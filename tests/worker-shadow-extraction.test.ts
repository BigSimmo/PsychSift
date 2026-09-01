import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SHADOW_EXTRACTION_MAX_PAGES,
  SHADOW_EXTRACTION_OUTCOMES,
  SHADOW_EXTRACTION_RECORD_VERSION,
  SHADOW_NUMERIC_TOKEN_PATTERN,
  buildShadowExtractionRecord,
  countNumericTokens,
  resetShadowExtractionStateForTests,
  runShadowExtraction,
  selectShadowCohort,
  shadowCohortBucket,
  shadowCohortSignals,
  summarizeLegacyExtraction,
  type ShadowExtractionRecord,
  type ShadowLegacySummary,
  type ShadowRunnerResult,
  type ShadowScriptRunner,
} from "../worker/shadow-extraction";
import type { ExtractedDocument } from "../src/lib/types";

// Packet B4 contract tests. Every test injects a fake runner — CI has no docling. The
// load-bearing invariants: (1) FAIL-OPEN, runShadowExtraction never throws; (2) AGGREGATE
// ONLY, no extracted text can reach the record; (3) the cohort is deterministic and bounded;
// (4) worker/main.ts calls it only after the legacy generation is committed and writes the
// record only through the existing final metadata merge.

const CANARY = "CANARY-SHADOW-LEAK-TOKEN";

const workerMain = readFileSync(new URL("../worker/main.ts", import.meta.url), "utf8");
const shadowSource = readFileSync(new URL("../worker/shadow-extraction.ts", import.meta.url), "utf8");
const pythonRunner = readFileSync(new URL("../worker/python/shadow_docling_extract.py", import.meta.url), "utf8");
const envSource = readFileSync(new URL("../src/lib/env.ts", import.meta.url), "utf8");
const dockerfileWorker = readFileSync(new URL("../Dockerfile.worker", import.meta.url), "utf8");

function legacyDoc(overrides: Partial<ExtractedDocument> = {}): ExtractedDocument {
  return {
    pages: [
      { pageNumber: 1, text: "Lithium 0.6-1.0 mmol/L target; 250 mg bd", ocrUsed: false },
      { pageNumber: 2, text: `${CANARY} monitoring at 12 weeks`, ocrUsed: true },
    ],
    images: [
      {
        pageNumber: 1,
        path: "/tmp/x/images/table-1.png",
        mimeType: "image/png",
        sourceKind: "table_crop",
        metadata: {
          table_rows: [
            ["a", "b"],
            ["c", "d"],
            ["e", "f"],
          ],
        },
      },
      { pageNumber: 2, path: "/tmp/x/images/fig-1.png", mimeType: "image/png", sourceKind: "diagram_crop" },
    ],
    ...overrides,
  };
}

const NO_SIGNAL_QUALITY = { issues: [] as string[], metrics: { ocr_coverage: 0, needs_ocr_page_count: 0 } };

function findDocumentId(predicate: (bucket: number) => boolean) {
  for (let index = 0; index < 100_000; index += 1) {
    const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    if (predicate(shadowCohortBucket(id))) return id;
  }
  throw new Error("no document id satisfied the bucket predicate");
}

const IN_COHORT_ID = findDocumentId((bucket) => bucket === 0);
const OUT_OF_COHORT_ID = findDocumentId((bucket) => bucket >= 50);

function okPayload(overrides: Record<string, unknown> = {}) {
  return {
    engine: "docling",
    ok: true,
    docling_version: "2.120.2",
    page_count: 2,
    text_character_count: 120,
    table_count: 2,
    table_cell_count: 9,
    numeric_token_count: 6,
    peak_rss_bytes: 1_400_000_000,
    ...overrides,
  };
}

function runnerResult(overrides: Partial<ShadowRunnerResult> = {}): ShadowRunnerResult {
  return { exitCode: 0, timedOut: false, wallMs: 12_345, payload: okPayload(), spawnErrorCode: null, ...overrides };
}

const baseRecordInput = (legacy: ShadowLegacySummary) => ({
  indexGenerationId: "11111111-1111-4111-8111-111111111111",
  cohortPercent: 2,
  bucket: 0,
  signals: ["tables" as const],
  legacy,
  measuredAt: "2026-08-19T00:00:00.000Z",
});

function shadowConfig(overrides: Partial<Parameters<typeof runShadowExtraction>[1]["config"]> = {}) {
  return { mode: "shadow" as const, cohortPercent: 2, pythonBin: "/opt/docling-venv/bin/python", ...overrides };
}

function shadowInput(overrides: Partial<Parameters<typeof runShadowExtraction>[0]> = {}) {
  return {
    documentId: IN_COHORT_ID,
    indexGenerationId: "11111111-1111-4111-8111-111111111111",
    fileName: "guideline.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 fake"),
    legacy: legacyDoc(),
    legacyWallMs: 980,
    quality: NO_SIGNAL_QUALITY,
    ...overrides,
  };
}

/** Mirror of public.jsonb_merge_deep (see tests/document-metadata-merge.test.ts). */
function jsonbMergeDeep(
  targetObj: Record<string, unknown> | null | undefined,
  patchObj: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(targetObj ?? {}) };
  for (const [key, incoming] of Object.entries(patchObj ?? {})) {
    if (incoming === null) {
      delete merged[key];
      continue;
    }
    const existing = merged[key];
    if (
      existing !== null &&
      typeof existing === "object" &&
      !Array.isArray(existing) &&
      typeof incoming === "object" &&
      !Array.isArray(incoming)
    ) {
      merged[key] = jsonbMergeDeep(existing as Record<string, unknown>, incoming as Record<string, unknown>);
    } else {
      merged[key] = incoming;
    }
  }
  return merged;
}

afterEach(() => {
  resetShadowExtractionStateForTests();
  vi.restoreAllMocks();
});

describe("shadow cohort selection", () => {
  it("buckets deterministically and lands close to the configured percentage", () => {
    expect(shadowCohortBucket("abc")).toBe(shadowCohortBucket("abc"));
    expect(shadowCohortBucket("abc")).not.toBe(shadowCohortBucket("abd"));
    const sample = 20_000;
    let selected = 0;
    for (let index = 0; index < sample; index += 1) {
      if (shadowCohortBucket(`doc-${index}`) < 2) selected += 1;
    }
    const share = selected / sample;
    expect(share).toBeGreaterThan(0.015);
    expect(share).toBeLessThan(0.025);
  });

  it("derives the tables / ocr / layout signals from the legacy result and index-quality output", () => {
    const legacy = summarizeLegacyExtraction(legacyDoc(), 980);
    expect(shadowCohortSignals({ legacy, quality: NO_SIGNAL_QUALITY })).toEqual(["tables"]);

    const noTables = summarizeLegacyExtraction(legacyDoc({ images: [] }), 980);
    expect(shadowCohortSignals({ legacy: noTables, quality: NO_SIGNAL_QUALITY })).toEqual([]);
    expect(
      shadowCohortSignals({
        legacy: noTables,
        quality: { issues: ["low table row extraction coverage"], metrics: {} },
      }),
    ).toEqual(["tables"]);
    expect(shadowCohortSignals({ legacy: noTables, quality: { issues: [], metrics: { ocr_coverage: 0.5 } } })).toEqual([
      "ocr",
    ]);
    expect(
      shadowCohortSignals({ legacy: noTables, quality: { issues: [], metrics: { needs_ocr_page_count: 1 } } }),
    ).toEqual(["ocr"]);
    expect(
      shadowCohortSignals({ legacy: noTables, quality: { issues: ["low heading density"], metrics: {} } }),
    ).toEqual(["layout"]);
    expect(
      shadowCohortSignals({ legacy: noTables, quality: { issues: ["low section path coverage"], metrics: {} } }),
    ).toEqual(["layout"]);
    // Sub-threshold OCR coverage and unrelated issues do not select.
    expect(
      shadowCohortSignals({
        legacy: noTables,
        quality: { issues: ["no memory cards"], metrics: { ocr_coverage: 0.1 } },
      }),
    ).toEqual([]);
  });

  it("selects only PDFs with at least one signal inside the percentage bucket", () => {
    const legacy = summarizeLegacyExtraction(legacyDoc(), 980);
    const base = {
      fileName: "g.pdf",
      mimeType: "application/pdf",
      legacy,
      quality: NO_SIGNAL_QUALITY,
      cohortPercent: 2,
    };
    expect(selectShadowCohort({ ...base, documentId: IN_COHORT_ID })).toMatchObject({
      selected: true,
      isPdf: true,
      bucket: 0,
      signals: ["tables"],
    });
    expect(selectShadowCohort({ ...base, documentId: OUT_OF_COHORT_ID }).selected).toBe(false);
    expect(
      selectShadowCohort({ ...base, documentId: IN_COHORT_ID, fileName: "notes.docx", mimeType: "application/msword" })
        .selected,
    ).toBe(false);
    expect(
      selectShadowCohort({
        ...base,
        documentId: IN_COHORT_ID,
        legacy: summarizeLegacyExtraction(legacyDoc({ images: [] }), 980),
      }).selected,
    ).toBe(false);
    // The bucket predicate is strict: percent 1 excludes bucket 1, percent 2 includes it.
    const bucketOneId = findDocumentId((bucket) => bucket === 1);
    expect(selectShadowCohort({ ...base, documentId: bucketOneId, cohortPercent: 1 }).selected).toBe(false);
    expect(selectShadowCohort({ ...base, documentId: bucketOneId, cohortPercent: 2 }).selected).toBe(true);
  });
});

describe("shadow legacy summary and numeric-token parity", () => {
  it("summarises the legacy extraction into numbers only", () => {
    expect(summarizeLegacyExtraction(legacyDoc(), 980.6)).toEqual({
      page_count: 2,
      text_character_count: legacyDoc().pages.reduce((sum, page) => sum + page.text.length, 0),
      ocr_page_count: 1,
      table_count: 1,
      table_row_count: 3,
      numeric_token_count: 4, // 0.6, 1.0, 250, 12
      wall_ms: 981,
    });
    expect(summarizeLegacyExtraction(legacyDoc(), null).wall_ms).toBeNull();
    expect(JSON.stringify(summarizeLegacyExtraction(legacyDoc(), 1))).not.toContain(CANARY);
  });

  it("uses the same ASCII numeric-token pattern as the Python runner", () => {
    expect(pythonRunner).toContain(`NUMERIC_TOKEN_PATTERN = re.compile(r"${SHADOW_NUMERIC_TOKEN_PATTERN}")`);
    expect(countNumericTokens("0.6-1.0 mmol/L, 250 mg, ٣ tablets")).toBe(3);
    expect(countNumericTokens("")).toBe(0);
  });
});

describe("shadow record construction", () => {
  const legacy = summarizeLegacyExtraction(legacyDoc(), 980);

  it("maps a successful run onto the fixed-shape record with deltas", () => {
    const record = buildShadowExtractionRecord(baseRecordInput(legacy), runnerResult());
    expect(record).toMatchObject({
      version: SHADOW_EXTRACTION_RECORD_VERSION,
      extractor: "docling",
      mode: "shadow",
      outcome: "ok",
      error_kind: null,
      docling_version: "2.120.2",
      wall_ms: 12_345,
      peak_rss_bytes: 1_400_000_000,
      exit_code: 0,
      docling: {
        page_count: 2,
        text_character_count: 120,
        table_count: 2,
        table_cell_count: 9,
        numeric_token_count: 6,
      },
      delta: { page_count: 0, table_count: 1, numeric_token_ratio: 1.5 },
    });
    expect(record.delta?.text_character_ratio).toBeCloseTo(120 / legacy.text_character_count, 3);
  });

  it("classifies runtime, timeout, extraction and process failures without extracted content", () => {
    const outcomes = {
      exit20: buildShadowExtractionRecord(
        baseRecordInput(legacy),
        runnerResult({ exitCode: 20, payload: { ok: false, error_kind: "runtime_unavailable" } }),
      ),
      enoent: buildShadowExtractionRecord(
        baseRecordInput(legacy),
        runnerResult({ exitCode: null, payload: null, spawnErrorCode: "ENOENT" }),
      ),
      timeout: buildShadowExtractionRecord(
        baseRecordInput(legacy),
        runnerResult({ exitCode: null, timedOut: true, payload: null }),
      ),
      exit10: buildShadowExtractionRecord(
        baseRecordInput(legacy),
        runnerResult({ exitCode: 10, payload: { ok: false, error_kind: "ConversionError", message: CANARY } }),
      ),
      crash: buildShadowExtractionRecord(baseRecordInput(legacy), runnerResult({ exitCode: 1, payload: null })),
      badNumbers: buildShadowExtractionRecord(
        baseRecordInput(legacy),
        runnerResult({ payload: okPayload({ page_count: -1 }) }),
      ),
    };
    expect(outcomes.exit20.outcome).toBe("runtime_unavailable");
    expect(outcomes.enoent.outcome).toBe("runtime_unavailable");
    expect(outcomes.timeout.outcome).toBe("timeout");
    expect(outcomes.exit10.outcome).toBe("extraction_failed");
    expect(outcomes.exit10.error_kind).toBe("ConversionError");
    expect(outcomes.crash.outcome).toBe("process_error");
    expect(outcomes.badNumbers.outcome).toBe("process_error");
    for (const record of Object.values(outcomes)) {
      expect(record.docling).toBeNull();
      expect(record.delta).toBeNull();
      expect(JSON.stringify(record)).not.toContain(CANARY);
      expect(SHADOW_EXTRACTION_OUTCOMES).toContain(record.outcome);
    }
  });

  it("strips unknown payload keys so extracted text can never reach documents.metadata", () => {
    const record = buildShadowExtractionRecord(
      baseRecordInput(legacy),
      runnerResult({ payload: okPayload({ text: CANARY, tables: [{ cells: [{ text: CANARY }] }], fileName: CANARY }) }),
    );
    expect(record.outcome).toBe("ok");
    expect(JSON.stringify(record)).not.toContain(CANARY);
    // Free-text strings are rejected in the two string slots the schema allows.
    const badVersion = buildShadowExtractionRecord(
      baseRecordInput(legacy),
      runnerResult({ payload: okPayload({ docling_version: CANARY }) }),
    );
    expect(badVersion.outcome).toBe("process_error");
    expect(JSON.stringify(badVersion)).not.toContain(CANARY);
    const badErrorKind = buildShadowExtractionRecord(
      baseRecordInput(legacy),
      runnerResult({ exitCode: 10, payload: { ok: false, error_kind: `bad kind ${CANARY}` } }),
    );
    expect(JSON.stringify(badErrorKind)).not.toContain(CANARY);
  });

  it("emits every key (never undefined) so jsonb_merge_deep clears stale numbers on a later non-ok run", () => {
    const first = buildShadowExtractionRecord(baseRecordInput(legacy), runnerResult());
    const second = buildShadowExtractionRecord(
      baseRecordInput(legacy),
      runnerResult({ exitCode: null, timedOut: true, payload: null, wallMs: 120_000 }),
    );
    for (const record of [first, second]) {
      const roundTrip = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
      expect(Object.keys(roundTrip).sort()).toEqual(Object.keys(record).sort());
      expect(Object.values(record)).not.toContain(undefined);
    }
    const row = jsonbMergeDeep(
      jsonbMergeDeep({ title: "kept" }, { shadow_extraction: first as unknown as Record<string, unknown> }),
      { shadow_extraction: second as unknown as Record<string, unknown> },
    );
    const merged = row.shadow_extraction as Record<string, unknown>;
    expect(row.title).toBe("kept");
    expect(merged.outcome).toBe("timeout");
    expect(merged.docling).toBeUndefined();
    expect(merged.delta).toBeUndefined();
    expect(merged.docling_version).toBeUndefined();
    expect(merged.legacy).toEqual(second.legacy);
  });
});

describe("runShadowExtraction (fail-open orchestration)", () => {
  it("returns null in legacy mode and for documents outside the cohort without calling the runner", async () => {
    const runner = vi.fn<ShadowScriptRunner>();
    await expect(
      runShadowExtraction(shadowInput(), { config: shadowConfig({ mode: "legacy" }), runner }),
    ).resolves.toBe(null);
    await expect(
      runShadowExtraction(shadowInput({ documentId: OUT_OF_COHORT_ID }), { config: shadowConfig(), runner }),
    ).resolves.toBe(null);
    await expect(
      runShadowExtraction(shadowInput({ fileName: "notes.docx", mimeType: "application/msword" }), {
        config: shadowConfig(),
        runner,
      }),
    ).resolves.toBe(null);
    expect(runner).not.toHaveBeenCalled();
  });

  it("records page-cap and missing-interpreter skips without spawning", async () => {
    const runner = vi.fn<ShadowScriptRunner>();
    const bigDoc = legacyDoc({
      pages: Array.from({ length: SHADOW_EXTRACTION_MAX_PAGES + 1 }, (_, index) => ({
        pageNumber: index + 1,
        text: "page",
      })),
    });
    const capped = await runShadowExtraction(shadowInput({ legacy: bigDoc }), { config: shadowConfig(), runner });
    expect(capped?.outcome).toBe("skipped_page_cap");
    expect(capped?.legacy.page_count).toBe(SHADOW_EXTRACTION_MAX_PAGES + 1);
    const noRuntime = await runShadowExtraction(shadowInput(), {
      config: shadowConfig({ pythonBin: undefined }),
      runner,
    });
    expect(noRuntime?.outcome).toBe("runtime_unavailable");
    expect(runner).not.toHaveBeenCalled();
  });

  it("runs the injected runner for cohort documents and stamps the record", async () => {
    const runner = vi.fn<ShadowScriptRunner>(async () => runnerResult());
    const record = await runShadowExtraction(shadowInput(), {
      config: shadowConfig(),
      runner,
      now: () => new Date("2026-08-19T01:02:03.000Z"),
    });
    expect(runner).toHaveBeenCalledWith({
      buffer: expect.any(Buffer),
      pythonBin: "/opt/docling-venv/bin/python",
      timeoutMs: 120_000,
    });
    expect(record).toMatchObject({
      outcome: "ok",
      cohort_percent: 2,
      cohort_bucket: 0,
      cohort_signals: ["tables"],
      index_generation_id: "11111111-1111-4111-8111-111111111111",
      measured_at: "2026-08-19T01:02:03.000Z",
      legacy: expect.objectContaining({ wall_ms: 980, table_count: 1 }),
    });
  });

  it("never throws: a runner exception becomes a process_error record", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const runner = vi.fn<ShadowScriptRunner>(async () => {
      throw new Error(`spawn exploded ${CANARY}`);
    });
    const record = await runShadowExtraction(shadowInput(), { config: shadowConfig(), runner });
    expect(record?.outcome).toBe("process_error");
    expect(JSON.stringify(record)).not.toContain(CANARY);
  });

  it("allows at most one docling process per worker and releases the slot afterwards", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner = vi.fn<ShadowScriptRunner>(async () => {
      await gate;
      return runnerResult();
    });
    const first = runShadowExtraction(shadowInput(), { config: shadowConfig(), runner });
    const second = await runShadowExtraction(shadowInput(), { config: shadowConfig(), runner });
    expect(second?.outcome).toBe("skipped_concurrent");
    release();
    expect((await first)?.outcome).toBe("ok");
    const third = await runShadowExtraction(shadowInput(), { config: shadowConfig(), runner });
    expect(third?.outcome).toBe("ok");
    expect(runner).toHaveBeenCalledTimes(2);
  });
});

describe("worker/main.ts + env + image contract (source text)", () => {
  it("runs the shadow extractor only after the legacy generation is committed and before the final metadata merge", () => {
    const commitIndex = workerMain.indexOf("await commitDocumentIndexGeneration({");
    const shadowCallIndex = workerMain.indexOf("shadowExtraction = await runShadowExtraction(");
    const finalMetadataIndex = workerMain.indexOf("const finalMetadata = {");
    const finalWriteIndex = workerMain.indexOf("metadata: finalMetadata,");
    expect(commitIndex).toBeGreaterThan(-1);
    expect(shadowCallIndex).toBeGreaterThan(commitIndex);
    expect(finalMetadataIndex).toBeGreaterThan(shadowCallIndex);
    expect(finalWriteIndex).toBeGreaterThan(finalMetadataIndex);
    expect(workerMain).toContain('if (env.WORKER_DOCUMENT_EXTRACTOR_MODE === "shadow") {');
    // Fail-open: the stage update before the shadow run must swallow a lost lease, otherwise
    // shadow mode could fail a job whose generation is already committed.
    const shadowStageUpdate = workerMain.slice(
      workerMain.indexOf('await updateJobProgress(job.id, { stage: "indexed; shadow extraction (docling)"'),
      workerMain.indexOf("const shadowHeartbeat = setInterval("),
    );
    expect(shadowStageUpdate).toMatch(/\.catch\(\s*\(\)\s*=>\s*\{\}\s*,?\s*\)/);
    // The record travels only inside finalMetadata (deep-merged by apply_document_metadata_patch).
    expect(workerMain.match(/shadow_extraction: shadowExtraction/g)).toHaveLength(1);
    expect(workerMain).toContain("...(shadowExtraction ? { shadow_extraction: shadowExtraction } : {})");
    // Legacy extraction is timed so the record can compare like with like.
    expect(workerMain).toContain("const legacyExtractionWallMs = Date.now() - legacyExtractionStartedAt;");
  });

  it("keeps the shadow module structurally unable to write to Supabase or the quality table", () => {
    // No Supabase client, RPC, table or upsert call exists in the module — the only sink for
    // the record is the finalMetadata merge in worker/main.ts (comments may name the tables).
    expect(shadowSource).not.toMatch(/supabase|createAdminClient|\.from\(|\.rpc\(|\.upsert\(|\.insert\(/);
    expect(shadowSource).toContain("terminateProcessTree");
    expect(shadowSource).toContain('TORCHDYNAMO_DISABLE: "1"');
    expect(shadowSource).toContain("HF_HUB_OFFLINE");
  });

  it("types the B4 env contract with a legacy default and the authorised 1-5 % window", () => {
    expect(envSource).toContain('WORKER_DOCUMENT_EXTRACTOR_MODE: z.enum(["legacy", "shadow"]).default("legacy")');
    expect(envSource).toContain(
      "WORKER_SHADOW_EXTRACTION_COHORT_PERCENT: z.coerce.number().int().min(1).max(5).default(2)",
    );
    expect(envSource).toMatch(/WORKER_DOCLING_PYTHON_BIN: z\s*\n?\s*\.string\(\)/);
  });

  it("provisions the docling venv from the Gate B lock without touching the OCR venv", () => {
    expect(dockerfileWorker).toContain("COPY eval/docling/requirements.txt /tmp/docling-requirements.txt");
    expect(dockerfileWorker).toContain("python3 -m venv /opt/docling-venv");
    expect(dockerfileWorker).toContain("/opt/docling-venv/bin/pip install --no-cache-dir --require-hashes");
    expect(dockerfileWorker).toContain("docling-tools models download --output-dir /opt/docling-models");
    expect(dockerfileWorker).toContain("ENV WORKER_DOCLING_PYTHON_BIN=/opt/docling-venv/bin/python");
    expect(dockerfileWorker).toContain("ENV DOCLING_ARTIFACTS_PATH=/opt/docling-models");
    expect(dockerfileWorker).toContain("ENV TORCHDYNAMO_DISABLE=1");
    expect(dockerfileWorker).toContain("ENV HF_HUB_OFFLINE=1");
    expect(dockerfileWorker).toContain("libgl1 libglib2.0-0");
    // The legacy OCR venv and its hashed lock are byte-for-byte the same contract.
    expect(dockerfileWorker).toContain(
      "/opt/ocr-venv/bin/pip install --no-cache-dir --upgrade --require-hashes -r worker/python/requirements.txt",
    );
    // The kill switch is a Railway variable, never baked into the image.
    expect(dockerfileWorker).not.toMatch(/^\s*ENV\s+WORKER_DOCUMENT_EXTRACTOR_MODE/m);
  });

  it("keeps the record type free of optional fields", () => {
    const typeBlock = shadowSource.slice(
      shadowSource.indexOf("export type ShadowExtractionRecord = {"),
      shadowSource.indexOf("export type ShadowRunnerInput"),
    );
    expect(typeBlock).not.toMatch(/\?:/);
    const sample: ShadowExtractionRecord = buildShadowExtractionRecord(
      baseRecordInput(summarizeLegacyExtraction(legacyDoc(), 1)),
      runnerResult(),
    );
    expect(Object.keys(sample)).toHaveLength(17);
  });
});

describe("worker source-anchored enrichment contract", () => {
  it("loads only the exact committed generation with bounded complete paging", () => {
    const start = workerMain.indexOf("async function loadEnrichmentRows");
    const end = workerMain.indexOf("async function processJob", start);
    const loader = workerMain.slice(start, end);
    expect(loader).toContain("documentId: string, indexGenerationId: string");
    expect(loader).toContain('index_generation_id');
    expect(loader).toContain('.eq("index_generation_id", indexGenerationId)');
    expect(loader).toContain('order("chunk_index", { ascending: true })');
    expect(loader).toContain('order("id", { ascending: true })');
    expect(loader).toContain("SOURCE_ANCHORED_MAX_CHUNKS");
    expect(loader).toContain("SOURCE_ANCHORED_MAX_IMAGES");
    expect(loader).toContain("source_anchored_summary_source_limit_exceeded");
  });

  it("passes the already-created generation to source loading and persistence", () => {
    expect(workerMain).toContain("loadEnrichmentRows(job.document_id, indexGenerationId)");
    expect(workerMain).toMatch(/upsertDocumentEnrichment\(\{[\s\S]*?indexGenerationId,[\s\S]*?chunks:/);
    expect(workerMain).not.toMatch(/loadEnrichmentRows\(job\.document_id\)/);
  });

  it("runs the local source-policy preflight before summary provider or persistence work", () => {
    const start = workerMain.indexOf("const enrichmentRows = await loadEnrichmentRows");
    const end = workerMain.indexOf("const enrichment = await upsertDocumentEnrichment", start);
    const section = workerMain.slice(start, end);
    expect(section).toContain("assertSourceAnchoredSummaryPreflight");
    expect(workerMain.indexOf("assertSourceAnchoredSummaryPreflight", start)).toBeLessThan(end);
  });
});
