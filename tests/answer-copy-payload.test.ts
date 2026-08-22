import { describe, expect, it } from "vitest";

import {
  answerStateForAnswer,
  buildAnswerClipboardText,
  resolveAnswerSources,
  singleDocumentClipboardMetadata,
} from "@/components/clinical-dashboard/answer-copy-payload";
import { primaryAnswerDisplayText } from "@/components/clinical-dashboard/answer-content";
import { buildAnswerRenderModel } from "@/lib/answer-render-policy";
import type { ClinicalSourceMetadata, RagAnswer, SearchResult } from "@/lib/types";

// ClinicalSourceMetadata's governance fields are required-and-nullable rather
// than optional, so a fixture cannot quietly omit the provenance a real source
// always carries. Annotated once here and varied by spread below: spreading
// `overdueSource.source_metadata` instead would widen every field back to
// optional, because `source_metadata` is optional on `SearchResult`.
const overdueMetadata: ClinicalSourceMetadata = {
  source_title: "Superseded WA protocol",
  publisher: null,
  jurisdiction: null,
  version: null,
  publication_date: null,
  review_date: "2020-01-01",
  uploaded_at: null,
  indexed_at: null,
  uploaded_by: null,
  document_status: "outdated",
  clinical_validation_status: "unknown",
  extraction_quality: "unknown",
};

const overdueSource: SearchResult = {
  id: "chunk-1",
  document_id: "doc-1",
  title: "Superseded WA protocol",
  file_name: "protocol.pdf",
  page_number: 3,
  chunk_index: 0,
  section_heading: "Dosing",
  content: "Legacy dose text.",
  image_ids: [],
  similarity: 0.9,
  images: [],
  source_metadata: overdueMetadata,
};

const currentSource: SearchResult = {
  ...overdueSource,
  id: "chunk-2",
  source_metadata: { ...overdueMetadata, document_status: "current", review_date: "2026-01-01" },
};

function answerWith(sources: SearchResult[]): RagAnswer {
  return {
    answer: "Start at 12.5 mg at night.",
    grounded: true,
    confidence: "high",
    citations: [],
    sources,
  };
}

describe("resolveAnswerSources", () => {
  it("keeps a populated answer.sources set", () => {
    expect(resolveAnswerSources([overdueSource], [])).toEqual([overdueSource]);
  });

  it("falls back when answer.sources is an empty array", () => {
    // RagAnswer.sources is a required array, so "not populated" arrives as [] —
    // nullish coalescing alone would keep [] and drop the fallback.
    expect(resolveAnswerSources([], [overdueSource])).toEqual([overdueSource]);
  });

  it("falls back when answer.sources is nullish", () => {
    expect(resolveAnswerSources(undefined, [overdueSource])).toEqual([overdueSource]);
    expect(resolveAnswerSources(null, [overdueSource])).toEqual([overdueSource]);
  });
});

describe("answerStateForAnswer · empty sources fallback", () => {
  it("projects stale_evidence from the fallback when answer.sources is []", () => {
    const state = answerStateForAnswer({
      answer: answerWith([]),
      sources: [overdueSource],
    });

    expect(state.kind).toBe("stale_evidence");
    if (state.kind !== "stale_evidence") return;
    expect(state.sourceCount).toBe(1);
    expect(state.overdue[0]?.sourceId).toBe("doc-1");
  });

  it("does not invent stale_evidence when both sets are empty", () => {
    const state = answerStateForAnswer({
      answer: answerWith([]),
      sources: [],
    });

    expect(state).toEqual({ kind: "ready", sourceCount: 0 });
  });
});

describe("buildAnswerClipboardText · single-document provenance", () => {
  it("uses the visible sanitized lead in the render-model clipboard path", () => {
    const answer: RagAnswer = {
      ...answerWith([currentSource]),
      answer:
        "Source mentions: Start the prescribed treatment after confirming the indication. Synthetic demo only: illustrative content.",
    };
    const displayText = primaryAnswerDisplayText(answer.answer);
    const renderModel = buildAnswerRenderModel(answer, { sources: [currentSource] });

    const copied = buildAnswerClipboardText({ answer, renderCopyText: renderModel.copyText });

    expect(displayText).toBe("Start the prescribed treatment after confirming the indication.");
    expect(copied).toContain(displayText);
    expect(copied).not.toContain("Source mentions:");
    expect(copied).not.toContain("Synthetic demo only:");
  });

  it("keeps preformatted content while removing bold markers from the copied lead", () => {
    const answer: RagAnswer = {
      ...answerWith([currentSource]),
      answer: "Facility code: WA-ABC-9\nUse the **local protocol**.",
      preformatted: true,
    };
    const renderModel = buildAnswerRenderModel(answer, { sources: [currentSource] });
    const copied = buildAnswerClipboardText({ answer, renderCopyText: renderModel.copyText });

    expect(primaryAnswerDisplayText(answer.answer, { preformatted: true, preserveBold: true })).toBe(answer.answer);
    expect(copied).toContain("Facility code: WA-ABC-9\nUse the local protocol.");
    expect(copied).not.toContain("**");
  });

  it("includes the provenance audit line for a one-document answer", () => {
    const copied = buildAnswerClipboardText({
      answer: answerWith([currentSource]),
      renderCopyText: "Clinical answer draft\n\nStart at 12.5 mg at night.",
    });

    expect(copied).toContain("Designation:");
    expect(copied).toContain("Review status:");
  });

  it("keeps the provenance line when the extra document is an uncited candidate", () => {
    // RagAnswer.sources retains every retrieval candidate while citations name
    // the supporting set. Deriving metadata from the raw candidate list made a
    // genuinely one-document answer look like two and dropped the audit line
    // from the paste — on the normal payload shape, not an edge case.
    const uncitedOtherDoc: SearchResult = {
      ...currentSource,
      id: "chunk-99",
      document_id: "doc-2",
      title: "Unrelated candidate",
    };
    const answer: RagAnswer = {
      ...answerWith([currentSource, uncitedOtherDoc]),
      citations: [
        {
          chunk_id: currentSource.id,
          document_id: currentSource.document_id,
          title: currentSource.title,
          file_name: currentSource.file_name,
          page_number: currentSource.page_number,
          chunk_index: currentSource.chunk_index,
        },
      ],
    };

    const copied = buildAnswerClipboardText({ answer, renderCopyText: "Clinical answer draft" });
    expect(copied).toContain("Designation:");
    expect(copied).toContain("Review status:");
  });

  it("suppresses the provenance line when more than one document is cited", () => {
    const secondDoc: SearchResult = {
      ...currentSource,
      id: "chunk-3",
      document_id: "doc-2",
      title: "Second guideline",
    };
    const copied = buildAnswerClipboardText({
      answer: answerWith([currentSource, secondDoc]),
      renderCopyText: "Clinical answer draft",
    });

    expect(copied).not.toContain("Designation:");
    expect(singleDocumentClipboardMetadata([currentSource, secondDoc])).toBeUndefined();
  });
});
