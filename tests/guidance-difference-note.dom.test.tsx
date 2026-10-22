import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/clinical-dashboard/signed-image", () => ({
  SignedImage: ({ caption }: { caption?: string }) => <p>{caption}</p>,
}));

import { NaturalLanguageAnswer } from "@/components/clinical-dashboard/answer-content";
import { buildAnswerClipboardText } from "@/components/clinical-dashboard/answer-copy-payload";
import { clientAnswerFieldsSchema } from "@/lib/answer-client-fields";
import {
  activeReviewedGuidanceDifferences,
  guidanceDifferenceNoteForAnswer,
  type ReviewedGuidanceDifference,
} from "@/lib/rag/guidance-difference-note";
import registry from "@/data/reviewed-guidance-differences.json";
import type { RagAnswer, SearchResult } from "@/lib/types";

/**
 * Owner decision 2026-10-21: when WA and national guidance differ, the answer follows WA and one
 * plain line names the national source. The line only comes from an owner-signed entry.
 * All identifiers and titles below are synthetic.
 */

const ENTRY: ReviewedGuidanceDifference = {
  id: "synthetic-renal-interval",
  topic: "renal monitoring interval",
  waDocumentId: "doc-wa",
  waChunkIds: ["chunk-wa-1"],
  national: {
    documentId: "doc-national",
    chunkId: "chunk-national-4",
    title: "Example National Guideline",
    publisher: "Example national body",
    year: 2023,
    page: 11,
  },
  signedOffBy: "owner",
  signedOffAt: "2026-10-21",
  reviewBy: "2099-12-31",
};

function answer(overrides: Partial<Pick<RagAnswer, "grounded" | "supportedClaims" | "sources">> = {}) {
  return {
    grounded: true,
    sources: [{ id: "chunk-wa-1" }, { id: "chunk-other" }] as SearchResult[],
    supportedClaims: [
      {
        claimId: "c1",
        text: "Check renal function.",
        riskClass: "routine",
        supportingChunkIds: ["chunk-wa-1"],
        supportStatus: "direct",
      },
    ],
    ...overrides,
  } as Pick<RagAnswer, "grounded" | "supportedClaims" | "sources">;
}

describe("guidance difference note", () => {
  it("ships with no signed-off differences, so no answer changes until the owner adds one", () => {
    expect(registry.differences).toEqual([]);
    expect(guidanceDifferenceNoteForAnswer(answer())).toBeUndefined();
  });

  it("attaches the national source when a signed-off WA chunk directly supports the answer", () => {
    expect(guidanceDifferenceNoteForAnswer(answer(), [ENTRY])).toEqual({
      differenceId: "synthetic-renal-interval",
      title: "Example National Guideline",
      year: 2023,
      page: 11,
      documentId: "doc-national",
      chunkId: "chunk-national-4",
    });
  });

  it("stays silent for partial support, ungrounded answers and chunks the answer did not serve", () => {
    const partial = answer({
      supportedClaims: [
        {
          claimId: "c1",
          text: "x",
          riskClass: "routine",
          supportingChunkIds: ["chunk-wa-1"],
          supportStatus: "partial",
        },
      ],
    });
    expect(guidanceDifferenceNoteForAnswer(partial, [ENTRY])).toBeUndefined();
    expect(guidanceDifferenceNoteForAnswer(answer({ grounded: false }), [ENTRY])).toBeUndefined();
    expect(guidanceDifferenceNoteForAnswer(answer({ sources: [] }), [ENTRY])).toBeUndefined();
  });

  it("drops expired, unsigned and malformed entries", () => {
    const now = new Date("2027-01-01T00:00:00Z");
    expect(
      activeReviewedGuidanceDifferences(
        [
          { ...ENTRY, id: "expired", reviewBy: "2026-12-31" },
          { ...ENTRY, id: "unsigned", signedOffBy: "agent" },
          { ...ENTRY, id: "same-document", national: { ...ENTRY.national, documentId: "doc-wa" } },
          { ...ENTRY, id: "no-chunks", waChunkIds: [] },
          { ...ENTRY, id: "year-typo", national: { ...ENTRY.national, year: 20233 } },
          { ...ENTRY, id: "long-title", national: { ...ENTRY.national, title: "x".repeat(301) } },
          ENTRY,
        ],
        now,
      ).map((entry) => entry.id),
    ).toEqual(["synthetic-renal-interval"]);
  });

  it("passes the client field boundary", () => {
    const note = guidanceDifferenceNoteForAnswer(answer(), [ENTRY]);
    expect(clientAnswerFieldsSchema.safeParse({ guidanceDifference: note }).success).toBe(true);
    expect(clientAnswerFieldsSchema.safeParse({ guidanceDifference: { ...note, title: "" } }).success).toBe(false);
  });

  function renderAnswer(props: { isRefusal?: boolean; withNote?: boolean }) {
    return render(
      <NaturalLanguageAnswer
        text="Check renal function at baseline and six weeks after starting."
        bestSource={null}
        sources={[]}
        sourceLinks={[]}
        railRows={[]}
        copied={false}
        onCopy={vi.fn()}
        isRefusal={props.isRefusal}
        guidanceDifference={props.withNote === false ? undefined : guidanceDifferenceNoteForAnswer(answer(), [ENTRY])}
      />,
    );
  }

  it("renders one plain line under the answer, linking to the national source page", () => {
    renderAnswer({});
    const line = screen.getByTestId("answer-guidance-difference");
    expect(line.textContent).toBe(
      "National guidance differs on this point. See Example National Guideline, 2023, p 11.",
    );
    const link = screen.getByRole("link", { name: "Example National Guideline, 2023, p 11" });
    expect(link.getAttribute("href")).toBe("/documents/doc-national?page=11&chunk=chunk-national-4");
    expect(screen.getByTestId("plain-answer-prose").closest("p")?.nextElementSibling).toBe(line);
  });

  it("shows nothing without a note or on a refusal", () => {
    const { unmount } = renderAnswer({ withNote: false });
    expect(screen.queryByTestId("answer-guidance-difference")).toBeNull();
    unmount();
    renderAnswer({ isRefusal: true });
    expect(screen.queryByTestId("answer-guidance-difference")).toBeNull();
  });

  it("keeps the line in a copied answer, directly after the answer text", () => {
    const note = guidanceDifferenceNoteForAnswer(answer(), [ENTRY]);
    const copied = buildAnswerClipboardText({
      answer: {
        answer: "Check renal function at baseline and six weeks after starting.",
        grounded: true,
        confidence: "high",
        citations: [],
        sources: [],
        guidanceDifference: note,
      },
      renderCopyText:
        "Clinical answer draft\n\nAnswer\nCheck renal function at baseline and six weeks after starting.\n\nSources\n1. WA guideline",
    });
    expect(copied).toContain(
      "Check renal function at baseline and six weeks after starting.\n\nNational guidance differs on this point. See Example National Guideline, 2023, p 11.\n\nSources",
    );
  });
});
