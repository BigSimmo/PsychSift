import { describe, expect, it } from "vitest";

import { analyzeClinicalQuery } from "@/lib/clinical-search";
import { buildRagQueryPlan, detectClinicalAmbiguity } from "@/lib/rag/rag-query-plan";

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

  it("does not manufacture comparison entities from benefits and risks of one medicine", () => {
    const query = "Compare the benefits and risks of clozapine";
    const result = buildRagQueryPlan(query, analyzeClinicalQuery(query));

    expect(result.kind).toBe("single");
    expect(result.subquestions).toEqual([{ id: "sq-1", question: query, purpose: "primary", required: true }]);
  });

  it.each([
    "Compare the benefits and risks of clozapine when co-prescribed with lithium.",
    "Compare efficacy and safety of clozapine in a patient taking lithium.",
  ])("does not promote a contextual second medicine into a comparison side for %s", (query) => {
    const result = buildRagQueryPlan(query, analyzeClinicalQuery(query));

    expect(result.kind).toBe("single");
    expect(result.subquestions).toEqual([{ id: "sq-1", question: query, purpose: "primary", required: true }]);
  });

  it("decomposes an explicit medicine-versus-medicine relation", () => {
    const query = "Compare clozapine versus lithium";
    const result = buildRagQueryPlan(query, analyzeClinicalQuery(query));

    expect(result.kind).toBe("decomposed");
    expect(result.subquestions.slice(1).map((item) => item.question)).toEqual([
      "clozapine: directly relevant evidence for this comparison.",
      "lithium: directly relevant evidence for this comparison.",
    ]);
  });

  it("still decomposes an identifiable non-medicine setting comparison", () => {
    const query = "Compare inpatient and community monitoring requirements";
    const result = buildRagQueryPlan(query, analyzeClinicalQuery(query));

    expect(result.kind).toBe("decomposed");
    expect(result.subquestions.map((item) => item.purpose)).toEqual(["primary", "comparison_side", "comparison_side"]);
    expect(result.subquestions.slice(1).map((item) => item.question)).toEqual([
      "inpatient: directly relevant evidence for this comparison.",
      "community: directly relevant evidence for this comparison.",
    ]);
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

  it("asks one bounded clarification when the required form has no workflow or jurisdiction anchor", () => {
    const query = "Which form is required?";
    const result = buildRagQueryPlan(query, analyzeClinicalQuery(query));

    expect(result.kind).toBe("clarification_required");
    expect(result.subquestions).toEqual([]);
    expect(result.targetSiteDomains).toEqual([]);
    expect(result.siteDomainDecision).toBe("none");
    expect(detectClinicalAmbiguity(query, analyzeClinicalQuery(query))).toMatchObject({
      material: true,
      dimensions: expect.arrayContaining(["document", "jurisdiction", "decision"]),
    });
  });

  it("keeps every ambiguous domain-bearing plan open until clarification", () => {
    const query = "Which tool is required?";
    const result = buildRagQueryPlan(query, analyzeClinicalQuery(query));

    expect(result.kind).toBe("clarification_required");
    expect(result.subquestions).toEqual([]);
    expect(result.targetSiteDomains).toEqual([]);
    expect(result.siteDomainDecision).toBe("none");
  });

  it("states an interpretation instead of clarifying when a required form has retrieval anchors", () => {
    const query = "Which form is required for clozapine monitoring in WA?";
    const result = buildRagQueryPlan(query, analyzeClinicalQuery(query));

    expect(result.kind).toBe("single");
    expect(result.subquestions).toHaveLength(1);
    expect(result.interpretation).toMatch(/document|medicine|jurisdiction/i);
    expect(result.targetSiteDomains).toEqual(["forms"]);
    expect(result.siteDomainDecision).toBe("explicit");
    expect(detectClinicalAmbiguity(query, analyzeClinicalQuery(query))).toBeNull();
  });

  it("retains a domain hint for an anchored ordinary tool decision", () => {
    const query = "Which tool is required for clozapine monitoring in WA?";
    const result = buildRagQueryPlan(query, analyzeClinicalQuery(query));

    expect(result.kind).toBe("single");
    expect(result.targetSiteDomains).toEqual(["tools"]);
    expect(result.siteDomainDecision).toBe("explicit");
  });
});
