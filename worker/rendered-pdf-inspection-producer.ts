import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { terminateProcessTree } from "../src/lib/extractors/document";
import { PDF_EXTRACTION_BUDGET } from "../src/lib/extractors/pdf-extraction-budget";
import { resolvePythonBin } from "../src/lib/python-bin";

const sha = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const count = z.number().int().nonnegative();
const positive = z.number().int().positive();
const version = z.string().regex(/^[A-Za-z0-9.+_-]{1,128}$/);
const excluded = z.literal("excluded_from_admitted_evidence");
const rect = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const geometry = z
  .object({
    pageRect: rect,
    cropBox: rect,
    mediaBox: rect,
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  })
  .strict();
const holds = ["table_relationships_unverified", "diagram_relationships_unverified"] as const;
const holdSchema = z.tuple([z.literal(holds[0]), z.literal(holds[1])]);
const artifact = z.object({ path: z.string().min(1), sha256: sha, byteLength: positive }).strict();
const usage = z.object({ pages: count, artifacts: count, artifactBytes: count, textBytes: count }).strict();
const provenance = z
  .object({
    version: z.literal("extracted-page-source-v1"),
    format: z.literal("pdf"),
    coordinateSpace: z.literal("raster_container_page_points"),
    physicalPageNumber: positive,
    sourceContentSha256: sha,
    rasterContainerSha256: sha,
    renderSha256: sha,
    nativeLayerDisposition: excluded,
    producer: z
      .object({
        contractVersion: z.literal("pdf-rendered-page-source-v1"),
        route: z.literal("python_pdf_rendered"),
        scriptSha256: sha,
        rendererScriptSha256: sha,
        pythonVersion: version,
        pymupdfVersion: version,
        mupdfVersion: version,
        tesseractVersion: version,
      })
      .strict(),
    pageGeometry: geometry,
    structuralDisposition: z.literal("unverified"),
    reasonCodes: z
      .array(
        z.enum(["pdf_geometry_transform_unverified", "pdf_ocr_unverified", "pdf_runtime_identity_unknown", ...holds]),
      )
      .max(5),
    ocr: z
      .object({
        status: z.literal("unverified"),
        confidence: z.null(),
        confidenceStatus: z.literal("unavailable"),
        textToPageMapping: z.literal("not_established"),
        comparison: z.literal("not_compared"),
      })
      .strict(),
    textMapping: z.object({ status: z.literal("not_established"), offsets: z.null() }).strict(),
    textIdentity: z
      .object({
        originalExtractedTextSha256: sha,
        persistedTextSha256: sha,
        normalizationApplied: z.literal(false),
        metadataNormalizationApplied: z.literal(false),
        qualification: z.literal("UTF-8 extracted/persisted text bytes; not original PDF spans"),
      })
      .strict(),
  })
  .strict();
// This is a separate held contract: never parse it as native-admissible evidence.
const resultSchema = z
  .object({
    version: z.literal("rendered-pdf-source-v1"),
    status: z.literal("held_for_review"),
    sourceSha256: sha,
    sourceByteLength: positive,
    pageCount: positive.max(PDF_EXTRACTION_BUDGET.maxPages),
    nativeLayerDisposition: excluded,
    activeContent: z.literal("absent"),
    encryption: z.literal("absent"),
    runtime: z
      .object({
        pythonVersion: version,
        pymupdfVersion: version,
        mupdfVersion: version,
        tesseractVersion: version,
        pillowVersion: version,
        pytesseractVersion: version,
        rendererScriptSha256: sha,
        extractorScriptSha256: sha,
      })
      .strict(),
    rasterContainer: artifact,
    renderPages: z
      .array(
        z
          .object({
            pageNumber: positive,
            originalGeometry: geometry,
            nativeFeatureDiagnostics: z
              .object({
                textPaintOperations: count,
                vectorPaintOperations: count,
                rasterImages: count,
                nativeTables: z.literal("not_inspected_strings_excluded"),
                semanticRelationships: z.literal("not_established"),
              })
              .strict(),
            artifact: artifact.extend({ width: positive, height: positive }),
            unresolvedFeatureHolds: holdSchema,
          })
          .strict(),
      )
      .max(PDF_EXTRACTION_BUDGET.maxPages),
    extraction: z.object({
      pages: z
        .array(
          z
            .object({
              pageNumber: positive,
              text: z.string(),
              ocrUsed: z.boolean(),
              needsOcr: z.boolean(),
              metadata: z
                .object({ source_provenance: provenance, image_coverage_ratio: z.number().min(0).max(1) })
                .strict(),
            })
            .strict(),
        )
        .max(PDF_EXTRACTION_BUDGET.maxPages),
      images: z
        .array(
          z.object({
            pageNumber: positive,
            path: z.string().min(1),
            mimeType: z.literal("image/png"),
            bbox: rect.nullable().optional(),
            width: positive,
            height: positive,
            sourceKind: z.literal("rendered_page_pixels"),
            metadata: z.object({
              source_kind: z.literal("rendered_page_pixels"),
              render_sha256: sha,
              source_content_sha256: sha,
              coordinate_space: z.literal("raster_container_page_points"),
            }),
          }),
        )
        .max(PDF_EXTRACTION_BUDGET.maxArtifacts),
      budgetUsage: usage,
    }),
    budgetUsage: usage,
    limitations: z.tuple([
      z.literal("ocr_text_unverified"),
      z.literal(holds[0]),
      z.literal(holds[1]),
      z.literal("whole_source_semantic_fidelity_not_established"),
    ]),
  })
  .strict();

export type RenderedPdfInspection = z.infer<typeof resultSchema> & {
  temporaryPaths: string[];
  artifactInventory: Array<{ path: string; sha256: string; byteLength: number }>;
};
const digest = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
async function artifactDigest(file: string, expectedBytes: number, check: () => void) {
  const hash = createHash("sha256");
  let byteLength = 0;
  for await (const chunk of createReadStream(file)) {
    check();
    const bytes = chunk as Buffer;
    byteLength += bytes.length;
    if (byteLength > expectedBytes) refuse("artifact_changed");
    hash.update(bytes);
  }
  if (byteLength !== expectedBytes) refuse("artifact_changed");
  return { sha256: `sha256:${hash.digest("hex")}`, byteLength };
}
function refuse(reason: string): never {
  throw new Error(`rendered_pdf_inspection_${reason}`);
}
function within(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function checkPathsAndNative(value: unknown, root: string): void {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (
      (/native.*(?:text|table)/i.test(key) && !(key === "nativeTables" && item === "not_inspected_strings_excluded")) ||
      key === "xref"
    )
      refuse("native_layer_mixed");
    if (/path$/i.test(key) && (typeof item !== "string" || !path.isAbsolute(item) || !within(root, path.resolve(item))))
      refuse("artifact_path_invalid");
    checkPathsAndNative(item, root);
  }
}
function childEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set([
    "path",
    "systemroot",
    "windir",
    "comspec",
    "pathext",
    "temp",
    "tmp",
    "tmpdir",
    "lang",
    "lc_all",
    "lc_ctype",
    "tessdata_prefix",
  ]);
  return {
    NODE_ENV: "production",
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase()))),
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONNOUSERSITE: "1",
    PDF_RASTER_TABLE_OCR: "0",
  };
}

async function run(
  script: string,
  source: string,
  artifacts: string,
  budget: string,
  timeout: number,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolvePythonBin(), [script, source, artifacts, budget], {
      cwd: process.cwd(),
      env: childEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let outputBytes = 0,
      errorBytes = 0,
      failure: string | undefined,
      settled = false;
    let termination: Promise<void> | undefined;
    let closed = false;
    let observeClose!: () => void;
    const closedPromise = new Promise<void>((resolve) => {
      observeClose = resolve;
    });
    const bounded = async (work: Promise<unknown>, timeoutMs: number) => {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          work,
          new Promise<void>((resolve) => {
            deadline = setTimeout(resolve, timeoutMs);
          }),
        ]);
      } finally {
        if (deadline) clearTimeout(deadline);
      }
    };
    const finish = (code?: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (failure) reject(new Error(`rendered_pdf_inspection_${failure}`));
      else if (code !== 0) {
        // Child failures remain stable codes, never document text or raw errors.
        let reason = "producer_failed";
        try {
          const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const parsed = z
            .object({
              version: z.literal("rendered-pdf-source-v1"),
              status: z.literal("refused"),
              reasonCode: z.string().regex(/^[a-z_]{1,80}$/),
            })
            .strict()
            .safeParse(result);
          if (parsed.success) reason = parsed.data.reasonCode;
        } catch {
          /* malformed output is a refusal */
        }
        reject(new Error(`rendered_pdf_inspection_${reason}`));
      } else resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const stop = (reason: string) => {
      failure ??= reason;
      // Begin asynchronously so close cannot race assignment of the promise.
      termination ??= Promise.resolve().then(async () => {
        await bounded(
          terminateProcessTree(child, { taskkillTimeoutMs: 750 }).catch(() => undefined),
          1000,
        );
        if (!closed) {
          try {
            child.kill("SIGKILL");
          } catch {
            /* verify exit below */
          }
          await bounded(closedPromise, 1000);
        }
        if (!closed) failure = "termination_unverified";
      });
      void termination.then(() => finish());
    };
    const abort = () => stop("aborted");
    const timer = setTimeout(() => stop("timeout"), timeout);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > PDF_EXTRACTION_BUDGET.maxResultBytes) stop("output_budget_exceeded");
      else if (!failure) chunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errorBytes += chunk.length;
      if (errorBytes > 64 * 1024) stop("output_budget_exceeded");
    });
    child.once("error", () => stop("producer_failed"));
    child.once("close", (code) => {
      closed = true;
      observeClose();
      void (termination ?? Promise.resolve()).then(() => finish(code as number | null));
    });
  });
}

/** Inspection only. Successful artifacts remain private for review; caller owns
 * temporaryPaths. Every output is held, including apparently correct OCR. This
 * function neither admits evidence nor calls providers or the indexing pipeline. */
export async function inspectRenderedPdfOriginal(
  sourcePath: string,
  artifactRoot: string,
  expectedSha256: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<RenderedPdfInspection> {
  const started = Date.now(),
    timeout = options.timeoutMs ?? PDF_EXTRACTION_BUDGET.totalTimeoutMs;
  let owned: string | undefined,
    success = false,
    preserveArtifacts = false;
  const check = () => {
    if (options.signal?.aborted) refuse("aborted");
    if (Date.now() - started >= timeout) refuse("timeout");
  };
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > PDF_EXTRACTION_BUDGET.totalTimeoutMs)
    refuse("timeout_invalid");
  if (!sha.safeParse(expectedSha256).success) refuse("source_binding_mismatch");
  try {
    check();
    const sourceInfo = await lstat(sourcePath);
    if (!sourceInfo.isFile() || sourceInfo.size < 1 || sourceInfo.size > 150 * 1024 * 1024)
      refuse("source_budget_exceeded");
    const source = await readFile(sourcePath);
    if (source.length !== sourceInfo.size || digest(source) !== expectedSha256) refuse("source_binding_mismatch");
    check();
    await mkdir(artifactRoot, { recursive: true });
    const root = await realpath(artifactRoot);
    owned = await mkdtemp(path.join(root, "rendered-review-"));
    const artifacts = path.join(owned, "artifacts");
    await mkdir(artifacts);
    const detachedSource = path.join(owned, "source.pdf"),
      budget = path.join(owned, "budget.json");
    const script = path.join(process.cwd(), "worker/python/inspect_rendered_pdf_source.py"),
      extractor = path.join(process.cwd(), "worker/python/extract_pdf_assets.py");
    const rendererHash = digest(await readFile(script)),
      extractorHash = digest(await readFile(extractor));
    await writeFile(detachedSource, source, { flag: "wx", mode: 0o600 });
    check();
    const remaining = timeout - (Date.now() - started);
    await writeFile(budget, JSON.stringify({ totalTimeoutMs: remaining }), { flag: "wx", mode: 0o600 });
    const raw: unknown = JSON.parse(await run(script, detachedSource, artifacts, budget, remaining, options.signal));
    checkPathsAndNative(raw, artifacts);
    const parsed = resultSchema.safeParse(raw);
    if (!parsed.success) refuse("response_invalid");
    const result = parsed.data;
    if (
      result.sourceSha256 !== expectedSha256 ||
      result.sourceByteLength !== source.length ||
      result.runtime.rendererScriptSha256 !== rendererHash ||
      result.runtime.extractorScriptSha256 !== extractorHash
    )
      refuse("source_or_runtime_binding_mismatch");
    if (
      result.pageCount !== result.renderPages.length ||
      result.pageCount !== result.extraction.pages.length ||
      result.budgetUsage.pages !== result.pageCount ||
      result.extraction.budgetUsage.pages !== result.pageCount
    )
      refuse("page_population_invalid");
    const inventory = new Map<string, { sha256: string; byteLength: number }>();
    let totalBytes = 0;
    const walk = async (folder: string): Promise<void> => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        check();
        const file = path.join(folder, entry.name),
          info = await lstat(file);
        if (info.isSymbolicLink() || !within(artifacts, await realpath(file))) refuse("artifact_path_invalid");
        if (info.isDirectory()) await walk(file);
        else {
          if (
            !info.isFile() ||
            inventory.size >= PDF_EXTRACTION_BUDGET.maxArtifacts ||
            totalBytes + info.size > PDF_EXTRACTION_BUDGET.maxArtifactBytes
          )
            refuse("artifact_budget_exceeded");
          const observed = await artifactDigest(file, info.size, check);
          totalBytes += observed.byteLength;
          inventory.set(path.resolve(file), observed);
        }
      }
    };
    await walk(artifacts);
    const verify = (item: z.infer<typeof artifact>) => {
      const observed = inventory.get(path.resolve(item.path));
      if (!observed || observed.sha256 !== item.sha256 || observed.byteLength !== item.byteLength)
        refuse("artifact_binding_mismatch");
    };
    verify(result.rasterContainer);
    let textBytes = 0;
    for (const [index, page] of result.extraction.pages.entries()) {
      const render = result.renderPages[index]!,
        provenance = page.metadata.source_provenance;
      verify(render.artifact);
      const producer = provenance.producer;
      if (
        page.pageNumber !== index + 1 ||
        render.pageNumber !== index + 1 ||
        provenance.physicalPageNumber !== index + 1 ||
        provenance.sourceContentSha256 !== expectedSha256 ||
        provenance.renderSha256 !== render.artifact.sha256 ||
        provenance.rasterContainerSha256 !== result.rasterContainer.sha256 ||
        producer.scriptSha256 !== extractorHash ||
        producer.rendererScriptSha256 !== rendererHash ||
        ["pythonVersion", "pymupdfVersion", "mupdfVersion", "tesseractVersion"].some(
          (key) => producer[key as keyof typeof producer] !== result.runtime[key as keyof typeof result.runtime],
        ) ||
        ["pdf_ocr_unverified", ...holds].some(
          (reason) => !provenance.reasonCodes.includes(reason as (typeof provenance.reasonCodes)[number]),
        ) ||
        provenance.textIdentity.originalExtractedTextSha256 !== digest(page.text) ||
        provenance.textIdentity.persistedTextSha256 !== digest(page.text)
      )
        refuse("page_binding_mismatch");
      if (render.artifact.width * render.artifact.height > PDF_EXTRACTION_BUDGET.maxRenderPixels)
        refuse("render_budget_exceeded");
      textBytes += Buffer.byteLength(page.text);
    }
    for (const image of result.extraction.images) {
      if (
        !inventory.has(path.resolve(image.path)) ||
        image.pageNumber > result.pageCount ||
        image.metadata.source_content_sha256 !== expectedSha256 ||
        image.metadata.render_sha256 !== result.renderPages[image.pageNumber - 1]!.artifact.sha256
      )
        refuse("image_binding_mismatch");
    }
    if (
      textBytes > PDF_EXTRACTION_BUDGET.maxTextBytes ||
      result.budgetUsage.textBytes !== textBytes ||
      result.extraction.budgetUsage.textBytes !== textBytes ||
      result.budgetUsage.artifacts !== inventory.size ||
      result.budgetUsage.artifactBytes !== totalBytes
    )
      refuse("budget_binding_mismatch");
    if (
      digest(await readFile(script)) !== rendererHash ||
      digest(await readFile(extractor)) !== extractorHash ||
      digest(await readFile(detachedSource)) !== expectedSha256
    )
      refuse("runtime_changed");
    check();
    success = true;
    return {
      ...result,
      temporaryPaths: [owned],
      artifactInventory: Array.from(inventory, ([file, observed]) => ({ path: file, ...observed })),
    };
  } catch (error) {
    if (error instanceof Error && /_(?:process_)?termination_unverified$/.test(error.message)) preserveArtifacts = true;
    if (error instanceof Error && /^rendered_pdf_inspection_[a-z_]+$/.test(error.message)) throw error;
    return refuse("processing_failed");
  } finally {
    if (owned && !success && !preserveArtifacts) {
      await rm(owned, { recursive: true, force: true }).catch(() => refuse("cleanup_failed"));
    }
  }
}
