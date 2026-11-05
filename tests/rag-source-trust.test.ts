import { expect, it } from "vitest";
import {
  assessAndEnforceClaimSupport,
  claimRestatesSourceVerbatim,
  sourceDirectlySupportsAnswerText,
} from "@/lib/rag/rag-claim-support";
import { sanitizeQuoteCards } from "@/lib/rag/rag-quote-verification";
import { finalizeRagAnswerQuality } from "@/lib/rag/rag-answer-quality-gate";
import type { Citation, RagAnswer, SearchResult } from "@/lib/types";

function source(id: string, content: string, overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id,
    document_id: `doc-${id}`,
    title: `Source ${id}`,
    file_name: `${id}.pdf`,
    page_number: 1,
    chunk_index: 0,
    section_heading: null,
    content,
    image_ids: [],
    images: [],
    similarity: 0.9,
    source_metadata: {
      source_title: `Source ${id}`,
      publisher: "Local service",
      jurisdiction: "WA",
      version: "1",
      publication_date: "2026-01-01",
      review_date: "2027-01-01",
      uploaded_at: "2026-01-01",
      indexed_at: "2026-01-01",
      uploaded_by: null,
      document_status: "current",
      clinical_validation_status: "approved",
      extraction_quality: "good",
    },
    ...overrides,
  };
}

function citation(result: SearchResult, provenance: Citation["provenance"] = "model_selected"): Citation {
  return {
    chunk_id: result.id,
    document_id: result.document_id,
    title: result.title,
    file_name: result.file_name,
    page_number: result.page_number,
    chunk_index: result.chunk_index,
    provenance,
  };
}

function answer(text: string, sources: SearchResult[], citations = sources.map((item) => citation(item))): RagAnswer {
  return {
    answer: text,
    grounded: true,
    confidence: "high",
    citations,
    sources,
    routingMode: "strong",
    responseMode: "clinical_pathway",
  };
}

const claim = "Synthetic procedure Z always requires a second review before completion.";
it("rejects a recommendation governed by a preceding withdrawal through the finalizer", () => {
  const s = source("withdrawn", "Correction: the following recommendation is withdrawn. " + claim);
  expect(claimRestatesSourceVerbatim(claim, s)).toBe(false);
  expect(sourceDirectlySupportsAnswerText(claim, s)).toBe(false);
  expect(assessAndEnforceClaimSupport(answer(claim, [s])).grounded).toBe(false);
  expect(
    finalizeRagAnswerQuality(answer(claim, [s]), "What review does synthetic procedure Z require?", "broad_summary")
      .grounded,
  ).toBe(false);
});
it("rejects derived-only direct proof and exact quotes through the finalizer", () => {
  const quote = "The synthetic green marker always requires review.";
  const s = source("derived", "The synthetic source only describes a blue marker.", {
    retrieval_synopsis: quote,
    index_unit: { title: "Synthetic summary", content: quote } as SearchResult["index_unit"],
  });
  const cards = sanitizeQuoteCards([{ chunk_id: s.id, quote }], [s]);
  expect(cards).toEqual([]);
  expect(sourceDirectlySupportsAnswerText(quote, s)).toBe(false);
  expect(
    finalizeRagAnswerQuality(
      { ...answer(quote, [s]), quoteCards: cards },
      "What review does the synthetic green marker require?",
      "broad_summary",
    ).grounded,
  ).toBe(false);
});
it("preserves original evidence and unrelated withdrawal discussion with bounded conditions", () => {
  const s = source("original", "Withdrawal symptoms require observation. " + claim);
  expect(sourceDirectlySupportsAnswerText(claim, s)).toBe(true);
  expect(sanitizeQuoteCards([{ chunk_id: s.id, quote: claim }], [s])[0]?.provenance).toBe("exact_quote");
  expect(
    sanitizeQuoteCards([{ chunk_id: s.id, quote: "An absent synthetic instruction requires review." }], [s]),
  ).toEqual([]);
  expect(claimRestatesSourceVerbatim(claim, source("conditional", "If the synthetic marker is green:\n" + claim))).toBe(
    false,
  );
  const nearby = source(
    "nearby",
    "The following recommendation is withdrawn. The obsolete procedure requires review. " + claim,
  );
  expect(sourceDirectlySupportsAnswerText(claim, nearby)).toBe(true);
});
it("withdraws the substantive numbered recommendation and preserves negated withdrawal", () => {
  const numbered = source("numbered", "Correction: the following recommendation is withdrawn. 1. " + claim);
  expect(
    finalizeRagAnswerQuality(
      answer(claim, [numbered]),
      "What review does synthetic procedure Z require?",
      "broad_summary",
    ).grounded,
  ).toBe(false);
  const negated = source("negated", "The following recommendation is not withdrawn. " + claim);
  expect(sourceDirectlySupportsAnswerText(claim, negated)).toBe(true);
  const later = source(
    "later",
    "The following recommendation is withdrawn. 1. The obsolete procedure requires review. 2. " + claim,
  );
  expect(sourceDirectlySupportsAnswerText(claim, later)).toBe(true);
});
it("does not display a withdrawn quote alongside a supported safe lead", () => {
  const safe = "Synthetic procedure Z requires recording the completion date.";
  const s = source("withdrawn-quote", safe + " Correction: the following recommendation is withdrawn. " + claim);
  const cards = sanitizeQuoteCards([{ chunk_id: s.id, quote: claim }], [s]);
  const final = finalizeRagAnswerQuality(
    { ...answer(safe, [s]), quoteCards: cards },
    "What does synthetic procedure Z require?",
    "broad_summary",
  );
  expect(cards).toEqual([]);
  expect(final.quoteCards ?? []).toEqual([]);
  expect(final.answer).not.toContain(claim);
});
it("keeps short original quotes without requiring a full clinical assertion", () => {
  const s = source("short-quote", "Record the completion date.");
  expect(sanitizeQuoteCards([{ chunk_id: s.id, quote: "completion date" }], [s])[0]?.quote).toBe("completion date");
});
it("removes unsafe prose from the delivered lead and sections", () => {
  for (const [text, s] of [
    [claim, source("withdrawn-delivery", "The following recommendation is withdrawn. " + claim)],
    [
      claim,
      source("derived-delivery", "The original source describes a different procedure.", { retrieval_synopsis: claim }),
    ],
  ] as const) {
    const final = finalizeRagAnswerQuality(
      {
        ...answer(text, [s]),
        answerSections: [
          { heading: "Recommendation", kind: "required_actions", body: text, citation_chunk_ids: [s.id] },
        ],
      },
      "What review does synthetic procedure Z require?",
      "broad_summary",
    );
    expect(final.answer).not.toContain(text);
    expect((final.answerSections ?? []).map((section) => section.body).join(" ")).not.toContain(text);
  }
});
it("filters duplicated withdrawn adjacent context while preserving valid adjacent quotations", () => {
  const safe = "Synthetic procedure Z requires recording the completion date.";
  const content = safe + " The following recommendation is withdrawn. " + claim;
  const s = source("adjacent-withdrawn", content, { adjacent_context: content });
  const cards = sanitizeQuoteCards([{ chunk_id: s.id, quote: claim }], [s]);
  expect(cards).toEqual([]);
  const final = finalizeRagAnswerQuality(
    { ...answer(safe, [s]), quoteCards: cards },
    "What does synthetic procedure Z require?",
    "broad_summary",
  );
  expect(final.quoteCards ?? []).toEqual([]);
  const valid = source("adjacent-valid", safe, { adjacent_context: claim });
  expect(sanitizeQuoteCards([{ chunk_id: valid.id, quote: claim }], [valid])[0]?.quote).toBe(claim);
});
