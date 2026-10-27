import { describe, expect, it, vi } from "vitest";
import { assessDocumentIndexQuality } from "../src/lib/index-quality";
import type { ExtractedDocument } from "../src/lib/types";
import { ingestionFailureDecision } from "../worker/behavior";
import { assertLegacyExtractionComplete, assertLegacyIndexPromotion } from "../worker/legacy-index-promotion";

const paragraph = "Synthetic source guidance with a retained qualification and complete explanatory context. ".repeat(
  5,
);
function extracted(): ExtractedDocument {
  return { pages: [{ pageNumber: 1, text: paragraph }], images: [] };
}
const chunks = [{ content: paragraph }];

describe("legacy generation promotion", () => {
  it("allows complete source text while optional enrichment is absent", () => {
    expect(() => assertLegacyIndexPromotion({ extracted: extracted(), chunks, insertedImages: [] })).not.toThrow();
  });

  it("separates optional enrichment penalties from the core extraction assessment", () => {
    const input = {
      metrics: {
        page_count: 1,
        text_character_count: paragraph.length,
        extracted_image_count: 0,
        searchable_image_count: 0,
      },
      chunks,
      insertedImages: [],
      sectionCount: 0,
      memoryCardCount: 0,
    };
    expect(assessDocumentIndexQuality(input).issues).toContain("no memory cards");
    const core = assessDocumentIndexQuality({ ...input, includeOptionalEnrichment: false });
    expect(core.issues).not.toContain("no memory cards");
    expect(core.issues).not.toContain("missing document summary embedding");
    expect(core.extractionQuality).toBe("good");
  });

  it("refuses even one unresolved required OCR page before downstream work", () => {
    const input = extracted();
    input.pages.push({ pageNumber: 2, text: paragraph, needsOcr: true });
    const next = vi.fn();
    expect(() => {
      assertLegacyExtractionComplete(input);
      next();
    }).toThrow("legacy_index_promotion_refused:unresolved_ocr");
    expect(next).not.toHaveBeenCalled();
  });

  it("refuses a source-reported page-count mismatch", () => {
    const input = extracted();
    input.budgetUsage = { pages: 2, artifacts: 0, artifactBytes: 0, textBytes: paragraph.length };
    expect(() => assertLegacyExtractionComplete(input)).toThrow(
      "legacy_index_promotion_refused:source_page_count_mismatch",
    );
  });

  it("does not invent a contiguous physical-page requirement without a source count", () => {
    const input = extracted();
    input.pages[0].pageNumber = 62;
    expect(() => assertLegacyExtractionComplete(input)).not.toThrow();
  });

  it("refuses reported table truncation even when searchable text survived", () => {
    const input = extracted();
    input.images.push({
      pageNumber: 1,
      path: "synthetic-table.png",
      mimeType: "image/png",
      sourceKind: "table_crop",
      metadata: { rows_truncated: true },
    });
    expect(() => assertLegacyIndexPromotion({ extracted: input, chunks, insertedImages: [] })).toThrow(
      "legacy_index_promotion_refused:truncated_table",
    );
  });

  it("refuses poor core coverage without invoking a commit, preserving the indexed failure state", () => {
    const input = extracted();
    input.pages = Array.from({ length: 20 }, (_, index) => ({ pageNumber: index + 1, text: "Sparse." }));
    const commit = vi.fn();
    let refusal: unknown;
    try {
      assertLegacyIndexPromotion({
        extracted: input,
        chunks: Array.from({ length: 20 }, () => ({ content: "Repeated short chunk." })),
        insertedImages: [],
      });
      commit();
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({ message: "legacy_index_promotion_refused:poor_core_extraction" });
    expect(commit).not.toHaveBeenCalled();
    expect(
      ingestionFailureDecision({ error: refusal, attemptCount: 1, maxAttempts: 3, atomicReindex: true }),
    ).toMatchObject({ retry: false, documentStatus: "indexed" });
  });
});
