import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import PDFDocument from "pdfkit";
import { PdfjsFallbackParser } from "@/lib/extractors/pdfjs-fallback";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractPdf, runPythonPdfExtractor } from "@/lib/extractors/document";
import {
  PDF_EXTRACTION_BUDGET,
  PdfExtractionBudgetTracker,
  PdfExtractionResourceError,
} from "@/lib/extractors/pdf-extraction-budget";
import { isRetryableIngestionError } from "@/lib/ingestion";
import { resolvePythonBin } from "@/lib/python-bin";

const roots: string[] = [];

async function createTextPdf() {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const document = new PDFDocument();
    document.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    document.text("This extracted text is deliberately longer than one byte.");
    document.end();
  });
}

async function createImagePdf() {
  const image = await readFile(new URL("../public/demo-documents/risk-flow.png", import.meta.url));
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const document = new PDFDocument();
    document.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    document.image(image, 20, 20);
    document.end();
  });
}

async function createRecoverableMalformedTextPdf() {
  const pdf = await createTextPdf();
  const source = pdf.toString("latin1");
  const malformed = source.replace(/startxref\s+\d+\s+%%EOF/, "startxref\n0\n%%EOF");
  if (malformed === source) throw new Error("Could not corrupt the PDF cross-reference pointer.");
  return Buffer.from(malformed, "latin1");
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("PDF extraction budgets", () => {
  it("resolves the platform default when PYTHON_BIN is unset", () => {
    const previous = process.env.PYTHON_BIN;
    delete process.env.PYTHON_BIN;
    try {
      expect(resolvePythonBin()).toBe(process.platform === "win32" ? "python" : "python3");
    } finally {
      if (previous === undefined) delete process.env.PYTHON_BIN;
      else process.env.PYTHON_BIN = previous;
    }
  });

  it("honors an explicit PYTHON_BIN override", () => {
    expect(resolvePythonBin("/custom/python")).toBe("/custom/python");
  });

  it("accepts exact aggregate boundaries and rejects the first byte or item beyond them", () => {
    const limits = {
      ...PDF_EXTRACTION_BUDGET,
      maxRenderPixels: 1,
      maxPages: 1,
      maxArtifacts: 1,
      maxArtifactBytes: 2,
      maxTextBytes: 2,
      maxResultBytes: 2,
    };
    const tracker = new PdfExtractionBudgetTracker(limits);
    tracker.addPage("é");
    tracker.addArtifact(2);
    tracker.assertResult("é");
    expect(() => tracker.addArtifact(1)).toThrow(/PDF_EXTRACTION_BUDGET_EXCEEDED/);
    expect(() => tracker.assertArtifact(3)).toThrow(/PDF_EXTRACTION_BUDGET_EXCEEDED/);
    expect(() => tracker.assertRenderDimensions(2, 2)).toThrow(/PDF_EXTRACTION_BUDGET_EXCEEDED/);

    expect(() => new PdfExtractionBudgetTracker({ ...limits, maxPages: 0 }).addPage("")).toThrow(
      /PDF_EXTRACTION_BUDGET_EXCEEDED/,
    );
    expect(() => new PdfExtractionBudgetTracker({ ...limits, maxTextBytes: 1 }).addPage("é")).toThrow(
      /PDF_EXTRACTION_BUDGET_EXCEEDED/,
    );
    expect(() => new PdfExtractionBudgetTracker({ ...limits, maxResultBytes: 1 }).assertResult("é")).toThrow(
      /PDF_EXTRACTION_BUDGET_EXCEEDED/,
    );
  });

  it("accepts fractional render dimensions within the pixel budget", () => {
    const tracker = new PdfExtractionBudgetTracker({
      ...PDF_EXTRACTION_BUDGET,
      maxRenderPixels: 101 * 101,
    });
    expect(() => tracker.assertRenderDimensions(100.5, 100.5)).not.toThrow();
    expect(() =>
      new PdfExtractionBudgetTracker({ ...PDF_EXTRACTION_BUDGET, maxRenderPixels: 100 }).assertRenderDimensions(
        100.5,
        100.5,
      ),
    ).toThrow(/PDF_EXTRACTION_BUDGET_EXCEEDED/);
  });

  it("terminates the Python child tree when the total deadline expires", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clinical-kb-pdf-deadline-"));
    roots.push(root);
    const inputPath = path.join(root, "child-pid-path.txt");
    const outputDir = path.join(root, "images");
    const fakeExtractor = path.join(root, "slow-extractor.py");
    const childPidPath = path.join(root, "child.pid");
    await mkdir(outputDir);
    await writeFile(inputPath, childPidPath, "utf8");
    await writeFile(
      fakeExtractor,
      [
        "import pathlib, subprocess, sys, time",
        "pid_path = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')",
        "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])",
        "pathlib.Path(pid_path).write_text(str(child.pid), encoding='utf-8')",
        "while True: time.sleep(1)",
      ].join("\n"),
      "utf8",
    );

    await expect(
      runPythonPdfExtractor(inputPath, outputDir, { ...PDF_EXTRACTION_BUDGET, totalTimeoutMs: 3_000 }, fakeExtractor),
    ).rejects.toMatchObject({ code: "PDF_EXTRACTION_DEADLINE_EXCEEDED" });

    const childPid = Number(await readFile(childPidPath, "utf8"));
    // SIGKILL delivery can lag under a busy suite; poll briefly before asserting.
    let childIsAlive = true;
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      try {
        process.kill(childPid, 0);
        if (process.platform === "linux") {
          const stat = await readFile(`/proc/${childPid}/stat`, "utf8").catch(() => "");
          if (stat.split(" ")[2] === "Z") {
            childIsAlive = false;
            break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      } catch {
        childIsAlive = false;
        break;
      }
    }
    if (childIsAlive) {
      try {
        process.kill(childPid, "SIGKILL");
      } catch {
        // already gone
      }
    }
    expect(childIsAlive).toBe(false);
  });

  it("classifies budget and deadline rejections as non-retryable", () => {
    expect(
      isRetryableIngestionError(new PdfExtractionResourceError("PDF_EXTRACTION_DEADLINE_EXCEEDED", "deadline timeout")),
    ).toBe(false);
    expect(
      isRetryableIngestionError(new PdfExtractionResourceError("PDF_EXTRACTION_BUDGET_EXCEEDED", "artifact budget")),
    ).toBe(false);
  });

  it("does not enter fallback and removes the temporary root after a budget rejection", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clinical-kb-pdf-cleanup-test-"));
    roots.push(root);
    const fakeExtractor = path.join(root, "budget-extractor.py");
    const rootRecord = path.join(root, "temporary-root.txt");
    await writeFile(
      fakeExtractor,
      [
        "import pathlib, sys",
        "record = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')",
        "temporary_root = pathlib.Path(sys.argv[2]).parent",
        "pathlib.Path(record).write_text(str(temporary_root), encoding='utf-8')",
        "(temporary_root / 'partial-artifact.bin').write_bytes(b'partial')",
        "print('PDF_EXTRACTION_BUDGET_EXCEEDED: test limit', file=sys.stderr)",
        "raise SystemExit(3)",
      ].join("\n"),
      "utf8",
    );

    await expect(
      extractPdf(Buffer.from(rootRecord, "utf8"), { scriptPathOverride: fakeExtractor }),
    ).rejects.toMatchObject({ code: "PDF_EXTRACTION_BUDGET_EXCEEDED" });
    const temporaryRoot = await readFile(rootRecord, "utf8");
    expect(existsSync(temporaryRoot)).toBe(false);
  });

  it("stops a stalled JavaScript fallback at the document deadline and cleans up (ING-B-05)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clinical-kb-pdf-fallback-deadline-test-"));
    roots.push(root);
    const fakeExtractor = path.join(root, "failing-extractor.py");
    const rootRecord = path.join(root, "temporary-root.txt");
    await writeFile(
      fakeExtractor,
      [
        "import pathlib, sys",
        "record = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')",
        "pathlib.Path(record).write_text(str(pathlib.Path(sys.argv[2]).parent), encoding='utf-8')",
        "print('synthetic ordinary extractor failure', file=sys.stderr)",
        "raise SystemExit(1)",
      ].join("\n"),
      "utf8",
    );
    const getTextSpy = vi
      .spyOn(PdfjsFallbackParser.prototype, "getText")
      .mockImplementation(() => new Promise<never>(() => undefined));
    const destroySpy = vi.spyOn(PdfjsFallbackParser.prototype, "destroy");

    await expect(
      extractPdf(Buffer.from(rootRecord, "utf8"), {
        limits: { ...PDF_EXTRACTION_BUDGET, totalTimeoutMs: 2_000 },
        scriptPathOverride: fakeExtractor,
      }),
    ).rejects.toMatchObject({ code: "PDF_EXTRACTION_DEADLINE_EXCEEDED" });

    expect(getTextSpy).toHaveBeenCalledTimes(1);
    expect(destroySpy).toHaveBeenCalled();
    expect(existsSync(await readFile(rootRecord, "utf8"))).toBe(false);
  }, 15_000);

  it("applies the same aggregate text budget in the JavaScript fallback", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clinical-kb-pdf-fallback-test-"));
    roots.push(root);
    const fakeExtractor = path.join(root, "missing-dependency.py");
    await writeFile(
      fakeExtractor,
      "import sys\nprint('PyMuPDF unavailable', file=sys.stderr)\nraise SystemExit(2)\n",
      "utf8",
    );

    await expect(
      extractPdf(await createTextPdf(), {
        limits: { ...PDF_EXTRACTION_BUDGET, maxTextBytes: 1 },
        scriptPathOverride: fakeExtractor,
      }),
    ).rejects.toMatchObject({ code: "PDF_EXTRACTION_BUDGET_EXCEEDED" });
  });

  it("extracts a real embedded image through the JavaScript fallback", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clinical-kb-pdf-image-fallback-test-"));
    roots.push(root);
    const fakeExtractor = path.join(root, "missing-dependency.py");
    await writeFile(
      fakeExtractor,
      "import sys\nprint('PyMuPDF unavailable', file=sys.stderr)\nraise SystemExit(2)\n",
      "utf8",
    );

    const extracted = await extractPdf(await createImagePdf(), { scriptPathOverride: fakeExtractor });
    roots.push(...(extracted.temporaryPaths ?? []));
    expect(extracted.images.length).toBeGreaterThan(0);
    const imageBytes = await readFile(extracted.images[0]!.path);
    expect(imageBytes.subarray(0, 8)).toEqual(Buffer.from("89504e470d0a1a0a", "hex"));
  });

  it("rejects an oversized embedded image before the JavaScript fallback decodes it", async () => {
    const getTextSpy = vi.spyOn(PdfjsFallbackParser.prototype, "getText");
    const getImageSpy = vi.spyOn(PdfjsFallbackParser.prototype, "getImage");
    const root = await mkdtemp(path.join(tmpdir(), "clinical-kb-pdf-image-budget-test-"));
    roots.push(root);
    const fakeExtractor = path.join(root, "missing-dependency.py");
    await writeFile(
      fakeExtractor,
      "import sys\nprint('PyMuPDF unavailable', file=sys.stderr)\nraise SystemExit(2)\n",
      "utf8",
    );

    await expect(
      extractPdf(await createImagePdf(), {
        limits: { ...PDF_EXTRACTION_BUDGET, maxRenderPixels: 1 },
        scriptPathOverride: fakeExtractor,
      }),
    ).rejects.toMatchObject({ code: "PDF_EXTRACTION_BUDGET_EXCEEDED" });

    expect(getTextSpy).not.toHaveBeenCalled();
    expect(getImageSpy).not.toHaveBeenCalled();
  });

  it("keeps best-effort fallback extraction for recoverable non-image PDF damage", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clinical-kb-pdf-recovery-test-"));
    roots.push(root);
    const fakeExtractor = path.join(root, "missing-dependency.py");
    await writeFile(
      fakeExtractor,
      "import sys\nprint('PyMuPDF unavailable', file=sys.stderr)\nraise SystemExit(2)\n",
      "utf8",
    );

    const extracted = await extractPdf(await createRecoverableMalformedTextPdf(), {
      scriptPathOverride: fakeExtractor,
    });
    roots.push(...(extracted.temporaryPaths ?? []));
    expect(extracted.pages.map((page) => page.text).join(" ")).toContain(
      "This extracted text is deliberately longer than one byte.",
    );
  });

  it("skips malformed image entries returned by the JavaScript fallback", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clinical-kb-pdf-malformed-image-test-"));
    roots.push(root);
    const fakeExtractor = path.join(root, "missing-dependency.py");
    await writeFile(
      fakeExtractor,
      "import sys\nprint('PyMuPDF unavailable', file=sys.stderr)\nraise SystemExit(2)\n",
      "utf8",
    );
    vi.spyOn(PdfjsFallbackParser.prototype, "getText").mockResolvedValue({
      pages: [{ num: 1, text: "Short fallback text." }],
      text: "Short fallback text.",
    } as never);
    vi.spyOn(PdfjsFallbackParser.prototype, "getImage").mockResolvedValue({
      pages: [
        {
          pageNumber: 1,
          images: [
            { data: undefined, width: 10, height: 20 },
            { data: new Uint8Array([1]), width: 10.5, height: 20 },
          ],
        },
      ],
    } as never);
    vi.spyOn(PdfjsFallbackParser.prototype, "destroy").mockResolvedValue(undefined);

    const extracted = await extractPdf(await createTextPdf(), { scriptPathOverride: fakeExtractor });
    roots.push(...(extracted.temporaryPaths ?? []));

    expect(extracted.images).toEqual([]);
    expect(extracted.pages[0]?.text).toContain("Short fallback text");
    expect(extracted.pages[0]?.needsOcr).toBe(true);
  });

  it("preserves text and OCR evidence when the PDF fallback rejects malformed image data", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clinical-kb-pdf-rejected-image-test-"));
    roots.push(root);
    const fakeExtractor = path.join(root, "missing-dependency.py");
    await writeFile(
      fakeExtractor,
      "import sys\nprint('PyMuPDF unavailable', file=sys.stderr)\nraise SystemExit(2)\n",
      "utf8",
    );
    vi.spyOn(PdfjsFallbackParser.prototype, "getText").mockResolvedValue({
      pages: [{ num: 1, text: "Short fallback text." }],
      text: "Short fallback text.",
    } as never);
    vi.spyOn(PdfjsFallbackParser.prototype, "getImage").mockRejectedValue(
      new Error("Image object img_p0_1: data field is empty or invalid. Available fields: width, height"),
    );
    vi.spyOn(PdfjsFallbackParser.prototype, "destroy").mockResolvedValue(undefined);

    const extracted = await extractPdf(await createTextPdf(), { scriptPathOverride: fakeExtractor });
    roots.push(...(extracted.temporaryPaths ?? []));

    expect(extracted.images).toEqual([]);
    expect(extracted.pages[0]).toMatchObject({ text: "Short fallback text.", needsOcr: true });
    expect(extracted.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^malformed_fallback_images:/)]));
  });
});
