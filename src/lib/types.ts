import type { DocxPageSourceProvenance } from "@/lib/extractors/docx-source-provenance";
import type { PdfPageSourceProvenance } from "@/lib/extractors/pdf-source-provenance";
import type { TextPageSourceProvenance } from "@/lib/extractors/text-source-provenance";
import type { XlsxPageSourceProvenance } from "@/lib/extractors/xlsx-source-provenance";
export type DocumentStatus = "queued" | "processing" | "indexed" | "failed";
export type JobStatus = "pending" | "processing" | "completed" | "failed";
export type ImportBatchStatus = "queued" | "processing" | "completed" | "completed_with_errors" | "failed";

export type ImageEvidenceCategory =
  | "clinical_table"
  | "flowchart_algorithm"
  | "form_checklist"
  | "risk_matrix"
  | "medication_chart"
  | "graph"
  | "screenshot_ui"
  | "cover_page"
  | "photo"
  | "logo_decorative"
  | "unclear";

export type ClinicalImageUseClass =
  "clinical_evidence" | "administrative" | "reference" | "decorative_or_empty" | "ambiguous";

export type DocumentLabelType =
  | "site"
  | "topic"
  | "document_type"
  | "medication"
  | "risk"
  | "setting"
  | "workflow"
  | "population"
  | "service"
  | "clinical_action"
  | "care_phase"
  | "document_intent"
  | "content_feature"
  | "custom";

export type DocumentOrganizationSiteKind =
  "hospital" | "health_service" | "program" | "unit" | "reference_collection" | "unknown";
export type DocumentOrganizationReviewStatus = "confident" | "needs_review" | "manual_override";
export type DocumentOrganizationType =
  | "policy"
  | "procedure"
  | "guideline"
  | "protocol"
  | "form"
  | "checklist"
  | "pathway"
  | "reference"
  | "algorithm"
  | "factsheet"
  | "manual"
  | "assessment_tool"
  | "prescribing_aid"
  | "unknown";

export type DocumentOrganizationProfile = {
  canonical_display_title: string;
  raw_bracket_tags: string[];
  site: {
    label: string | null;
    short_label: string | null;
    raw_tag: string | null;
    kind: DocumentOrganizationSiteKind;
    confidence: number;
    evidence_sources: string[];
    candidates: Array<{
      label: string;
      short_label: string;
      raw_tag: string;
      kind: DocumentOrganizationSiteKind;
      confidence: number;
      evidence_sources: string[];
    }>;
  };
  document_type: {
    label: DocumentOrganizationType;
    confidence: number;
    evidence_sources: string[];
  };
  secondary_facets: {
    population: string[];
    setting: string[];
    service: string[];
    topic: string[];
    workflow: string[];
    medication: string[];
    risk: string[];
    clinical_action: string[];
    care_phase: string[];
    document_intent: string[];
    content_feature: string[];
  };
  review_status: DocumentOrganizationReviewStatus;
};

export type SourceContentMode = "indexed_content" | "link_only";

export type SourceLicencePolicy =
  "review_required" | "public_index_permitted" | "metadata_link_only" | "index_forbidden";

export type SourceChangeState = "unchanged" | "changed" | "withdrawn" | "superseded" | "unknown";

export type ClinicalSourceMetadata = {
  source_kind?: "document" | "registry_record" | string | null;
  registry_record_kind?: "service" | "form" | "medication" | "differential" | string | null;
  registry_record_subkind?: string | null;
  registry_record_id?: string | null;
  registry_record_slug?: string | null;
  source_title: string | null;
  publisher: string | null;
  publisher_code?: string | null;
  jurisdiction: string | null;
  version: string | null;
  publication_date: string | null;
  review_date: string | null;
  uploaded_at: string | null;
  indexed_at: string | null;
  uploaded_by: string | null;
  corpus_scope?: SourceCorpusScope | null;
  source_role?: ClinicalSourceRole | null;
  content_mode?: SourceContentMode | null;
  source_catalogue_key?: string | null;
  source_policy_version?: string | null;
  canonical_url?: string | null;
  effective_date?: string | null;
  expiry_date?: string | null;
  supersedes_document_id?: string | null;
  superseded_by_document_id?: string | null;
  retrieved_at?: string | null;
  content_hash?: string | null;
  change_state?: SourceChangeState;
  licence_policy?: SourceLicencePolicy | null;
  document_status: "current" | "review_due" | "outdated" | "unknown";
  clinical_validation_status: "unverified" | "locally_reviewed" | "approved" | "unknown";
  clinical_validation_evidence?: Record<string, unknown> | null;
  extraction_quality: "good" | "partial" | "poor" | "unknown";
};

/** Untrusted metadata shape accepted at ingestion and API normalization boundaries. */
export type ClinicalSourceMetadataInput =
  | (Partial<{ [Field in keyof ClinicalSourceMetadata]: unknown }> & Readonly<Record<string, unknown>>)
  | null
  | undefined;

/** Canonical corpus boundary used by programme evaluation, ingestion, and retrieval. */
export type SourceCorpusScope =
  "uploaded_local" | "clinical_kb_site" | "australian_public" | "international_supplementary";

/** Server-issued, request-local provenance used only for context-pack admission. */
export type ContextPackAdmissionReceipt = Readonly<{
  version: "context-pack-admission-v1";
  ownerId: string | null;
  sourcePolicyVersion: string;
  indexGeneration: string | null;
  document: Readonly<{
    corpusScope: "australian_public";
    documentId: string;
    chunkId: string;
  }> | null;
  siteContent: Readonly<{
    releaseId: string;
    releaseDigest: string;
    changeEpoch: string;
  }> | null;
}>;

/** Canonical clinical/governance role of a source, independent of its corpus. */
export type ClinicalSourceRole =
  | "local_guideline"
  | "clinical_guideline"
  | "clinical_reference"
  | "service_directory"
  | "form_reference"
  | "tool_reference"
  | "safety_alert"
  | "regulatory"
  | "quality_standard"
  | "legal"
  | "subsidy"
  | "professional_review"
  | "service_policy"
  | "reference_link";

/** Claim-level evidence roles used to keep source purpose separate from topical relevance. */
export type ClinicalClaimRole =
  "treatment" | "dose_or_monitoring" | "safety" | "legal" | "subsidy" | "quality" | "service_workflow";

export type SourceEligibilityDecision = {
  eligible: boolean;
  reason:
    "eligible" | "link_only" | "inactive" | "role_mismatch" | "not_current" | "governance_block" | "catalogue_mismatch";
};

export type SourcePolicyConflictSide = {
  documentId: string;
  catalogueKey: string;
  title: string;
  publisher: string;
  publicationDate: string | null;
  effectiveFrom: string | null;
  jurisdiction: string;
  sourceRole: ClinicalSourceRole;
  corpusScope: SourceCorpusScope;
  supportingChunkIds: string[];
};

export type SourcePolicyConflict = {
  version: "source-policy-conflict-v1";
  id: string;
  claimRole: ClinicalClaimRole;
  topicKey: string;
  local: SourcePolicyConflictSide & { corpusScope: "uploaded_local" };
  australian: SourcePolicyConflictSide & { corpusScope: "australian_public" };
  overlapReason: "same_claim" | "same_topic_and_population";
  materialDifferenceReason:
    | "recommendation_differs"
    | "dose_differs"
    | "threshold_differs"
    | "monitoring_differs"
    | "legal_status_differs"
    | "other_reviewed_material_difference";
  localPrimaryDecision: {
    selected: "uploaded_local";
    reason: "current_valid_accessible_directly_supportive";
  };
  reviewTargetDocumentId: string;
};

export type VerifiedSourcePolicyDifference = Pick<
  SourcePolicyConflict,
  "claimRole" | "topicKey" | "overlapReason" | "materialDifferenceReason"
> & {
  localChunkIds: string[];
  australianChunkIds: string[];
};

export type EvidencePrimaryDecision =
  | {
      selected: "uploaded_local";
      reason: "current_valid_accessible_directly_supportive";
    }
  | {
      selected: "australian_public";
      reason: "no_eligible_uploaded_local" | "uploaded_local_not_directly_supportive";
    }
  | {
      selected: "none";
      reason: "no_eligible_evidence";
    };

/** Canonical first-party Clinical KB content domains. */
export type SiteContentDomain =
  | "services"
  | "forms"
  | "medications"
  | "differentials"
  | "specifiers"
  | "dsm"
  | "formulation"
  | "therapies"
  | "dictionary"
  | "factsheets"
  | "calculators"
  | "tools";

export type SiteContentPartitionState = "current" | "updating" | "stale" | "unavailable" | "disabled";

export type RagSubquestionPurpose =
  "primary" | "comparison_side" | "required_action" | "monitoring" | "risk" | "special_population";

export type RagSubquestion = {
  id: string;
  /** Request-local clinical question. Never persist this field in telemetry. */
  question: string;
  purpose: RagSubquestionPurpose;
  /** Request-local delivery facets; never retrieval text or telemetry. */
  requestedFacets?: RagAskedPart[];
  requestedFacetDetails?: Partial<Record<RagAskedPart, RagRequestedFacetDetail[]>>;
  required: boolean;
};

export type RagRequestedFacetDetail = "frequency" | "route" | "maximum";

export type RagAskedPart =
  | "dosing"
  | "assessment"
  | "differential"
  | "rationale"
  | "management"
  | "monitoring"
  | "risk"
  | "comparison"
  | "service_workflow";

export type RagQueryPlan = {
  askedParts?: RagAskedPart[];
  requestedDepth?: "concise" | "standard" | "detailed";
  materialSafetyDependencies?: RagSubquestionPurpose[];
  sourcePolicy?: "only_this_source" | "primary_plus_approved_supplements";
  version: "rag-query-plan-v1";
  kind: import("@/lib/rag/rag-programme-eval").RagQueryPlanKind;
  /** Request-local original text. Never persist this field in telemetry. */
  originalQuery: string;
  interpretation: string;
  subquestions: RagSubquestion[];
  targetSiteDomains: SiteContentDomain[];
  siteDomainDecision: "explicit" | "inferred" | "none";
  reasonCodes: string[];
};

export type ClinicalAmbiguity = {
  material: boolean;
  dimensions: Array<"population" | "setting" | "medicine" | "document" | "jurisdiction" | "decision">;
  clarificationQuestion: string;
};

export type SubquestionCoverage = {
  subquestionId: string;
  status: "direct" | "partial" | "conflicting" | "absent";
  chunkIds: string[];
  reasonCodes: string[];
};

export type AnswerCoveragePlan = {
  interpretation: string;
  ambiguity: ClinicalAmbiguity | null;
  subquestions: Array<{ id: string; question: string; required: boolean }>;
  coverage: SubquestionCoverage[];
  conflicts: SourcePolicyConflict[];
  overall: "complete" | "partial" | "conflicting" | "absent";
  insufficiencyReason: RagInsufficiencyReason | null;
};

export type RagFallbackReasonCode =
  | "provider_offline"
  | "provider_missing_key"
  | "provider_auth"
  | "provider_quota"
  | "provider_rate_limit"
  | "provider_timeout"
  | "provider_failure"
  | "retrieval_degraded"
  | "no_candidates"
  | "low_signal"
  | "coverage_gap"
  | "source_role_mismatch"
  | "source_conflict"
  | "source_governance_block"
  | "site_content_updating"
  | "site_content_stale"
  | "site_content_unavailable"
  | "citation_or_claim_gate"
  | "unsupported"
  | "unknown";

export type AdaptiveAnswerShape = "narrow" | "focused" | "comprehensive" | "comparison" | "partial";

/** Required, request-local policy input; legacy query/answer plans need not carry it. */
export type AdaptiveAnswerRequest = Required<
  Pick<RagQueryPlan, "askedParts" | "requestedDepth" | "materialSafetyDependencies" | "sourcePolicy">
> &
  Pick<RagQueryPlan, "subquestions">;

/** Internal composition policy, built only from the current request and packed coverage. */
export type AdaptiveAnswerPlan = {
  shape: AdaptiveAnswerShape;
  requestedDepth: AdaptiveAnswerRequest["requestedDepth"];
  requiredAskedParts: RagAskedPart[];
  materialSafetyDependencies: RagSubquestionPurpose[];
  sourcePolicy: AdaptiveAnswerRequest["sourcePolicy"];
  requiredCoverage: Array<{
    subquestionId: string;
    question: string;
    purpose: RagSubquestionPurpose | null;
    /** Null is missing coverage, never manufactured supporting evidence. */
    coverage: SubquestionCoverage | null;
  }>;
  supportedSubquestionIds: string[];
  exactGapSubquestionIds: string[];
  missingSafetyDependencies: RagSubquestionPurpose[];
  optionalSectionKinds: AnswerSectionKind[];
  requireExactGap: boolean;
  requireConflictSection: boolean;
  conflicts: SourcePolicyConflict[];
  clarificationQuestion: string | null;
  /** Finite policy tiers; the shared answer-contract limits owner supplies empirical ceilings. */
  allocation: {
    tier: "concise" | "standard" | "detailed";
    requiredFirst: true;
    optionalEnrichment: "remaining_budget_only";
    padToMinimum: false;
  };
};

export type RagInsufficiencyReason =
  | "not_in_corpus"
  | "retrieval_miss"
  | "insufficient_claim_support"
  | "source_role_mismatch"
  | "source_conflict"
  | "governance_block"
  | "site_content_updating"
  | "site_content_stale"
  | "site_content_unavailable"
  | "timeout"
  | "provider_failure";

export type ClinicalQueryMode =
  | "auto"
  | "monitoring_schedule"
  | "dose_threshold_lookup"
  | "contraindications_cautions"
  | "escalation_criteria"
  | "required_documentation"
  | "compare_guidance";

/**
 * Retrieval-layer health for one search.
 *
 * A retrieval RPC that errors degrades to zero candidates behind a 200 response
 * (`searchTextChunkCandidates` returns `[]` and only records `hybrid_rpc_errors`
 * in telemetry), so a broken index and a genuinely absent topic are
 * indistinguishable to the reader. In a clinical corpus that is the dangerous
 * direction to fail: "no guideline covers this" must never be inferred from a
 * search that never ran. When this is set, an empty result set is not evidence
 * of absence and must not be reported as one.
 */
export type SearchRetrievalHealth = {
  degraded: true;
  /** Machine-readable and query-free (RPC names only), so it is safe to log. */
  reason: string;
};

export type SearchScopeSummary = {
  summary: string;
  activeFilterCount: number;
  matchedDocumentCount: number | null;
  warnings: string[];
  queryMode?: ClinicalQueryMode;
  /**
   * Carried on the scope summary because that is the object already threaded
   * intact from `/api/search` to the results panel, and it is already the
   * "why does this result set look like this" channel (see `warnings`).
   */
  retrieval?: SearchRetrievalHealth | null;
};

export const SOURCE_GOVERNANCE_CODES = {
  OUTDATED: "outdated_source",
  REVIEW_DUE: "review_due_source",
  NON_LOCAL: "non_local_source",
  UNVERIFIED: "unverified_source",
  POOR_EXTRACTION: "poor_extraction",
  PARTIAL_EXTRACTION: "partial_extraction",
  LOW_INDEX_QUALITY: "low_index_quality",
  WEAK_EVIDENCE: "weak_evidence",
  WEAK_TABLE_EXTRACTION: "weak_table_extraction",
  REGISTRY_RECORD: "registry_record_source",
  DOCUMENT_CAUTION: "document_caution",
} as const;

export type SourceGovernanceCode = (typeof SOURCE_GOVERNANCE_CODES)[keyof typeof SOURCE_GOVERNANCE_CODES];

export type SourceGovernanceUiToken = "destructive" | "warning" | "caution" | "neutral" | "muted";

export type SourceGovernanceWarning = {
  code: SourceGovernanceCode;
  severity: "info" | "warning" | "danger";
  message: string;
  uiToken?: SourceGovernanceUiToken;
  document_id?: string;
  title?: string;
};

export type RetrievalConfidenceGateStatus = "passed" | "blocked";

export type RetrievalChunkType = "text" | "table" | "flowchart" | "medication_chart" | "patient_education";

export type RetrievalIntent = {
  needsTable: boolean;
  needsMedicationChart: boolean;
  needsFlowchartStep: boolean;
  needsPatientEducation: boolean;
  needsSourceImage: boolean;
  needsRiskFlowchart: boolean;
  needsExactVisualTable: boolean;
  needsDoseRouteFrequency: boolean;
  needsComparison: boolean;
  preferredDocumentSignals: string[];
  requiredTermSignals: string[];
};

export type RetrievalCandidate = {
  chunkId: string;
  documentId: string;
  title: string;
  section?: string;
  page?: number | null;
  chunkType: RetrievalChunkType;
  score: number;
  lexicalScore?: number;
  semanticScore?: number;
  rerankScore?: number;
  contentCoverageScore?: number;
  matchedSignals: string[];
  sourceHref?: string;
};

export type RetrievalSelectionSummary = {
  candidateCount: number;
  selectedCount: number;
  requiredSignalsSatisfied: boolean;
  matchedSignals: string[];
  missingRequiredSignals: string[];
  rescueApplied: boolean;
  topChunkTypes: Record<RetrievalChunkType, number>;
};

export type RetrievalDiagnostics = {
  candidateCount: number;
  retrievalDepth: number;
  distinctDocumentCount: number;
  topScore: number;
  secondScore: number;
  scoreSpread: number;
  queryClass?: RagQueryClass;
  routeMode?: "unsupported" | "extractive" | "fast" | "strong";
  gateStatus: RetrievalConfidenceGateStatus;
  fallbackReason?: string | null;
  retrievalReason?: string | null;
};

export type ClinicalDocument = {
  id: string;
  owner_id?: string | null;
  title: string;
  description: string | null;
  file_name: string;
  file_type: string;
  file_size: number;
  storage_path: string;
  content_hash?: string | null;
  source_path?: string | null;
  import_batch_id?: string | null;
  status: DocumentStatus;
  page_count: number;
  chunk_count: number;
  image_count: number;
  error_message: string | null;
  metadata?: Record<string, unknown> | ClinicalSourceMetadata | null;
  labels?: DocumentLabel[];
  summary?: DocumentSummary | null;
  created_at: string;
  updated_at: string;
};

export type IngestionJob = {
  id: string;
  document_id: string;
  batch_id?: string | null;
  status: JobStatus;
  stage: string;
  progress: number;
  error_message: string | null;
  attempt_count?: number;
  max_attempts?: number;
  locked_at?: string | null;
  locked_by?: string | null;
  next_run_at?: string | null;
  created_at: string;
  updated_at: string;
  documents?: Pick<ClinicalDocument, "title" | "file_name" | "status"> | null;
};

export type ImportBatch = {
  id: string;
  owner_id: string | null;
  name: string;
  source_root: string | null;
  include_glob: string;
  status: ImportBatchStatus;
  total_files: number;
  queued_files: number;
  skipped_files: number;
  failed_files: number;
  total_bytes: number;
  metadata: Record<string, unknown>;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ChunkImage = {
  id: string;
  page_number: number | null;
  storage_path: string;
  signed_url?: string;
  caption: string;
  bbox?: [number, number, number, number] | null;
  image_type?: ImageEvidenceCategory | string;
  /** Intrinsic pixels. The viewer frames a crop at its own ratio rather than a
   *  generic 4:3 box, so an image without these renders letterboxed. */
  width?: number | null;
  height?: number | null;
  searchable?: boolean;
  clinical_relevance_score?: number;
  source_kind?: string | null;
  sourceKind?: string | null;
  tableLabel?: string | null;
  tableTitle?: string | null;
  tableRole?: string | null;
  tableTextSnippet?: string | null;
  clinicalUseClass?: ClinicalImageUseClass | null;
  clinicalUseReason?: string | null;
  accessibleTableMarkdown?: string | null;
  tableRows?: string[][] | null;
  tableColumns?: string[] | null;
  labels?: string[];
  metadata?: Record<string, unknown> | null;
};

export type SearchResult = {
  id: string;
  document_id: string;
  title: string;
  file_name: string;
  page_number: number | null;
  chunk_index: number;
  section_heading: string | null;
  section_path?: string[];
  heading_level?: number | null;
  parent_heading?: string | null;
  anchor_id?: string | null;
  content: string;
  retrieval_synopsis?: string | null;
  image_ids: string[];
  similarity: number;
  /** Server-only retrieval scope; candidate selection rejects an absent or unknown value. */
  corpus_scope?: SourceCorpusScope;
  /** Server-only first-party site partition, when this result belongs to that corpus. */
  site_content_domain?: SiteContentDomain | null;
  /** Server-only, non-serializable authority. Untrusted retrieval rows are never allowed to provide it. */
  context_pack_admission?: ContextPackAdmissionReceipt;
  // RC9 observability: "synthetic_text" marks a `similarity` fabricated from lexical/structural
  // signals (document-lookup, memory-card, table-facts fast paths) rather than a real cosine.
  // Coverage/threshold gates are calibrated for cosine values; this tag lets telemetry measure
  // how often synthetic scores cross those gates before any recalibration.
  //
  // "document_context" marks the constant `similarity: 1` that `buildDocumentSummaryResults`
  // (`rag/rag-row-contracts.ts`) stamps on document-summary rows. It is NOT a measured cosine
  // either, but it is also not the same hazard as "synthetic_text": that route's only caller is
  // `summarizeDocument`, where the "query" IS the document, so every committed chunk is context
  // by construction rather than by a match score. Owner decision 2026-08-17 (Option B,
  // `docs/clinical-hazard-analysis.md` H5a) keeps the confidence derivation unchanged and adds
  // this value purely so the provenance is legible to telemetry, review, and future gating —
  // `deriveConfidence` deliberately excludes only "synthetic_text", pinned by
  // `tests/rag-score.test.ts`.
  similarity_origin?: "cosine" | "synthetic_text" | "document_context";
  text_rank?: number;
  hybrid_score?: number;
  // Lexical/keyword relevance (0-1) for text-only fallback rows. This is NOT a
  // cosine similarity — text-only rows leave `similarity` at 0 so a keyword hit
  // can never masquerade as strong/moderate semantic evidence (RET-C2).
  lexical_score?: number | null;
  rrf_score?: number;
  score_explanation?: SearchScoreExplanation;
  source_strength?: SourceStrength;
  source_metadata?: ClinicalSourceMetadata | null;
  document_labels?: DocumentLabel[];
  document_summary?: string | null;
  adjacent_context?: string | null;
  memory_cards?: DocumentMemoryCard[];
  memory_score?: number;
  relevance?: SourceEvidenceRelevance;
  match_explanation?: SearchMatchExplanation;
  table_facts?: DocumentTableFact[];
  index_unit?: DocumentIndexUnitMatch | null;
  indexing_quality?: DocumentIndexQualityScore | null;
  images: ChunkImage[];
};

export type SearchMatchExplanation = {
  titleHit?: boolean;
  labelHit?: boolean;
  sectionHit?: boolean;
  contentHit?: boolean;
  tableHit?: boolean;
  indexUnitType?: string | null;
  matchedAliases?: string[];
  vectorSimilarity?: number | null;
  textRank?: number | null;
  fieldType?: string | null;
  freshness?: ClinicalSourceMetadata["document_status"] | null;
  extractionQuality?: ClinicalSourceMetadata["extraction_quality"] | null;
  indexQualityScore?: number | null;
  indexQualityIssues?: string[];
  reasons: string[];
};

export type DocumentIndexUnitMatch = {
  id: string;
  unit_type: string;
  title: string;
  content: string;
  source_chunk_id: string | null;
  source_image_id: string | null;
  page_start: number | null;
  page_end: number | null;
  heading_path: string[];
  normalized_terms: string[];
  source_span?: Record<string, unknown> | null;
  quality_score: number | null;
  extraction_mode: "deterministic" | "model_heavy" | "hybrid";
  similarity?: number | null;
  text_rank?: number | null;
  hybrid_score?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type DocumentTableFact = {
  id: string;
  document_id: string;
  source_chunk_id: string | null;
  source_image_id: string | null;
  page_number: number | null;
  table_title: string | null;
  row_label: string | null;
  clinical_parameter: string | null;
  threshold_value: string | null;
  action: string | null;
  text_rank?: number | null;
  match_reason?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type DocumentIndexQualityScore = {
  document_id: string;
  owner_id?: string | null;
  quality_score: number;
  extraction_quality: ClinicalSourceMetadata["extraction_quality"] | string;
  metrics: Record<string, unknown>;
  issues: string[];
  updated_at?: string;
};

export type SearchScoreExplanation = {
  vectorScore: number;
  textRank: number;
  lexicalCoverageScore: number;
  metadataMatchScore: number;
  sectionTitleMatchBoost: number;
  freshnessRecencyBoost: number;
  weightedHybridScore: number;
  rrfScore: number | null;
  rrfBoost: number;
  memoryBoost: number;
  titleBoost: number;
  metadataBoost: number;
  clinicalSignalBoost: number;
  penalty: number;
  rawPenalty?: number;
  /**
   * Unbounded application-layer relevance score used for ordering. Unlike finalScore,
   * this retains the magnitude of boosts and signed penalties after confidence saturates.
   */
  rankScore: number;
  /** Live-eval-gated retrieval score used for the final released search order. */
  releaseRankScore?: number;
  /** Existing public confidence signal, clamped to the inclusive 0-1 range. */
  finalScore: number;
  finalRank?: number;
  /** Bounded model relevance from the ambiguity-only reranker; used as a small answer-evidence signal. */
  semanticRerankScore?: number;
  /** Compatibility alias for rankScore retained for older telemetry and fixtures. */
  preClampFinalScore?: number;
  /** Numeric inputs to the deterministic query-class fusion. Fixed adjustments are not tunable. */
  fusionSignals?: {
    hybridRelevance: number;
    lexicalCoverage: number;
    reciprocalRankFusion: number;
    titleSectionRelevance: number;
    metadataRelevance: number;
    clinicalEvidence: number;
    fixedAdjustment: number;
  };
  strategy: "weighted_hybrid" | "weighted_hybrid_rrf_blend";
};

export type CitationProvenance =
  "model_selected" | "section_selected" | "exact_quote" | "deterministic_support" | "review_only" | "retrieval_only";

export type Citation = {
  chunk_id: string;
  document_id: string;
  title: string;
  file_name: string;
  page_number: number | null;
  chunk_index: number;
  similarity?: number;
  source_metadata?: ClinicalSourceMetadata | null;
  provenance?: CitationProvenance;
};

export type SafetyWarningKind =
  "contraindication" | "red_flag" | "escalation" | "dose_limit" | "monitoring" | "exclusion" | "caveat";

export type SafetyWarning = {
  id: string;
  kind: SafetyWarningKind;
  label: string;
  text: string;
  citation: Citation;
  href: string;
};

export type SupportedClaim = {
  claimId: string;
  text: string;
  riskClass: "routine" | "high_risk";
  supportingChunkIds: string[];
  supportStatus: "direct" | "partial" | "unsupported";
};

export type EvidenceAssessment = {
  relevance: "direct" | "partial" | "nearby" | "none";
  claimSupport: "direct" | "partial" | "unsupported";
  authority: "approved" | "locally_reviewed" | "unverified";
  currency: "current" | "review_due" | "outdated" | "unknown";
  extractionQuality: "good" | "partial" | "poor" | "unknown";
};

export type QuoteCard = Citation & {
  quote: string;
  section_heading: string | null;
  source_strength?: SourceStrength;
  // True when the quote was cut at the display cap; the card shows a "truncated — open source"
  // affordance so a value past the cut is never read as the complete passage.
  isTruncated?: boolean;
};

export type SourceStrength = "strong" | "moderate" | "limited";

export type EvidenceRelevanceVerdict = "direct" | "partial" | "nearby" | "none";

export type EvidenceRelevance = {
  verdict: EvidenceRelevanceVerdict;
  label: string;
  matchedTerms: string[];
  missingTerms: string[];
  directSourceCount: number;
  weakSourceCount: number;
  score: number;
  supportReason: string;
  isSourceBacked: boolean;
};

export type SourceEvidenceRelevance = EvidenceRelevance & {
  coverageScore: number;
  rankScore: number;
  titleMatchedTerms: string[];
  contentMatchedTerms: string[];
  metadataMatchedTerms: string[];
  chips: string[];
};

export type VisualEvidenceCard = {
  id: string;
  image_id: string;
  signed_url_endpoint: string;
  caption: string;
  document_id: string;
  title: string;
  file_name: string;
  page_number: number | null;
  source_chunk_id: string;
  chunk_index: number;
  viewer_href: string;
  image_type?: ImageEvidenceCategory;
  clinical_relevance_score?: number;
  source_kind?: string | null;
  tableLabel?: string | null;
  tableTitle?: string | null;
  tableRole?: string | null;
  tableTextSnippet?: string | null;
  clinicalUseClass?: ClinicalImageUseClass | null;
  clinicalUseReason?: string | null;
  accessibleTableMarkdown?: string | null;
  tableRows?: string[][] | null;
  tableColumns?: string[] | null;
  labels?: string[];
  relevance?: SourceEvidenceRelevance;
};

export type DocumentLabel = {
  id: string;
  document_id: string;
  owner_id?: string | null;
  label: string;
  label_type: DocumentLabelType;
  source: "generated" | "manual";
  confidence: number;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
};

export type DocumentSummary = {
  id: string;
  document_id: string;
  owner_id?: string | null;
  summary: string;
  clinical_specifics: {
    profile?: ClinicalDocumentSummaryProfile;
    actions?: string[];
    thresholds_timing?: string[];
    medication_monitoring?: string[];
    risk_escalation?: string[];
    documentation_forms?: string[];
    exceptions_gaps?: string[];
    [key: string]: unknown;
  };
  source_chunk_ids: string[];
  source_image_ids: string[];
  model: string | null;
  metadata?: Record<string, unknown>;
  generated_at?: string;
  created_at?: string;
  updated_at?: string;
};

export type DocumentSummaryEvidenceType = "text" | "table" | "image" | "mixed" | "metadata";
export type DocumentSummarySupportLevel = "direct" | "partial" | "not_found";

export type DocumentSummaryProfileItem = {
  text: string;
  source_chunk_ids: string[];
  source_image_ids: string[];
  pages: number[];
  evidence_type: DocumentSummaryEvidenceType;
  support: DocumentSummarySupportLevel;
};

export type ClinicalDocumentSummaryProfile = {
  overview: string;
  applies_to: DocumentSummaryProfileItem[];
  key_clinical_actions: DocumentSummaryProfileItem[];
  medication_dose_monitoring: DocumentSummaryProfileItem[];
  thresholds_timing: DocumentSummaryProfileItem[];
  escalation_risk_warnings: DocumentSummaryProfileItem[];
  required_forms_documentation: DocumentSummaryProfileItem[];
  not_covered: DocumentSummaryProfileItem[];
  important_tables_images: DocumentSummaryProfileItem[];
  best_questions: DocumentSummaryProfileItem[];
  source_quality_notes: DocumentSummaryProfileItem[];
};

export type RagIndexingVersion = "rag-universal-v1" | "rag-deep-memory-v1" | "rag-deep-memory-v2";

export type DocumentIndexQuality = {
  indexingVersion?: RagIndexingVersion | null;
  memoryVersion?: RagIndexingVersion | null;
  extractionQuality?: ClinicalSourceMetadata["extraction_quality"];
  sectionCount?: number;
  memoryCardCount?: number;
  missingEmbeddings?: number;
  qualityScore?: number;
  qualityIssues?: string[];
  stale?: boolean;
};

export type DocumentSectionMemory = {
  id?: string;
  document_id: string;
  owner_id?: string | null;
  section_index: number;
  heading: string;
  heading_path: string[];
  page_start: number | null;
  page_end: number | null;
  chunk_ids: string[];
  summary: string;
  tags: string[];
  extraction_quality: ClinicalSourceMetadata["extraction_quality"];
  index_generation_id?: string | null;
  producer?: string | null;
  artifact_generation_id?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type DocumentMemoryCardType =
  | "section_summary"
  | "askable_question"
  | "table_row"
  | "threshold"
  | "medication"
  | "risk"
  | "workflow"
  | "definition"
  | "citation_anchor";

export type DocumentMemoryCard = {
  id?: string;
  document_id: string;
  owner_id?: string | null;
  section_id?: string | null;
  card_type: DocumentMemoryCardType;
  title: string;
  content: string;
  normalized_terms: string[];
  page_number: number | null;
  source_chunk_ids: string[];
  source_image_ids: string[];
  confidence: number;
  index_generation_id?: string | null;
  producer?: string | null;
  artifact_generation_id?: string | null;
  metadata?: Record<string, unknown>;
  embedding?: number[];
  created_at?: string;
  updated_at?: string;
};

export type RagQueryClass =
  | "document_lookup"
  | "table_threshold"
  | "medication_dose_risk"
  | "comparison"
  | "broad_summary"
  | "unsupported_or_general";

export type ClinicalQueryIntent =
  | "definition"
  | "protocol"
  | "drug_dosing"
  | "escalation_risk"
  | "document_lookup"
  | "comparison"
  | "broad_summary"
  | "general";

// Finding #11 corpus grounding: how the corpus classified an unsupported-soft-tail query.
// "in_corpus_topic" deterministically reclassifies to broad_summary; "out_of_corpus" skips the
// LLM classifier so the soft-tail refusal is deterministic; "inconclusive" keeps legacy
// behaviour (LLM classifier fallback). Absent = the query never entered the soft tail.
export type CorpusGroundingVerdict = "in_corpus_topic" | "out_of_corpus" | "inconclusive";

export type ClinicalQueryAnalysis = {
  originalQuery: string;
  normalizedQuery: string;
  queryClass: RagQueryClass;
  intent: ClinicalQueryIntent;
  confidence: number;
  reasons: string[];
  corpusGrounding?: CorpusGroundingVerdict;
  canonicalTerms: string[];
  expandedTerms: string[];
  typoCorrections: Array<{ from: string; to: string }>;
  medications: string[];
  acronyms: string[];
  thresholdTerms: string[];
  documentTitleTerms: string[];
  queryRewrite: {
    normalizedQuery: string;
    searchQuery: string;
    expansions: string[];
    reasons: string[];
  };
  documentTitleIntent: boolean;
  comparisonIntent: boolean;
  freshnessNeed: boolean;
  needsVisualEvidence: boolean;
  needsSynthesis: boolean;
  needsClassifierFallback: boolean;
};

export type RelatedDocument = {
  document_id: string;
  title: string;
  file_name: string;
  labels: DocumentLabel[];
  summary: string | null;
  best_pages: number[];
  best_chunk_ids: string[];
  image_count: number;
  table_count?: number;
  /** Non-searchable first-page cover image id for search-card thumbnails. */
  cover_image_id?: string | null;
  match_reason: string;
  score: number;
};

export type DocumentMatch = {
  document_id: string;
  title: string;
  file_name: string;
  labels: DocumentLabel[];
  summarySnippet: string | null;
  bestPages: number[];
  bestChunkIds: string[];
  imageCount: number;
  tableCount: number;
  /** Non-searchable first-page cover image id for search-card thumbnails. */
  coverImageId?: string | null;
  matchReason: string;
  score: number;
  relevance?: SourceEvidenceRelevance;
};

export type DocumentBreakdown = {
  document_id: string;
  title: string;
  file_name: string;
  top_similarity: number;
  source_strength: SourceStrength;
  source_count: number;
  quote_count: number;
  pages: number[];
  best_quote?: string;
};

export type BestSourceRecommendation = Citation & {
  source_strength: SourceStrength;
  score: number;
  snippet: string;
  quote?: string;
  section_heading: string | null;
  image_count: number;
  viewer_href: string;
  relevance?: SourceEvidenceRelevance;
};

export type EvidenceSummary = {
  document_count: number;
  total_sources: number;
  quote_count: number;
  image_count: number;
  source_strength: SourceStrength | "none";
  summary: string;
};

export type SourceCoverage = {
  documents_used: number;
  pages: number[];
  strongest_similarity: number;
  has_images: boolean;
};

export type ConflictOrGap = {
  type: "gap" | "conflict";
  message: string;
  source_chunk_ids?: string[];
};

export type AnswerSectionKind =
  | "bottom_line"
  | "required_actions"
  | "monitoring_timing"
  | "medication_dose"
  | "thresholds"
  | "escalation_risk"
  | "contraindications_cautions"
  | "comparison"
  | "documentation"
  | "source_gap"
  | "source_conflict"
  | "visual_evidence"
  | "quotes"
  | "verification";

export type AnswerSectionSupportLevel = "direct" | "partial" | "nearby" | "unsupported";

export type AnswerSection = {
  heading: string;
  body: string;
  citation_chunk_ids: string[];
  kind?: AnswerSectionKind;
  supportLevel?: AnswerSectionSupportLevel;
};

export type OpenAITokenUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cached_input_tokens?: number;
  cache_write_tokens?: number;
  reasoning_output_tokens?: number;
};

export type SmartPanel = {
  query: string;
  total_sources: number;
  documents: DocumentBreakdown[];
  quotes: QuoteCard[];
  visualEvidence: VisualEvidenceCard[];
  bestSource?: BestSourceRecommendation | null;
  image_count: number;
  evidenceSummary: EvidenceSummary;
  sourceCoverage: SourceCoverage;
  conflictsOrGaps: ConflictOrGap[];
  relatedDocuments?: RelatedDocument[];
  relevance?: EvidenceRelevance;
};

export type SmartRagSourceLink = {
  id: string;
  label: string;
  href: string;
  document_id: string;
  chunk_id: string;
  title: string;
  file_name: string;
  page_number: number | null;
  source_strength: SourceStrength;
  reason: string;
  snippet: string;
};

export type SmartRagAnswerPlan = {
  intent: "clinical_synthesis" | "source_lookup" | "document_lookup" | "unsupported";
  queryClass: RagQueryClass;
  routeMode: "unsupported" | "extractive" | "fast" | "strong";
  modelStrategy: "fast_model_then_quality_gate" | "strong_model_then_quality_gate" | "extractive_lookup" | "source_gap";
  retrievalQuality: "strong" | "partial" | "weak" | "conflicting";
  retrievalIntent: RetrievalIntent;
  sourceSelection: RetrievalSelectionSummary;
  qualityCriteria: string[];
  fallbackBehavior: "retry_strong_then_source_gap" | "source_gap" | "extractive_lookup_only";
  sourcePolicy: "required_citations" | "nearby_sources_allowed" | "exact_source_links";
};

/** Adaptive generation only: enrich after actual packed coverage exists, behind its rollout gate. */
export type AdaptiveSmartRagAnswerPlan = SmartRagAnswerPlan & { adaptiveAnswer: AdaptiveAnswerPlan };

export type SmartRagApiPlan = {
  query: string;
  queryClass: RagQueryClass;
  intent:
    | "find_document"
    | "find_threshold_or_table"
    | "medication_or_risk_answer"
    | "compare_sources"
    | "summarize_sources"
    | "general_or_unsupported";
  responseMode:
    | "document_lookup"
    | "extractive_answer"
    | "fast_grounded_answer"
    | "strong_synthesis"
    | "multi_document_synthesis"
    | "unsupported";
  retrievalStrategy:
    | "search_cache"
    | "text_fast_path"
    | "document_lookup_fast_path"
    | "hybrid"
    | "vector_fallback"
    | "unsupported_short_circuit"
    | "unknown";
  latencyPlan: "cache_or_text_first" | "balanced_hybrid" | "strong_generation" | "no_supported_answer";
  answerFocus: string;
  answerPlan: SmartRagAnswerPlan;
  displayMode: AnswerResponseMode;
  sourceLinkCount: number;
  coreSourceLinks: SmartRagSourceLink[];
  streamPlan: string[];
};

export type AnswerResponseMode =
  "checklist" | "comparison_matrix" | "threshold_table" | "clinical_pathway" | "document_lookup" | "evidence_gap";

export type ComparisonEvaluationState = "evaluated" | "not_evaluated";

export type ComparisonMatrixEntry = {
  documentId: string;
  chunkIds: string[];
  value: string | null;
  qualifiers: string[];
};

export type ComparisonMatrixRow = {
  parameter: string;
  entries: ComparisonMatrixEntry[];
  status: "agreement" | "conflict" | "missing";
};

export type ComparisonMatrix = {
  documents: Array<{
    documentId: string;
    title: string;
    fileName: string;
  }>;
  rows: ComparisonMatrixRow[];
};

export type RagAnswer = {
  /** Final server-selected adaptive contract; absent for legacy payloads. */
  answerContractVersion?: "clinical-rag-answer-v20";
  renderAdaptiveAnswer?: boolean;
  /** Server-only allowlisted coverage accounting; no query/source/reviewer identifiers. */
  ragDiagnostics?: import("@/lib/rag/rag-eval-diagnostics").ContentFreeRagDiagnostics;
  /** Server-only programme diagnostics; excluded from the public answer DTO. */
  generationDegradation?: import("@/lib/rag/rag-generation-degradation").RagGenerationDegradationRecord;
  interactionId?: string;
  feedbackToken?: string;
  answer: string;
  grounded: boolean;
  confidence: "high" | "medium" | "low" | "unsupported";
  citations: Citation[];
  sources: SearchResult[];
  supportedClaims?: SupportedClaim[];
  evidenceAssessments?: Record<string, EvidenceAssessment>;
  retrievalDiagnostics?: RetrievalDiagnostics;
  /** Bounded browser-safe projection of retrievalDiagnostics.gateStatus. */
  retrievalGateBlocked?: boolean;
  /** Server-derived browser-safe trust cap. Never carries claim, chunk, document, or assessment identities. */
  authorityTrustCapRequired?: boolean;
  /**
   * Server-derived, label-only cap on the words "Strong support" (#WGMB4Z). Never changes render
   * trust or caps. Absent on payloads stored before it existed, which then keep the old label.
   */
  strongSupportLabelCapped?: boolean;
  modelUsed?: string | null;
  routingMode?: "unsupported" | "extractive" | "fast" | "strong";
  routingReason?: string;
  // Provider/quality signalling for the answer. providerMode reflects how the answer was produced
  // (full OpenAI vs source-only); answerQualityTier and fallbackReason let the UI show a clear
  // "source-only — may be lower quality, verify against cited passages" disclosure.
  providerMode?: "auto" | "openai" | "offline";
  answerQualityTier?: "model_synthesis" | "source_only" | "cached";
  fallbackReasonCode?: RagFallbackReasonCode | null;
  fallbackReason?: string | null;
  degradedMode?: {
    active: boolean;
    reason?: string | null;
  };
  queryClass?: RagQueryClass;
  queryAnalysis?: ClinicalQueryAnalysis;
  responseMode?: AnswerResponseMode;
  comparisonMatrix?: ComparisonMatrix;
  comparisonEvaluationState?: ComparisonEvaluationState;
  // True for deterministic, template-built answers (document-support lists, table/visual
  // source references) assembled from source metadata rather than model prose. These are
  // well-formed by construction, so the clinical-prose sanitizer/quality gate — which would
  // strip their document names (facility codes read as non-prose) — must be skipped.
  preformatted?: boolean;
  // True when this answer is the source-backed review fallback pointer (ledger #ZK460W): a
  // deterministic ungrounded/unsupported review-only citation stub, not model prose. Prefer
  // this explicit flag over routingReason string matching + empty-sections side-conditions.
  sourceBackedReviewFallback?: boolean;
  latencyTimings?: {
    search_cache_hit?: boolean;
    shared_cache_hit?: boolean;
    shared_cache_status?: "hit" | "miss";
    shared_cache_miss_reason?: string | null;
    text_fast_path_latency_ms?: number;
    text_candidate_budget?: number;
    text_candidate_count?: number;
    text_fast_path_reason?: string | null;
    embedding_skipped?: boolean;
    embedding_skip_reason?: string | null;
    embedding_latency_ms?: number;
    embedding_cache_hit?: boolean;
    /** True when this retrieval initiated an embedding warm-up flight. */
    embedding_prefetched?: boolean;
    vector_candidate_count?: number;
    embedding_field_count?: number;
    retrieval_query_variant_count?: number;
    supabase_rpc_latency_ms?: number;
    rerank_latency_ms?: number;
    second_stage_rerank_used?: boolean;
    second_stage_rerank_latency_ms?: number;
    context_pack_latency_ms?: number;
    context_pack_cache_hits?: number;
    answer_retry_count?: number;
    answer_retry_reasons?: string[];
    /** Server-only bounded observation that any provider generation result was truncated. */
    provider_generation_truncated?: boolean;
    /** Cache-version refresh plus answer-cache lookups before retrieval starts. These run
     * inside the route budget but outside every retrieval phase timer. Additive. */
    pre_retrieval_latency_ms?: number;
    retrieval_latency_ms?: number;
    routing_latency_ms?: number;
    search_latency_ms?: number;
    generation_latency_ms?: number;
    verification_latency_ms?: number;
    route_budget_ms?: number;
    route_deadline_exceeded?: boolean;
    /** Pre-answer work (dominated by retrieval) consumed the entire route budget before
     * generation could start. Additive; optional for mixed-version telemetry compat. */
    route_budget_exhausted_by_retrieval?: boolean;
    total_latency_ms?: number;
  };
  openAIRequestIds?: string[];
  openAIUsage?: OpenAITokenUsage;
  answerSections?: AnswerSection[];
  evidenceSummary?: EvidenceSummary;
  conflictsOrGaps?: ConflictOrGap[];
  sourceCoverage?: SourceCoverage;
  quoteCards?: QuoteCard[];
  visualEvidence?: VisualEvidenceCard[];
  bestSource?: BestSourceRecommendation | null;
  documentBreakdown?: DocumentBreakdown[];
  smartPanel?: SmartPanel;
  relatedDocuments?: RelatedDocument[];
  relevance?: EvidenceRelevance;
  memoryCardsUsed?: DocumentMemoryCard[];
  indexingVersion?: RagIndexingVersion | null;
  indexingQuality?: DocumentIndexQuality;
  smartApiPlan?: SmartRagApiPlan;
  scoreExplanations?: Array<{
    chunk_id: string;
    document_id: string;
    finalScore: number;
    score_explanation?: SearchScoreExplanation;
  }>;
  scope?: SearchScopeSummary;
  sourceGovernanceWarnings?: SourceGovernanceWarning[];
  /** Server-derived safety findings. Browser payloads use these bounded
   * findings instead of scanning full source chunks client-side. */
  safetyWarnings?: SafetyWarning[];
  // GEN-C1: set when the model output was cut off (status="incomplete" /
  // max_output_tokens). The clinical content may be missing a dose/threshold, so
  // the UI must surface "answer truncated — verify against sources".
  truncated?: boolean;
  truncationReason?: string;
  // GEN-C2/H2: post-generation faithfulness verification. Lists numeric/dose/threshold
  // tokens asserted in the answer that could not be found verbatim in any cited chunk.
  // When non-empty the answer should be treated as needing source verification.
  unverifiedNumericTokens?: string[];
  faithfulnessWarning?: string;
  // Debug-only: when a final quality gate rejects a candidate's answer prose and replaces
  // `answer` with an evidence-gap response, this preserves the pre-replacement candidate text
  // so eval tooling (scripts/eval-quality.ts) can show what was actually rejected instead of
  // only the generic fallback text the user was shown. Never read by product/UI code and never
  // influences routing, scoring, or the delivered answer.
  rejectedCandidateText?: string;
};

export type ExtractedPage = {
  metadata?: Record<string, unknown> & {
    source_provenance?:
      DocxPageSourceProvenance | PdfPageSourceProvenance | TextPageSourceProvenance | XlsxPageSourceProvenance;
  };
  pageNumber: number;
  text: string;
  ocrUsed?: boolean;
  // IDX-H3: set when a page has image content but the extractor produced below-threshold
  // text (e.g. the JS fallback can't OCR scanned PDFs). Surfaced in index_quality so a
  // scanned guideline is never silently treated as a healthy, fully-indexed document.
  needsOcr?: boolean;
};

export type ExtractedImage = {
  pageNumber: number | null;
  path: string;
  mimeType: string;
  bbox?: [number, number, number, number] | null;
  width?: number | null;
  height?: number | null;
  sourceKind?: "embedded" | "table_crop" | "diagram_crop" | "page_region" | "fallback" | "cover_page";
  metadata?: Record<string, unknown>;
};

export type ExtractionProvenance = {
  name: string;
  version: string;
  pymupdf?: string;
  tableStrategy?: string;
};

export type ExtractedDocument = {
  pages: ExtractedPage[];
  images: ExtractedImage[];
  warnings?: string[];
  temporaryPaths?: string[];
  /** Which reader produced this output (audit F04). Absent for extractors that do not report it. */
  extractor?: ExtractionProvenance;
  budgetUsage?: {
    pages: number;
    artifacts: number;
    artifactBytes: number;
    textBytes: number;
  };
};

export type ChunkInput = {
  documentId: string;
  pageNumber: number | null;
  pageText: string;
  images?: Array<{
    id: string;
    caption: string;
    pageNumber: number | null;
    imageType?: ImageEvidenceCategory;
    sourceKind?: string | null;
    labels?: string[];
    tableLabel?: string | null;
    tableTitle?: string | null;
    tableRole?: string | null;
    tableTextSnippet?: string | null;
    accessibleTableMarkdown?: string | null;
    tableRows?: string[][] | null;
    tableColumns?: string[] | null;
  }>;
  metadata?: Record<string, unknown>;
};

export type DocumentChunk = {
  document_id: string;
  page_number: number | null;
  chunk_index: number;
  section_heading: string | null;
  section_path?: string[];
  heading_level?: number | null;
  parent_heading?: string | null;
  anchor_id?: string | null;
  content: string;
  retrieval_synopsis?: string;
  token_estimate: number;
  image_ids: string[];
  metadata: Record<string, unknown>;
};
