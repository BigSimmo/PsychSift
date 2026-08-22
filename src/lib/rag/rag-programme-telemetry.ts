import type { RagObservationContext } from "@/lib/rag/rag-contracts";
import type {
  RagAnswer,
  RagAugmentationOutcome,
  RagGenerationOutcome,
  RagInsufficiencyReason,
  RagQueryPlanKind,
  RagReconciliationOutcome,
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

type CorpusCounts = Record<SourceCorpusScope, number>;
type CoverageCounts = { direct: number; partial: number; conflicting: number; absent: number };

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

export type RagProgrammeTelemetryInput = {
  observationContext: RagObservationContext;
  queryPlanKind: RagQueryPlanKind;
  subquestionCount: number;
  materialAmbiguity: boolean;
  coverageCounts: CoverageCounts;
  candidateCounts: CorpusCounts;
  selectedCounts: CorpusCounts;
  selectedSiteDomains: readonly SiteContentDomain[];
  siteCandidateCount: number;
  siteSelectedCount: number;
  publicSiteContentState: SiteContentPartitionState;
  siteStaticManifestMatch: boolean | null;
  sitePendingCount: number | null;
  augmentationOutcome: RagAugmentationOutcome;
  roleExclusionCount: number;
  insufficiencyReason: RagInsufficiencyReason | null;
  generationOutcome: RagGenerationOutcome;
  verifiedUnitsEmitted: number;
  verifiedUnitsDiscarded: number;
  reconciliationOutcome: RagReconciliationOutcome;
};

function boundedCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
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
    insufficiency_reason:
      insufficiencyReason === null
        ? null
        : enumValue(insufficiencyReason, insufficiencyReasons, "insufficient_claim_support"),
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

export function programmeTelemetryInputForAnswer(args: {
  observationContext: RagObservationContext;
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
  >;
  candidateCount: number;
}): RagProgrammeTelemetryInput {
  const supported = args.answer.grounded && args.answer.confidence !== "unsupported";
  return {
    observationContext: args.observationContext,
    queryPlanKind: "single",
    subquestionCount: 1,
    materialAmbiguity: false,
    coverageCounts: { direct: supported ? 1 : 0, partial: 0, conflicting: 0, absent: supported ? 0 : 1 },
    candidateCounts: {
      uploaded_local: boundedCount(args.candidateCount),
      clinical_kb_site: 0,
      australian_public: 0,
      international_supplementary: 0,
    },
    selectedCounts: {
      uploaded_local: boundedCount(args.answer.sources?.length),
      clinical_kb_site: 0,
      australian_public: 0,
      international_supplementary: 0,
    },
    selectedSiteDomains: [],
    siteCandidateCount: 0,
    siteSelectedCount: 0,
    publicSiteContentState: "disabled",
    siteStaticManifestMatch: null,
    sitePendingCount: null,
    augmentationOutcome: "disabled",
    roleExclusionCount: 0,
    insufficiencyReason: insufficiencyReason(args.answer),
    generationOutcome: generationOutcome(args.answer),
    verifiedUnitsEmitted: 0,
    verifiedUnitsDiscarded: 0,
    reconciliationOutcome: "not_applicable",
  };
}
