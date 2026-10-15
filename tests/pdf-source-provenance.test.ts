import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { extractedTextSha256 } from "@/lib/extractors/docx-source-provenance";
import {
  pdfPageSourceProvenanceSchema,
  PdfSourceProvenanceError,
  type PdfPageSourceProvenance,
  validatePdfSourcePages,
} from "@/lib/extractors/pdf-source-provenance";
import { extractPdf, parseExtractedDocumentPayload } from "@/lib/extractors/document";
import { buildDocumentPageRowsForPersistence } from "../worker/behavior";
import { PDFParse } from "pdf-parse";
import { resolvePythonBin } from "@/lib/python-bin";

function packet(): PdfPageSourceProvenance {
  const hash = extractedTextSha256("synthetic page");
  return {
    version: "extracted-page-source-v1",
    format: "pdf",
    coordinateSpace: "pymupdf_observed_page_points",
    physicalPageNumber: 1,
    sourceContentSha256: extractedTextSha256("synthetic PDF bytes"),
    producer: {
      contractVersion: "pdf-native-page-source-v1",
      route: "python_pdf",
      scriptSha256: extractedTextSha256("script bytes"),
      pythonVersion: "3.11.15",
      pymupdfVersion: "1.28.0",
    },
    pageGeometry: { pageRect: [0, 0, 612, 792], cropBox: [0, 0, 612, 792], mediaBox: [0, 0, 612, 792], rotation: 0 },
    nativeTextSha256: hash,
    structuralDisposition: "retained",
    reasonCodes: [],
    ocr: {
      status: "not_requested",
      confidence: null,
      confidenceStatus: "unavailable",
      textToPageMapping: "not_established",
      comparison: "not_applicable",
    },
    textMapping: { status: "not_established", offsets: null },
    textIdentity: {
      originalExtractedTextSha256: hash,
      persistedTextSha256: hash,
      normalizationApplied: false,
      metadataNormalizationApplied: false,
      qualification: "UTF-8 extracted/persisted text bytes; not original PDF spans",
    },
  };
}
function payload(source: unknown = packet()) {
  return {
    pages: [
      { pageNumber: 1, text: "synthetic page", metadata: { source_provenance: source, image_coverage_ratio: 0 } },
    ],
    images: [],
  };
}

describe("native PDF source-only provenance", () => {
  it("keeps producer OCR and unknown-runtime observations unverified without running OCR", () => {
    const result = spawnSync(
      resolvePythonBin(),
      [
        "-c",
        `import json, sys
sys.path.insert(0, "worker/python")
import extract_pdf_assets as extractor
geometry = {"pageRect": [0, 0, 400, 500], "cropBox": [0, 0, 400, 500], "mediaBox": [0, 0, 400, 500], "rotation": 0}
identity = {"sourceContentSha256": "sha256:" + "a" * 64, "producer": {"contractVersion": "pdf-native-page-source-v1", "route": "python_pdf", "scriptSha256": "sha256:" + "b" * 64, "pythonVersion": None, "pymupdfVersion": "synthetic-runtime"}}
print(json.dumps([extractor.page_source_provenance(geometry, 1, "native", "returned", used, needed, identity) for used, needed in [(True, False), (False, True)]]))
`,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    expect(result.status, result.stderr).toBe(0);
    const observations = JSON.parse(result.stdout) as unknown[];
    expect(observations).toHaveLength(2);
    for (const observation of observations) {
      expect(pdfPageSourceProvenanceSchema.parse(observation)).toMatchObject({
        nativeTextSha256: extractedTextSha256("native"),
        structuralDisposition: "unverified",
        reasonCodes: ["pdf_ocr_unverified", "pdf_runtime_identity_unknown"],
        ocr: { status: "unverified", confidence: null, comparison: "not_compared" },
        textIdentity: { originalExtractedTextSha256: extractedTextSha256("returned") },
      });
    }
  });

  it("accepts actual default native producer output with bound source, script and observed geometry", async () => {
    const fixture = spawnSync(
      resolvePythonBin(),
      [
        "-c",
        `import base64, hashlib, json, pymupdf as fitz
document = fitz.open()
for index in range(2):
    page = document.new_page(width=400, height=500)
    page.insert_textbox(fitz.Rect(30, 40, 360, 420), ("Synthetic administrative reference text for native extraction. " * 8), fontsize=10)
    if index:
        page.set_cropbox(fitz.Rect(10, 20, 390, 480))
        page.set_rotation(90)
source = document.tobytes()
expected = [{"nativeTextSha256": "sha256:" + hashlib.sha256(page.get_text("text", sort=True).encode("utf-8")).hexdigest(), "pageRect": list(page.rect), "cropBox": list(page.cropbox), "mediaBox": list(page.mediabox), "rotation": page.rotation} for page in document]
print(json.dumps({"source": base64.b64encode(source).decode("ascii"), "expected": expected}))
document.close()
`,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    expect(fixture.status, fixture.stderr).toBe(0);
    const input = JSON.parse(fixture.stdout) as {
      source: string;
      expected: Array<{
        nativeTextSha256: string;
        pageRect: number[];
        cropBox: number[];
        mediaBox: number[];
        rotation: number;
      }>;
    };
    const bytes = Buffer.from(input.source, "base64");
    const fallback = vi.spyOn(PDFParse.prototype, "getText");
    let extracted: Awaited<ReturnType<typeof extractPdf>> | undefined;
    try {
      extracted = await extractPdf(bytes);
      expect(extracted.pages).toHaveLength(2);
      expect(fallback).not.toHaveBeenCalled();
      const scriptHash = extractedTextSha256(
        await readFile(path.join(process.cwd(), "worker", "python", "extract_pdf_assets.py")),
      );
      for (const [index, page] of extracted.pages.entries()) {
        const provenance = pdfPageSourceProvenanceSchema.parse(page.metadata?.source_provenance);
        const { nativeTextSha256, ...pageGeometry } = input.expected[index];
        expect(page.text.length).toBeGreaterThan(220);
        expect(provenance).toMatchObject({
          physicalPageNumber: index + 1,
          sourceContentSha256: extractedTextSha256(bytes),
          producer: { scriptSha256: scriptHash, pythonVersion: expect.any(String), pymupdfVersion: expect.any(String) },
          pageGeometry,
          nativeTextSha256,
          structuralDisposition: index ? "unverified" : "retained",
          reasonCodes: index ? ["pdf_geometry_transform_unverified"] : [],
          ocr: { status: "not_requested", comparison: "not_applicable" },
          textIdentity: {
            originalExtractedTextSha256: extractedTextSha256(page.text),
            persistedTextSha256: extractedTextSha256(page.text),
            normalizationApplied: false,
            metadataNormalizationApplied: false,
          },
        });
      }
      expect(parseExtractedDocumentPayload(JSON.stringify(extracted)).pages).toEqual(extracted.pages);
    } finally {
      fallback.mockRestore();
      for (const temporaryPath of extracted?.temporaryPaths ?? [])
        await rm(temporaryPath, { recursive: true, force: true });
    }
  }, 30_000);

  it("retains strict observations through JSON roundtrip", () => {
    const parsed = parseExtractedDocumentPayload(JSON.stringify(payload()));
    expect(parsed).toEqual(payload());
    expect(parseExtractedDocumentPayload(JSON.stringify(parsed))).toEqual(parsed);
  });
  it.each([
    null,
    { ...packet(), version: "unknown" },
    { ...packet(), format: "unknown" },
    { ...packet(), arbitrary: "private prose" },
  ])("terminally rejects malformed supplied provenance %j", (source) => {
    expect(() => parseExtractedDocumentPayload(JSON.stringify(payload(source)))).toThrow(PdfSourceProvenanceError);
  });
  it.each([
    [0, 0, 0, 792],
    [100, 0, 10, 792],
    [0, 0, 612, Infinity],
  ])("rejects unsafe geometry %j", (pageRect) => {
    expect(
      pdfPageSourceProvenanceSchema.safeParse({ ...packet(), pageGeometry: { ...packet().pageGeometry, pageRect } })
        .success,
    ).toBe(false);
  });
  it("requires exact reasons, unknown OCR, and unverified transforms/runtime", () => {
    const source = packet();
    source.pageGeometry.rotation = 90;
    source.producer.pymupdfVersion = null;
    source.ocr.status = "unverified";
    expect(pdfPageSourceProvenanceSchema.safeParse(source).success).toBe(false);
    source.structuralDisposition = "unverified";
    source.reasonCodes = ["pdf_geometry_transform_unverified", "pdf_runtime_identity_unknown", "pdf_ocr_unverified"];
    source.ocr.comparison = "not_compared";
    expect(pdfPageSourceProvenanceSchema.parse(source)).toEqual(source);
    source.reasonCodes.push("pdf_ocr_unverified");
    expect(pdfPageSourceProvenanceSchema.safeParse(source).success).toBe(false);
  });
  it("refuses mismatched/duplicate physical pages and source/script identity", () => {
    const source = packet();
    const pages = payload().pages;
    expect(() =>
      validatePdfSourcePages(pages, {
        sourceSha256: extractedTextSha256("different received PDF"),
        scriptSha256: source.producer.scriptSha256,
        requireEveryPage: true,
      }),
    ).toThrow("PDF_SOURCE_PROVENANCE_IDENTITY_MISMATCH");
    expect(() =>
      validatePdfSourcePages(pages, {
        sourceSha256: source.sourceContentSha256,
        scriptSha256: extractedTextSha256("different executed script"),
        requireEveryPage: true,
      }),
    ).toThrow("PDF_SOURCE_PROVENANCE_IDENTITY_MISMATCH");
    expect(() => validatePdfSourcePages([...pages, ...pages])).toThrow("PDF_SOURCE_PROVENANCE_INVALID");
    source.physicalPageNumber = 2;
    expect(() => parseExtractedDocumentPayload(JSON.stringify(payload(source)))).toThrow(
      "PDF_SOURCE_PROVENANCE_INVALID",
    );
  });
  it("records sanitation without inventing original PDF offsets or altering source identity", () => {
    const source = packet();
    const text = "synthetic\u0000 page\\u0000\ud800";
    source.textIdentity.originalExtractedTextSha256 = extractedTextSha256(text);
    source.textIdentity.persistedTextSha256 = extractedTextSha256(text);
    source.producer.pythonVersion = "3.11\u0000";
    const clean = (value: string) =>
      value
        .replace(/\u0000/g, "")
        .replace(/\\u0000/g, "")
        .toWellFormed();
    const sanitize = (value: unknown): unknown =>
      typeof value === "string"
        ? clean(value)
        : Array.isArray(value)
          ? value.map(sanitize)
          : value && typeof value === "object"
            ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitize(entry)]))
            : value;
    const rows = buildDocumentPageRowsForPersistence(
      "synthetic",
      { pages: [{ pageNumber: 1, text, metadata: { source_provenance: source } }], images: [] },
      { cleanString: clean, sanitizeJsonbRecord: (value) => sanitize(value) as Record<string, unknown> },
    );
    const persisted = pdfPageSourceProvenanceSchema.parse(rows[0].metadata.source_provenance);
    expect(persisted.sourceContentSha256).toBe(source.sourceContentSha256);
    expect(persisted.textMapping).toEqual({ status: "not_established", offsets: null });
    expect(persisted.textIdentity).toMatchObject({
      originalExtractedTextSha256: extractedTextSha256(text),
      persistedTextSha256: extractedTextSha256(clean(text)),
      normalizationApplied: true,
      metadataNormalizationApplied: true,
    });
    expect(
      parseExtractedDocumentPayload(
        JSON.stringify({ pages: [{ pageNumber: 1, text: rows[0].text, metadata: rows[0].metadata }], images: [] }),
      ).pages[0].text,
    ).toBe(clean(text));
  });
  it.each([
    {
      label: "invented original text hash",
      updates: { originalExtractedTextSha256: extractedTextSha256("not returned text"), normalizationApplied: true },
    },
    { label: "claimed text normalization", updates: { normalizationApplied: true } },
    { label: "claimed metadata normalization", updates: { metadataNormalizationApplied: true } },
  ])("rejects $label at the fresh native boundary", ({ updates }) => {
    const source = packet();
    source.textIdentity = { ...source.textIdentity, ...updates };
    expect(() =>
      validatePdfSourcePages(payload(source).pages, {
        sourceSha256: source.sourceContentSha256,
        scriptSha256: source.producer.scriptSha256,
        requireEveryPage: true,
      }),
    ).toThrow("PDF_SOURCE_PROVENANCE_IDENTITY_MISMATCH");
  });
  it.each([
    { source: null, code: "PDF_SOURCE_PROVENANCE_INVALID" },
    { source: { ...packet(), version: "unknown" }, code: "PDF_SOURCE_PROVENANCE_INVALID" },
    { source: { ...packet(), physicalPageNumber: 2 }, code: "PDF_SOURCE_PROVENANCE_INVALID" },
    { source: packet(), code: "PDF_SOURCE_PROVENANCE_IDENTITY_MISMATCH" },
  ])(
    "carries successful native process refusal $code through extractPdf without fallback",
    async ({ source, code }) => {
      const root = await mkdtemp(path.join(tmpdir(), "clinical-kb-pdf-provenance-test-"));
      const script = path.join(root, "fake.py");
      const fallback = vi.spyOn(PDFParse.prototype, "getText");
      try {
        await writeFile(
          script,
          `import json, sys\nwith open(sys.argv[3], 'w') as handle:\n    json.dump(json.loads(${JSON.stringify(JSON.stringify(payload(source)))}), handle)\n`,
        );
        await expect(
          extractPdf(Buffer.from("synthetic malformed packet source"), { scriptPathOverride: script }),
        ).rejects.toMatchObject({ code });
        expect(fallback).not.toHaveBeenCalled();
      } finally {
        fallback.mockRestore();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
