import type { RagObservationContext } from "@/lib/rag/rag-contracts";
import type {
  AnswerResponseMode,
  RagAnswer,
  RagAugmentationOutcome,
  RagGenerationOutcome,
  RagInsufficiencyReason,
  RagQueryPlanKind,
  RagReconciliationOutcome,
  RagProgrammeDiagnostics,
  SearchResult,
  SiteContentDomain,
  SiteContentPartitionState,
  SourceCorpusScope,
} from "@/lib/types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const corpusScopes = [
  "uploaded_local",
  "clinical_kb_site",
  "australian_public",
  "international_supplementary",
] as const satisfies readonly SourceCorpusScope[];
const answerResponseModes = [
  "checklist",
  "comparison_matrix",
  "threshold_table",
  "clinical_pathway",
  "document_lookup",
  "evidence_gap",
] as const satisfies readonly AnswerResponseMode[];
const siteContentDomains = [
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
] as const satisfies readonly SiteContentDomain[];
const queryPlanKinds = [
  "single",
  "decomposed",
  "clarification_required",
] as const satisfies readonly RagQueryPlanKind[];
const siteContentStates = [
  "current",
  "updating",
  "stale",
  "unavailable",
  "disabled",
] as const satisfies readonly SiteContentPartitionState[];
const augmentationOutcomes = [
  "not_needed",
  "used",
  "no_eligible_evidence",
  "unavailable",
  "disabled",
] as const satisfies readonly RagAugmentationOutcome[];
const insufficiencyReasons = [
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
] as const satisfies readonly RagInsufficiencyReason[];
const generationOutcomes = [
  "generated",
  "extractive",
  "source_only",
  "failed",
] as const satisfies readonly RagGenerationOutcome[];
const reconciliationOutcomes = [
  "not_applicable",
  "matched",
  "mismatch",
] as const satisfies readonly RagReconciliationOutcome[];

type CorpusCounts = RagProgrammeDiagnostics["candidateCounts"];
type CoverageCounts = RagProgrammeDiagnostics["coverageCounts"];

export type RagProgrammeTelemetry = {
  version: "rag-programme-telemetry-v1";
  interaction_id: string;
  rollout_mode: RagObservationContext["rolloutMode"];
  query_plan_kind: RagQueryPlanKind;
  subquestion_count: number;
  material_ambiguity: boolean;
  coverage_counts: CoverageCounts;
  candidate_counts: CorpusCounts;
  selected_counts: CorpusCounts;
  selected_site_domains: SiteContentDomain[];
  site_candidate_count: number;
  site_selected_count: number;
  public_site_content_state: SiteContentPartitionState;
  site_static_manifest_match: boolean | null;
  site_pending_count_bucket: "0" | "1" | "2_to_5" | "6_plus" | null;
  augmentation_outcome: RagAugmentationOutcome;
  role_exclusion_count: number;
  insufficiency_reason: RagInsufficiencyReason | null;
  generation_outcome: RagGenerationOutcome;
  verified_units_emitted: number;
  verified_units_discarded: number;
  reconciliation_outcome: RagReconciliationOutcome;
};

export type RagProgrammeTelemetryInput = RagProgrammeDiagnostics & {
  observationContext: RagObservationContext;
};

type RagProgrammeAnswer = Pick<
  RagAnswer,
  | "answerQualityTier"
  | "confidence"
  | "fallbackReason"
  | "grounded"
  | "modelUsed"
  | "programmeDiagnostics"
  | "retrievalDiagnostics"
  | "responseMode"
  | "routingMode"
  | "routingReason"
  | "sources"
>;

function boundedCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function boundedInsufficiencyReason(value: unknown): RagInsufficiencyReason | null {
  return value === null || value === undefined
    ? null
    : enumValue(value, insufficiencyReasons, "insufficient_claim_support");
}

function corpusCounts(value: unknown): CorpusCounts {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(corpusScopes.map((scope) => [scope, boundedCount(source[scope])])) as CorpusCounts;
}

function coverageCounts(value: unknown): CoverageCounts {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    direct: boundedCount(source.direct),
    partial: boundedCount(source.partial),
    conflicting: boundedCount(source.conflicting),
    absent: boundedCount(source.absent),
  };
}

function pendingCountBucket(value: unknown): RagProgrammeTelemetry["site_pending_count_bucket"] {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const count = Math.floor(value);
  if (count === 0) return "0";
  if (count === 1) return "1";
  return count <= 5 ? "2_to_5" : "6_plus";
}

export function buildRagProgrammeTelemetry(input: RagProgrammeTelemetryInput): RagProgrammeTelemetry {
  const source = input as RagProgrammeTelemetryInput & Record<string, unknown>;
  const interactionId = source.observationContext?.interactionId;
  if (typeof interactionId !== "string" || !UUID_PATTERN.test(interactionId)) {
    throw new TypeError("RAG programme telemetry requires an opaque UUID interaction ID.");
  }

  const selectedSiteDomains = Array.isArray(source.selectedSiteDomains)
    ? [...new Set(source.selectedSiteDomains)].filter((domain): domain is SiteContentDomain =>
        siteContentDomains.includes(domain as SiteContentDomain),
      )
    : [];
  const insufficiencyReason = source.insufficiencyReason;

  return {
    version: "rag-programme-telemetry-v1",
    interaction_id: interactionId,
    rollout_mode: enumValue(source.observationContext.rolloutMode, ["legacy", "shadow", "canary"], "legacy"),
    query_plan_kind: enumValue(source.queryPlanKind, queryPlanKinds, "single"),
    subquestion_count: boundedCount(source.subquestionCount),
    material_ambiguity: source.materialAmbiguity === true,
    coverage_counts: coverageCounts(source.coverageCounts),
    candidate_counts: corpusCounts(source.candidateCounts),
    selected_counts: corpusCounts(source.selectedCounts),
    selected_site_domains: selectedSiteDomains,
    site_candidate_count: boundedCount(source.siteCandidateCount),
    site_selected_count: boundedCount(source.siteSelectedCount),
    public_site_content_state: enumValue(source.publicSiteContentState, siteContentStates, "disabled"),
    site_static_manifest_match:
      typeof source.siteStaticManifestMatch === "boolean" ? source.siteStaticManifestMatch : null,
    site_pending_count_bucket: pendingCountBucket(source.sitePendingCount),
    augmentation_outcome: enumValue(source.augmentationOutcome, augmentationOutcomes, "disabled"),
    role_exclusion_count: boundedCount(source.roleExclusionCount),
    insufficiency_reason: boundedInsufficiencyReason(insufficiencyReason),
    generation_outcome: enumValue(source.generationOutcome, generationOutcomes, "failed"),
    verified_units_emitted: boundedCount(source.verifiedUnitsEmitted),
    verified_units_discarded: boundedCount(source.verifiedUnitsDiscarded),
    reconciliation_outcome: enumValue(source.reconciliationOutcome, reconciliationOutcomes, "not_applicable"),
  };
}

export function buildRagQueryMetadata(input: RagProgrammeTelemetryInput) {
  const telemetry = buildRagProgrammeTelemetry(input);
  return {
    version: telemetry.version,
    interaction_id: telemetry.interaction_id,
    rollout_mode: telemetry.rollout_mode,
    coverage_counts: telemetry.coverage_counts,
    insufficiency_reason: telemetry.insufficiency_reason,
    generation_outcome: telemetry.generation_outcome,
    verified_units_emitted: telemetry.verified_units_emitted,
    verified_units_discarded: telemetry.verified_units_discarded,
    reconciliation_outcome: telemetry.reconciliation_outcome,
  };
}

export function buildRagRetrievalMetadata(input: RagProgrammeTelemetryInput) {
  const telemetry = buildRagProgrammeTelemetry(input);
  return {
    version: telemetry.version,
    interaction_id: telemetry.interaction_id,
    rollout_mode: telemetry.rollout_mode,
    query_plan_kind: telemetry.query_plan_kind,
    subquestion_count: telemetry.subquestion_count,
    material_ambiguity: telemetry.material_ambiguity,
    candidate_counts: telemetry.candidate_counts,
    selected_counts: telemetry.selected_counts,
    selected_site_domains: telemetry.selected_site_domains,
    site_candidate_count: telemetry.site_candidate_count,
    site_selected_count: telemetry.site_selected_count,
    public_site_content_state: telemetry.public_site_content_state,
    site_static_manifest_match: telemetry.site_static_manifest_match,
    site_pending_count_bucket: telemetry.site_pending_count_bucket,
    augmentation_outcome: telemetry.augmentation_outcome,
    role_exclusion_count: telemetry.role_exclusion_count,
  };
}

function generationOutcome(answer: Pick<RagAnswer, "answerQualityTier" | "modelUsed" | "routingMode">) {
  if (answer.answerQualityTier === "source_only") return "source_only" as const;
  if (answer.modelUsed) return "generated" as const;
  if (answer.routingMode === "extractive") return "extractive" as const;
  return "failed" as const;
}

function insufficiencyReason(answer: Pick<RagAnswer, "confidence" | "fallbackReason" | "routingReason">) {
  const boundedSignals = `${answer.fallbackReason ?? ""};${answer.routingReason ?? ""}`.toLowerCase();
  if (boundedSignals.includes("timeout")) return "timeout" as const;
  if (boundedSignals.includes("provider")) return "provider_failure" as const;
  if (boundedSignals.includes("governance")) return "governance_block" as const;
  if (boundedSignals.includes("conflict")) return "source_conflict" as const;
  return answer.confidence === "unsupported" ? ("retrieval_miss" as const) : null;
}

function emptyCorpusCounts(): CorpusCounts {
  return {
    uploaded_local: 0,
    clinical_kb_site: 0,
    australian_public: 0,
    international_supplementary: 0,
  };
}

function corpusCountsForResults(results: readonly SearchResult[]) {
  const counts = emptyCorpusCounts();
  for (const result of results) {
    const scope = (result as SearchResult & { corpus_scope?: SourceCorpusScope }).corpus_scope;
    if (scope && corpusScopes.includes(scope)) counts[scope] += 1;
  }
  return counts;
}

function selectedSiteDomains(results: readonly SearchResult[]) {
  return [
    ...new Set(
      results.flatMap((result) => {
        const domain = (result as SearchResult & { site_content_domain?: SiteContentDomain | null })
          .site_content_domain;
        return domain ? [domain] : [];
      }),
    ),
  ];
}

export function buildRagProgrammeDiagnostics(
  answer: Pick<
    RagAnswer,
    | "answerQualityTier"
    | "confidence"
    | "fallbackReason"
    | "grounded"
    | "modelUsed"
    | "routingMode"
    | "routingReason"
    | "sources"
  >,
  candidateResults: readonly SearchResult[],
): RagProgrammeDiagnostics {
  const selectedResults = answer.sources ?? [];
  const candidateCounts = corpusCountsForResults(candidateResults);
  const selectedCounts = corpusCountsForResults(selectedResults);
  const domains = selectedSiteDomains(selectedResults);
  const supported = answer.grounded && answer.confidence !== "unsupported";
  return {
    queryPlanKind: "single",
    subquestionCount: 1,
    materialAmbiguity: false,
    coverageCounts: { direct: supported ? 1 : 0, partial: 0, conflicting: 0, absent: supported ? 0 : 1 },
    candidateCounts,
    selectedCounts,
    selectedSiteDomains: domains,
    siteCandidateCount: candidateCounts.clinical_kb_site,
    siteSelectedCount: selectedCounts.clinical_kb_site,
    publicSiteContentState: "disabled",
    siteStaticManifestMatch: null,
    sitePendingCount: null,
    augmentationOutcome: "disabled",
    roleExclusionCount: 0,
    insufficiencyReason: insufficiencyReason(answer),
    generationOutcome: generationOutcome(answer),
    verifiedUnitsEmitted: 0,
    verifiedUnitsDiscarded: 0,
    reconciliationOutcome: "not_applicable",
  };
}

export function withRagProgrammeDiagnostics(answer: RagAnswer, candidateResults: readonly SearchResult[]): RagAnswer {
  return answer.programmeDiagnostics
    ? answer
    : { ...answer, programmeDiagnostics: buildRagProgrammeDiagnostics(answer, candidateResults) };
}

export function withFinalRagProgrammeOutcome(answer: RagAnswer): RagAnswer {
  const finalDiagnostics = buildRagProgrammeDiagnostics(answer, []);
  return {
    ...answer,
    programmeDiagnostics: {
      ...(answer.programmeDiagnostics ?? finalDiagnostics),
      coverageCounts: finalDiagnostics.coverageCounts,
      insufficiencyReason: finalDiagnostics.insufficiencyReason,
      generationOutcome: answer.confidence === "unsupported" ? "failed" : finalDiagnostics.generationOutcome,
    },
  };
}

export function programmeTelemetryInputForAnswer(args: {
  observationContext: RagObservationContext;
  answer: RagProgrammeAnswer;
}): RagProgrammeTelemetryInput {
  const diagnostics = args.answer.programmeDiagnostics ?? buildRagProgrammeDiagnostics(args.answer, []);
  return {
    observationContext: args.observationContext,
    ...diagnostics,
  };
}

export function boundedAnswerTelemetryReasons(answer: RagProgrammeAnswer) {
  const route = enumValue(
    answer.routingMode ?? answer.retrievalDiagnostics?.routeMode,
    ["unsupported", "extractive", "fast", "strong"],
    "unsupported",
  );
  const responseMode = answerResponseModes.includes(answer.responseMode as AnswerResponseMode)
    ? (answer.responseMode as AnswerResponseMode)
    : null;
  const diagnostics = answer.programmeDiagnostics ?? buildRagProgrammeDiagnostics(answer, []);
  return { route, responseMode, insufficiencyReason: boundedInsufficiencyReason(diagnostics.insufficiencyReason) };
}
