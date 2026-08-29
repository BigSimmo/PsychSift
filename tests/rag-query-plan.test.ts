import { describe, expect, it } from "vitest";

import { analyzeClinicalQuery } from "@/lib/clinical-search";
import { buildRagQueryPlan } from "@/lib/rag/rag-query-plan";

describe("bounded RAG query planning", () => {
  it("keeps a simple threshold query single and always retains the original query", () => {
    const query = "What ANC means withhold clozapine?";

    expect(buildRagQueryPlan(query, analyzeClinicalQuery(query))).toMatchObject({
      version: "rag-query-plan-v1",
      kind: "single",
      originalQuery: query,
      subquestions: [{ id: "sq-1", question: query, purpose: "primary", required: true }],
    });
  });

  it("decomposes a broad management question deterministically within four subquestions", () => {
    const query = "How should this condition be managed, including treatment, monitoring and escalation?";
    const first = buildRagQueryPlan(query, analyzeClinicalQuery(query));
    const second = buildRagQueryPlan(query, analyzeClinicalQuery(query));

    expect(first).toEqual(second);
    expect(first.kind).toBe("decomposed");
    expect(first.subquestions.length).toBeLessThanOrEqual(4);
    expect(first.subquestions.map((item) => item.purpose)).toEqual([
      "primary",
      "required_action",
      "monitoring",
      "risk",
    ]);
  });

  it("creates comparison sides only when two bounded sides are identifiable", () => {
    const identifiable = "Compare clozapine and lithium monitoring requirements";
    const openEnded = "Compare the available monitoring approaches";

    expect(
      buildRagQueryPlan(identifiable, analyzeClinicalQuery(identifiable)).subquestions.map((item) => item.purpose),
    ).toEqual(["primary", "comparison_side", "comparison_side"]);
    expect(buildRagQueryPlan(openEnded, analyzeClinicalQuery(openEnded)).subquestions).toHaveLength(1);
  });

  it.each([
    ["ANC threshold in the clozapine monitoring guideline", "document"],
    ["clozapin withholding neutrophils", "medicine"],
    ["the section titled restarting after interruption", "document"],
    ["monitoring in adolescents in WA", "population"],
  ])("preserves query-understanding dimensions for %s", (query, expectedDimension) => {
    const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));

    expect(plan.originalQuery).toBe(query);
    expect(`${plan.interpretation} ${plan.reasonCodes.join(" ")}`).toMatch(new RegExp(expectedDimension, "i"));
  });

  it("retains explicit jurisdiction and deterministic site-domain hints", () => {
    const query = "Which WA service form is required for adolescent follow-up?";
    const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));

    expect(plan.reasonCodes).toEqual(expect.arrayContaining(["population_explicit", "jurisdiction_explicit"]));
    expect(plan.targetSiteDomains).toEqual(["services", "forms"]);
    expect(plan.siteDomainDecision).toBe("explicit");
  });

  it("asks one clarification only when an unresolved dimension changes retrieval", () => {
    const query = "What is the required observation period?";
    const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));

    expect(plan.kind).toBe("clarification_required");
    expect(plan.subquestions).toEqual([]);
    expect(plan.interpretation).toMatch(/clarification/i);
  });
});
