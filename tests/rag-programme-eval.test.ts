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
const baseline: RagProgrammeRun = {
  caseSetFingerprint: "case-set-v1",
  populationFingerprint: "population-v1",
  cases: [passingCase],
};
const candidate: RagProgrammeRun = {
  ...baseline,
  cases: [{ ...passingCase, totalLatencyMs: 105, estimatedCostUsd: 0.0105 }],
};

function candidateWith(violation: RagProgrammeHardViolation): RagProgrammeRun {
  return {
    ...candidate,
    cases: [{ ...candidate.cases[0], passed: false, hardViolations: [violation] }],
  };
}

describe("RAG programme gate", () => {
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
    expect(compareRagProgrammeRuns(baseline, candidateWith(violation)).decision).toBe("NO_GO");
  });

  it("fails when either the case set or evaluated population fingerprint differs", () => {
    expect(compareRagProgrammeRuns(baseline, { ...candidate, caseSetFingerprint: "different" }).decision).toBe("NO_GO");
    expect(compareRagProgrammeRuns(baseline, { ...candidate, populationFingerprint: "different" }).decision).toBe(
      "NO_GO",
    );
  });

  it("fails when any must-pass case fails even if aggregate recall remains perfect", () => {
    const failedCase = {
      ...candidate.cases[0],
      passed: false,
      failedExpectations: ["visible_conflict_metadata_missing"],
    };
    expect(
      compareRagProgrammeRuns(baseline, { ...candidate, cases: [failedCase, ...candidate.cases.slice(1)] }).decision,
    ).toBe("NO_GO");
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
      compareRagProgrammeRuns(baseline, {
        ...candidate,
        cases: [{ ...candidate.cases[0], documentReciprocalRank: 0.5 }],
      }).reasons,
    ).toContain("per_case_rank_regression");
    expect(
      compareRagProgrammeRuns(baseline, {
        ...candidate,
        cases: [{ ...candidate.cases[0], totalLatencyMs: 111 }],
      }).reasons,
    ).toContain("latency_multiplier_exceeded");
    expect(
      compareRagProgrammeRuns(baseline, {
        ...candidate,
        cases: [{ ...candidate.cases[0], estimatedCostUsd: 0.0116 }],
      }).reasons,
    ).toContain("estimated_cost_multiplier_exceeded");
  });

  it("fails closed for an empty population or missing rank, latency, and cost metrics", () => {
    expect(compareRagProgrammeRuns(baseline, { ...candidate, cases: [] }).reasons).toContain(
      "evaluated_case_population_empty",
    );
    expect(
      compareRagProgrammeRuns(baseline, {
        ...candidate,
        cases: [{ ...candidate.cases[0], documentReciprocalRank: Number.NaN }],
      }).reasons,
    ).toContain("rank_metric_invalid");
    expect(
      compareRagProgrammeRuns(baseline, {
        ...candidate,
        cases: [{ ...candidate.cases[0], totalLatencyMs: null, estimatedCostUsd: null }],
      }).reasons,
    ).toEqual(expect.arrayContaining(["latency_metric_missing", "estimated_cost_metric_missing"]));
  });
});

describe("RAG programme fixture", () => {
  it("verifies stable case and case-set fingerprints for the complete privacy-reviewed target slice", () => {
    const raw = JSON.parse(readFileSync("scripts/fixtures/rag-programme-failures.v1.json", "utf8"));
    const parsed = parseRagProgrammeFixture(raw);

    expect(parsed.caseSetFingerprint).toBe(raw.caseSetFingerprint);
    expect(parsed.cases).toHaveLength(29);
    expect(parseRagProgrammeFixture(parsed.raw).caseSetFingerprint).toBe(parsed.caseSetFingerprint);
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
});
