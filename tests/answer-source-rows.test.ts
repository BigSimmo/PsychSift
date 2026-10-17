import { describe, expect, it } from "vitest";

import {
  buildAnswerSourceRows,
  sourceBadgeDisplay,
  sourceSpokenName,
  sourceStepSpokenLabel,
  sourceSupportLabel,
  sourceSupportSentence,
  type AnswerSourceRow,
} from "@/components/clinical-dashboard/answer-source-rows";
import {
  documentFileKind,
  documentFileKindFromType,
  documentSupportBadgeProps,
} from "@/components/clinical-dashboard/document-ui";
import { normalizeSourceMetadata } from "@/lib/source-metadata";
import type { SearchResult } from "@/lib/types";

function makeRow(overrides: Partial<AnswerSourceRow> = {}): AnswerSourceRow {
  return {
    id: "row-1",
    documentId: "doc-1",
    title: "Maudsley Prescribing Guidelines in Psychiatry",
    href: "/documents/doc-1?page=42",
    pageNumber: 42,
    score: 0.92,
    snippet: "Monitor ANC weekly for the first 18 weeks.",
    metadata: normalizeSourceMetadata({
      document_status: "current",
      clinical_Readiness: "approved",
    }),
    sourceStrength: "strong",
    cited: true,
    ...overrides,
  };
}

describe("answer-source-rows uncited / em-dash presentation labels (R17)", () => {
  it("never labels an uncited row as Direct or Partial support even if sourceStrength is strong or moderate", () => {
    const uncitedStrong = makeRow({ cited: false, sourceStrength: "strong" });
    const uncitedModerate = makeRow({ cited: false, sourceStrength: "moderate" });
    const emDashRow = makeRow({ sourceStrength: "strong", ...({ badge: "—" } as Record<string, unknown>) });

    expect(sourceBadgeDisplay(uncitedStrong, 1)).toBe("—");
    expect(sourceSupportLabel(uncitedStrong)).toBe("Searched, not cited");
    expect(sourceSupportLabel(uncitedModerate)).toBe("Searched, not cited");
    expect(sourceSupportLabel(emDashRow)).toBe("Searched, not cited");
  });

  it("preserves Direct, Partial, and Unsupported labels for cited rows", () => {
    expect(sourceSupportLabel(makeRow({ cited: true, sourceStrength: "strong" }))).toBe("Direct");
    expect(sourceSupportLabel(makeRow({ cited: true, sourceStrength: "moderate" }))).toBe("Partial");
    expect(sourceSupportLabel(makeRow({ cited: true, sourceStrength: "weak" as never }))).toBe("Partial");
    expect(sourceSupportLabel(makeRow({ cited: true, sourceStrength: "none" }))).toBe("Unsupported");
  });

  it("announces uncited rows as Also found and em-dash rows as Searched document", () => {
    const uncited = makeRow({ cited: false });
    const emDash = makeRow({ ...({ badge: "—" } as Record<string, unknown>) });
    const cited = makeRow({ cited: true });

    expect(sourceSpokenName(uncited, 3)).toBe("Also found");
    expect(sourceStepSpokenLabel(uncited, 3)).toBe("Also found source");
    expect(sourceSpokenName(emDash, 3)).toBe("Searched document");
    expect(sourceStepSpokenLabel(emDash, 3)).toBe("Searched document");
    expect(sourceSpokenName(cited, 0)).toBe("Source 1");
  });

  it("returns neutral searched support sentence when an uncited row is opened without claim support", () => {
    const uncited = makeRow({ cited: false, sourceStrength: "strong" });
    expect(sourceSupportSentence(uncited, null)).toBeNull();
    expect(sourceSupportSentence(uncited, 1)).toBe("Searched, not cited in the answer.");
    expect(sourceSupportSentence(uncited, 1, "direct")).toBe("This page states the claim directly.");
  });

  it("maps uncited or em-dash documents to the searched DocumentBadge variant", () => {
    expect(documentSupportBadgeProps({ cited: false, sourceStrength: "strong" })).toEqual({
      variant: "searched",
      label: "Searched, not cited",
    });
    expect(documentSupportBadgeProps({ badge: "—", sourceStrength: "moderate" })).toEqual({
      variant: "searched",
      label: "Searched, not cited",
    });
    expect(documentSupportBadgeProps({ cited: true, sourceStrength: "strong" })).toEqual({
      variant: "best",
      label: "Direct",
    });
  });

  it("falls back to source.content for inline excerpts when sourceLinks omit snippet and detects TXT vs PDF kinds", () => {
    const sources: SearchResult[] = [
      {
        id: "chunk-txt-1",
        document_id: "doc-txt-1",
        title: "Alcohol Withdrawal Management Reference",
        file_name: "alcohol-withdrawal-reference.txt",
        page_number: 1,
        chunk_index: 0,
        section_heading: "Monitoring",
        content: "Monitor CIWA-Ar every 1 to 4 hours during acute alcohol withdrawal.",
        similarity: 0.91,
        hybrid_score: 0.91,
        image_ids: [],
        images: [],
      },
    ];
    const rows = buildAnswerSourceRows(
      null,
      sources,
      [
        {
          id: "link-txt-1",
          chunk_id: "chunk-txt-1",
          document_id: "doc-txt-1",
          title: "Alcohol Withdrawal Management Reference",
          file_name: "alcohol-withdrawal-reference.txt",
          page_number: 1,
          label: "Source 1",
          reason: "cited",
          href: "/documents/doc-txt-1",
          snippet: "",
          sourceStrength: "strong",
        },
      ],
      new Set(["chunk-txt-1"]),
    );

    expect(rows[0]?.snippet).toBe("Monitor CIWA-Ar every 1 to 4 hours during acute alcohol withdrawal.");
    expect(documentFileKind(rows[0]?.fileName)).toBe("TXT");
    expect(documentFileKind("guideline-without-extension")).toBe("PDF");
    expect(documentFileKindFromType("application/pdf", "guideline.docx")).toBe("PDF");
    expect(documentFileKindFromType("Text/Plain; charset=utf-8", "notes.pdf")).toBe("TXT");
    expect(documentFileKindFromType("application/octet-stream", "notes.docx")).toBe("DOCX");
    expect(documentFileKindFromType(null, "no-extension")).toBe("PDF");
    expect(documentFileKindFromType("image/png", "scan")).toBe("PNG");
    expect(documentFileKindFromType("image/tiff", "scan")).toBe("IMAGE");
  });
});
