import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
