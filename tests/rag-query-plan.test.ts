import { describe, expect, it } from "vitest";

import { analyzeClinicalQuery } from "@/lib/clinical-search";
import { renderAnswerRequestContext, resolveAnswerRequestContext } from "@/lib/answer-request-context";
import { queryForClinicalMode } from "@/lib/clinical-query-mode";
import { buildRagQueryPlan, detectClinicalAmbiguity } from "@/lib/rag/rag-query-plan";

describe("bounded RAG query planning", () => {
  function followUps(subject: string, ...requests: string[]) {
    return requests.reduce(
      (prior, latest) => renderAnswerRequestContext(resolveAnswerRequestContext(prior, latest)),
      subject,
    );
  }

  it.each([
    ["omit monitoring but include the risks", ["dosing", "risk"]],
    ["omit monitoring but give the dosing", ["dosing", "risk"]],
    ["omit the monitoring and the risks", ["dosing"]],
    ["do not give the dosing", ["monitoring", "risk"]],
    ["do not include the risks", ["dosing", "monitoring"]],
    ["omit the monitoring but do not give the dosing", ["risk"]],
    ["omit monitoring but include risks", ["dosing", "risk"]],
    ["do not give dosing", ["monitoring", "risk"]],
  ])("P12A R2 applies command polarity before ordinary determiners: %s", (request, expected) => {
    const query = followUps("Give lithium dosing, monitoring and risks", `For this, ${request}`);
    expect(buildRagQueryPlan(query, analyzeClinicalQuery(query)).askedParts).toEqual(expected);
  });

  it.each([
    "never use approved supplements",
    "we should not use approved supplements",
    "do not use approved supplements",
    "don't use approved supplements",
    "without approved supplements",
    "could we use approved supplements?",
  ])("P12A R1 does not widen source permission for %s", (restriction) => {
    const query = followUps("Give lithium dosing using only this source", `For this, ${restriction}`);
    expect(buildRagQueryPlan(query, analyzeClinicalQuery(query)).sourcePolicy).toBe("only_this_source");
  });

  it("P12A R1 allows an explicit affirmative supplement reset", () => {
    const query = followUps("Give lithium dosing using only this source", "For this, allow approved supplements");
    expect(buildRagQueryPlan(query, analyzeClinicalQuery(query)).sourcePolicy).toBe(
      "primary_plus_approved_supplements",
    );
  });

  it.each([
    "omit monitoring and risks",
    "omit monitoring or risks",
    "exclude monitoring, risks",
    "omit monitoring but include risks",
    "omit monitoring and include risks",
    "omit monitoring",
  ])("P12A R1 respects coordinated facet scope: %s", (request) => {
    const query = followUps("Give lithium dosing, monitoring and risks", `For this, ${request}`);
    const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
    expect(plan.askedParts).toEqual(
      request.includes("include risks") || request === "omit monitoring" ? ["dosing", "risk"] : ["dosing"],
    );
    expect(plan.materialSafetyDependencies).toEqual([]);
  });

  it("P12A R1 retains independent material safety despite excluding the optional risk facet", () => {
    const query = followUps(
      "Give lithium dosing, monitoring and risks with renal impairment",
      "For this, omit monitoring and risks",
    );
    const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
    expect(plan.askedParts).toEqual(["dosing"]);
    expect(plan.materialSafetyDependencies).toEqual(["risk"]);
    expect(plan.subquestions.some((part) => part.required && part.purpose === "risk")).toBe(true);
  });

  it.each([
    ["no supplements", "allow approved supplements", "only_this_source"],
    ["allow approved supplements", "no supplements", "primary_plus_approved_supplements"],
  ])("P12A R1 retains the last repeated policy reset through elaboration: %s", (first, second, expected) => {
    const query = followUps(
      "Give lithium dosing",
      `For this, ${first}`,
      `For this, ${second}`,
      `For this, ${first}`,
      "Elaborate",
    );
    expect(buildRagQueryPlan(query, analyzeClinicalQuery(query)).sourcePolicy).toBe(expected);
  });

  it.each(["And risks?", "And the risks?"])(
    "P12A retains monitoring through two follow-ups and elaboration: %s",
    (riskRequest) => {
      const query = followUps("Give lithium dosing for adults", "What about monitoring?", riskRequest, "Elaborate");
      const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
      expect(plan.askedParts).toEqual(["dosing", "monitoring", "risk"]);
      expect(plan.requestedDepth).toBe("detailed");
      expect(plan.subquestions.map((part) => part.purpose)).toEqual([
        "primary",
        "required_action",
        "monitoring",
        "risk",
      ]);
      expect(plan.subquestions.every((part) => part.required)).toBe(true);
    },
  );

  it("P12A preserves requested parts while applying population and renal negation resets", () => {
    const query = followUps(
      "Give lithium dosing for adults with renal impairment",
      "What about monitoring?",
      "And for adolescents without renal impairment?",
      "Keep this concise",
    );
    const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
    expect(plan.askedParts).toEqual(["dosing", "monitoring"]);
    expect(plan.requestedDepth).toBe("concise");
    expect(plan.materialSafetyDependencies).toEqual([]);
    expect(plan.originalQuery).not.toMatch(/adults|with renal impairment/);
    expect(plan.originalQuery).toContain("adolescents");
  });

  it("P12A drops prior parts and source restrictions on a new topic", () => {
    const query = followUps(
      "Give lithium dosing using only this source",
      "What about monitoring?",
      "New topic: briefly give the differential for catatonia",
    );
    const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
    expect(plan.askedParts).toEqual(["differential"]);
    expect(plan.requestedDepth).toBe("concise");
    expect(plan.sourcePolicy).toBe("primary_plus_approved_supplements");
  });

  it("P12A applies a latest facet exclusion without dropping retained dosing", () => {
    const query = followUps("Give lithium dosing and monitoring", "For this, omit monitoring and elaborate on dosing");
    const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
    expect(plan.askedParts).toEqual(["dosing"]);
    expect(plan.subquestions.some((part) => part.purpose === "monitoring")).toBe(false);
  });

  it("P12A applies an explicit only-facet focus while retaining source restrictions", () => {
    const query = followUps(
      "Give lithium dosing and monitoring using only this source",
      "For this, only explain dosing",
    );
    const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
    expect(plan.askedParts).toEqual(["rationale", "dosing"]);
    expect(plan.sourcePolicy).toBe("only_this_source");
  });

  it("P12A preserves a restriction through elaboration and permits an explicit latest supplement reset", () => {
    const restricted = followUps("Give lithium dosing using only this source", "What about monitoring?", "Elaborate");
    expect(buildRagQueryPlan(restricted, analyzeClinicalQuery(restricted)).sourcePolicy).toBe("only_this_source");
    const query = followUps(restricted, "For this, allow approved supplements");
    const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
    expect(plan.sourcePolicy).toBe("primary_plus_approved_supplements");
    expect(plan.askedParts).toEqual(["dosing", "monitoring"]);
    const restrictedAgain = followUps(
      "Give lithium dosing with approved supplements",
      "For this, use only this source",
    );
    expect(buildRagQueryPlan(restrictedAgain, analyzeClinicalQuery(restrictedAgain)).sourcePolicy).toBe(
      "only_this_source",
    );
  });

  it("P12A does not confuse a negated clinical constraint with excluding an asked facet", () => {
    const query = "Give lithium dosing without renal impairment";
    const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
    expect(plan.askedParts).toEqual(["dosing"]);
    expect(plan.materialSafetyDependencies).toEqual([]);
  });

  it("P12A never treats negated supplement permission as an authorization", () => {
    const query = followUps(
      "Give lithium dosing using only this source",
      "For this, do not allow approved supplements",
    );
    expect(buildRagQueryPlan(query, analyzeClinicalQuery(query)).sourcePolicy).toBe("only_this_source");
  });

  it("P12A does not treat only-use-this-source wording as an only-facet reset", () => {
    const query = followUps("Give lithium dosing and monitoring", "For this, only use this source for dosing");
    const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
    expect(plan.askedParts).toEqual(["dosing", "monitoring"]);
    expect(plan.sourcePolicy).toBe("only_this_source");
  });

  it("T8-R3 makes explicit medicine parts required coverage despite protected medication intent", () => {
    const query = "Give lithium dosing, monitoring and risks";
    const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
    expect(plan.askedParts).toEqual(["dosing", "monitoring", "risk"]);
    expect(plan.subquestions.map((part) => part.purpose)).toEqual(["primary", "required_action", "monitoring", "risk"]);
    expect(plan.subquestions.every((part) => part.required)).toBe(true);
  });
  it("P08C requires asked assessment, differential and rationale instead of a generic four-part template", () => {
    const query = "Give a comprehensive assessment, differential and rationale for catatonia.";
    const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
    expect(plan.askedParts).toEqual(["assessment", "differential", "rationale"]);
    expect(plan.subquestions.some((part) => part.purpose === "monitoring" || part.purpose === "risk")).toBe(false);
    expect(plan.requestedDepth).toBe("detailed");
  });

  it("P08C requires a material medicine safety dependency without adding a generic template", () => {
    const query = "How should lithium dosing be managed in renal impairment?";
    const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
    expect(plan.materialSafetyDependencies).toEqual(["risk"]);
    expect(plan.subquestions.some((part) => part.required && part.purpose === "risk")).toBe(true);
    expect(plan.subquestions.length).toBeLessThanOrEqual(4);
  });
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

  it("decomposes an explicitly broad overview when escalation terms cause a dose-risk false positive", () => {
    const query = "Give an overview of agitation management including treatment, monitoring and escalation.";
    const analysis = analyzeClinicalQuery(query);

    expect(analysis.queryClass).toBe("medication_dose_risk");
    expect(buildRagQueryPlan(query, analysis).kind).toBe("decomposed");
  });

  it.each([
    "What is catatonia?",
    "What is treatment-resistant depression?",
    "Define catatonia.",
    "Describe catatonia.",
    "Catatonia meaning",
    "Catatonia term",
  ])("keeps an explicit definition single after classifier fallback rewrites only the query class: %s", (query) => {
    const analysis = {
      ...analyzeClinicalQuery(query),
      queryClass: "broad_summary" as const,
      reasons: ["classifier_broad_summary"],
    };

    expect(analysis.intent).toBe("definition");
    expect(buildRagQueryPlan(query, analysis)).toMatchObject({
      kind: "single",
      subquestions: [{ question: query, purpose: "primary" }],
    });
  });

  it.each([
    ["How should a missed clozapine dose be managed?", "medication_dose_risk"],
    ["Give an overview of the Clozapine monitoring guideline", "medication_dose_risk"],
    ["Give an overview of the ANC threshold for clozapine.", "table_threshold"],
    ["Give an overview of the NOCC document.", "document_lookup"],
    ["Give a comprehensive definition of catatonia.", "unsupported_or_general"],
  ] as const)("does not generically decompose protected %s queries", (query, queryClass) => {
    const analysis = analyzeClinicalQuery(query);
    const result = buildRagQueryPlan(query, analysis);

    expect(analysis.queryClass).toBe(queryClass);
    expect(result.kind).toBe("single");
    expect(result.subquestions).toEqual([{ id: "sq-1", question: query, purpose: "primary", required: true }]);
  });

  it("does not generically decompose a classifier-confirmed unsupported query", () => {
    const query = "Give an overview of configuring a router.";
    const analysis = { ...analyzeClinicalQuery(query), queryClass: "unsupported_or_general" as const };

    expect(buildRagQueryPlan(query, analysis).kind).toBe("single");
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

  it.each([
    "What does thought form mean in schizophrenia?",
    "How should thought form be documented in a mental state assessment?",
  ])("does not treat clinical thought form usage as an administrative forms domain: %s", (query) => {
    const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));

    expect(plan.targetSiteDomains).not.toContain("forms");
    expect(plan.targetSiteDomains).toEqual([]);
    expect(plan.siteDomainDecision).toBe("none");
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

describe("P12A phase original request through clinical mode", () => {
  it("uses resolved current depth and source policy while retaining the augmented retrieval query", () => {
    const original = ["What about monitoring?", "For this, allow approved supplements", "Keep this concise"].reduce(
      (prior, next) => renderAnswerRequestContext(resolveAnswerRequestContext(prior, next)),
      "Give detailed lithium dosing using only this source",
    );
    const augmented = queryForClinicalMode(original, "monitoring_schedule");
    const analysis = analyzeClinicalQuery(augmented);
    expect(buildRagQueryPlan(augmented, analysis, original)).toMatchObject({
      requestedDepth: "concise",
      sourcePolicy: "primary_plus_approved_supplements",
      originalQuery: augmented,
    });
    expect(buildRagQueryPlan(augmented, analysis)).toMatchObject({
      requestedDepth: "detailed",
      sourcePolicy: "only_this_source",
    });
    const restricted = renderAnswerRequestContext(
      resolveAnswerRequestContext(original, "For this, no approved supplements"),
    );
    expect(
      buildRagQueryPlan(queryForClinicalMode(restricted, "monitoring_schedule"), analysis, restricted).sourcePolicy,
    ).toBe("only_this_source");
  });
  it("does not treat contraindications scaffolding as user toxicity or a safety dependency", () => {
    const original = "Give lithium dosing";
    const augmented = queryForClinicalMode(original, "contraindications_cautions");
    expect(augmented).toContain("toxicity");
    const plan = buildRagQueryPlan(augmented, analyzeClinicalQuery(augmented), original);
    expect(plan.askedParts).toEqual(["dosing"]);
    expect(plan.materialSafetyDependencies).toEqual([]);
  });
});
