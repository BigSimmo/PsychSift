import { describe, expect, it } from "vitest";
import { buildExtractiveAnswer } from "../src/lib/rag/rag-extractive-builder";
import {
  buildDocumentBreakdown,
  buildEvidenceSummary,
  buildSourceCoverage,
  buildSmartPanel,
  selectBestSourceRecommendation,
} from "../src/lib/evidence";
import type { SearchResult } from "../src/lib/types";

function source(id: string, document_id: string, content: string): SearchResult {
  return {
    id,
    document_id,
    content,
    title: `Synthetic ${document_id}`,
    file_name: `${document_id}.pdf`,
    page_number: 1,
    chunk_index: 0,
    section_heading: "",
    image_ids: [],
    images: [],
    similarity: 0.9,
    hybrid_score: 0.9,
  } as SearchResult;
}
function answer(query: string, results: SearchResult[]) {
  return buildExtractiveAnswer({
    query,
    queryClass: "document_lookup",
    results,
    quoteCards: [],
    documentBreakdown: buildDocumentBreakdown(results, []),
    evidenceSummary: buildEvidenceSummary(results, []),
    sourceCoverage: buildSourceCoverage(results),
    conflictsOrGaps: [],
    visualEvidence: [],
    bestSource: selectBestSourceRecommendation(results),
    smartPanel: buildSmartPanel(query, results),
    relatedDocuments: [],
    routeReason: "test",
    timings: undefined,
  });
}

describe("claim-bearing document lookup", () => {
  const partial = source("partial", "partial-care", "Pregnancy care includes routine appointments.");
  const full = source("full", "complete-guideline", "Anticoagulation in pregnancy requires specialist planning.");
  const unrelated = source("unrelated", "other-guideline", "Manage asthma using an individual care plan.");
  it.each([
    "Which document supports anticoagulation in pregnancy?",
    "Which documents support anticoagulation in pregnancy?",
  ])("retains complete support and rebuilds derived source artifacts: %s", (query) => {
    const result = answer(query, [partial, full, unrelated]);
    expect(result.sources.map((r) => r.id)).toEqual([full.id]);
    expect(result.citations.map((r) => r.chunk_id)).toEqual([full.id]);
    expect(result.bestSource?.document_id).toBe(full.document_id);
    expect(result.documentBreakdown?.map((d) => d.document_id)).toEqual([full.document_id]);
    expect(result.smartPanel?.documents.map((d) => d.document_id)).toEqual([full.document_id]);
    expect(result.answer).not.toContain(partial.title);
  });
  it("accumulates matching qualifiers across chunks before choosing documents", () => {
    const split = [
      source("split-a", "split-guideline", "Anticoagulation requires specialist planning."),
      source("split-b", "split-guideline", "Pregnancy care is addressed in this guidance."),
    ];
    const result = answer("Which document supports anticoagulation in pregnancy?", [full, ...split, unrelated]);
    expect(new Set(result.sources.map((r) => r.document_id))).toEqual(new Set([full.document_id, "split-guideline"]));
    expect(result.citations.map((r) => r.chunk_id)).toEqual(expect.arrayContaining(split.map((r) => r.id)));
  });
  it("reserves citations for every named document before extra chunks", () => {
    const chunks = Array.from({ length: 5 }, (_, i) => source(`crowded-${i}`, "crowded-guideline", full.content));
    const result = answer("Which indexed documents support anticoagulation in pregnancy?", [...chunks, full]);
    expect(result.citations.map((c) => c.document_id)).toContain(full.document_id);
    expect(result.citations.map((c) => c.document_id)).toContain("crowded-guideline");
    expect(result.citations.length).toBeLessThanOrEqual(5);
  });
  it("keeps source metadata and citations within the five delivered documents", () => {
    const results = Array.from({ length: 6 }, (_, i) => source(`chunk-${i}`, `guideline-${i}`, full.content));
    const result = answer("Which documents support anticoagulation in pregnancy?", results);
    expect(result.sources).toHaveLength(5);
    expect(new Set(result.citations.map((c) => c.document_id)).size).toBe(5);
    expect(new Set(result.sources.map((r) => r.document_id))).toEqual(
      new Set(result.documentBreakdown?.map((d) => d.document_id)),
    );
  });
  it("returns a gap without attributing support when no document matches", () => {
    const result = answer("Which documents support anticoagulation in pregnancy?", [unrelated]);
    expect(result.grounded).toBe(false);
    expect(result.sources).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(result.bestSource).toBeFalsy();
  });
});
