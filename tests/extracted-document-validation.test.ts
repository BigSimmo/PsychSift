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
    version: "2026-10-15.intact-layout-v5",
    pymupdf: "1.26.0",
    tableStrategy: "table_aware_page_text",
  };

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
