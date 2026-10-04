import { describe, expect, it } from "vitest";

import {
  buildDocumentSectionIndex,
  documentIndexingSectionId,
  documentOverviewSectionId,
  type DocumentSectionIndexInput,
} from "@/components/document-viewer/section-index";

function input(overrides: Partial<DocumentSectionIndexInput> = {}): DocumentSectionIndexInput {
  return {
    hasDocument: true,
    hasStoredSummary: true,
    pageCount: 84,
    chunkCount: 312,
    visualCount: 6,
    hasIndexHealth: true,
    pinnedPage: 12,
    loading: false,
    ...overrides,
  };
}

describe("buildDocumentSectionIndex", () => {
  it("returns nothing until a document has resolved", () => {
    expect(buildDocumentSectionIndex(input({ hasDocument: false }))).toEqual([]);
  });

  it("lists the full document in reading order", () => {
    expect(buildDocumentSectionIndex(input()).map((section) => section.id)).toEqual([
      documentOverviewSectionId,
      "source-evidence",
      "pdf-preview-section",
      "source-summary",
      "source-text",
      "source-images",
      documentIndexingSectionId,
    ]);
  });

  it("omits sections the document does not have rather than disabling them", () => {
    const sections = buildDocumentSectionIndex(
      input({ hasStoredSummary: false, visualCount: 0, hasIndexHealth: false }),
    );

    expect(sections.map((section) => section.id)).toEqual([
      documentOverviewSectionId,
      "source-evidence",
      "pdf-preview-section",
      "source-text",
    ]);
  });

  it("reports indexing as pending instead of a count of zero", () => {
    const sections = buildDocumentSectionIndex(input({ loading: true, chunkCount: 0, visualCount: 0 }));
    const text = sections.find((section) => section.id === "source-text");

    expect(text?.pending).toBe(true);
    expect(text?.detail).toBe("Indexing");
    // A loading document has not yet proven it has no visuals, so the row stays.
    expect(sections.some((section) => section.id === "source-images")).toBe(true);
  });

  it("weights the track by share of the document and always normalises to one", () => {
    const sections = buildDocumentSectionIndex(input());
    const total = sections.reduce((sum, section) => sum + section.weight, 0);
    expect(total).toBeCloseTo(1, 10);

    const weightOf = (id: string) => sections.find((section) => section.id === id)?.weight ?? 0;
    // An 84-page PDF is a bigger part of the document than its indexing footnote.
    expect(weightOf("pdf-preview-section")).toBeGreaterThan(weightOf(documentIndexingSectionId));
    expect(weightOf("source-text")).toBeGreaterThan(weightOf(documentOverviewSectionId));
  });

  it("re-weights when sections are absent so the track still fills", () => {
    const sparse = buildDocumentSectionIndex(input({ hasStoredSummary: false, visualCount: 0 }));
    expect(sparse.reduce((sum, section) => sum + section.weight, 0)).toBeCloseTo(1, 10);
  });

  it("names the pinned passage page, and leaves the row out when nothing is pinned", () => {
    expect(buildDocumentSectionIndex(input()).find((section) => section.id === "source-evidence")?.detail).toBe(
      "Page 12",
    );
    expect(
      buildDocumentSectionIndex(input({ pinnedPage: null })).some((section) => section.id === "source-evidence"),
    ).toBe(false);
  });

  it("marks only the accordion sections collapsible", () => {
    const collapsible = buildDocumentSectionIndex(input())
      .filter((section) => section.collapsible)
      .map((section) => section.id);

    expect(collapsible).toEqual(["source-summary", "source-text", "source-images", documentIndexingSectionId]);
    expect(buildDocumentSectionIndex(input()).find((section) => section.id === "source-text")?.collapsible).toBe(true);
  });
});
