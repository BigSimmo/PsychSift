import { adaptiveAnswerLimits, answerWithinLimits } from "@/lib/rag/rag-answer-contract-limits";
import { normalizeClaimText } from "@/lib/answer-claim-marks";
import { primaryAnswerDisplayText } from "@/lib/answer-display-text";
import { ragAdaptiveAnswerPromptVersion } from "@/lib/rag/rag-versioning";
import {
  clientAnswerFieldsSchema,
  clientDocumentLabelSchema,
  type ClientAnswerFields,
} from "@/lib/answer-client-fields";
export type { ClientRelatedDocument } from "@/lib/answer-client-fields";
import { citationFromResult, documentCitationHref } from "@/lib/citations";
import { hasWaDocumentControlEndorsement } from "@/lib/clinical-validation-basis";
import { isRagFallbackReasonCode, publicDegradedReason } from "@/lib/rag/rag-fallback-reason";
import type {
  BestSourceRecommendation,
  Citation,
  ClinicalQueryMode,
  ClinicalSourceMetadata,
  DocumentLabel,
  DocumentMatch,
  QuoteCard,
  RagAnswer,
  SafetyWarning,
  SearchResult,
  SearchScopeSummary,
  SupportedClaim,
} from "@/lib/types";

export type ClientDocumentMatch = Omit<DocumentMatch, "labels"> & { labels: ClientDocumentLabel[] };

// Route-boundary trim of the answer payload. The retrieval pipeline carries
// full chunk text plus server-only context on every source (adjacent_context
// for generation packing, memory cards, table facts, index-unit matches,
// document summaries), but the client renders only a snippet
// (retrieval_synopsis ?? content) plus identity, scoring, governance, and
// label fields. Trimming at the route boundary — never inside rag.ts — keeps
// caches, generation inputs, and eval behavior byte-identical while cutting
// the final SSE/JSON event the user waits on after the prose has streamed.
//
// Ordering contract: source-governance/safety derivation and diagnostics consume
// the FULL answer and must run before this trim (both routes do). The browser
// receives only the same bounded snippet the source UI renders; explicit
// server-derived safetyWarnings preserve findings beyond that display window.

export const demoAnswerDisclosure = "Synthetic demo only: this is not clinical guidance.";

const clientSourceSnippetMaxChars = 900;

const sourceFieldPolicy = {
  id: "client",
  document_id: "client",
  title: "client",
  file_name: "client",
  page_number: "client",
  chunk_index: "client",
  section_heading: "client",
  section_path: "client",
  heading_level: "client",
  parent_heading: "client",
  anchor_id: "client",
  content: "client",
  retrieval_synopsis: "client",
  image_ids: "client",
  similarity: "client",
  corpus_scope: "server",
  site_content_domain: "server",
  context_pack_admission: "server",
  similarity_origin: "client",
  text_rank: "client",
  hybrid_score: "client",
  lexical_score: "client",
  rrf_score: "client",
  score_explanation: "server",
  source_strength: "client",
  source_metadata: "client",
  document_labels: "client",
  document_summary: "server",
  adjacent_context: "server",
  memory_cards: "server",
  memory_score: "server",
  relevance: "server",
  match_explanation: "server",
  table_facts: "server",
  index_unit: "server",
  indexing_quality: "server",
  images: "server",
} as const satisfies Record<keyof SearchResult, "client" | "server">;

const answerFieldPolicy = {
  answerContractVersion: "client",
  renderAdaptiveAnswer: "client",
  generationDegradation: "server",
  rejectedCandidateText: "server",
  ragDiagnostics: "server",
  interactionId: "server",
  feedbackToken: "server",
  answer: "client",
  grounded: "client",
  confidence: "client",
  citations: "client",
  sources: "client",
  supportedClaims: "server",
  evidenceAssessments: "server",
  retrievalDiagnostics: "server",
  retrievalGateBlocked: "client",
  authorityTrustCapRequired: "client",
  strongSupportLabelCapped: "client",
  modelUsed: "server",
  routingMode: "client",
  routingReason: "server",
  providerMode: "client",
  answerQualityTier: "client",
  fallbackReasonCode: "client",
  fallbackReason: "server",
  degradedMode: "server",
  queryClass: "client",
  queryAnalysis: "server",
  responseMode: "client",
  comparisonMatrix: "client",
  comparisonEvaluationState: "client",
  preformatted: "client",
  sourceBackedReviewFallback: "server",
  latencyTimings: "server",
  openAIRequestIds: "server",
  openAIUsage: "server",
  openAIUsageAttempts: "server",
  answerSections: "client",
  evidenceSummary: "client",
  conflictsOrGaps: "client",
  sourceCoverage: "client",
  quoteCards: "client",
  visualEvidence: "client",
  bestSource: "client",
  documentBreakdown: "client",
  smartPanel: "server",
  relatedDocuments: "client",
  relevance: "client",
  memoryCardsUsed: "server",
  indexingVersion: "server",
  indexingQuality: "server",
  smartApiPlan: "server",
  scoreExplanations: "server",
  scope: "client",
  sourceGovernanceWarnings: "client",
  safetyWarnings: "client",
  truncated: "client",
  truncationReason: "client",
  unverifiedNumericTokens: "client",
  faithfulnessWarning: "client",
} as const satisfies Record<keyof RagAnswer, "client" | "server">;

type ClientSourceMetadataKey =
  | "source_kind"
  | "registry_record_kind"
  | "registry_record_subkind"
  | "registry_record_slug"
  | "source_title"
  | "publisher"
  | "publisher_code"
  | "jurisdiction"
  | "version"
  | "publication_date"
  | "review_date"
  | "corpus_scope"
  | "source_role"
  | "content_mode"
  | "source_catalogue_key"
  | "source_policy_version"
  | "licence_policy"
  | "document_status"
  | "clinical_validation_status"
  | "extraction_quality";

/** Browser-safe provenance: no owner/reviewer/uploader ids, hashes, or evidence blobs. */
export type ClientSourceMetadata = Partial<Pick<ClinicalSourceMetadata, ClientSourceMetadataKey>>;

export type ClientDocumentLabel = Pick<DocumentLabel, "label" | "label_type" | "source" | "confidence">;

export type ClientCitation = Omit<Citation, "source_metadata"> & {
  source_metadata?: ClientSourceMetadata | null;
};

export type ClientQuoteCard = Omit<QuoteCard, "source_metadata"> & {
  source_metadata?: ClientSourceMetadata | null;
};

export type ClientBestSourceRecommendation = Omit<BestSourceRecommendation, "source_metadata" | "relevance"> & {
  source_metadata?: ClientSourceMetadata | null;
};

export type ClientSafetyWarning = Omit<SafetyWarning, "citation"> & {
  citation: ClientCitation;
};

type ClientSearchResultScalar = Pick<
  SearchResult,
  | "id"
  | "document_id"
  | "title"
  | "file_name"
  | "page_number"
  | "chunk_index"
  | "section_heading"
  | "section_path"
  | "heading_level"
  | "parent_heading"
  | "anchor_id"
  | "content"
  | "retrieval_synopsis"
  | "image_ids"
  | "similarity"
  | "similarity_origin"
  | "text_rank"
  | "hybrid_score"
  | "lexical_score"
  | "rrf_score"
  | "source_strength"
>;

export type ClientSearchResult = ClientSearchResultScalar & {
  source_metadata?: ClientSourceMetadata | null;
  document_labels?: ClientDocumentLabel[];
};

export type ClientSearchScopeSummary = Pick<
  SearchScopeSummary,
  "summary" | "activeFilterCount" | "matchedDocumentCount" | "warnings" | "queryMode"
>;

export type ClientDegradedMode = {
  active: boolean;
  reason?: string | null;
};

export type ClientRagAnswerPayload = ClientAnswerFields &
  Pick<RagAnswer, "answer" | "grounded" | "confidence" | "fallbackReasonCode"> & {
    citations: ClientCitation[];
    sources: ClientSearchResult[];
    quoteCards?: ClientQuoteCard[];
    bestSource?: ClientBestSourceRecommendation | null;
    safetyWarnings?: ClientSafetyWarning[];
    scope?: ClientSearchScopeSummary;
    degradedMode?: ClientDegradedMode;
    retrievalGateBlocked?: boolean;
    authorityTrustCapRequired?: boolean;
    strongSupportLabelCapped?: boolean;
  };

const scopeSummaryMaxChars = 300;
const scopeWarningMaxChars = 240;
const scopeWarningMaxCount = 5;
const clientMetadataTextMaxChars = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedClientText(value: unknown, maximum = clientMetadataTextMaxChars): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1).trimEnd()}…`;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function integerOrNull(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function enumValue<const Value extends string>(value: unknown, allowed: readonly Value[]): Value | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as Value) : undefined;
}

function sameProjection(input: unknown, projected: unknown, depth = 0): boolean {
  if (input === projected) return true;
  if (depth >= 12) return false;
  if (Array.isArray(input) && Array.isArray(projected)) {
    return (
      input.length <= 1_000 &&
      input.length === projected.length &&
      input.every((item, index) => sameProjection(item, projected[index], depth + 1))
    );
  }
  if (!isRecord(input) || !isRecord(projected)) return false;
  const keys = Object.keys(input).filter((key) => input[key] !== undefined);
  return (
    keys.length <= 1_000 &&
    keys.length === Object.keys(projected).filter((key) => projected[key] !== undefined).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(projected, key) && sameProjection(input[key], projected[key], depth + 1),
    )
  );
}

function nullableEnumValue<const Value extends string>(value: unknown, allowed: readonly Value[]) {
  return value === null ? null : enumValue(value, allowed);
}

/** Field-by-field recursive projection shared by every browser transport and restore path. */
export function projectClientSourceMetadata(value: unknown): ClientSourceMetadata | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const sourceKind = nullableEnumValue(value.source_kind, ["document", "registry_record"] as const);
  const registryRecordKind = nullableEnumValue(value.registry_record_kind, [
    "service",
    "form",
    "medication",
    "differential",
  ] as const);
  const corpusScope = nullableEnumValue(value.corpus_scope, [
    "uploaded_local",
    "clinical_kb_site",
    "australian_public",
    "international_supplementary",
  ] as const);
  const sourceRole = nullableEnumValue(value.source_role, [
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
  ] as const);
  const contentMode = nullableEnumValue(value.content_mode, ["indexed_content", "link_only"] as const);
  const licencePolicy = nullableEnumValue(value.licence_policy, [
    "review_required",
    "public_index_permitted",
    "metadata_link_only",
    "index_forbidden",
  ] as const);
  const documentStatus = enumValue(value.document_status, ["current", "review_due", "outdated", "unknown"] as const);
  const validationStatus = enumValue(value.clinical_validation_status, [
    "unverified",
    "locally_reviewed",
    "approved",
    "unknown",
  ] as const);
  const extractionQuality = enumValue(value.extraction_quality, ["good", "partial", "poor", "unknown"] as const);
  const text = (key: ClientSourceMetadataKey) => boundedClientText(value[key]);
  return {
    ...(sourceKind === undefined ? {} : { source_kind: sourceKind }),
    ...(registryRecordKind === undefined ? {} : { registry_record_kind: registryRecordKind }),
    ...(text("registry_record_subkind") === undefined
      ? {}
      : { registry_record_subkind: text("registry_record_subkind") }),
    ...(text("registry_record_slug") === undefined ? {} : { registry_record_slug: text("registry_record_slug") }),
    ...(text("source_title") === undefined ? {} : { source_title: text("source_title") }),
    ...(text("publisher") === undefined ? {} : { publisher: text("publisher") }),
    ...(text("publisher_code") === undefined ? {} : { publisher_code: text("publisher_code") }),
    ...(text("jurisdiction") === undefined ? {} : { jurisdiction: text("jurisdiction") }),
    ...(text("version") === undefined ? {} : { version: text("version") }),
    ...(text("publication_date") === undefined ? {} : { publication_date: text("publication_date") }),
    ...(text("review_date") === undefined ? {} : { review_date: text("review_date") }),
    ...(corpusScope === undefined ? {} : { corpus_scope: corpusScope }),
    ...(sourceRole === undefined ? {} : { source_role: sourceRole }),
    ...(contentMode === undefined ? {} : { content_mode: contentMode }),
    ...(text("source_catalogue_key") === undefined ? {} : { source_catalogue_key: text("source_catalogue_key") }),
    ...(text("source_policy_version") === undefined ? {} : { source_policy_version: text("source_policy_version") }),
    ...(licencePolicy === undefined ? {} : { licence_policy: licencePolicy }),
    ...(documentStatus === undefined ? {} : { document_status: documentStatus }),
    ...(validationStatus === undefined ? {} : { clinical_validation_status: validationStatus }),
    ...(extractionQuality === undefined ? {} : { extraction_quality: extractionQuality }),
  };
}

export function isClientSourceMetadata(value: unknown): value is ClientSourceMetadata | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  const projected = projectClientSourceMetadata(value);
  return isRecord(projected) && sameProjection(value, projected);
}

export function projectClientDocumentLabel(value: unknown): ClientDocumentLabel | null {
  if (!isRecord(value)) return null;
  const confidence = finiteNumber(value.confidence);
  const parsed = clientDocumentLabelSchema.safeParse({
    ...value,
    label: boundedClientText(value.label),
    confidence: confidence === undefined ? undefined : Math.max(0, Math.min(1, confidence)),
  });
  return parsed.success ? parsed.data : null;
}

function isClientDocumentLabel(value: unknown): value is ClientDocumentLabel {
  if (!isRecord(value)) return false;
  const projected = projectClientDocumentLabel(value);
  return Boolean(projected) && sameProjection(value, projected as unknown as Record<string, unknown>);
}

const clientSourceKeys = new Set(
  Object.entries(sourceFieldPolicy)
    .filter(([, policy]) => policy === "client")
    .map(([key]) => key),
);

export function projectClientSearchResult(value: unknown): ClientSearchResult | null {
  if (!isRecord(value)) return null;
  const id = boundedClientText(value.id);
  const documentId = boundedClientText(value.document_id);
  const title = boundedClientText(value.title, 1_000);
  const fileName = boundedClientText(value.file_name, 1_000);
  const pageNumber = integerOrNull(value.page_number);
  const chunkIndex = integerOrNull(value.chunk_index);
  const sectionHeading = boundedClientText(value.section_heading, 1_000);
  const similarity = finiteNumber(value.similarity);
  if (
    typeof id !== "string" ||
    typeof documentId !== "string" ||
    typeof title !== "string" ||
    typeof fileName !== "string" ||
    pageNumber === undefined ||
    chunkIndex == null ||
    sectionHeading === undefined ||
    similarity === undefined ||
    !Array.isArray(value.image_ids) ||
    !value.image_ids.every((item) => typeof item === "string")
  ) {
    return null;
  }
  const renderedSnippet =
    typeof value.retrieval_synopsis === "string"
      ? value.retrieval_synopsis.trim()
      : typeof value.content === "string"
        ? value.content.trim()
        : "";
  const content =
    renderedSnippet.length <= clientSourceSnippetMaxChars
      ? renderedSnippet
      : `${renderedSnippet.slice(0, clientSourceSnippetMaxChars - 1).trimEnd()}…`;
  const sectionPath =
    Array.isArray(value.section_path) && value.section_path.every((item) => typeof item === "string")
      ? value.section_path.slice(0, 100).map((item) => item.slice(0, clientMetadataTextMaxChars))
      : undefined;
  const sourceMetadata = projectClientSourceMetadata(value.source_metadata);
  const labels = Array.isArray(value.document_labels)
    ? value.document_labels
        .slice(0, 100)
        .map(projectClientDocumentLabel)
        .filter((label): label is ClientDocumentLabel => Boolean(label))
    : undefined;
  const similarityOrigin = enumValue(value.similarity_origin, [
    "cosine",
    "synthetic_text",
    "document_context",
  ] as const);
  const sourceStrength = enumValue(value.source_strength, ["strong", "moderate", "limited"] as const);
  const headingLevel = integerOrNull(value.heading_level);
  const parentHeading = boundedClientText(value.parent_heading, 1_000);
  const anchorId = boundedClientText(value.anchor_id, 1_000);
  const retrievalSynopsis = value.retrieval_synopsis == null ? undefined : content;
  const textRank = finiteNumber(value.text_rank);
  const hybridScore = finiteNumber(value.hybrid_score);
  const lexicalScore = value.lexical_score === null ? null : finiteNumber(value.lexical_score);
  const rrfScore = finiteNumber(value.rrf_score);
  return {
    id,
    document_id: documentId,
    title,
    file_name: fileName,
    page_number: pageNumber,
    chunk_index: chunkIndex,
    section_heading: sectionHeading,
    content,
    image_ids: value.image_ids.slice(0, 100).map((item) => item.slice(0, 500)),
    similarity,
    ...(sectionPath === undefined ? {} : { section_path: sectionPath }),
    ...(headingLevel === undefined ? {} : { heading_level: headingLevel }),
    ...(parentHeading === undefined ? {} : { parent_heading: parentHeading }),
    ...(anchorId === undefined ? {} : { anchor_id: anchorId }),
    ...(retrievalSynopsis === undefined ? {} : { retrieval_synopsis: retrievalSynopsis }),
    ...(similarityOrigin === undefined ? {} : { similarity_origin: similarityOrigin }),
    ...(textRank === undefined ? {} : { text_rank: textRank }),
    ...(hybridScore === undefined ? {} : { hybrid_score: hybridScore }),
    ...(lexicalScore === undefined ? {} : { lexical_score: lexicalScore }),
    ...(rrfScore === undefined ? {} : { rrf_score: rrfScore }),
    ...(sourceStrength === undefined ? {} : { source_strength: sourceStrength }),
    ...(sourceMetadata === undefined ? {} : { source_metadata: sourceMetadata }),
    ...(labels === undefined ? {} : { document_labels: labels }),
  };
}

export function isClientSearchResult(value: unknown): value is ClientSearchResult {
  if (!isRecord(value) || Object.keys(value).some((key) => !clientSourceKeys.has(key))) return false;
  if (value.source_metadata !== undefined && !isClientSourceMetadata(value.source_metadata)) return false;
  if (
    value.document_labels !== undefined &&
    (!Array.isArray(value.document_labels) || !value.document_labels.every(isClientDocumentLabel))
  )
    return false;
  const projected = projectClientSearchResult(value);
  return Boolean(projected) && sameProjection(value, projected as unknown as Record<string, unknown>);
}

const citationKeys = new Set([
  "chunk_id",
  "document_id",
  "title",
  "file_name",
  "page_number",
  "chunk_index",
  "similarity",
  "source_metadata",
  "provenance",
]);

export function projectClientCitation(value: unknown): ClientCitation | null {
  if (!isRecord(value)) return null;
  const chunkId = boundedClientText(value.chunk_id);
  const documentId = boundedClientText(value.document_id);
  const title = boundedClientText(value.title, 1_000);
  const fileName = boundedClientText(value.file_name, 1_000);
  const pageNumber = integerOrNull(value.page_number);
  const chunkIndex = integerOrNull(value.chunk_index);
  if (
    typeof chunkId !== "string" ||
    typeof documentId !== "string" ||
    typeof title !== "string" ||
    typeof fileName !== "string" ||
    pageNumber === undefined ||
    chunkIndex == null
  ) {
    return null;
  }
  const similarity = finiteNumber(value.similarity);
  const provenance = enumValue(value.provenance, [
    "model_selected",
    "section_selected",
    "exact_quote",
    "deterministic_support",
    "review_only",
    "retrieval_only",
  ] as const);
  const sourceMetadata = projectClientSourceMetadata(value.source_metadata);
  return {
    chunk_id: chunkId,
    document_id: documentId,
    title,
    file_name: fileName,
    page_number: pageNumber,
    chunk_index: chunkIndex,
    ...(similarity === undefined ? {} : { similarity }),
    ...(sourceMetadata === undefined ? {} : { source_metadata: sourceMetadata }),
    ...(provenance === undefined ? {} : { provenance }),
  };
}

export function isClientCitation(value: unknown): value is ClientCitation {
  if (!isRecord(value) || Object.keys(value).some((key) => !citationKeys.has(key))) return false;
  if (value.source_metadata !== undefined && !isClientSourceMetadata(value.source_metadata)) return false;
  const projected = projectClientCitation(value);
  return Boolean(projected) && sameProjection(value, projected as unknown as Record<string, unknown>);
}

export function projectClientQuoteCard(value: unknown): ClientQuoteCard | null {
  const citation = projectClientCitation(value);
  if (!citation || !isRecord(value)) return null;
  const quote = boundedClientText(value.quote, 4_000);
  const sectionHeading = boundedClientText(value.section_heading, 1_000);
  const sourceStrength = enumValue(value.source_strength, ["strong", "moderate", "limited"] as const);
  if (typeof quote !== "string" || sectionHeading === undefined) return null;
  return {
    ...citation,
    quote,
    section_heading: sectionHeading,
    ...(sourceStrength === undefined ? {} : { source_strength: sourceStrength }),
    ...(typeof value.isTruncated === "boolean" ? { isTruncated: value.isTruncated } : {}),
  };
}

export function projectClientBestSource(value: unknown): ClientBestSourceRecommendation | null {
  const citation = projectClientCitation(value);
  if (!citation || !isRecord(value)) return null;
  const sourceStrength = enumValue(value.source_strength, ["strong", "moderate", "limited"] as const);
  const score = finiteNumber(value.score);
  const snippet = boundedClientText(value.snippet, clientSourceSnippetMaxChars);
  const quote = boundedClientText(value.quote, 4_000);
  const sectionHeading = boundedClientText(value.section_heading, 1_000);
  const imageCount = integerOrNull(value.image_count);
  const viewerHref = boundedClientText(value.viewer_href, 2_000);
  if (
    sourceStrength == null ||
    score === undefined ||
    typeof snippet !== "string" ||
    sectionHeading === undefined ||
    imageCount == null ||
    typeof viewerHref !== "string"
  ) {
    return null;
  }
  return {
    ...citation,
    source_strength: sourceStrength,
    score,
    snippet,
    ...(typeof quote === "string" ? { quote } : {}),
    section_heading: sectionHeading,
    image_count: imageCount,
    viewer_href: viewerHref,
  };
}

export function projectClientSafetyWarning(value: unknown): ClientSafetyWarning | null {
  if (!isRecord(value)) return null;
  const id = boundedClientText(value.id);
  const kind = enumValue(value.kind, [
    "contraindication",
    "red_flag",
    "escalation",
    "dose_limit",
    "monitoring",
    "exclusion",
    "caveat",
  ] as const);
  const label = boundedClientText(value.label, 1_000);
  const warningText = boundedClientText(value.text, 4_000);
  const href = boundedClientText(value.href, 2_000);
  const citation = projectClientCitation(value.citation);
  if (
    typeof id !== "string" ||
    kind == null ||
    typeof label !== "string" ||
    typeof warningText !== "string" ||
    typeof href !== "string" ||
    !citation
  ) {
    return null;
  }
  return { id, kind, label, text: warningText, citation, href };
}

function isClientQuoteCard(value: unknown): value is ClientQuoteCard {
  if (!isRecord(value)) return false;
  const projected = projectClientQuoteCard(value);
  return Boolean(projected) && sameProjection(value, projected as unknown as Record<string, unknown>);
}

function isClientBestSource(value: unknown): value is ClientBestSourceRecommendation {
  if (!isRecord(value)) return false;
  const projected = projectClientBestSource(value);
  return Boolean(projected) && sameProjection(value, projected as unknown as Record<string, unknown>);
}

function isClientSafetyWarning(value: unknown): value is ClientSafetyWarning {
  if (!isRecord(value)) return false;
  const projected = projectClientSafetyWarning(value);
  return Boolean(projected) && sameProjection(value, projected as unknown as Record<string, unknown>);
}

const clientAnswerPassthroughKeys = Object.keys(clientAnswerFieldsSchema.shape);

const clientAnswerKeys = new Set([
  ...Object.entries(answerFieldPolicy)
    .filter(([, policy]) => policy === "client")
    .map(([key]) => key),
  // These server fields have explicit public projections or are accepted transport-envelope metadata.
  "degradedMode",
  "interactionId",
  "feedbackToken",
  "demoMode",
  "fallbackMode",
  ...clientAnswerPassthroughKeys,
]);

export function projectClientDegradedMode(value: unknown): ClientDegradedMode | undefined {
  if (!isRecord(value)) return undefined;
  const rawMode = isRecord(value.degradedMode) ? value.degradedMode : null;
  const fallbackReasonCode = isRagFallbackReasonCode(value.fallbackReasonCode) ? value.fallbackReasonCode : null;
  if (!rawMode && value.answerQualityTier !== "source_only" && fallbackReasonCode === null) return undefined;
  const active = rawMode?.active === true || value.answerQualityTier === "source_only" || fallbackReasonCode !== null;
  // Same source-count rule as the server (audit NEW-G-04): with no sources, never claim a
  // verified source-backed portion is shown.
  const sourceCount = Array.isArray(value.sources) ? value.sources.length : 0;
  return { active, reason: active ? publicDegradedReason(fallbackReasonCode ?? "unknown", sourceCount) : null };
}

/**
 * Runtime projection for untrusted SSE/storage values. In strict mode every
 * nested value must already be the canonical projection; non-strict restore
 * mode strips unknown fields and recomputes degradation copy.
 */
export function projectClientAnswerPayload(value: unknown, strict = false): ClientRagAnswerPayload | null {
  if (!isRecord(value)) return null;
  if (strict && Object.keys(value).some((key) => !clientAnswerKeys.has(key))) return null;
  if (
    typeof value.answer !== "string" ||
    value.answer.length > 200_000 ||
    typeof value.grounded !== "boolean" ||
    !["high", "medium", "low", "unsupported"].includes(String(value.confidence)) ||
    !Array.isArray(value.citations) ||
    !Array.isArray(value.sources) ||
    value.citations.length > 100 ||
    value.sources.length > 100
  ) {
    return null;
  }
  if (value.fallbackReasonCode != null && !isRagFallbackReasonCode(value.fallbackReasonCode)) return null;
  if (
    (value.retrievalGateBlocked !== undefined && typeof value.retrievalGateBlocked !== "boolean") ||
    (value.authorityTrustCapRequired !== undefined && typeof value.authorityTrustCapRequired !== "boolean") ||
    (value.strongSupportLabelCapped !== undefined && typeof value.strongSupportLabelCapped !== "boolean")
  )
    return null;
  if (strict && (!value.citations.every(isClientCitation) || !value.sources.every(isClientSearchResult))) return null;
  const citations = value.citations
    .map(projectClientCitation)
    .filter((citation): citation is ClientCitation => Boolean(citation));
  const sources = value.sources
    .map(projectClientSearchResult)
    .filter((source): source is ClientSearchResult => Boolean(source));
  if (strict && (citations.length !== value.citations.length || sources.length !== value.sources.length)) return null;

  if (
    (Array.isArray(value.quoteCards) && value.quoteCards.length > 100) ||
    (Array.isArray(value.safetyWarnings) && value.safetyWarnings.length > 100)
  )
    return null;
  const quoteCards = Array.isArray(value.quoteCards)
    ? value.quoteCards.map(projectClientQuoteCard).filter((quote): quote is ClientQuoteCard => Boolean(quote))
    : undefined;
  if (
    strict &&
    value.quoteCards !== undefined &&
    (!Array.isArray(value.quoteCards) || !value.quoteCards.every(isClientQuoteCard))
  ) {
    return null;
  }
  const bestSource = value.bestSource === null ? null : projectClientBestSource(value.bestSource);
  if (strict && value.bestSource !== undefined && value.bestSource !== null && !isClientBestSource(value.bestSource)) {
    return null;
  }
  const safetyWarnings = Array.isArray(value.safetyWarnings)
    ? value.safetyWarnings
        .map(projectClientSafetyWarning)
        .filter((warning): warning is ClientSafetyWarning => Boolean(warning))
    : undefined;
  if (
    strict &&
    value.safetyWarnings !== undefined &&
    (!Array.isArray(value.safetyWarnings) || !value.safetyWarnings.every(isClientSafetyWarning))
  ) {
    return null;
  }

  let scope: ClientSearchScopeSummary | undefined;
  if (isRecord(value.scope)) {
    const queryMode = [
      "auto",
      "monitoring_schedule",
      "dose_threshold_lookup",
      "contraindications_cautions",
      "escalation_criteria",
      "required_documentation",
      "compare_guidance",
    ].includes(String(value.scope.queryMode))
      ? (value.scope.queryMode as ClinicalQueryMode)
      : undefined;
    if (
      typeof value.scope.summary === "string" &&
      typeof value.scope.activeFilterCount === "number" &&
      (value.scope.matchedDocumentCount === null || typeof value.scope.matchedDocumentCount === "number") &&
      Array.isArray(value.scope.warnings)
    ) {
      scope = toClientSearchScopeSummary(
        {
          summary: value.scope.summary,
          activeFilterCount: value.scope.activeFilterCount,
          matchedDocumentCount: value.scope.matchedDocumentCount,
          warnings: value.scope.warnings.filter((warning): warning is string => typeof warning === "string"),
        },
        queryMode,
      );
    }
  }
  if (
    strict &&
    value.scope !== undefined &&
    (!scope || !isRecord(value.scope) || !sameProjection(value.scope, scope as unknown as Record<string, unknown>))
  ) {
    return null;
  }

  const fields = clientAnswerFieldsSchema.safeParse(value);
  if (!fields.success) return null;
  if (fields.data.claimMarks) {
    const sourceIds = new Set(sources.map((source) => source.id));
    const displayed = ` ${normalizeClaimText(primaryAnswerDisplayText(value.answer, { preformatted: Boolean(fields.data.preformatted && value.grounded) }))} `;
    const retained = fields.data.claimMarks.filter(
      (claim) =>
        claim.supportingChunkIds.length > 0 &&
        claim.supportingChunkIds.every((id) => sourceIds.has(id)) &&
        normalizeClaimText(claim.text).length > 0 &&
        displayed.includes(` ${normalizeClaimText(claim.text)} `),
    );
    if (strict && retained.length !== fields.data.claimMarks.length) return null;
    fields.data.claimMarks = retained;
  }
  if (fields.data.answerContractVersion === ragAdaptiveAnswerPromptVersion) {
    if (
      typeof fields.data.renderAdaptiveAnswer !== "boolean" ||
      !answerWithinLimits({ answer: value.answer, answerSections: fields.data.answerSections }, adaptiveAnswerLimits)
    )
      return null;
  } else if (fields.data.renderAdaptiveAnswer !== undefined) return null;

  if (strict && clientAnswerPassthroughKeys.some((key) => !sameProjection(value[key], Reflect.get(fields.data, key))))
    return null;
  const confidence = enumValue(value.confidence, ["high", "medium", "low", "unsupported"] as const);
  if (!confidence) return null;
  const projected: ClientRagAnswerPayload = {
    ...fields.data,
    answer: value.answer,
    grounded: value.grounded,
    confidence,
    citations,
    sources,
  };
  if (value.fallbackReasonCode === null || isRagFallbackReasonCode(value.fallbackReasonCode))
    projected.fallbackReasonCode = value.fallbackReasonCode;
  if (typeof value.retrievalGateBlocked === "boolean") projected.retrievalGateBlocked = value.retrievalGateBlocked;
  if (typeof value.authorityTrustCapRequired === "boolean") {
    projected.authorityTrustCapRequired = value.authorityTrustCapRequired;
  }
  if (typeof value.strongSupportLabelCapped === "boolean") {
    projected.strongSupportLabelCapped = value.strongSupportLabelCapped;
  }
  if (quoteCards !== undefined) projected.quoteCards = quoteCards;
  if (value.bestSource !== undefined) projected.bestSource = bestSource;
  if (safetyWarnings !== undefined) projected.safetyWarnings = safetyWarnings;
  if (scope) projected.scope = scope;
  const degradedMode = projectClientDegradedMode(value);
  if (
    strict &&
    value.degradedMode !== undefined &&
    (!isRecord(value.degradedMode) ||
      !degradedMode ||
      !sameProjection(value.degradedMode, degradedMode as unknown as Record<string, unknown>))
  ) {
    return null;
  }
  if (degradedMode) projected.degradedMode = degradedMode;
  return projected;
}

function boundedScopeText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1).trimEnd()}…`;
}

/** Allowlisted route/client projection. Resolved document ids and raw filters never cross this boundary. */
export function toClientSearchScopeSummary(
  scope: Pick<SearchScopeSummary, "summary" | "activeFilterCount" | "matchedDocumentCount" | "warnings">,
  queryMode?: ClinicalQueryMode,
): ClientSearchScopeSummary {
  const activeFilterCount = Number.isFinite(scope.activeFilterCount)
    ? Math.max(0, Math.min(1_000, Math.trunc(scope.activeFilterCount)))
    : 0;
  const matchedDocumentCount =
    scope.matchedDocumentCount == null || !Number.isFinite(scope.matchedDocumentCount)
      ? null
      : Math.max(0, Math.min(1_000_000, Math.trunc(scope.matchedDocumentCount)));
  return {
    summary: boundedScopeText(scope.summary, scopeSummaryMaxChars),
    activeFilterCount,
    matchedDocumentCount,
    warnings: (Array.isArray(scope.warnings) ? scope.warnings : [])
      .slice(0, scopeWarningMaxCount)
      .map((warning) => boundedScopeText(warning, scopeWarningMaxChars))
      .filter(Boolean),
    ...(queryMode === undefined ? {} : { queryMode }),
  };
}

/** Exported for the verified evidence preview (#100), which must cross the route
 * boundary through the exact same trim as the final payload — never a copy of it. */
export function trimSourceForClient(source: SearchResult): ClientSearchResult {
  const projected = projectClientSearchResult(source);
  if (!projected) throw new TypeError("Cannot project an invalid search result for the client.");
  return projected;
}

/**
 * Owner decision point (#JYH1FH, 2026-09-26; recommended option): a WA document-control
 * endorsement (`unverified` plus the `wa_document_control_endorsement` basis) is NOT reviewed
 * authority for the render-trust cap or the "Strong support" wording, so those treat it like any
 * unverified source. Setting this to `true` is the whole change if the owner decides otherwise.
 */
const WA_ENDORSEMENT_COUNTS_AS_REVIEWED_AUTHORITY: boolean = false;

/** Whether the chunk a claim rests on has reviewed authority (approved or locally reviewed). */
function chunkHasReviewedAuthority(answer: RagAnswer, chunkId: string): boolean {
  const authority = answer.evidenceAssessments?.[chunkId]?.authority;
  if (authority === "approved" || authority === "locally_reviewed") return true;
  if (!WA_ENDORSEMENT_COUNTS_AS_REVIEWED_AUTHORITY || authority !== "unverified") return false;
  const source = answer.sources.find((candidate) => candidate.id === chunkId);
  return hasWaDocumentControlEndorsement(source?.source_metadata);
}

/** True when every claim is directly supported, and every chunk it rests on has reviewed authority. */
function claimsHaveReviewedDirectSupport(answer: RagAnswer, claims: SupportedClaim[]): boolean {
  return claims.every(
    (claim) =>
      claim.supportStatus === "direct" &&
      claim.supportingChunkIds.length > 0 &&
      claim.supportingChunkIds.every((chunkId) => chunkHasReviewedAuthority(answer, chunkId)),
  );
}

/**
 * Render-trust cap: lowers trust to "medium", which also trims quote cards, related
 * documents, tables and source/row counts. Only high-risk claims are gated unless
 * NEXT_PUBLIC_RAG_TRUST_CAP_ALL_CLAIMS is exactly "true"; no gated claims means no cap.
 * The all-claims owner rule (#WGMB4Z) does NOT live here - see strongSupportLabelCapped.
 */
export function authorityTrustCapRequired(answer: RagAnswer): boolean {
  if (answer.authorityTrustCapRequired === true) return true;
  const capAllClaims = process.env.NEXT_PUBLIC_RAG_TRUST_CAP_ALL_CLAIMS === "true";
  const gatedClaims = capAllClaims
    ? (answer.supportedClaims ?? [])
    : (answer.supportedClaims ?? []).filter((claim) => claim.riskClass === "high_risk");
  if (gatedClaims.length === 0) return false;
  return !claimsHaveReviewedDirectSupport(answer, gatedClaims);
}

/**
 * Label-only cap on the words "Strong support" (#WGMB4Z, owner decisions 3, 10 and 17,
 * 2026-09-25). Every claim must be direct on approved or locally reviewed authority, and an
 * answer with no assessed claims is capped, so the displayed word says "Supported" at most.
 * It changes the word only: render trust, quote cards, related documents, tables, source
 * counts and styling stay with authorityTrustCapRequired. An explicit
 * NEXT_PUBLIC_RAG_TRUST_CAP_ALL_CLAIMS="false" opts out, so the word follows trust as before.
 */
function strongSupportLabelCapped(answer: RagAnswer): boolean {
  if (answer.strongSupportLabelCapped === true) return true;
  if (process.env.NEXT_PUBLIC_RAG_TRUST_CAP_ALL_CLAIMS === "false") return false;
  const claims = answer.supportedClaims ?? [];
  if (claims.length === 0) return true;
  return !claimsHaveReviewedDirectSupport(answer, claims);
}

function directSupportingBestSource(answer: RagAnswer): BestSourceRecommendation | null {
  const directlySupportingId = (answer.supportedClaims ?? [])
    .filter((claim) => claim.supportStatus === "direct")
    .flatMap((claim) => claim.supportingChunkIds)[0];
  const source = answer.sources.find((candidate) => candidate.id === directlySupportingId);
  if (!source) return null;
  const citation = citationFromResult(source, "deterministic_support");
  return {
    ...citation,
    source_strength: source.source_strength ?? "limited",
    score: source.hybrid_score ?? source.similarity,
    snippet: source.retrieval_synopsis ?? source.content,
    section_heading: source.section_heading,
    image_count: source.image_ids.length,
    viewer_href: documentCitationHref(citation),
  };
}

export function sourceCurrencyWarningForAnswer(answer: RagAnswer): "supporting" | "retrieved" | undefined {
  const materialIds = new Set(
    (answer.supportedClaims ?? [])
      .filter((claim) => claim.supportStatus === "direct")
      .flatMap((claim) => claim.supportingChunkIds),
  );
  const assessments = Object.entries(answer.evidenceAssessments ?? {});
  return assessments.some(([id, assessment]) => materialIds.has(id) && assessment.currency === "review_due")
    ? "supporting"
    : materialIds.size === 0 &&
        assessments.some(([, assessment]) => assessment.currency === "review_due" && assessment.relevance !== "none")
      ? "retrieved"
      : undefined;
}

/**
 * Audit NEW-G-03: no check reads the text of an AI-written gap or conflict note, so once an answer
 * is refused its notes are dropped too. Notes the system built from sources or checks stay.
 */
export function withoutModelNotesOnRefusal<
  T extends Pick<RagAnswer, "confidence" | "responseMode" | "conflictsOrGaps">,
>(answer: T): T {
  const refused = answer.confidence === "unsupported" || answer.responseMode === "evidence_gap";
  if (!refused || !answer.conflictsOrGaps?.some((item) => item.origin === "model")) return answer;
  return { ...answer, conflictsOrGaps: answer.conflictsOrGaps.filter((item) => item.origin !== "model") };
}

export function toClientAnswerPayload(answer: RagAnswer): ClientRagAnswerPayload {
  answer = withoutModelNotesOnRefusal(answer);
  const sourceCurrencyWarning = sourceCurrencyWarningForAnswer(answer);
  const claimMarks = answer.supportedClaims
    ?.filter((claim) => claim.supportStatus === "direct" || claim.supportStatus === "partial")
    .slice(0, 100)
    .map((claim) => ({
      claimId: claim.claimId,
      text: claim.text,
      supportStatus: claim.supportStatus,
      supportingChunkIds: claim.supportingChunkIds,
    }));
  const bestSource =
    answer.bestSource === undefined &&
    answer.answerQualityTier === "model_synthesis" &&
    answer.routingMode !== "extractive" &&
    answer.grounded &&
    answer.confidence !== "unsupported"
      ? (directSupportingBestSource(answer) ?? undefined)
      : answer.bestSource;
  const projected = projectClientAnswerPayload({
    ...answer,
    claimMarks,
    sourceCurrencyWarning,
    bestSource,
    retrievalGateBlocked: answer.retrievalGateBlocked === true || answer.retrievalDiagnostics?.gateStatus === "blocked",
    authorityTrustCapRequired: authorityTrustCapRequired(answer),
    strongSupportLabelCapped: strongSupportLabelCapped(answer),
    ...(answer.scope ? { scope: toClientSearchScopeSummary(answer.scope, answer.scope.queryMode) } : {}),
  });
  if (!projected) throw new TypeError("Cannot project an invalid answer for the client.");
  return projected;
}
