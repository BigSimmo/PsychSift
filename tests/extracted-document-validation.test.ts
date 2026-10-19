import { describe, expect, it } from "vitest";
import { parseExtractedDocumentPayload } from "../src/lib/extractors/document";

describe("Python extracted-document payload validation", () => {
  it("accepts the extractor contract", () => {
    expect(
      parseExtractedDocumentPayload(
        JSON.stringify({
          pages: [{ pageNumber: 1, text: "Clinical source text", ocrUsed: true }],
          images: [
            {
              pageNumber: 1,
              path: "C:/tmp/page-1-table.png",
              mimeType: "image/png",
              bbox: [10, 20, 300, 180],
              width: 290,
              height: 160,
              sourceKind: "table_crop",
              metadata: { table_title: "Monitoring thresholds" },
            },
          ],
          warnings: [],
        }),
      ),
    ).toMatchObject({
      pages: [{ pageNumber: 1, text: "Clinical source text", ocrUsed: true }],
      images: [{ pageNumber: 1, sourceKind: "table_crop" }],
    });
  });

  it("retains bounded unverified raster observations without accepting arbitrary metadata", () => {
    const hash = "sha256:" + "a".repeat(64);
    const observations = {
      version: "raster-table-ocr-observations-v1",
      status: "unverified",
      cellModel: {
        language: "Latin",
        sha256: "sha256:6dbdaf8ecc6c40f025c2648bf3b3f3fbffe073e1fd2df2047fde2e2b2f020d53",
        bytes: 89_384_811,
      },
      outsideModel: { language: "eng", sha256: null, status: "not_observed" },
      runtime: {
        pythonVersion: "3.12.14",
        pymupdfVersion: "1.26.6",
        mupdfVersion: "1.26.11",
        tesseractVersion: "5.5.0",
      },
      detector: { width: 100, height: 200, scale: 2 },
      crops: [
        {
          kind: "cell",
          language: "Latin",
          sourceRect: [0, 0, 20, 10],
          scale: 6.25,
          width: 125,
          height: 63,
          pngSha256: hash,
          pixelsSha256: hash,
          textSha256: hash,
        },
      ],
    };
    const packet = (value: unknown) =>
      JSON.stringify({
        pages: [{ pageNumber: 1, text: "synthetic source", ocrUsed: true, metadata: { raster_table_ocr: value } }],
        images: [],
      });
    expect(parseExtractedDocumentPayload(packet(observations)).pages[0].metadata?.raster_table_ocr).toEqual(
      observations,
    );
    for (const invalid of [
      { ...observations, status: "verified" },
      { ...observations, confidence: 1 },
      { ...observations, cellModel: { ...observations.cellModel, sha256: hash } },
      { ...observations, cellModel: { ...observations.cellModel, bytes: 1 } },
      { ...observations, detector: { ...observations.detector, width: 4_000_000 } },
      { ...observations, crops: Array.from({ length: 113 }, () => observations.crops[0]) },
      { ...observations, crops: [{ ...observations.crops[0], language: "eng" }] },
      { ...observations, crops: [{ ...observations.crops[0], sourceRect: [20, 0, 0, 10] }] },
      { ...observations, crops: [{ ...observations.crops[0], privateText: "unapproved metadata" }] },
    ])
      expect(() => parseExtractedDocumentPayload(packet(invalid))).toThrow();
    expect(() =>
      parseExtractedDocumentPayload(
        JSON.stringify({
          pages: [{ pageNumber: 1, text: "synthetic", metadata: { arbitrary: "still rejected" } }],
          images: [],
        }),
      ),
    ).toThrow();
  });

  it.each([
    {
      name: "non-string page text",
      payload: { pages: [{ pageNumber: 1, text: 42 }], images: [] },
    },
    {
      name: "an incomplete image bounding box",
      payload: {
        pages: [],
        images: [{ pageNumber: 1, path: "table.png", mimeType: "image/png", bbox: [0, 0, 20] }],
      },
    },
    {
      name: "an image without a path",
      payload: { pages: [], images: [{ pageNumber: 1, mimeType: "image/png" }] },
    },
  ])("rejects $name", ({ payload }) => {
    expect(() => parseExtractedDocumentPayload(JSON.stringify(payload))).toThrow();
  });
});

describe("extraction provenance (audit F04)", () => {
  const provenance = {
    name: "extract_pdf_assets",
    version: "2026-10-19.ruled-edge-raster-table-ocr-v9",
    pymupdf: "1.26.0",
    tableStrategy: "table_aware_page_text",
  };

  it("preserves the previous reader's provenance on existing artifacts", () => {
    const previousProvenance = { ...provenance, version: "2026-10-18.ruled-edge-provenance-v7" };
    const parsed = parseExtractedDocumentPayload(
      JSON.stringify({ pages: [], images: [], extractor: previousProvenance }),
    );
    expect(parsed.extractor).toEqual(previousProvenance);
  });

  it("keeps the reader's provenance so the worker can record it on the document", () => {
    const parsed = parseExtractedDocumentPayload(JSON.stringify({ pages: [], images: [], extractor: provenance }));
    expect(parsed.extractor).toEqual(provenance);
  });

  it("still accepts a payload from an extractor that reports no provenance", () => {
    expect(parseExtractedDocumentPayload(JSON.stringify({ pages: [], images: [] })).extractor).toBeUndefined();
  });

  it("rejects a provenance block without a version, which could not be traced", () => {
    expect(() =>
      parseExtractedDocumentPayload(
        JSON.stringify({ pages: [], images: [], extractor: { name: "extract_pdf_assets" } }),
      ),
    ).toThrow();
  });

  it("matches the version the Python reader declares", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../worker/python/extract_pdf_assets.py", import.meta.url), "utf8");
    expect(source).toContain(`EXTRACTOR_VERSION = "${provenance.version}"`);
  });

  it("is written onto documents.metadata by the worker", async () => {
    const { readFileSync } = await import("node:fs");
    const worker = readFileSync(new URL("../worker/main.ts", import.meta.url), "utf8");
    expect(worker).toContain("extraction_provenance: { ...extracted.extractor, recorded_at: indexedAt }");
  });
});
