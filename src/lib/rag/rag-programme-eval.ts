import { createHash } from "node:crypto";

import type {
  AdaptiveAnswerShape,
  ClinicalSourceRole,
  RagInsufficiencyReason,
  RagProgrammeCaseResult,
  RagProgrammeExpectation,
  RagProgrammeGatePolicy,
  RagProgrammeHardViolation,
  RagProgrammeRankApplicability,
  RagSubquestionPurpose,
  SiteContentDomain,
  SiteContentPartitionState,
  SourceCorpusScope,
} from "@/lib/types";

export type {
  RagProgrammeCaseResult,
  RagProgrammeExpectation,
  RagProgrammeGatePolicy,
  RagProgrammeHardViolation,
  RagProgrammeRankApplicability,
} from "@/lib/types";

type ConflictVisibleField = NonNullable<RagProgrammeExpectation["expectedConflict"]>["requireVisibleFields"][number];

export type RagProgrammeObservedCase = {
  corpusScopes: SourceCorpusScope[];
  sourceRoles: ClinicalSourceRole[];
  siteDomains: SiteContentDomain[];
  publicSiteContentState: SiteContentPartitionState | "not_applicable";
  subquestionPurposes: RagSubquestionPurpose[];
  directSubquestionCount: number;
  answerShape: AdaptiveAnswerShape;
  supportedPartRetained: boolean;
  exactGapNamed: boolean;
  insufficiencyReason: RagInsufficiencyReason | null;
  conflictDocumentIds?: { localDocumentId: string; australianDocumentId: string } | null;
  visibleConflictFields: ConflictVisibleField[];
  hardViolations: RagProgrammeHardViolation[];
  satisfiedFacts: string[];
  answerText: string;
  documentReciprocalRank: number;
  contentReciprocalRank: number;
  totalLatencyMs: number | null;
  estimatedCostUsd: number | null;
  incrementalEligibility: RagProgrammeExpectation["incrementalEligibility"];
};

export type RagProgrammeCaseEvaluationInput = {
  id: string;
  caseFingerprint: string;
  rankApplicability: RagProgrammeRankApplicability;
  expectation: RagProgrammeExpectation;
  observed: RagProgrammeObservedCase;
};

export type RagProgrammeRun = {
  caseSetFingerprint: string;
  populationFingerprint: string;
  cases: RagProgrammeCaseResult[];
};

export type RagProgrammePopulationContract = {
  caseSetFingerprint: string;
  populationFingerprint: string;
  cases: Array<{ id: string; caseFingerprint: string; rankApplicability: RagProgrammeRankApplicability }>;
};

export type RagProgrammeGateDecision = {
  decision: "GO" | "NO_GO";
  reasons: string[];
};

export const requiredRagProgrammeFailureClasses = [
  "direct_evidence_generic_refusal",
  "trusted_admin_activation",
  "ordinary_user_upload_denial",
  "private_staging_exclusion",
  "broad_partial_gap",
  "uploaded_australian_augmentation",
  "site_specifier_current",
  "site_differential_current",
  "site_medication_current",
  "cross_domain_site_coverage",
  "uploaded_primary_over_site_summary",
  "site_product_primary",
  "changed_deleted_site_record",
  "stale_manifest_cache_mismatch",
  "uploaded_public_conflict",
  "public_release_auth_parity",
  "site_admin_only_mutation",
  "source_role_mismatch",
  "site_sync_unavailable",
  "australian_augmentation_unavailable",
  "healthdirect_exclusion",
  "etg_amh_link_only",
  "prohibited_upload_pre_provider",
  "narrow_answer_conciseness",
  "broad_answer_completeness",
  "broad_management_route",
  "structured_output_truncation",
  "anaphoric_follow_up",
  "incremental_reconciliation",
] as const;

export type RagProgrammeProtectedFailureClass = (typeof requiredRagProgrammeFailureClasses)[number];

export type RagProgrammeFixtureCase = {
  id: string;
  caseFingerprint: string;
  rankApplicability: RagProgrammeRankApplicability;
  question: string;
  privacyReview: {
    reviewed: true;
    classification: "synthetic_non_patient" | "deidentified_failure_reproduction";
    containsPatientText: false;
  };
  protectedFailureClasses: RagProgrammeProtectedFailureClass[];
  expectedDocumentIds: string[];
  expectation: RagProgrammeExpectation;
};

export type RagProgrammeFixture = {
  version: 1;
  fixtureId: "rag-programme-failures-v1";
  caseSetFingerprint: string;
  privacyReview: {
    reviewed: true;
    reviewDate: string;
    classification: "synthetic_and_deidentified";
    containsPatientData: false;
    containsProductionTraceData: false;
    containsProviderOutput: false;
    containsProtectedReferenceContent: false;
    containsUserOrAdministratorIdentifiers: false;
  };
  requiredFailureClasses: RagProgrammeProtectedFailureClass[];
  cases: RagProgrammeFixtureCase[];
};

export const ragProgrammeGatePolicy: RagProgrammeGatePolicy = {
  version: "rag-programme-gate-v1",
  requireDocumentRecall: 1,
  requireContentRecall: 1,
  maximumHardViolations: 0,
  maximumPerCaseRankRegressions: 0,
  maximumP95LatencyMultiplier: 1.1,
  maximumEstimatedCostMultiplier: 1.15,
};

function sortedUnique<T extends string>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort();
}

function missingValues<T extends string>(expected: readonly T[], actual: readonly T[]): T[] {
  const actualSet = new Set(actual);
  return sortedUnique(expected.filter((value) => !actualSet.has(value)));
}

function isUnitInterval(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function evaluateRagProgrammeCase(input: RagProgrammeCaseEvaluationInput): RagProgrammeCaseResult {
  const { expectation, observed } = input;
  const failedExpectations: string[] = [];
  const hardViolations = new Set(observed.hardViolations);

  for (const scope of missingValues(expectation.expectedCorpusScopes, observed.corpusScopes)) {
    failedExpectations.push(`corpus_scope:${scope}`);
  }
  for (const role of missingValues(expectation.expectedSourceRoles, observed.sourceRoles)) {
    failedExpectations.push(`source_role:${role}`);
    hardViolations.add("source_role_mismatch");
  }
  for (const domain of missingValues(expectation.expectedSiteDomains, observed.siteDomains)) {
    failedExpectations.push(`site_domain:${domain}`);
    hardViolations.add("site_domain_miss");
  }
  for (const purpose of missingValues(expectation.expectedSubquestionPurposes, observed.subquestionPurposes)) {
    failedExpectations.push(`subquestion_purpose:${purpose}`);
  }

  if (observed.publicSiteContentState !== expectation.expectedPublicSiteContentState) {
    failedExpectations.push(`public_site_state:${expectation.expectedPublicSiteContentState}`);
    if (expectation.expectedPublicSiteContentState === "current") hardViolations.add("stale_site_content");
  }
  if (observed.directSubquestionCount < expectation.minimumDirectSubquestions) {
    failedExpectations.push(`direct_subquestions:${expectation.minimumDirectSubquestions}`);
  }
  if (!expectation.allowedAnswerShapes.includes(observed.answerShape)) {
    failedExpectations.push(`answer_shape:${observed.answerShape}`);
  }
  if (expectation.requireSupportedPart && !observed.supportedPartRetained) {
    failedExpectations.push("supported_part_not_retained");
  }
  if (expectation.requireExactGap && !observed.exactGapNamed) {
    failedExpectations.push("exact_gap_missing");
  }
  if (
    observed.insufficiencyReason !== null &&
    expectation.forbiddenFallbackReasons.includes(observed.insufficiencyReason)
  ) {
    failedExpectations.push(`forbidden_fallback:${observed.insufficiencyReason}`);
  }
  for (const fact of missingValues(expectation.requiredFacts, observed.satisfiedFacts)) {
    failedExpectations.push(`required_fact:${fact}`);
  }
  for (const pattern of expectation.forbiddenPatterns) {
    if (observed.answerText.toLocaleLowerCase().includes(pattern.toLocaleLowerCase())) {
      failedExpectations.push(`forbidden_pattern:${pattern}`);
    }
  }

  if (expectation.expectedConflict) {
    const expectedConflict = expectation.expectedConflict;
    if (
      observed.conflictDocumentIds?.localDocumentId !== expectedConflict.localDocumentId ||
      observed.conflictDocumentIds?.australianDocumentId !== expectedConflict.australianDocumentId
    ) {
      failedExpectations.push("conflict_document_identity");
      hardViolations.add("conflict_contract");
    }
    for (const field of missingValues(expectedConflict.requireVisibleFields, observed.visibleConflictFields)) {
      failedExpectations.push(field);
      hardViolations.add("conflict_contract");
    }
  }
  if (observed.incrementalEligibility !== expectation.incrementalEligibility) {
    failedExpectations.push(`incremental_eligibility:${expectation.incrementalEligibility}`);
    hardViolations.add("incremental_reconciliation");
  }
  if (!isUnitInterval(observed.documentReciprocalRank)) failedExpectations.push("document_rank_invalid");
  if (!isUnitInterval(observed.contentReciprocalRank)) failedExpectations.push("content_rank_invalid");
  if (
    input.rankApplicability === "correct_negative" &&
    (observed.documentReciprocalRank !== 0 || observed.contentReciprocalRank !== 0)
  ) {
    failedExpectations.push("correct_negative_rank_nonzero");
  }

  const falseInsufficiency =
    expectation.minimumDirectSubquestions > 0 &&
    observed.directSubquestionCount >= expectation.minimumDirectSubquestions &&
    !observed.supportedPartRetained;

  return {
    id: input.id,
    caseFingerprint: input.caseFingerprint,
    rankApplicability: input.rankApplicability,
    passed: failedExpectations.length === 0 && hardViolations.size === 0,
    falseInsufficiency,
    supportedPartRetained: observed.supportedPartRetained,
    documentReciprocalRank: observed.documentReciprocalRank,
    contentReciprocalRank: observed.contentReciprocalRank,
    hardViolations: sortedUnique(hardViolations),
    failedExpectations: sortedUnique(failedExpectations),
    totalLatencyMs: observed.totalLatencyMs,
    estimatedCostUsd: observed.estimatedCostUsd,
  };
}

function percentile95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null;
}

function sumKnown(values: Array<number | null>): number | null {
  if (values.some((value) => value === null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function populationFingerprint(cases: Array<{ id: string; caseFingerprint: string }>): string {
  return fingerprint(
    cases
      .map(({ id, caseFingerprint }) => ({ id, caseFingerprint }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
}

function hasExactPopulation(run: RagProgrammeRun, canonical: RagProgrammePopulationContract): boolean {
  if (
    run.caseSetFingerprint !== canonical.caseSetFingerprint ||
    run.populationFingerprint !== canonical.populationFingerprint ||
    populationFingerprint(run.cases) !== canonical.populationFingerprint ||
    run.cases.length !== canonical.cases.length
  ) {
    return false;
  }
  const expected = new Map(canonical.cases.map((item) => [item.id, item]));
  return (
    expected.size === canonical.cases.length &&
    run.cases.every((item) => {
      const canonicalCase = expected.get(item.id);
      return (
        canonicalCase?.caseFingerprint === item.caseFingerprint &&
        canonicalCase.rankApplicability === item.rankApplicability
      );
    })
  );
}

function hasConsistentCaseResult(item: RagProgrammeCaseResult): boolean {
  const hasFailureEvidence =
    item.falseInsufficiency || item.hardViolations.length > 0 || item.failedExpectations.length > 0;
  const rankIsConsistent =
    item.rankApplicability === "positive_retrieval" ||
    (item.documentReciprocalRank === 0 && item.contentReciprocalRank === 0);
  return (
    item.passed === !hasFailureEvidence && !(item.falseInsufficiency && item.supportedPartRetained) && rankIsConsistent
  );
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function compareRagProgrammeRuns(
  baseline: RagProgrammeRun,
  candidate: RagProgrammeRun,
  canonicalPopulation: RagProgrammePopulationContract,
  policy: RagProgrammeGatePolicy = ragProgrammeGatePolicy,
): RagProgrammeGateDecision {
  const reasons = new Set<string>();
  const canonicalPopulationIsValid =
    canonicalPopulation.cases.length > 0 &&
    new Set(canonicalPopulation.cases.map((item) => item.id)).size === canonicalPopulation.cases.length &&
    populationFingerprint(canonicalPopulation.cases) === canonicalPopulation.populationFingerprint;
  if (!canonicalPopulationIsValid) reasons.add("canonical_population_contract_invalid");
  if (
    !canonicalPopulationIsValid ||
    !hasExactPopulation(baseline, canonicalPopulation) ||
    !hasExactPopulation(candidate, canonicalPopulation)
  ) {
    reasons.add("canonical_population_mismatch");
  }
  if (baseline.caseSetFingerprint !== candidate.caseSetFingerprint) reasons.add("case_set_fingerprint_mismatch");
  if (baseline.populationFingerprint !== candidate.populationFingerprint) {
    reasons.add("population_fingerprint_mismatch");
  }

  if (baseline.cases.length === 0 || candidate.cases.length === 0) reasons.add("evaluated_case_population_empty");
  const baselineById = new Map(baseline.cases.map((item) => [item.id, item]));
  const candidateIds = new Set(candidate.cases.map((item) => item.id));
  if (baselineById.size !== baseline.cases.length || candidateIds.size !== candidate.cases.length) {
    reasons.add("duplicate_case_id");
  }
  if (baseline.cases.length !== candidate.cases.length || candidate.cases.some((item) => !baselineById.has(item.id))) {
    reasons.add("evaluated_case_population_mismatch");
  }
  if (candidate.cases.some((item) => !item.passed)) reasons.add("must_pass_case_failed");
  if ([...baseline.cases, ...candidate.cases].some((item) => !hasConsistentCaseResult(item))) {
    reasons.add("case_result_invariant_violation");
  }
  if (
    [...baseline.cases, ...candidate.cases].some(
      (item) => !isUnitInterval(item.documentReciprocalRank) || !isUnitInterval(item.contentReciprocalRank),
    )
  ) {
    reasons.add("rank_metric_invalid");
  }

  const hardViolationCount = candidate.cases.reduce((sum, item) => sum + item.hardViolations.length, 0);
  if (hardViolationCount > policy.maximumHardViolations) reasons.add("hard_violation_ceiling_exceeded");

  const rankApplicableCases = candidate.cases.filter((item) => item.rankApplicability === "positive_retrieval");
  if (rankApplicableCases.length > 0) {
    const documentRecall =
      rankApplicableCases.filter((item) => item.documentReciprocalRank > 0).length / rankApplicableCases.length;
    const contentRecall =
      rankApplicableCases.filter((item) => item.contentReciprocalRank > 0).length / rankApplicableCases.length;
    if (documentRecall < policy.requireDocumentRecall) reasons.add("document_recall_below_gate");
    if (contentRecall < policy.requireContentRecall) reasons.add("content_recall_below_gate");
  }

  let rankRegressions = 0;
  for (const item of candidate.cases) {
    const prior = baselineById.get(item.id);
    if (!prior) continue;
    if (item.caseFingerprint !== prior.caseFingerprint) reasons.add("case_fingerprint_mismatch");
    if (
      item.documentReciprocalRank < prior.documentReciprocalRank ||
      item.contentReciprocalRank < prior.contentReciprocalRank
    ) {
      rankRegressions += 1;
    }
  }
  if (rankRegressions > policy.maximumPerCaseRankRegressions) reasons.add("per_case_rank_regression");

  const baselineFalseInsufficiency = baseline.cases.filter((item) => item.falseInsufficiency).length;
  const candidateFalseInsufficiency = candidate.cases.filter((item) => item.falseInsufficiency).length;
  if (
    candidateFalseInsufficiency > 0 &&
    (baselineFalseInsufficiency === 0 || candidateFalseInsufficiency >= baselineFalseInsufficiency)
  ) {
    reasons.add("false_insufficiency_not_improved");
  }

  if (baseline.cases.some((item) => item.totalLatencyMs === null)) reasons.add("baseline_latency_metric_missing");
  if (candidate.cases.some((item) => item.totalLatencyMs === null)) reasons.add("latency_metric_missing");
  if (baseline.cases.some((item) => item.estimatedCostUsd === null)) reasons.add("baseline_cost_metric_missing");
  if (candidate.cases.some((item) => item.estimatedCostUsd === null)) reasons.add("estimated_cost_metric_missing");
  if (baseline.cases.some((item) => item.totalLatencyMs !== null && !isFiniteNonNegative(item.totalLatencyMs))) {
    reasons.add("baseline_latency_metric_invalid");
  }
  if (candidate.cases.some((item) => item.totalLatencyMs !== null && !isFiniteNonNegative(item.totalLatencyMs))) {
    reasons.add("latency_metric_invalid");
  }
  if (baseline.cases.some((item) => item.estimatedCostUsd !== null && !isFiniteNonNegative(item.estimatedCostUsd))) {
    reasons.add("baseline_cost_metric_invalid");
  }
  if (candidate.cases.some((item) => item.estimatedCostUsd !== null && !isFiniteNonNegative(item.estimatedCostUsd))) {
    reasons.add("estimated_cost_metric_invalid");
  }

  const baselineP95 = percentile95(
    baseline.cases.flatMap((item) =>
      item.totalLatencyMs !== null && isFiniteNonNegative(item.totalLatencyMs) ? [item.totalLatencyMs] : [],
    ),
  );
  const candidateP95 = percentile95(
    candidate.cases.flatMap((item) =>
      item.totalLatencyMs !== null && isFiniteNonNegative(item.totalLatencyMs) ? [item.totalLatencyMs] : [],
    ),
  );
  if (
    baselineP95 !== null &&
    candidateP95 !== null &&
    candidateP95 > baselineP95 * policy.maximumP95LatencyMultiplier
  ) {
    reasons.add("latency_multiplier_exceeded");
  }

  const baselineCost = sumKnown(
    baseline.cases.map((item) =>
      item.estimatedCostUsd !== null && isFiniteNonNegative(item.estimatedCostUsd) ? item.estimatedCostUsd : null,
    ),
  );
  const candidateCost = sumKnown(
    candidate.cases.map((item) =>
      item.estimatedCostUsd !== null && isFiniteNonNegative(item.estimatedCostUsd) ? item.estimatedCostUsd : null,
    ),
  );
  if (
    baselineCost !== null &&
    candidateCost !== null &&
    candidateCost > baselineCost * policy.maximumEstimatedCostMultiplier
  ) {
    reasons.add("estimated_cost_multiplier_exceeded");
  }

  return { decision: reasons.size === 0 ? "GO" : "NO_GO", reasons: [...reasons].sort() };
}

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

function fingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function enumArray<T extends string>(value: unknown, allowed: ReadonlySet<T>, allowEmpty = true): value is T[] {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.every((item) => typeof item === "string" && allowed.has(item as T))
  );
}

const sourceCorpusScopes = new Set<SourceCorpusScope>([
  "uploaded_local",
  "clinical_kb_site",
  "australian_public",
  "international_supplementary",
]);
const clinicalSourceRoles = new Set<ClinicalSourceRole>([
  "local_guideline",
  "clinical_guideline",
  "clinical_reference",
  "service_directory",
  "form_reference",
  "tool_reference",
  "safety_alert",
  "regulatory",
  "quality_standard",
  "legal",
  "subsidy",
  "professional_review",
  "service_policy",
  "reference_link",
]);
const siteContentDomains = new Set<SiteContentDomain>([
  "services",
  "forms",
  "medications",
  "differentials",
  "specifiers",
  "dsm",
  "formulation",
  "therapies",
  "dictionary",
  "factsheets",
  "calculators",
  "tools",
]);
const siteContentStates = new Set<SiteContentPartitionState | "not_applicable">([
  "current",
  "updating",
  "stale",
  "unavailable",
  "disabled",
  "not_applicable",
]);
const subquestionPurposes = new Set<RagSubquestionPurpose>([
  "primary",
  "comparison_side",
  "required_action",
  "monitoring",
  "risk",
  "special_population",
]);
const answerShapes = new Set<AdaptiveAnswerShape>(["narrow", "focused", "comprehensive", "comparison", "partial"]);
const insufficiencyReasons = new Set<RagInsufficiencyReason>([
  "not_in_corpus",
  "retrieval_miss",
  "insufficient_claim_support",
  "source_role_mismatch",
  "source_conflict",
  "governance_block",
  "site_content_updating",
  "site_content_stale",
  "site_content_unavailable",
  "timeout",
  "provider_failure",
]);
const conflictVisibleFields = new Set<ConflictVisibleField>([
  "source_identity",
  "publication_or_effective_date",
  "jurisdiction",
  "source_role",
  "material_difference",
  "local_primary_decision",
  "review_flag",
]);
const incrementalEligibility = new Set<RagProgrammeExpectation["incrementalEligibility"]>([
  "none",
  "lead",
  "independent_sections",
]);

function assertPrivacyBoundary(value: Record<string, unknown>, prefix: string): void {
  if (
    value.reviewed !== true ||
    typeof value.reviewDate !== "string" ||
    !value.reviewDate.trim() ||
    value.classification !== "synthetic_and_deidentified"
  ) {
    throw new Error(`${prefix}: privacy review metadata is incomplete or invalid.`);
  }
  for (const key of [
    "containsPatientData",
    "containsProductionTraceData",
    "containsProviderOutput",
    "containsProtectedReferenceContent",
    "containsUserOrAdministratorIdentifiers",
  ]) {
    if (!Object.hasOwn(value, key) || value[key] !== false) {
      throw new Error(`${prefix}: privacy review must declare ${key}=false.`);
    }
  }
}

function validateExpectation(value: unknown, prefix: string): asserts value is RagProgrammeExpectation {
  if (!isRecord(value)) throw new Error(`${prefix}: expectation is required.`);
  if (!enumArray(value.expectedCorpusScopes, sourceCorpusScopes))
    throw new Error(`${prefix}: expectedCorpusScopes contains an invalid value.`);
  if (!enumArray(value.expectedSourceRoles, clinicalSourceRoles))
    throw new Error(`${prefix}: expectedSourceRoles contains an invalid value.`);
  if (!enumArray(value.expectedSiteDomains, siteContentDomains))
    throw new Error(`${prefix}: expectedSiteDomains contains an invalid value.`);
  if (!siteContentStates.has(value.expectedPublicSiteContentState as SiteContentPartitionState | "not_applicable"))
    throw new Error(`${prefix}: expectedPublicSiteContentState is invalid.`);
  if (!enumArray(value.expectedSubquestionPurposes, subquestionPurposes))
    throw new Error(`${prefix}: expectedSubquestionPurposes contains an invalid value.`);
  if (!enumArray(value.allowedAnswerShapes, answerShapes, false))
    throw new Error(`${prefix}: allowedAnswerShapes contains an invalid value.`);
  if (!enumArray(value.forbiddenFallbackReasons, insufficiencyReasons))
    throw new Error(`${prefix}: forbiddenFallbackReasons contains an invalid value.`);
  if (!Number.isInteger(value.minimumDirectSubquestions) || Number(value.minimumDirectSubquestions) < 0) {
    throw new Error(`${prefix}: minimumDirectSubquestions must be a non-negative integer.`);
  }
  if (typeof value.requireSupportedPart !== "boolean" || typeof value.requireExactGap !== "boolean") {
    throw new Error(`${prefix}: supported-part and exact-gap flags must be boolean.`);
  }
  if (!stringArray(value.requiredFacts)) throw new Error(`${prefix}: requiredFacts must contain explicit facts.`);
  if (
    !Array.isArray(value.forbiddenPatterns) ||
    !value.forbiddenPatterns.every((item) => typeof item === "string" && item.trim())
  ) {
    throw new Error(`${prefix}: forbiddenPatterns must contain only non-empty strings.`);
  }
  if (!incrementalEligibility.has(value.incrementalEligibility as RagProgrammeExpectation["incrementalEligibility"])) {
    throw new Error(`${prefix}: incrementalEligibility is invalid.`);
  }
  if (value.expectedConflict !== null) {
    if (
      !isRecord(value.expectedConflict) ||
      typeof value.expectedConflict.localDocumentId !== "string" ||
      !value.expectedConflict.localDocumentId.trim() ||
      typeof value.expectedConflict.australianDocumentId !== "string" ||
      !value.expectedConflict.australianDocumentId.trim() ||
      !enumArray(value.expectedConflict.requireVisibleFields, conflictVisibleFields, false)
    ) {
      throw new Error(`${prefix}: expectedConflict is malformed.`);
    }
  }
}

type RawFixtureCase = Omit<RagProgrammeFixtureCase, "caseFingerprint">;

function validateFixtureCase(value: unknown, index: number): asserts value is RawFixtureCase {
  if (!isRecord(value)) throw new Error(`Programme fixture case ${index} must be an object.`);
  const prefix = typeof value.id === "string" && value.id.trim() ? value.id : `case ${index}`;
  if (typeof value.id !== "string" || !value.id.trim()) throw new Error(`${prefix}: id is required.`);
  if (typeof value.question !== "string" || !value.question.trim()) throw new Error(`${prefix}: question is required.`);
  if (
    !isRecord(value.privacyReview) ||
    value.privacyReview.reviewed !== true ||
    !new Set(["synthetic_non_patient", "deidentified_failure_reproduction"]).has(
      String(value.privacyReview.classification),
    ) ||
    !Object.hasOwn(value.privacyReview, "containsPatientText") ||
    value.privacyReview.containsPatientText !== false
  ) {
    throw new Error(`${prefix}: privacy review must be complete and declare containsPatientText=false.`);
  }
  if (
    !enumArray(
      value.protectedFailureClasses,
      new Set<RagProgrammeProtectedFailureClass>(requiredRagProgrammeFailureClasses),
      false,
    )
  ) {
    throw new Error(`${prefix}: protectedFailureClasses must name at least one class.`);
  }
  if (
    !Array.isArray(value.expectedDocumentIds) ||
    !value.expectedDocumentIds.every((item) => typeof item === "string" && item.trim().length > 0)
  ) {
    throw new Error(`${prefix}: expectedDocumentIds must be an array.`);
  }
  validateExpectation(value.expectation, prefix);
}

export function parseRagProgrammeFixture(input: unknown): {
  raw: RagProgrammeFixture;
  cases: RagProgrammeFixtureCase[];
  caseSetFingerprint: string;
  population: RagProgrammePopulationContract;
} {
  if (!isRecord(input) || input.version !== 1 || input.fixtureId !== "rag-programme-failures-v1") {
    throw new Error("RAG programme fixture must be the versioned rag-programme-failures-v1 contract.");
  }
  if (!isRecord(input.privacyReview)) throw new Error("Fixture privacy review is required.");
  assertPrivacyBoundary(input.privacyReview, "Fixture privacy review");
  if (!stringArray(input.requiredFailureClasses) || !Array.isArray(input.cases)) {
    throw new Error("RAG programme fixture must declare required failure classes and cases.");
  }
  const declaredFailureClasses = input.requiredFailureClasses;
  input.cases.forEach(validateFixtureCase);
  const ids = input.cases.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new Error("RAG programme fixture case IDs must be unique.");

  const required = new Set<string>(requiredRagProgrammeFailureClasses);
  if (declaredFailureClasses.some((item) => !required.has(item))) {
    throw new Error("RAG programme fixture declares an unknown protected failure class.");
  }
  const covered = new Set(input.cases.flatMap((item) => item.protectedFailureClasses));
  if (
    declaredFailureClasses.length !== required.size ||
    requiredRagProgrammeFailureClasses.some((item) => !declaredFailureClasses.includes(item) || !covered.has(item))
  ) {
    throw new Error("RAG programme fixture does not cover every protected failure class.");
  }

  const casesWithoutFingerprints = input.cases.map((item) => {
    const { caseFingerprint: _caseFingerprint, rankApplicability: _rankApplicability, ...caseInput } = item;
    return caseInput;
  });
  const { caseSetFingerprint: storedFingerprint, ...fingerprintInput } = input;
  fingerprintInput.cases = casesWithoutFingerprints;
  const computedFingerprint = fingerprint(fingerprintInput);
  if (storedFingerprint !== computedFingerprint) {
    throw new Error(`RAG programme case-set fingerprint mismatch: expected ${computedFingerprint}.`);
  }

  const cases = casesWithoutFingerprints.map((item) => ({
    ...item,
    caseFingerprint: fingerprint(item),
    rankApplicability: item.expectedDocumentIds.length > 0 ? "positive_retrieval" : "correct_negative",
  })) satisfies RagProgrammeFixtureCase[];
  const raw = { ...input, cases } as RagProgrammeFixture;
  const population: RagProgrammePopulationContract = {
    caseSetFingerprint: computedFingerprint,
    populationFingerprint: populationFingerprint(cases),
    cases: cases.map(({ id, caseFingerprint, rankApplicability }) => ({ id, caseFingerprint, rankApplicability })),
  };
  return { raw, cases, caseSetFingerprint: computedFingerprint, population };
}
