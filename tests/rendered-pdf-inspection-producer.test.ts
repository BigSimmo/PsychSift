import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ spawn: vi.fn(), terminate: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: boundary.spawn }));
vi.mock("../src/lib/extractors/document", () => ({ terminateProcessTree: boundary.terminate }));
import { inspectRenderedPdfOriginal } from "../worker/rendered-pdf-inspection-producer";

const sha = (data: string | Buffer) => `sha256:${createHash("sha256").update(data).digest("hex")}`;
const holds = ["table_relationships_unverified", "diagram_relationships_unverified"];
const folders: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});
async function setup() {
  const folder = await mkdtemp(path.join(os.tmpdir(), "render-wrapper-test-"));
  folders.push(folder);
  const source = path.join(folder, "synthetic.pdf");
  const bytes = "%PDF-1.7\nsynthetic\n%%EOF";
  await writeFile(source, bytes);
  return { folder, source, bytes, hash: sha(bytes), root: path.join(folder, "artifacts") };
}
async function envelope(args: string[]) {
  const stage = args[2]!;
  const source = await readFile(args[1]!);
  const render = path.join(stage, "page.png"),
    raster = path.join(stage, "raster.pdf");
  await writeFile(render, "render");
  await writeFile(raster, "raster");
  const renderer = sha(await readFile(args[0]!));
  const extractor = sha(await readFile(path.join(process.cwd(), "worker/python/extract_pdf_assets.py")));
  const runtime = {
    pythonVersion: "3.12",
    pymupdfVersion: "1.26",
    mupdfVersion: "1.26",
    tesseractVersion: "5.4.0",
    pillowVersion: "11.0",
    pytesseractVersion: "0.3",
    rendererScriptSha256: renderer,
    extractorScriptSha256: extractor,
  };
  const geometry = { pageRect: [0, 0, 100, 100], cropBox: [0, 0, 100, 100], mediaBox: [0, 0, 100, 100], rotation: 0 };
  const text = "VISIBLE SYNTHETIC 47";
  return {
    version: "rendered-pdf-source-v1",
    status: "held_for_review",
    sourceSha256: sha(source),
    sourceByteLength: source.length,
    pageCount: 1,
    nativeLayerDisposition: "excluded_from_admitted_evidence",
    activeContent: "absent",
    encryption: "absent",
    runtime,
    rasterContainer: { path: raster, sha256: sha("raster"), byteLength: 6 },
    renderPages: [
      {
        pageNumber: 1,
        originalGeometry: geometry,
        nativeFeatureDiagnostics: {
          textPaintOperations: 1,
          vectorPaintOperations: 0,
          rasterImages: 0,
          nativeTables: "not_inspected_strings_excluded",
          semanticRelationships: "not_established",
        },
        artifact: { path: render, sha256: sha("render"), byteLength: 6, width: 100, height: 100 },
        unresolvedFeatureHolds: holds,
      },
    ],
    extraction: {
      pages: [
        {
          pageNumber: 1,
          text,
          ocrUsed: true,
          needsOcr: false,
          metadata: {
            image_coverage_ratio: 1,
            source_provenance: {
              version: "extracted-page-source-v1",
              format: "pdf",
              coordinateSpace: "raster_container_page_points",
              physicalPageNumber: 1,
              sourceContentSha256: sha(source),
              rasterContainerSha256: sha("raster"),
              renderSha256: sha("render"),
              nativeLayerDisposition: "excluded_from_admitted_evidence",
              producer: {
                contractVersion: "pdf-rendered-page-source-v1",
                route: "python_pdf_rendered",
                scriptSha256: extractor,
                rendererScriptSha256: renderer,
                pythonVersion: runtime.pythonVersion,
                pymupdfVersion: runtime.pymupdfVersion,
                mupdfVersion: runtime.mupdfVersion,
                tesseractVersion: runtime.tesseractVersion,
              },
              pageGeometry: geometry,
              structuralDisposition: "unverified",
              reasonCodes: ["pdf_ocr_unverified", ...holds],
              ocr: {
                status: "unverified",
                confidence: null,
                confidenceStatus: "unavailable",
                textToPageMapping: "not_established",
                comparison: "not_compared",
              },
              textMapping: { status: "not_established", offsets: null },
              textIdentity: {
                originalExtractedTextSha256: sha(text),
                persistedTextSha256: sha(text),
                normalizationApplied: false,
                metadataNormalizationApplied: false,
                qualification: "UTF-8 extracted/persisted text bytes; not original PDF spans",
              },
            },
          },
        },
      ],
      images: [],
      warnings: [],
      budgetUsage: { pages: 1, artifacts: 0, artifactBytes: 0, textBytes: Buffer.byteLength(text) },
      extractor: { name: "extract_pdf_assets", version: "v1" },
    },
    budgetUsage: { pages: 1, artifacts: 2, artifactBytes: 12, textBytes: Buffer.byteLength(text) },
    limitations: ["ocr_text_unverified", ...holds, "whole_source_semantic_fidelity_not_established"],
  };
}
type Envelope = Awaited<ReturnType<typeof envelope>>;
function childOutput(change?: (result: Envelope, args: string[]) => void | Promise<void>) {
  boundary.spawn.mockImplementation((_bin: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      pid: 987654,
      exitCode: null,
    });
    boundary.terminate.mockImplementation(async () => {
      child.emit("close", null);
    });
    void (async () => {
      const output = await envelope(args);
      await change?.(output, args);
      child.stdout.emit("data", Buffer.from(JSON.stringify(output)));
      child.emit("close", 0);
    })();
    return child;
  });
}
describe("held rendered-original subprocess boundary", () => {
  it("retains only held rendered evidence and uses a provider-free environment", async () => {
    const fixture = await setup();
    vi.stubEnv("OPENAI_API_KEY", "synthetic-do-not-forward");
    vi.stubEnv("PYTHONPATH", "synthetic-untrusted-import-path");
    vi.stubEnv("PYTHON_BIN", "explicit-python");
    childOutput();
    const result = await inspectRenderedPdfOriginal(fixture.source, fixture.root, fixture.hash);
    expect(result.status).toBe("held_for_review");
    expect(result.extraction.pages[0]!.text).toBe("VISIBLE SYNTHETIC 47");
    expect(result.temporaryPaths).toHaveLength(1);
    expect(result.artifactInventory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sha256: sha("render"), byteLength: 6 }),
        expect.objectContaining({ sha256: sha("raster"), byteLength: 6 }),
      ]),
    );
    expect(boundary.spawn.mock.calls[0]![0]).toBe("explicit-python");
    const environment = boundary.spawn.mock.calls[0]![2].env;
    expect(environment.OPENAI_API_KEY).toBeUndefined();
    expect(environment.PYTHONPATH).toBeUndefined();
    expect(environment.PDF_RASTER_TABLE_OCR).toBe("0");
    expect(await readdir(fixture.root)).toHaveLength(1);
  });
  it("refuses a mismatched original before launching a child", async () => {
    const fixture = await setup();
    await expect(inspectRenderedPdfOriginal(fixture.source, fixture.root, sha("wrong"))).rejects.toThrow(
      "source_binding_mismatch",
    );
    expect(boundary.spawn).not.toHaveBeenCalled();
  });
  it("preserves an earlier unknown-runtime hold after independently observed OCR identity is stamped", async () => {
    const fixture = await setup();
    childOutput((output) => {
      output.extraction.pages[0]!.metadata.source_provenance.reasonCodes.push("pdf_runtime_identity_unknown");
    });
    const result = await inspectRenderedPdfOriginal(fixture.source, fixture.root, fixture.hash);
    expect(result.status).toBe("held_for_review");
    expect(result.extraction.pages[0]!.metadata.source_provenance.reasonCodes).toContain(
      "pdf_runtime_identity_unknown",
    );
  });
  it.each(["escape", "tamper", "runtime", "native", "page", "text"])(
    "refuses forged %s evidence and removes only its own run",
    async (mode) => {
      const fixture = await setup();
      await writeFile(path.join(fixture.folder, "sentinel"), "preserved");
      childOutput(async (output) => {
        if (mode === "escape") output.renderPages[0]!.artifact.path = path.join(fixture.folder, "sentinel");
        if (mode === "tamper") await writeFile(output.renderPages[0]!.artifact.path, "damage");
        if (mode === "runtime") output.runtime.rendererScriptSha256 = sha("forged");
        if (mode === "native")
          Object.assign(output.extraction.pages[0]!.metadata.source_provenance, { nativeText: "FORBIDDEN NATIVE" });
        if (mode === "page") output.extraction.pages[0]!.pageNumber = 2;
        if (mode === "text") output.extraction.pages[0]!.text = "forged text";
      });
      await expect(inspectRenderedPdfOriginal(fixture.source, fixture.root, fixture.hash)).rejects.toThrow(
        /^rendered_pdf_inspection_/,
      );
      expect(await readdir(fixture.root)).toEqual([]);
      expect(await readFile(path.join(fixture.folder, "sentinel"), "utf8")).toBe("preserved");
    },
  );
  it("kills the process tree on an external wall deadline without exposing output", async () => {
    const fixture = await setup();
    boundary.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        pid: 987654,
        exitCode: null,
      });
      boundary.terminate.mockImplementation(async () => {
        child.emit("close", null);
      });
      queueMicrotask(() => child.stderr.emit("data", Buffer.from("private source raw error")));
      return child;
    });
    await expect(
      inspectRenderedPdfOriginal(fixture.source, fixture.root, fixture.hash, { timeoutMs: 35 }),
    ).rejects.toThrow("rendered_pdf_inspection_timeout");
    expect(boundary.terminate).toHaveBeenCalledOnce();
    expect(await readdir(fixture.root)).toEqual([]);
  });
  it("kills an active child when the caller cancels", async () => {
    const fixture = await setup();
    const controller = new AbortController();
    boundary.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        pid: 987654,
        exitCode: null,
      });
      boundary.terminate.mockImplementation(async () => {
        child.emit("close", null);
      });
      queueMicrotask(() => controller.abort("private reason must not escape"));
      return child;
    });
    await expect(
      inspectRenderedPdfOriginal(fixture.source, fixture.root, fixture.hash, { signal: controller.signal }),
    ).rejects.toThrow("rendered_pdf_inspection_aborted");
    expect(boundary.terminate).toHaveBeenCalledOnce();
    expect(await readdir(fixture.root)).toEqual([]);
  });
  it("preserves artifacts when a reported tree-stop never observes producer exit", async () => {
    const fixture = await setup();
    const controller = new AbortController();
    boundary.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        pid: 987654,
        exitCode: null,
        kill: vi.fn(() => false),
      });
      boundary.terminate.mockResolvedValue(undefined);
      queueMicrotask(() => controller.abort());
      return child;
    });
    await expect(
      inspectRenderedPdfOriginal(fixture.source, fixture.root, fixture.hash, { signal: controller.signal }),
    ).rejects.toThrow("rendered_pdf_inspection_termination_unverified");
    expect(await readdir(fixture.root)).toHaveLength(1);
  });
  it("bounds diagnostic output and never includes it in errors", async () => {
    const fixture = await setup();
    boundary.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        pid: 987654,
        exitCode: null,
      });
      boundary.terminate.mockImplementation(async () => {
        child.emit("close", null);
      });
      queueMicrotask(() => child.stderr.emit("data", Buffer.alloc(65537, 65)));
      return child;
    });
    await expect(inspectRenderedPdfOriginal(fixture.source, fixture.root, fixture.hash)).rejects.toThrow(
      "rendered_pdf_inspection_output_budget_exceeded",
    );
    expect(boundary.terminate).toHaveBeenCalledOnce();
  });
});
