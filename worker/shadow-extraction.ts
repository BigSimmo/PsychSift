import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { terminateProcessTree } from "../src/lib/extractors/document";
import { safeErrorLogDetails } from "../src/lib/privacy";
import type { ExtractedDocument } from "../src/lib/types";

// Packet B4 — Docling worker shadow mode (docs/rag-improvement/README.md §B4), authorised by
// the Gate B PASS of 2026-08-18 (docs/rag-improvement/gate-b-decision-record-2026-08-18.md).
//
// Contract:
//   - Runs ONLY after the legacy index generation has been committed (worker/main.ts calls
//     this after commitDocumentIndexGeneration), so the live index never depends on it.
//   - Runs on a deterministic 1–5 % cohort of PDFs selected by index-quality signals
//     (tables / OCR / layout — the Gate B weak-point strata).
//   - Produces an AGGREGATE, numbers-only record for documents.metadata.shadow_extraction.
//     No chunk, embedding, index-unit, table-fact, or document_index_quality write, ever.
//   - FAIL-OPEN: runShadowExtraction never throws and never blocks the ingestion job.
//   - Bounded: per-document timeout equal to the Gate B lab cap, a page cap, and at most one
//     docling process per worker regardless of WORKER_CONCURRENCY.
//   - Kill switch / one-step rollback: WORKER_DOCUMENT_EXTRACTOR_MODE=legacy (no migration,
//     no reindex).

export const SHADOW_EXTRACTION_RECORD_VERSION = 1;
/** Salting the bucket re-rolls the cohort when the extractor identity changes. */
export const SHADOW_EXTRACTION_COHORT_SALT = "docling-shadow-v1";
/** Same per-document wall-clock cap as eval/docling (report/lab-config.json), so a `timeout`
 *  outcome here is comparable with the recorded Gate B resource gate. */
export const SHADOW_EXTRACTION_TIMEOUT_MS = 120_000;
/** Docling ran eager at ~9–19 s/doc on 2 CPUs for small lab fixtures; real guideline PDFs are
 *  longer, so cohort documents above this page count are recorded as skipped, not run. */
export const SHADOW_EXTRACTION_MAX_PAGES = 40;
/** Numeric-token proxy for the Gate B exactness measure. Must stay identical to
 *  NUMERIC_TOKEN_PATTERN in worker/python/shadow_docling_extract.py (ASCII digits only —
 *  Python's \d is Unicode-wide). */
export const SHADOW_NUMERIC_TOKEN_PATTERN = "[0-9]+(?:[.,][0-9]+)?";
export const SHADOW_COHORT_SIGNALS = ["tables", "ocr", "layout"] as const;
export const SHADOW_EXTRACTION_OUTCOMES = [
  "ok",
  "extraction_failed",
  "timeout",
  "runtime_unavailable",
  "process_error",
  "skipped_page_cap",
  "skipped_concurrent",
] as const;

const OCR_COVERAGE_SIGNAL_THRESHOLD = 0.25;
const RESULT_FILE_MAX_BYTES = 1024 * 1024;
const STREAM_TAIL_MAX_BYTES = 16 * 1024;
const RUNTIME_UNAVAILABLE_EXIT_CODE = 20;
const EXTRACTION_FAILED_EXIT_CODE = 10;

export type ShadowCohortSignal = (typeof SHADOW_COHORT_SIGNALS)[number];
export type ShadowExtractionOutcome = (typeof SHADOW_EXTRACTION_OUTCOMES)[number];

export type ShadowExtractionConfig = {
  mode: "legacy" | "shadow";
  cohortPercent: number;
  pythonBin: string | undefined;
  timeoutMs?: number;
  maxPages?: number;
};

/** The slice of the worker's initial index-quality payload the cohort predicate reads. */
export type ShadowQualityInput = {
  issues: readonly string[];
  metrics: Record<string, unknown>;
};

export type ShadowLegacySummary = {
  page_count: number;
  text_character_count: number;
  ocr_page_count: number;
  table_count: number;
  table_row_count: number;
  numeric_token_count: number;
  wall_ms: number | null;
};

export type ShadowDoclingSummary = {
  page_count: number;
  text_character_count: number;
  table_count: number;
  table_cell_count: number;
  numeric_token_count: number;
};

export type ShadowDelta = {
  page_count: number;
  text_character_ratio: number | null;
  table_count: number;
  numeric_token_ratio: number | null;
};

/**
 * Fixed-shape record. Every key is always present in the emitted patch; values are numbers,
 * fixed-vocabulary strings, or null. `apply_document_metadata_patch` (jsonb_merge_deep)
 * deletes a key on JSON null, so a non-ok run deliberately emits `docling: null` /
 * `delta: null` to clear a previous run's numbers on the row. Never emit `undefined` (dropped
 * by JSON.stringify — the previous run's value would survive the merge) and never `{}` for a
 * nested object (deep-merge would keep stale sub-keys).
 */
export type ShadowExtractionRecord = {
  version: number;
  extractor: "docling";
  mode: "shadow";
  index_generation_id: string;
  cohort_percent: number;
  cohort_bucket: number;
  cohort_signals: ShadowCohortSignal[];
  outcome: ShadowExtractionOutcome;
  error_kind: string | null;
  measured_at: string;
  docling_version: string | null;
  wall_ms: number | null;
  peak_rss_bytes: number | null;
  exit_code: number | null;
  docling: ShadowDoclingSummary | null;
  legacy: ShadowLegacySummary;
  delta: ShadowDelta | null;
};

export type ShadowRunnerInput = {
  buffer: Buffer;
  pythonBin: string;
  timeoutMs: number;
};

export type ShadowRunnerResult = {
  exitCode: number | null;
  timedOut: boolean;
  wallMs: number;
  /** Parsed JSON from the result file, or null when absent/unparseable. Validated downstream. */
  payload: unknown;
  /** Node spawn error code (e.g. ENOENT when the interpreter is missing). */
  spawnErrorCode: string | null;
};

export type ShadowScriptRunner = (input: ShadowRunnerInput) => Promise<ShadowRunnerResult>;

// Numbers-only view of the Python payload. Unknown keys (e.g. any accidental `text`) are
// stripped by zod, so extracted content can never reach documents.metadata.
const nonNegativeInt = z.number().int().nonnegative();
const doclingPayloadSchema = z.object({
  ok: z.boolean(),
  docling_version: z
    .string()
    .regex(/^\d+\.\d+\.\d+[0-9A-Za-z.+-]{0,24}$/)
    .nullable()
    .optional(),
  error_kind: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .nullable()
    .optional(),
  page_count: nonNegativeInt.optional(),
  text_character_count: nonNegativeInt.optional(),
  table_count: nonNegativeInt.optional(),
  table_cell_count: nonNegativeInt.optional(),
  numeric_token_count: nonNegativeInt.optional(),
  peak_rss_bytes: nonNegativeInt.nullable().optional(),
});

export function isPdfDocument(args: { fileName: string; mimeType: string }) {
  // Same predicate as extractDocument (src/lib/extractors/document.ts).
  return args.mimeType === "application/pdf" || args.fileName.toLowerCase().endsWith(".pdf");
}

/** Deterministic 0–99 bucket: sha256("<salt>:<documentId>") first 32 bits mod 100. */
export function shadowCohortBucket(documentId: string, salt = SHADOW_EXTRACTION_COHORT_SALT) {
  const digest = createHash("sha256").update(`${salt}:${documentId}`).digest("hex");
  return Number.parseInt(digest.slice(0, 8), 16) % 100;
}

export function countNumericTokens(text: string) {
  const matches = text.match(new RegExp(SHADOW_NUMERIC_TOKEN_PATTERN, "g"));
  return matches ? matches.length : 0;
}

function tableRowCount(image: ExtractedDocument["images"][number]) {
  const rows = image.metadata?.table_rows;
  return Array.isArray(rows) ? rows.length : 0;
}

export function summarizeLegacyExtraction(
  extracted: ExtractedDocument,
  wallMs: number | null | undefined,
): ShadowLegacySummary {
  const tableImages = extracted.images.filter((image) => image.sourceKind === "table_crop");
  return {
    page_count: extracted.pages.length,
    text_character_count: extracted.pages.reduce((sum, page) => sum + page.text.length, 0),
    ocr_page_count: extracted.pages.filter((page) => page.ocrUsed).length,
    table_count: tableImages.length,
    table_row_count: tableImages.reduce((sum, image) => sum + tableRowCount(image), 0),
    numeric_token_count: extracted.pages.reduce((sum, page) => sum + countNumericTokens(page.text), 0),
    wall_ms: typeof wallMs === "number" && Number.isFinite(wallMs) ? Math.max(0, Math.round(wallMs)) : null,
  };
}

function metricNumber(metrics: Record<string, unknown>, key: string) {
  const value = Number(metrics[key]);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Cohort signals from the legacy result and the initial index-quality assessment. These are
 * the Gate B weak-point strata (tables / scanned OCR / multi-column layout); the layout signal
 * is a proxy — legacy could not recover heading or section structure.
 */
export function shadowCohortSignals(args: {
  legacy: ShadowLegacySummary;
  quality: ShadowQualityInput;
}): ShadowCohortSignal[] {
  const issues = new Set(args.quality.issues);
  const signals: ShadowCohortSignal[] = [];
  if (args.legacy.table_count > 0 || issues.has("low table row extraction coverage")) signals.push("tables");
  if (
    metricNumber(args.quality.metrics, "ocr_coverage") >= OCR_COVERAGE_SIGNAL_THRESHOLD ||
    metricNumber(args.quality.metrics, "needs_ocr_page_count") > 0
  ) {
    signals.push("ocr");
  }
  if (issues.has("low heading density") || issues.has("low section path coverage")) signals.push("layout");
  return signals;
}

export type ShadowCohortDecision = {
  selected: boolean;
  isPdf: boolean;
  bucket: number;
  signals: ShadowCohortSignal[];
};

export function selectShadowCohort(args: {
  documentId: string;
  fileName: string;
  mimeType: string;
  legacy: ShadowLegacySummary;
  quality: ShadowQualityInput;
  cohortPercent: number;
}): ShadowCohortDecision {
  const isPdf = isPdfDocument(args);
  const bucket = shadowCohortBucket(args.documentId);
  const signals = shadowCohortSignals({ legacy: args.legacy, quality: args.quality });
  const percent = Math.min(100, Math.max(0, Math.floor(args.cohortPercent)));
  return {
    selected: isPdf && signals.length > 0 && bucket < percent,
    isPdf,
    bucket,
    signals,
  };
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(3)) : null;
}

export function buildShadowDelta(docling: ShadowDoclingSummary, legacy: ShadowLegacySummary): ShadowDelta {
  return {
    page_count: docling.page_count - legacy.page_count,
    text_character_ratio: ratio(docling.text_character_count, legacy.text_character_count),
    table_count: docling.table_count - legacy.table_count,
    numeric_token_ratio: ratio(docling.numeric_token_count, legacy.numeric_token_count),
  };
}

type RecordBase = {
  indexGenerationId: string;
  cohortPercent: number;
  bucket: number;
  signals: ShadowCohortSignal[];
  legacy: ShadowLegacySummary;
  measuredAt: string;
};

function baseRecord(base: RecordBase, outcome: ShadowExtractionOutcome): ShadowExtractionRecord {
  return {
    version: SHADOW_EXTRACTION_RECORD_VERSION,
    extractor: "docling",
    mode: "shadow",
    index_generation_id: base.indexGenerationId,
    cohort_percent: base.cohortPercent,
    cohort_bucket: base.bucket,
    cohort_signals: [...base.signals],
    outcome,
    error_kind: null,
    measured_at: base.measuredAt,
    docling_version: null,
    wall_ms: null,
    peak_rss_bytes: null,
    exit_code: null,
    docling: null,
    legacy: { ...base.legacy },
    delta: null,
  };
}

/** Map a runner result onto the fixed-shape record. Pure; unit-tested. */
export function buildShadowExtractionRecord(base: RecordBase, result: ShadowRunnerResult): ShadowExtractionRecord {
  const parsed = doclingPayloadSchema.safeParse(result.payload);
  const payload = parsed.success ? parsed.data : null;
  const wallMs = Number.isFinite(result.wallMs) ? Math.max(0, Math.round(result.wallMs)) : null;

  let outcome: ShadowExtractionOutcome;
  if (result.timedOut) outcome = "timeout";
  else if (result.spawnErrorCode === "ENOENT" || result.exitCode === RUNTIME_UNAVAILABLE_EXIT_CODE) {
    outcome = "runtime_unavailable";
  } else if (result.spawnErrorCode) outcome = "process_error";
  else if (result.exitCode === EXTRACTION_FAILED_EXIT_CODE || (payload && !payload.ok)) outcome = "extraction_failed";
  else if (
    result.exitCode === 0 &&
    payload?.ok &&
    payload.page_count !== undefined &&
    payload.text_character_count !== undefined &&
    payload.table_count !== undefined &&
    payload.table_cell_count !== undefined &&
    payload.numeric_token_count !== undefined
  ) {
    outcome = "ok";
  } else outcome = "process_error";

  const record = baseRecord(base, outcome);
  record.wall_ms = wallMs;
  record.exit_code = typeof result.exitCode === "number" ? result.exitCode : null;
  record.docling_version = payload?.docling_version ?? null;
  record.peak_rss_bytes = payload?.peak_rss_bytes ?? null;
  record.error_kind = outcome === "ok" ? null : (payload?.error_kind ?? null);
  if (outcome === "ok" && payload) {
    const docling: ShadowDoclingSummary = {
      page_count: payload.page_count ?? 0,
      text_character_count: payload.text_character_count ?? 0,
      table_count: payload.table_count ?? 0,
      table_cell_count: payload.table_cell_count ?? 0,
      numeric_token_count: payload.numeric_token_count ?? 0,
    };
    record.docling = docling;
    record.delta = buildShadowDelta(docling, base.legacy);
  }
  return record;
}

function appendTail(current: string, chunk: Buffer | string) {
  const next = current + chunk.toString();
  return next.length > STREAM_TAIL_MAX_BYTES ? next.slice(next.length - STREAM_TAIL_MAX_BYTES) : next;
}

/**
 * The parser receives untrusted original bytes after the legacy index has committed. Pass
 * runtime settings explicitly instead of inheriting the worker's credentials, proxies and
 * interpreter injection variables. This reduces exposure; it is not an OS sandbox.
 * Model caches may be shared only inside the explicitly configured artifact directory.
 */
export function buildDoclingShadowEnvironment(
  workDir: string,
  environment: Partial<NodeJS.ProcessEnv> = process.env,
): NodeJS.ProcessEnv {
  // Next augments ProcessEnv with required NODE_ENV. Keep it explicit and benign;
  // the Python child must never inherit the parent's environment wholesale.
  const childEnvironment: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const key of [
    "PATH",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TESSDATA_PREFIX",
    "OMP_NUM_THREADS",
    "MKL_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
    "TOKENIZERS_PARALLELISM",
  ]) {
    if (environment[key] !== undefined) childEnvironment[key] = environment[key];
  }
  const artifacts = environment.DOCLING_ARTIFACTS_PATH?.trim();
  if (artifacts) childEnvironment.DOCLING_ARTIFACTS_PATH = artifacts;
  const artifactCache = (value: string | undefined) => {
    if (!artifacts || !path.isAbsolute(artifacts) || !value || !path.isAbsolute(value)) return undefined;
    const root = path.resolve(artifacts);
    if (root === path.parse(root).root) return undefined;
    const relative = path.relative(root, path.resolve(value));
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) ? value : undefined;
  };
  const cache = path.join(workDir, "cache");
  const hfHome = artifactCache(environment.HF_HOME) ?? path.join(cache, "huggingface");
  const hub =
    artifactCache(environment.HF_HUB_CACHE) ??
    artifactCache(environment.HUGGINGFACE_HUB_CACHE) ??
    path.join(hfHome, "hub");
  return {
    ...childEnvironment,
    HOME: path.join(workDir, "home"),
    USERPROFILE: path.join(workDir, "home"),
    TMPDIR: path.join(workDir, "tmp"),
    TEMP: path.join(workDir, "tmp"),
    TMP: path.join(workDir, "tmp"),
    XDG_CACHE_HOME: cache,
    HF_HOME: hfHome,
    HF_HUB_CACHE: hub,
    HUGGINGFACE_HUB_CACHE: artifactCache(environment.HUGGINGFACE_HUB_CACHE) ?? hub,
    HF_DATASETS_CACHE: artifactCache(environment.HF_DATASETS_CACHE) ?? path.join(cache, "huggingface", "datasets"),
    TRANSFORMERS_CACHE: artifactCache(environment.TRANSFORMERS_CACHE) ?? hub,
    TORCH_HOME: artifactCache(environment.TORCH_HOME) ?? path.join(cache, "torch"),
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONUNBUFFERED: "1",
    TORCHDYNAMO_DISABLE: "1",
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    HF_DATASETS_OFFLINE: "1",
    HF_HUB_DISABLE_TELEMETRY: "1",
  };
}

/**
 * Default runner: writes the PDF to a private temp dir, spawns the docling venv interpreter on
 * worker/python/shadow_docling_extract.py, kills the whole process tree at the deadline, and
 * returns the parsed result file. stdout/stderr are never persisted (a bounded tail is kept
 * only for the warn log through safeErrorLogDetails). Eager torch and offline HF are forced so
 * the run matches the Gate B lab configuration and never fetches models at run time.
 */
export const runDoclingShadowScript: ShadowScriptRunner = async (input) => {
  const scriptPath = path.join(process.cwd(), "worker", "python", "shadow_docling_extract.py");
  const workDir = await mkdtemp(path.join(tmpdir(), "clinical-kb-shadow-"));
  const pdfPath = path.join(workDir, "document.pdf");
  const resultPath = path.join(workDir, "result.json");
  const startedAt = Date.now();
  try {
    for (const directory of ["home", "tmp", "cache"]) {
      await mkdir(path.join(workDir, directory), { mode: 0o700 });
    }
    await writeFile(pdfPath, input.buffer);
    const spawnResult = await new Promise<Omit<ShadowRunnerResult, "payload" | "wallMs"> & { stderrTail: string }>(
      (resolve) => {
        const child = spawn(input.pythonBin, [scriptPath, pdfPath, resultPath], {
          cwd: process.cwd(),
          env: buildDoclingShadowEnvironment(workDir),
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
          windowsHide: true,
        });
        let stderrTail = "";
        let timedOut = false;
        let settled = false;
        const finish = (value: Omit<ShadowRunnerResult, "payload" | "wallMs">) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ ...value, stderrTail });
        };
        const timer = setTimeout(() => {
          timedOut = true;
          // Settle once the tree kill has run even if no `close` event follows (finish is
          // idempotent, so a racing `close` still wins with its real exit code).
          void terminateProcessTree(child)
            .catch(() => undefined)
            .then(() => finish({ exitCode: null, timedOut: true, spawnErrorCode: null }));
        }, input.timeoutMs);
        timer.unref();
        child.stdout?.on("data", () => {
          // Aggregates travel through the result file; stdout is intentionally discarded.
        });
        child.stderr?.on("data", (chunk) => {
          stderrTail = appendTail(stderrTail, chunk);
        });
        child.once("error", (error) => {
          const code = (error as NodeJS.ErrnoException).code ?? "SPAWN_ERROR";
          finish({ exitCode: null, timedOut, spawnErrorCode: code });
        });
        child.once("close", (code) => {
          finish({ exitCode: typeof code === "number" ? code : null, timedOut, spawnErrorCode: null });
        });
      },
    );
    const wallMs = Date.now() - startedAt;
    let payload: unknown = null;
    try {
      const info = await stat(resultPath);
      if (info.size <= RESULT_FILE_MAX_BYTES) {
        payload = JSON.parse(await readFile(resultPath, "utf8"));
      }
    } catch {
      payload = null;
    }
    if (spawnResult.exitCode !== 0 && spawnResult.stderrTail) {
      console.warn(
        "Shadow extraction script reported an error",
        safeErrorLogDetails(new Error(spawnResult.stderrTail.slice(-512))),
      );
    }
    return {
      exitCode: spawnResult.exitCode,
      timedOut: spawnResult.timedOut,
      spawnErrorCode: spawnResult.spawnErrorCode,
      wallMs,
      payload,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

let shadowInFlight = false;

/** Test seam only. */
export function resetShadowExtractionStateForTests() {
  shadowInFlight = false;
}

export type ShadowExtractionInput = {
  documentId: string;
  indexGenerationId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  legacy: ExtractedDocument;
  legacyWallMs: number | null;
  quality: ShadowQualityInput;
};

/**
 * Decide, run (bounded), and summarise. Returns null when the mode is `legacy` or the document
 * is not in the cohort — the caller then writes nothing. Never throws.
 */
export async function runShadowExtraction(
  input: ShadowExtractionInput,
  options: {
    config: ShadowExtractionConfig;
    runner?: ShadowScriptRunner;
    now?: () => Date;
  },
): Promise<ShadowExtractionRecord | null> {
  const { config } = options;
  if (config.mode !== "shadow") return null;
  const now = options.now ?? (() => new Date());
  const runner = options.runner ?? runDoclingShadowScript;

  try {
    const legacy = summarizeLegacyExtraction(input.legacy, input.legacyWallMs);
    const decision = selectShadowCohort({
      documentId: input.documentId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      legacy,
      quality: input.quality,
      cohortPercent: config.cohortPercent,
    });
    if (!decision.selected) return null;

    const base: RecordBase = {
      indexGenerationId: input.indexGenerationId,
      cohortPercent: config.cohortPercent,
      bucket: decision.bucket,
      signals: decision.signals,
      legacy,
      measuredAt: now().toISOString(),
    };
    const maxPages = config.maxPages ?? SHADOW_EXTRACTION_MAX_PAGES;
    if (legacy.page_count > maxPages) return baseRecord(base, "skipped_page_cap");
    if (!config.pythonBin) return baseRecord(base, "runtime_unavailable");
    if (shadowInFlight) return baseRecord(base, "skipped_concurrent");

    shadowInFlight = true;
    try {
      const result = await runner({
        buffer: input.buffer,
        pythonBin: config.pythonBin,
        timeoutMs: config.timeoutMs ?? SHADOW_EXTRACTION_TIMEOUT_MS,
      });
      const record = buildShadowExtractionRecord(base, result);
      record.measured_at = now().toISOString();
      if (record.outcome !== "ok") {
        console.warn(
          `Shadow extraction outcome=${record.outcome} exit_code=${record.exit_code ?? "none"} wall_ms=${record.wall_ms ?? "none"}`,
        );
      }
      return record;
    } catch (error) {
      console.warn("Shadow extraction failed; continuing without a measurement", safeErrorLogDetails(error));
      return baseRecord(base, "process_error");
    } finally {
      shadowInFlight = false;
    }
  } catch (error) {
    // Cohort selection itself must never take the job down.
    console.warn("Shadow extraction skipped after an internal error", safeErrorLogDetails(error));
    return null;
  }
}
