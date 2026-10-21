import { describe, expect, it } from "vitest";

import {
  buildProvenanceReport,
  NOT_RECORDED,
  parseProvenanceArgs,
  readProvenance,
} from "@/lib/extraction-provenance-report";

const recorded = (version: string, chunkers: string[], ocr: string[] = []) => ({
  extraction_provenance: { name: "extract_pdf_assets", version, chunker_versions: chunkers, ocr_engine_versions: ocr },
});

const rows = [
  { id: "a", title: "Lithium", metadata: recorded("v11", ["1.3.1-page"], ["5.3.4"]) },
  { id: "b", title: "Clozapine", metadata: recorded("v10", ["1.3.0-page", "1.3.0-document"]) },
  { id: "c", title: "Legacy", metadata: { index_generation_id: "x" } },
  { id: "d", title: null, metadata: null },
];

describe("extraction provenance report (#2F8K1V)", () => {
  it("counts every document by reader, chunker and OCR engine, marking unrecorded documents", () => {
    const report = buildProvenanceReport(rows);
    expect(report.scanned).toBe(4);
    expect(report.matched.map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
    expect(report.byExtractorVersion).toEqual({ v11: 1, v10: 1, [NOT_RECORDED]: 2 });
    expect(report.byChunkerVersion).toEqual({
      "1.3.1-page": 1,
      "1.3.0-page": 1,
      "1.3.0-document": 1,
      [NOT_RECORDED]: 2,
    });
    expect(report.byOcrEngineVersion).toEqual({ "5.3.4": 1 });
  });

  it("lists only the documents a given version touched", () => {
    expect(buildProvenanceReport(rows, { extractorVersion: "v10" }).matched).toEqual([{ id: "b", title: "Clozapine" }]);
    expect(buildProvenanceReport(rows, { chunkerVersion: "1.3.1-page" }).matched.map((row) => row.id)).toEqual(["a"]);
    expect(buildProvenanceReport(rows, { ocrEngineVersion: "5.3.4" }).matched.map((row) => row.id)).toEqual(["a"]);
    expect(buildProvenanceReport(rows, { ocrEngineVersion: "4.1.1" }).matched).toEqual([]);
  });

  it("lists exactly the documents a count shows as not recorded", () => {
    expect(buildProvenanceReport(rows, { extractorVersion: NOT_RECORDED }).matched.map((row) => row.id)).toEqual([
      "c",
      "d",
    ]);
    expect(buildProvenanceReport(rows, { chunkerVersion: NOT_RECORDED }).matched.map((row) => row.id)).toEqual([
      "c",
      "d",
    ]);
  });

  it("reads a reader-only record written before chunker and OCR versions were added", () => {
    expect(readProvenance({ extraction_provenance: { name: "extract_pdf_assets", version: "v7" } })).toEqual({
      extractorVersion: "v7",
      chunkerVersions: [],
      ocrEngineVersions: [],
    });
  });

  it("parses filters and refuses a flag without a value", () => {
    expect(parseProvenanceArgs(["--chunker-version", "1.3.1-page", "--list"])).toEqual({
      extractorVersion: undefined,
      chunkerVersion: "1.3.1-page",
      ocrEngineVersion: undefined,
      listDocuments: true,
    });
    expect(() => parseProvenanceArgs(["--extractor-version", "--list"])).toThrow("--extractor-version needs a value");
  });
});
