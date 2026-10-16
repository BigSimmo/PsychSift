import { describe, expect, it } from "vitest";
import { citationFromResult } from "../src/lib/citations";
import { retainVerifiedAnswerParts } from "../src/lib/rag/rag-extractive-answer";
import { adaptiveAnswerGenerationContract } from "../src/lib/rag/rag-versioning";
import type { RagAnswer, RagQueryPlan, RagSubquestion, SearchResult } from "../src/lib/types";

// Admitted-passage delivery has no coverage plan, so the delivered prose itself is
// checked against each required part. Synthetic guideline text only.

function source(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "chunk-1",
    document_id: "doc-1",
    title: "Lithium monitoring",
    file_name: "lithium.pdf",
    page_number: 2,
    chunk_index: 0,
    section_heading: "Monitoring",
    content: "",
    image_ids: [],
    similarity: 0.9,
    images: [],
    ...overrides,
  };
}

function plan(subquestions: RagSubquestion[], materialSafetyDependencies?: RagQueryPlan["materialSafetyDependencies"]) {
  return {
    version: "rag-query-plan-v1",
    kind: "multi_part",
    originalQuery: subquestions.map((part) => part.question).join(" and "),
    interpretation: "Synthetic delivery plan",
    subquestions,
    targetSiteDomains: [],
    siteDomainDecision: "none",
    reasonCodes: [],
    ...(materialSafetyDependencies ? { materialSafetyDependencies } : {}),
  } as unknown as RagQueryPlan;
}

function deliver(text: string, queryPlan: RagQueryPlan) {
  const row = source({ content: text });
  const answer: RagAnswer = {
    answer: text,
    grounded: true,
    confidence: "high",
    sources: [row],
    citations: [citationFromResult(row, "model_selected")],
    supportedClaims: [
      { claimId: "c1", text, riskClass: "routine", supportingChunkIds: [row.id], supportStatus: "direct" },
    ],
  };
  return retainVerifiedAnswerParts(answer, {
    query: queryPlan.originalQuery,
    queryPlan,
    queryClass: "unsupported_or_general",
    contract: adaptiveAnswerGenerationContract,
    admittedPassageDelivery: true,
    resolveCoverage: () => null,
  });
}

const gapBody = (result: ReturnType<typeof deliver>) =>
  result.answer.answerSections?.find((section) => section.kind === "source_gap")?.body ?? "";

describe("admitted-passage delivery gap", () => {
  it("names a required part the delivered prose does not cover", () => {
    const result = deliver(
      "Check lithium serum levels every three months once stable.",
      plan([
        { id: "a", question: "Lithium monitoring frequency", purpose: "monitoring", required: true },
        { id: "b", question: "Lithium dosing in renal impairment", purpose: "special_population", required: true },
        { id: "c", question: "Optional history of lithium", purpose: "primary", required: false },
      ]),
    );
    expect(result.gapAdded).toBe(true);
    expect(gapBody(result)).toBe(
      "This answer does not establish: Lithium dosing in renal impairment. Source coverage has not been assessed.",
    );
    expect(result.answer.answer).toContain("every three months");
  });

  it("checks requested facets and facet details against the delivered prose", () => {
    const result = deliver(
      "For adults, lithium is usually started at 250 mg orally once daily and adjusted to serum levels.",
      plan([
        {
          id: "dose",
          question: "Lithium dose for adults",
          purpose: "primary",
          requestedFacets: ["dosing", "monitoring"],
          requestedFacetDetails: { dosing: ["maximum", "route", "frequency"], monitoring: ["frequency"] },
          required: true,
        },
      ]),
    );
    // No monitoring cadence is delivered, so that facet detail must be named.
    expect(result.gapAdded).toBe(true);
    expect(gapBody(result)).toContain("monitoring frequency");
    expect(gapBody(result)).toMatch(/Source coverage has not been assessed\.$/);
  });

  it("names the stated constraint when a material safety dependency has no delivered risk prose", () => {
    const result = deliver(
      "Lithium is usually started at 250 mg once daily in adults without renal impairment.",
      plan(
        [
          {
            id: "risk",
            question: "Lithium in renal impairment during pregnancy",
            purpose: "risk",
            requestedFacets: ["risk"],
            required: true,
          },
          {
            id: "older",
            question: "Lithium monitoring in older adults over 65 years",
            purpose: "monitoring",
            required: true,
          },
        ],
        ["risk"],
      ),
    );
    expect(result.gapAdded).toBe(true);
    // The negated constraint ("without renal impairment") is not risk prose for it.
    expect(gapBody(result)).toContain("safety implications of renal impairment; pregnancy");
    // A delivered adult statement does not answer an older-adult question.
    expect(gapBody(result)).toContain("Lithium monitoring in older adults over 65 years");
  });

  it("adds nothing when every required part is delivered", () => {
    const text = "Check lithium serum levels every three months once stable.";
    const result = deliver(text, plan([{ id: "a", question: text, purpose: "monitoring", required: true }]));
    expect(result.answer.answer).toContain("every three months");
    expect(result.gapAdded).toBe(false);
    expect(result.answer.answerSections?.filter((section) => section.kind === "source_gap") ?? []).toEqual([]);
  });
});
