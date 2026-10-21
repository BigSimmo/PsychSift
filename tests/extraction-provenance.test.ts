import { describe, expect, it } from "vitest";

import type { ExtractedPage } from "@/lib/types";
import { buildExtractionProvenance } from "../worker/extraction-provenance";

const sha = `sha256:${"a".repeat(64)}`;

function pdfPage(pageNumber: number, tesseractVersion?: string): ExtractedPage {
  return {
    pageNumber,
    text: "page text",
    ocrUsed: tesseractVersion !== undefined,
    metadata: {
      source_provenance: {
        format: "pdf",
        producer: {
          contractVersion: "pdf-native-page-source-v1",
          route: "python_pdf",
          scriptSha256: sha,
          pythonVersion: "3.12.3",
          pymupdfVersion: "1.28.0",
          ...(tesseractVersion === undefined ? {} : { tesseractVersion }),
        },
      } as never,
    },
  };
}

describe("buildExtractionProvenance (#2F8K1V)", () => {
  const extractor = {
    name: "extract_pdf_assets",
    version: "2026-10-21.merged-cell-provenance-v11",
    pymupdf: "1.28.0",
    tableStrategy: "table_aware_page_text",
  };

  it("records the reader, the distinct chunker versions and the OCR engine of OCR'd pages", () => {
    const result = buildExtractionProvenance({
      extracted: { extractor, pages: [pdfPage(1), pdfPage(2, "5.3.4"), pdfPage(3, "5.3.4")] },
      chunks: [
        { metadata: { chunker_version: "1.3.1-page" } },
        { metadata: { chunker_version: "1.3.1-page" } },
        { metadata: { chunker_version: "1.3.1-document" } },
      ] as never,
      recordedAt: "2026-10-21T12:00:00.000Z",
    });
    expect(result).toEqual({
      ...extractor,
      chunker_versions: ["1.3.1-document", "1.3.1-page"],
      ocr_page_count: 2,
      ocr_engine_versions: ["5.3.4"],
      recorded_at: "2026-10-21T12:00:00.000Z",
    });
  });

  it("still records chunker provenance for a document whose extractor reports no reader block", () => {
    const result = buildExtractionProvenance({
      extracted: { pages: [{ pageNumber: 1, text: "plain text" }] },
      chunks: [{ metadata: { chunker_version: "1.3.1-page" } }] as never,
      recordedAt: "2026-10-21T12:00:00.000Z",
    });
    expect(result).toEqual({
      chunker_versions: ["1.3.1-page"],
      ocr_page_count: 0,
      ocr_engine_versions: [],
      recorded_at: "2026-10-21T12:00:00.000Z",
    });
  });

  it("ignores missing, non-string and oversized version values rather than storing them", () => {
    const result = buildExtractionProvenance({
      extracted: { extractor, pages: [pdfPage(1, "x".repeat(101))] },
      chunks: [{ metadata: {} }, { metadata: { chunker_version: 7 } }] as never,
      recordedAt: "2026-10-21T12:00:00.000Z",
    });
    expect(result.chunker_versions).toEqual([]);
    expect(result.ocr_engine_versions).toEqual([]);
    expect(result.ocr_page_count).toBe(1);
  });
});
