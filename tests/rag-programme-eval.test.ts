import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  compareRagProgrammeRuns,
  evaluateRagProgrammeCase,
  parseRagProgrammeFixture,
  ragProgrammeGatePolicy,
  requiredRagProgrammeFailureClasses,
  type RagProgrammeCaseEvaluationInput,
  type RagProgrammeRun,
} from "@/lib/rag/rag-programme-eval";
import type { RagProgrammeExpectation, RagProgrammeHardViolation } from "@/lib/types";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function fixtureFingerprint(raw: Record<string, unknown>): string {
  const { caseSetFingerprint: _caseSetFingerprint, ...payload } = raw;
  payload.cases = (payload.cases as Array<Record<string, unknown>>).map(
    ({ caseFingerprint: _caseFingerprint, ...item }) => item,
  );
  return sha256(payload);
}

function populationFingerprint(cases: Array<{ id: string; caseFingerprint: string }>): string {
  return sha256(
    cases
      .map(({ id, caseFingerprint }) => ({ id, caseFingerprint }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
}

const expectation: RagProgrammeExpectation = {
  expectedCorpusScopes: ["uploaded_local"],
  expectedSourceRoles: ["local_guideline"],
  expectedSiteDomains: [],
  expectedPublicSiteContentState: "not_applicable",
  expectedSubquestionPurposes: ["primary"],
  minimumDirectSubquestions: 1,
  allowedAnswerShapes: ["focused", "partial"],
  requireSupportedPart: true,
  requireExactGap: true,
  expectedConflict: null,
  forbiddenFallbackReasons: ["not_in_corpus"],
  requiredFacts: [],
  forbiddenPatterns: [],
  incrementalEligibility: "none",
};

function evaluation(
  overrides: Partial<RagProgrammeCaseEvaluationInput["observed"]> = {},
): RagProgrammeCaseEvaluationInput {
  return {
    id: "synthetic-supported-case",
    caseFingerprint: "case-fingerprint-v1",
    rankApplicability: "positive_retrieval",
    expectation,
    observed: {
      corpusScopes: ["uploaded_local"],
      sourceRoles: ["local_guideline"],
      siteDomains: [],
      publicSiteContentState: "not_applicable",
      subquestionPurposes: ["primary"],
      directSubquestionCount: 1,
      answerShape: "focused",
      supportedPartRetained: true,
      exactGapNamed: true,
      insufficiencyReason: null,
      visibleConflictFields: [],
      hardViolations: [],
      satisfiedFacts: [],
      answerText: "Synthetic answer with supported guidance and an explicit evidence gap.",
      documentReciprocalRank: 1,
      contentReciprocalRank: 1,
      totalLatencyMs: 100,
      estimatedCostUsd: 0.01,
      incrementalEligibility: "none",
      ...overrides,
    },
  };
}

const fixture = {
  directEvidenceGenericRefusal: evaluation({
    supportedPartRetained: false,
    exactGapNamed: false,
    insufficiencyReason: "not_in_corpus",
    answerShape: "partial",
  }),
  supportedPartWithExactGap: evaluation({ answerShape: "partial" }),
  conflictMissingAustralianDateAndRole: {
    ...evaluation(),
    id: "synthetic-conflict-case",
    expectation: {
      ...expectation,
      expectedCorpusScopes: ["uploaded_local", "australian_public"],
      expectedSourceRoles: ["local_guideline", "clinical_guideline"],
      expectedConflict: {
        localDocumentId: "synthetic-local-guideline-v1",
        australianDocumentId: "synthetic-australian-guideline-v1",
        requireVisibleFields: [
          "source_identity",
          "publication_or_effective_date",
          "jurisdiction",
          "source_role",
          "material_difference",
          "local_primary_decision",
          "review_flag",
        ],
      },
    },
    observed: {
      ...evaluation().observed,
      corpusScopes: ["uploaded_local", "australian_public"],
      sourceRoles: ["local_guideline", "clinical_guideline"],
      visibleConflictFields: [
        "source_identity",
        "jurisdiction",
        "material_difference",
        "local_primary_decision",
        "review_flag",
      ],
    },
  },
} satisfies Record<string, RagProgrammeCaseEvaluationInput>;

const passingCase = evaluateRagProgrammeCase(evaluation());
const oneCasePopulationFingerprint = populationFingerprint([passingCase]);
const baseline: RagProgrammeRun = {
  caseSetFingerprint: "case-set-v1",
  populationFingerprint: oneCasePopulationFingerprint,
  cases: [passingCase],
};
const candidate: RagProgrammeRun = {
  ...baseline,
  cases: [{ ...passingCase, totalLatencyMs: 105, estimatedCostUsd: 0.0105 }],
};
const oneCasePopulation = {
  caseSetFingerprint: baseline.caseSetFingerprint,
  populationFingerprint: oneCasePopulationFingerprint,
  cases: [
    {
      id: passingCase.id,
      caseFingerprint: passingCase.caseFingerprint,
      rankApplicability: passingCase.rankApplicability,
    },
  ],
};

function candidateWith(violation: RagProgrammeHardViolation): RagProgrammeRun {
  return {
    ...candidate,
    cases: [{ ...candidate.cases[0], passed: false, hardViolations: [violation] }],
  };
}

describe("RAG programme gate", () => {
  it("accepts a complete internally consistent run bound to its canonical population", () => {
    expect(compareRagProgrammeRuns(baseline, candidate, oneCasePopulation)).toEqual({ decision: "GO", reasons: [] });
  });

  it("marks a generic refusal as false insufficiency when a required subquestion has direct evidence", () => {
    const result = evaluateRagProgrammeCase(fixture.directEvidenceGenericRefusal);
    expect(result).toMatchObject({ falseInsufficiency: true, passed: false });
  });

  it("passes a partial answer only when it retains support and names the exact gap", () => {
    const result = evaluateRagProgrammeCase(fixture.supportedPartWithExactGap);
    expect(result).toMatchObject({ supportedPartRetained: true, falseInsufficiency: false, passed: true });
  });

  it("fails a conflict case unless the complete canonical conflict is visible", () => {
    const result = evaluateRagProgrammeCase(fixture.conflictMissingAustralianDateAndRole);
    expect(result).toMatchObject({ passed: false, hardViolations: expect.arrayContaining(["conflict_contract"]) });
    expect(result.failedExpectations).toEqual(expect.arrayContaining(["publication_or_effective_date", "source_role"]));
  });

  it.each([
    "healthdirect_used",
    "link_only_content_used",
    "access_boundary",
    "site_public_read_mismatch",
    "site_non_admin_mutation",
    "conflict_contract",
    "incremental_reconciliation",
  ] satisfies RagProgrammeHardViolation[])("fails the run for one %s violation", (violation) => {
    expect(compareRagProgrammeRuns(baseline, candidateWith(violation), oneCasePopulation).decision).toBe("NO_GO");
  });

  it("fails when either the case set or evaluated population fingerprint differs", () => {
    expect(
      compareRagProgrammeRuns(baseline, { ...candidate, caseSetFingerprint: "different" }, oneCasePopulation).decision,
    ).toBe("NO_GO");
    expect(
      compareRagProgrammeRuns(baseline, { ...candidate, populationFingerprint: "different" }, oneCasePopulation)
        .decision,
    ).toBe("NO_GO");
  });

  it("fails when any must-pass case fails even if aggregate recall remains perfect", () => {
    const failedCase = {
      ...candidate.cases[0],
      passed: false,
      failedExpectations: ["visible_conflict_metadata_missing"],
    };
    expect(
      compareRagProgrammeRuns(
        baseline,
        { ...candidate, cases: [failedCase, ...candidate.cases.slice(1)] },
        oneCasePopulation,
      ).decision,
    ).toBe("NO_GO");
  });

  it("fails when a run copies the real case-set fingerprint but omits canonical must-pass cases", () => {
    const parsed = parseRagProgrammeFixture(
      JSON.parse(readFileSync("scripts/fixtures/rag-programme-failures.v1.json", "utf8")),
    );
    const canonicalPopulation = parsed.population;
    const firstCaseOnly: RagProgrammeRun = {
      caseSetFingerprint: parsed.caseSetFingerprint,
      populationFingerprint: canonicalPopulation.populationFingerprint,
      cases: [{ ...passingCase, id: parsed.cases[0].id, caseFingerprint: parsed.cases[0].caseFingerprint }],
    };

    expect(compareRagProgrammeRuns(firstCaseOnly, firstCaseOnly, canonicalPopulation).reasons).toContain(
      "canonical_population_mismatch",
    );
  });

  it("excludes canonical correct negatives from recall while preserving their zero ranks", () => {
    const parsed = parseRagProgrammeFixture(
      JSON.parse(readFileSync("scripts/fixtures/rag-programme-failures.v1.json", "utf8")),
    );
    const evaluated = parsed.cases.map((item) => {
      const result = evaluateRagProgrammeCase({
        id: item.id,
        caseFingerprint: item.caseFingerprint,
        rankApplicability: item.rankApplicability,
        expectation: item.expectation,
        observed: {
          corpusScopes: item.expectation.expectedCorpusScopes,
          sourceRoles: item.expectation.expectedSourceRoles,
          siteDomains: item.expectation.expectedSiteDomains,
          publicSiteContentState: item.expectation.expectedPublicSiteContentState,
          subquestionPurposes: item.expectation.expectedSubquestionPurposes,
          directSubquestionCount: item.expectation.minimumDirectSubquestions,
          answerShape: item.expectation.allowedAnswerShapes[0],
          supportedPartRetained: true,
          exactGapNamed: true,
          insufficiencyReason: null,
          conflictDocumentIds: item.expectation.expectedConflict
            ? {
                localDocumentId: item.expectation.expectedConflict.localDocumentId,
                australianDocumentId: item.expectation.expectedConflict.australianDocumentId,
              }
            : null,
          visibleConflictFields: item.expectation.expectedConflict?.requireVisibleFields ?? [],
          hardViolations: [],
          satisfiedFacts: item.expectation.requiredFacts,
          answerText: "Synthetic privacy-reviewed governed answer.",
          documentReciprocalRank: item.rankApplicability === "positive_retrieval" ? 1 : 0,
          contentReciprocalRank: item.rankApplicability === "positive_retrieval" ? 1 : 0,
          totalLatencyMs: 100,
          estimatedCostUsd: 0.01,
          incrementalEligibility: item.expectation.incrementalEligibility,
        },
      });
      return result;
    });
    const run: RagProgrammeRun = {
      caseSetFingerprint: parsed.caseSetFingerprint,
      populationFingerprint: parsed.population.populationFingerprint,
      cases: evaluated,
    };
    const correctNegatives = run.cases.filter((item) => item.rankApplicability === "correct_negative");

    expect(correctNegatives).toHaveLength(6);
    expect(
      correctNegatives.every((item) => item.documentReciprocalRank === 0 && item.contentReciprocalRank === 0),
    ).toBe(true);
    expect(compareRagProgrammeRuns(run, run, parsed.population)).toEqual({ decision: "GO", reasons: [] });
    expect(evaluated.map((result) => result.rankApplicability)).toEqual(
      parsed.cases.map((item) => item.rankApplicability),
    );
  });

  it.each([
    { passed: true, failedExpectations: ["tampered_failure"] },
    { passed: false, failedExpectations: [] },
    { passed: false, falseInsufficiency: true, supportedPartRetained: true, failedExpectations: ["exact_gap"] },
  ])("rejects caller-supplied outcomes that contradict their evidence: $passed", (overrides) => {
    const contradictory: RagProgrammeRun = {
      ...candidate,
      cases: [{ ...candidate.cases[0], ...overrides }],
    };

    expect(compareRagProgrammeRuns(baseline, contradictory, oneCasePopulation).reasons).toContain(
      "case_result_invariant_violation",
    );
  });

  it.each([
    ["baseline", "latency", Number.NaN, "baseline_latency_metric_invalid"],
    ["baseline", "latency", Number.POSITIVE_INFINITY, "baseline_latency_metric_invalid"],
    ["baseline", "latency", -1, "baseline_latency_metric_invalid"],
    ["baseline", "cost", Number.NaN, "baseline_cost_metric_invalid"],
    ["baseline", "cost", Number.POSITIVE_INFINITY, "baseline_cost_metric_invalid"],
    ["baseline", "cost", -1, "baseline_cost_metric_invalid"],
    ["candidate", "latency", Number.NaN, "latency_metric_invalid"],
    ["candidate", "latency", Number.POSITIVE_INFINITY, "latency_metric_invalid"],
    ["candidate", "latency", -1, "latency_metric_invalid"],
    ["candidate", "cost", Number.NaN, "estimated_cost_metric_invalid"],
    ["candidate", "cost", Number.POSITIVE_INFINITY, "estimated_cost_metric_invalid"],
    ["candidate", "cost", -1, "estimated_cost_metric_invalid"],
  ] as const)("rejects %s %s metric value %s", (runName, metric, value, reason) => {
    const changedCase = {
      ...(runName === "baseline" ? baseline.cases[0] : candidate.cases[0]),
      ...(metric === "latency" ? { totalLatencyMs: value } : { estimatedCostUsd: value }),
    };
    const changedRun = {
      ...(runName === "baseline" ? baseline : candidate),
      cases: [changedCase],
    };
    const decision = compareRagProgrammeRuns(
      runName === "baseline" ? changedRun : baseline,
      runName === "candidate" ? changedRun : candidate,
      oneCasePopulation,
    );

    expect(decision.reasons).toContain(reason);
  });

  it("pins zero hard violations, perfect recall, no rank regression, and bounded latency and cost", () => {
    expect(ragProgrammeGatePolicy).toEqual({
      version: "rag-programme-gate-v1",
      requireDocumentRecall: 1,
      requireContentRecall: 1,
      maximumHardViolations: 0,
      maximumPerCaseRankRegressions: 0,
      maximumP95LatencyMultiplier: 1.1,
      maximumEstimatedCostMultiplier: 1.15,
    });

    expect(
      compareRagProgrammeRuns(
        baseline,
        {
          ...candidate,
          cases: [{ ...candidate.cases[0], documentReciprocalRank: 0.5 }],
        },
        oneCasePopulation,
      ).reasons,
    ).toContain("per_case_rank_regression");
    expect(
      compareRagProgrammeRuns(
        baseline,
        {
          ...candidate,
          cases: [{ ...candidate.cases[0], totalLatencyMs: 111 }],
        },
        oneCasePopulation,
      ).reasons,
    ).toContain("latency_multiplier_exceeded");
    expect(
      compareRagProgrammeRuns(
        baseline,
        {
          ...candidate,
          cases: [{ ...candidate.cases[0], estimatedCostUsd: 0.0116 }],
        },
        oneCasePopulation,
      ).reasons,
    ).toContain("estimated_cost_multiplier_exceeded");
  });

  it("fails closed for an empty population or missing rank, latency, and cost metrics", () => {
    expect(compareRagProgrammeRuns(baseline, { ...candidate, cases: [] }, oneCasePopulation).reasons).toContain(
      "evaluated_case_population_empty",
    );
    expect(
      compareRagProgrammeRuns(
        baseline,
        {
          ...candidate,
          cases: [{ ...candidate.cases[0], documentReciprocalRank: Number.NaN }],
        },
        oneCasePopulation,
      ).reasons,
    ).toContain("rank_metric_invalid");
    expect(
      compareRagProgrammeRuns(
        baseline,
        {
          ...candidate,
          cases: [{ ...candidate.cases[0], totalLatencyMs: null, estimatedCostUsd: null }],
        },
        oneCasePopulation,
      ).reasons,
    ).toEqual(expect.arrayContaining(["latency_metric_missing", "estimated_cost_metric_missing"]));
  });
});

describe("RAG programme fixture", () => {
  it("verifies stable case and case-set fingerprints for the complete privacy-reviewed target slice", () => {
    const raw = JSON.parse(readFileSync("scripts/fixtures/rag-programme-failures.v1.json", "utf8"));
    const parsed = parseRagProgrammeFixture(raw);

    expect(parsed.caseSetFingerprint).toBe(raw.caseSetFingerprint);
    expect(parsed.cases).toHaveLength(29);
    expect(parsed.population.populationFingerprint).toBe(populationFingerprint(parsed.cases));
    const reparsed = parseRagProgrammeFixture(JSON.parse(JSON.stringify(parsed.raw)));
    expect(reparsed.caseSetFingerprint).toBe(parsed.caseSetFingerprint);
    expect(reparsed.cases.map((item) => item.caseFingerprint)).toEqual(
      parsed.cases.map((item) => item.caseFingerprint),
    );
    expect(parsed.cases.every((item) => item.caseFingerprint.startsWith("sha256:"))).toBe(true);
    expect(parsed.cases.every((item) => item.privacyReview.reviewed && !item.privacyReview.containsPatientText)).toBe(
      true,
    );
  });

  it("covers every protected programme failure class with an explicit structured expectation", () => {
    const parsed = parseRagProgrammeFixture(
      JSON.parse(readFileSync("scripts/fixtures/rag-programme-failures.v1.json", "utf8")),
    );
    const covered = new Set(parsed.cases.flatMap((item) => item.protectedFailureClasses));

    expect([...covered].sort()).toEqual([...requiredRagProgrammeFailureClasses].sort());
    expect(parsed.cases.every((item) => item.expectedDocumentIds.every((id) => !/patient|owner|user/i.test(id)))).toBe(
      true,
    );
  });

  it("rejects fixture tampering and privacy-boundary regressions", () => {
    const raw = JSON.parse(readFileSync("scripts/fixtures/rag-programme-failures.v1.json", "utf8"));
    expect(() => parseRagProgrammeFixture({ ...raw, caseSetFingerprint: "sha256:tampered" })).toThrow(
      /case-set fingerprint/i,
    );
    expect(() =>
      parseRagProgrammeFixture({
        ...raw,
        cases: [
          { ...raw.cases[0], privacyReview: { ...raw.cases[0].privacyReview, containsPatientText: true } },
          ...raw.cases.slice(1),
        ],
      }),
    ).toThrow(/privacy review/i);
  });

  it.each([
    ["invalid corpus enum", (raw: Record<string, any>) => (raw.cases[0].expectation.expectedCorpusScopes = [42])],
    [
      "invalid public-state boolean",
      (raw: Record<string, any>) => (raw.cases[0].expectation.expectedPublicSiteContentState = false),
    ],
    [
      "malformed conflict",
      (raw: Record<string, any>) =>
        (raw.cases[0].expectation.expectedConflict = {
          localDocumentId: false,
          australianDocumentId: "synthetic-australian-v1",
          requireVisibleFields: ["not_canonical"],
        }),
    ],
    [
      "invalid case privacy classification",
      (raw: Record<string, any>) => (raw.cases[0].privacyReview.classification = "private_patient"),
    ],
    ["missing fixture privacy declaration", (raw: Record<string, any>) => delete raw.privacyReview.containsPatientData],
  ])("rejects %s even after the case-set fingerprint is recomputed", (_label, mutate) => {
    const raw = JSON.parse(readFileSync("scripts/fixtures/rag-programme-failures.v1.json", "utf8"));
    mutate(raw);
    raw.caseSetFingerprint = fixtureFingerprint(raw);

    expect(() => parseRagProgrammeFixture(raw)).toThrow();
  });
});
