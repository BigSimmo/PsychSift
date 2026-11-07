import { expect, it } from "vitest";
import {
  assessAndEnforceClaimSupport,
  claimProofWithoutGeneratedNarrative,
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
it("withdraws only the first unpunctuated numbered item while retaining the independent quote", () => {
  const withdrawn = "Stop synthetic action A";
  const valid = "Continue independent synthetic action B";
  const s = source(
    "unpunctuated-list",
    "The following recommendation is withdrawn.\n1) Stop synthetic action A\n2) Continue independent synthetic action B",
  );
  const withdrawnCards = sanitizeQuoteCards([{ chunk_id: s.id, quote: withdrawn }], [s]);
  const validCards = sanitizeQuoteCards([{ chunk_id: s.id, quote: valid }], [s]);
  expect({
    withdrawnDirect: sourceDirectlySupportsAnswerText(withdrawn, s),
    withdrawnQuotes: withdrawnCards.map((card) => card.quote),
    validQuotes: validCards.map((card) => card.quote),
  }).toEqual({
    withdrawnDirect: false,
    withdrawnQuotes: [],
    validQuotes: [valid],
  });
  expect(claimProofWithoutGeneratedNarrative(s).content).toContain("2) " + valid);
});
it("withholds nested items of a withdrawn list recommendation until the next sibling", () => {
  const nested = "Administer synthetic action C once daily";
  const sibling = "Contact synthetic support D";
  const s = source(
    "nested-list",
    "The following recommendation is withdrawn.\n1) Treat synthetic state:\n   - " + nested + "\n2) " + sibling,
  );
  expect(sanitizeQuoteCards([{ chunk_id: s.id, quote: nested }], [s])).toEqual([]);
  expect(sourceDirectlySupportsAnswerText(nested, s)).toBe(false);
  const content = claimProofWithoutGeneratedNarrative(s).content;
  expect(content).not.toContain(nested);
  expect(content).toContain("2) " + sibling);
});
it.each([
  { name: "punctuated parent and two punctuated children", parent: "1) Treat synthetic state.", secondPrefix: "   - " },
  { name: "colon parent and two punctuated children", parent: "1) Treat synthetic state:", secondPrefix: "   - " },
  { name: "indented prose continuing a punctuated child", parent: "1) Treat synthetic state:", secondPrefix: "     " },
])("withholds $name through support, quotes and finalization", ({ parent, secondPrefix }) => {
  const first = "The synthetic blue marker always requires a second review before completion.";
  const sibling = "The independent synthetic action B should continue during the scheduled review.";
  const s = source(
    "punctuated-nested-list",
    "The following recommendation is withdrawn.\n" +
      parent +
      "\n   - " +
      first +
      "\n" +
      secondPrefix +
      claim +
      "\n2) " +
      sibling,
  );
  const withdrawnCards = sanitizeQuoteCards([{ chunk_id: s.id, quote: claim }], [s]);
  const siblingCards = sanitizeQuoteCards([{ chunk_id: s.id, quote: sibling }], [s]);
  const withdrawnFinal = finalizeRagAnswerQuality(
    { ...answer(claim, [s]), quoteCards: withdrawnCards },
    "What review does synthetic procedure Z require?",
    "broad_summary",
  );
  const siblingFinal = finalizeRagAnswerQuality(
    { ...answer(sibling, [s]), quoteCards: siblingCards },
    "What independent synthetic action should continue?",
    "broad_summary",
  );
  expect({
    firstDirect: sourceDirectlySupportsAnswerText(first, s),
    withdrawnDirect: sourceDirectlySupportsAnswerText(claim, s),
    withdrawnQuotes: withdrawnCards.map((card) => card.quote),
    withdrawnFinalGrounded: withdrawnFinal.grounded,
    withdrawnFinalQuotes: (withdrawnFinal.quoteCards ?? []).map((card) => card.quote),
    siblingDirect: sourceDirectlySupportsAnswerText(sibling, s),
    siblingFinalGrounded: siblingFinal.grounded,
    siblingFinalQuotes: (siblingFinal.quoteCards ?? []).map((card) => card.quote),
  }).toEqual({
    firstDirect: false,
    withdrawnDirect: false,
    withdrawnQuotes: [],
    withdrawnFinalGrounded: false,
    withdrawnFinalQuotes: [],
    siblingDirect: true,
    siblingFinalGrounded: true,
    siblingFinalQuotes: [sibling],
  });
});
it("ends a withdrawn nested recommendation at a blank line before independent prose", () => {
  const independent = "The independent synthetic action B should continue during the scheduled review.";
  const s = source(
    "nested-blank-boundary",
    "The following recommendation is withdrawn.\n1) Treat synthetic state:\n   - " + claim + "\n\n" + independent,
  );
  expect(sanitizeQuoteCards([{ chunk_id: s.id, quote: claim }], [s])).toEqual([]);
  expect(sourceDirectlySupportsAnswerText(claim, s)).toBe(false);
  expect(sourceDirectlySupportsAnswerText(independent, s)).toBe(true);
  expect(
    finalizeRagAnswerQuality(
      answer(independent, [s]),
      "What independent synthetic action should continue?",
      "broad_summary",
    ).grounded,
  ).toBe(true);
});
it("retains a complete independent numbered recommendation through support and finalization", () => {
  // The terse `2) Continue ...` fixture above is not independently recognized by
  // the existing directive matcher. Use a complete normative sentence here.
  const valid = "The independent synthetic action B should continue during the scheduled review.";
  const s = source(
    "unpunctuated-list-composed",
    "The following recommendation is withdrawn.\n1) Stop synthetic action A\n2) " + valid,
  );
  const cards = sanitizeQuoteCards([{ chunk_id: s.id, quote: valid }], [s]);
  const final = finalizeRagAnswerQuality(
    { ...answer(valid, [s]), quoteCards: cards },
    "What independent synthetic action should continue?",
    "broad_summary",
  );
  expect({
    direct: sourceDirectlySupportsAnswerText(valid, s),
    finalGrounded: final.grounded,
    finalQuotes: (final.quoteCards ?? []).map((card) => card.quote),
  }).toEqual({
    direct: true,
    finalGrounded: true,
    finalQuotes: [valid],
  });
});
it("scopes withdrawal negation to its own clause through support, quotes and finalization", () => {
  const s = source(
    "independent-negation",
    "The previous recommendation was not withdrawn; the following recommendation is withdrawn. " + claim,
  );
  const cards = sanitizeQuoteCards([{ chunk_id: s.id, quote: claim }], [s]);
  const final = finalizeRagAnswerQuality(
    { ...answer(claim, [s]), quoteCards: cards },
    "What review does synthetic procedure Z require?",
    "broad_summary",
  );
  expect({
    verbatim: claimRestatesSourceVerbatim(claim, s),
    direct: sourceDirectlySupportsAnswerText(claim, s),
    quotes: cards.map((card) => card.quote),
    finalGrounded: final.grounded,
    finalQuotes: (final.quoteCards ?? []).map((card) => card.quote),
  }).toEqual({ verbatim: false, direct: false, quotes: [], finalGrounded: false, finalQuotes: [] });
});
it.each([
  "1) Stop synthetic action A\n   until the synthetic review is complete\n2) Continue independent synthetic action B",
  "1.\nStop synthetic action A\n   until the synthetic review is complete\n2) Continue independent synthetic action B",
  "1)\nStop synthetic action A\n   until the synthetic review is complete\n2)\nContinue independent synthetic action B",
  "- Stop synthetic action A\n   until the synthetic review is complete\n- Continue independent synthetic action B",
])("keeps wrapped withdrawn text and pure markers inside the first list item: %s", (list) => {
  const s = source("wrapped-list", "The following recommendation is withdrawn.\n" + list);
  const proof = claimProofWithoutGeneratedNarrative(s);
  expect(proof.content).not.toContain("Stop synthetic action A");
  expect(proof.content).not.toContain("until the synthetic review is complete");
  expect(proof.content).toContain("Continue independent synthetic action B");
  expect(sanitizeQuoteCards([{ chunk_id: s.id, quote: "until the synthetic review is complete" }], [s])).toEqual([]);
});
it("preserves a negated following withdrawal after an unrelated positive withdrawal clause", () => {
  const s = source(
    "independent-negated-following",
    "The previous recommendation was withdrawn; the following recommendation is not withdrawn. " + claim,
  );
  expect(sourceDirectlySupportsAnswerText(claim, s)).toBe(true);
  expect(sanitizeQuoteCards([{ chunk_id: s.id, quote: claim }], [s])[0]?.quote).toBe(claim);
});
it.each([
  {
    correction: "The following recommendation is withdrawn, whereas the previous recommendation was not withdrawn.",
    retained: false,
  },
  {
    correction: "The following recommendation is not withdrawn, whereas the previous recommendation was withdrawn.",
    retained: true,
  },
])("binds following withdrawal to its own subject through delivery: $correction", ({ correction, retained }) => {
  const s = source("following-subject-withdrawal", correction + " " + claim);
  const cards = sanitizeQuoteCards([{ chunk_id: s.id, quote: claim }], [s]);
  const final = finalizeRagAnswerQuality(
    { ...answer(claim, [s]), quoteCards: cards },
    "What review does synthetic procedure Z require?",
    "broad_summary",
  );
  expect({
    verbatim: claimRestatesSourceVerbatim(claim, s),
    direct: sourceDirectlySupportsAnswerText(claim, s),
    quotes: cards.map((card) => card.quote),
    finalGrounded: final.grounded,
    finalQuotes: (final.quoteCards ?? []).map((card) => card.quote),
  }).toEqual({
    verbatim: retained,
    direct: retained,
    quotes: retained ? [claim] : [],
    finalGrounded: retained,
    finalQuotes: retained ? [claim] : [],
  });
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
it("withholds a withdrawn instruction through an abbreviation instead of leaking its tail", () => {
  const tail = "400 mg nightly with levels at five days.";
  const independent = "The independent synthetic action B should continue during the scheduled review.";
  const s = source(
    "abbreviation-withdrawal",
    "The following recommendation has been withdrawn. Give synthetic agent Q e.g. " + tail + " " + independent,
  );
  const content = claimProofWithoutGeneratedNarrative(s).content;
  expect(content).not.toContain("400 mg nightly");
  expect(sanitizeQuoteCards([{ chunk_id: s.id, quote: tail }], [s])).toEqual([]);
  expect(sourceDirectlySupportsAnswerText(independent, s)).toBe(true);
});
it("withholds the recommendation below a withdrawal notice", () => {
  const s = source("below-withdrawal", "The recommendation below has been withdrawn. " + claim);
  expect(claimProofWithoutGeneratedNarrative(s).content).not.toContain(claim);
  expect(sourceDirectlySupportsAnswerText(claim, s)).toBe(false);
  expect(sanitizeQuoteCards([{ chunk_id: s.id, quote: claim }], [s])).toEqual([]);
});
it("withholds the preceding sentence or list item named by a trailing withdrawal notice", () => {
  const independent = "The independent synthetic action B should continue during the scheduled review.";
  const prose = source("trailing-prose", claim + " This recommendation has been withdrawn. " + independent);
  expect(sourceDirectlySupportsAnswerText(claim, prose)).toBe(false);
  expect(sanitizeQuoteCards([{ chunk_id: prose.id, quote: claim }], [prose])).toEqual([]);
  expect(sourceDirectlySupportsAnswerText(independent, prose)).toBe(true);
  const list = source(
    "trailing-list",
    "1) " + claim + "\n   Repeat the synthetic check. This recommendation has been withdrawn.\n2) " + independent,
  );
  const content = claimProofWithoutGeneratedNarrative(list).content;
  expect(content).not.toContain(claim);
  expect(content).not.toContain("Repeat the synthetic check");
  expect(content).toContain("2) " + independent);
  expect(sourceDirectlySupportsAnswerText(claim, list)).toBe(false);
  const inline = source("trailing-inline", claim.replace(/\.$/, "") + "; this recommendation has been withdrawn.");
  expect(sourceDirectlySupportsAnswerText(claim, inline)).toBe(false);
});
it.each([
  "The following recommendation has not yet been withdrawn. ",
  "The recommendation below has not yet been withdrawn. ",
])("treats a not-yet-withdrawn notice as still current: %s", (notice) => {
  const s = source("not-yet-withdrawn", notice + claim);
  expect(sourceDirectlySupportsAnswerText(claim, s)).toBe(true);
  expect(sanitizeQuoteCards([{ chunk_id: s.id, quote: claim }], [s])[0]?.quote).toBe(claim);
});
it("keeps the preceding recommendation when a trailing notice says it has not yet been withdrawn", () => {
  const s = source("trailing-not-yet", claim + " This recommendation has not yet been withdrawn.");
  expect(sourceDirectlySupportsAnswerText(claim, s)).toBe(true);
});
