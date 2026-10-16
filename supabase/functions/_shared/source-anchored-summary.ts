export const SOURCE_ANCHORED_SUMMARY_VERSION = "source-anchored-summary-v1" as const;
export const SOURCE_ANCHORED_SUMMARY_METADATA_KEY = "source_anchored_summary_v1" as const;
export const SOURCE_ANCHORED_SUMMARY_PROJECTION_COMPLETE_KEY =
  "source_anchored_summary_projection_complete_v1" as const;
export const SOURCE_ANCHORED_HEURISTIC_MODEL = "deterministic-source-coverage-heuristic" as const;
export const SOURCE_ANCHORED_HEURISTIC_MODEL_VERSION = SOURCE_ANCHORED_SUMMARY_VERSION;
export const SOURCE_ANCHORED_STRUCTURED_MODEL_VERSION = "rag-deep-memory-v1" as const;
export const SOURCE_ANCHORED_SOURCE_PAGE_SIZE = 1000;
export const SOURCE_ANCHORED_MAX_CHUNKS = 5000;
export const SOURCE_ANCHORED_MAX_IMAGES = 1000;
export const SOURCE_ANCHORED_MAX_PROMPT_IMAGES = 64;
export const SOURCE_ANCHORED_FALLBACK_MESSAGE =
  "A deterministic source-only fallback is available; inspect the anchored source evidence before clinical use." as const;

export type SourceAnchoredSummaryProfileItem = Readonly<{
  text: string;
  source_chunk_ids: readonly string[];
  source_image_ids: readonly string[];
  pages: readonly number[];
  evidence_type: "text" | "table" | "image" | "mixed" | "metadata";
  support: "direct" | "partial" | "not_found";
}>;

export type SourceAnchoredClinicalProfile = Readonly<{
  overview: string;
  applies_to: readonly SourceAnchoredSummaryProfileItem[];
  key_clinical_actions: readonly SourceAnchoredSummaryProfileItem[];
  medication_dose_monitoring: readonly SourceAnchoredSummaryProfileItem[];
  thresholds_timing: readonly SourceAnchoredSummaryProfileItem[];
  escalation_risk_warnings: readonly SourceAnchoredSummaryProfileItem[];
  required_forms_documentation: readonly SourceAnchoredSummaryProfileItem[];
  not_covered: readonly SourceAnchoredSummaryProfileItem[];
  important_tables_images: readonly SourceAnchoredSummaryProfileItem[];
  best_questions: readonly SourceAnchoredSummaryProfileItem[];
  source_quality_notes: readonly SourceAnchoredSummaryProfileItem[];
}>;

export type SourceAnchoredSummaryLabelType =
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

export type SourceAnchoredSummaryPayload = Readonly<{
  summary_kind: "structured" | "heuristic_fallback";
  summary_version: "source-anchored-summary-v1";
  document_id: string;
  index_generation_id: string;
  model: string;
  model_version: string;
  generated_at: string;
  source_chunk_ids: readonly string[];
  source_image_ids: readonly string[];
  summary: string;
  clinical_specifics: Readonly<{
    profile: SourceAnchoredClinicalProfile;
    actions: readonly string[];
    thresholds_timing: readonly string[];
    medication_monitoring: readonly string[];
    risk_escalation: readonly string[];
    documentation_forms: readonly string[];
    exceptions_gaps: readonly string[];
  }>;
  labels: readonly Readonly<{
    label: string;
    label_type: SourceAnchoredSummaryLabelType;
    confidence: number;
  }>[];
  heuristic_fallback: boolean;
}>;

export type SourceAnchoredSummarySourceRow = Readonly<{
  id: string;
  page_number: number | null;
  index_generation_id?: string | null;
}>;

export type SourceAnchoredSummaryAuthority = Readonly<{
  documentId: string;
  indexGenerationId: string | null;
  expectedStructuredModel: string;
  expectedStructuredModelVersion: string;
  selectedChunks: readonly SourceAnchoredSummarySourceRow[];
  selectedImages: readonly SourceAnchoredSummarySourceRow[];
}>;

export type ProjectedSourceAnchoredLabel = Readonly<{
  label: string;
  label_type: SourceAnchoredSummaryLabelType;
  confidence: number;
  source_chunk_ids: readonly string[];
  source_image_ids: readonly string[];
  pages: readonly number[];
}>;

export const SOURCE_ANCHORED_PROFILE_KEYS = [
  "applies_to",
  "key_clinical_actions",
  "medication_dose_monitoring",
  "thresholds_timing",
  "escalation_risk_warnings",
  "required_forms_documentation",
  "not_covered",
  "important_tables_images",
  "best_questions",
  "source_quality_notes",
] as const;

const CLAIM_PROJECTION_KEYS = [
  "applies_to",
  "key_clinical_actions",
  "medication_dose_monitoring",
  "thresholds_timing",
  "escalation_risk_warnings",
  "required_forms_documentation",
  "important_tables_images",
] as const;
const EVIDENCE_TYPES = new Set(["text", "table", "image", "mixed", "metadata"]);
const SUPPORT_LEVELS = new Set(["direct", "partial", "not_found"]);
const LABEL_TYPES = new Set<SourceAnchoredSummaryLabelType>([
  "site",
  "topic",
  "document_type",
  "medication",
  "risk",
  "setting",
  "workflow",
  "population",
  "service",
  "clinical_action",
  "care_phase",
  "document_intent",
  "content_feature",
  "custom",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NOT_FOUND_PREFIX = "Not established by selected source evidence:";

function fail(code: string): never {
  throw new Error(code);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function canonicalUuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) fail(code);
  return value;
}

export function requireSourceAnchoredSummaryGeneration(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    fail("source_anchored_summary_requires_active_generation");
  }
  return canonicalUuid(value, "source_anchored_summary_requires_active_generation");
}

export function requireExactSourceAnchoredGeneration(typedGeneration: unknown, metadata: unknown): string {
  const generation = requireSourceAnchoredSummaryGeneration(typedGeneration);
  const raw = record(metadata, "source_anchored_summary_requires_active_generation").index_generation_id;
  if (raw !== generation) fail("source_anchored_summary_requires_active_generation");
  return generation;
}

export function canonicalSourceAnchoredText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function boundedCanonicalText(value: unknown, code: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) fail(code);
  const canonical = canonicalSourceAnchoredText(value);
  if (!canonical || canonical !== value) fail(code);
  return value;
}

function exactIso(value: unknown): string {
  if (typeof value !== "string") fail("source_anchored_summary_generated_at_invalid");
  const time = new Date(value);
  if (!Number.isFinite(time.getTime()) || time.toISOString() !== value) {
    fail("source_anchored_summary_generated_at_invalid");
  }
  return value;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], code: string) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
}

function exactArray(value: unknown, code: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(code);
  return value;
}

function sameArray<T>(left: readonly T[], right: readonly T[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function exactCanonicalStringArray(value: unknown, code: string, max = 8): string[] {
  const source = exactArray(value, code, max);
  return source.map((item) => boundedCanonicalText(item, code, 600));
}

function sourcePages(rows: readonly SourceAnchoredSummarySourceRow[]) {
  return new Map(rows.map((row) => [row.id, row.page_number] as const));
}

function derivedPages(
  chunkIds: readonly string[],
  imageIds: readonly string[],
  chunkPages: ReadonlyMap<string, number | null>,
  imagePages: ReadonlyMap<string, number | null>,
) {
  return Array.from(
    new Set(
      [...chunkIds.map((id) => chunkPages.get(id)), ...imageIds.map((id) => imagePages.get(id))].filter(
        (page): page is number => Number.isInteger(page) && Number(page) > 0,
      ),
    ),
  ).sort((a, b) => a - b);
}

function validateAuthority(authority: SourceAnchoredSummaryAuthority) {
  const documentId = canonicalUuid(authority.documentId, "source_anchored_summary_document_id_invalid");
  const indexGenerationId = requireSourceAnchoredSummaryGeneration(authority.indexGenerationId);
  boundedCanonicalText(authority.expectedStructuredModel, "source_anchored_summary_model_invalid", 200);
  boundedCanonicalText(authority.expectedStructuredModelVersion, "source_anchored_summary_model_version_invalid", 200);
  if (authority.selectedChunks.length > 36 || authority.selectedImages.length > SOURCE_ANCHORED_MAX_PROMPT_IMAGES) {
    fail("source_anchored_summary_source_limit_exceeded");
  }
  if (authority.selectedChunks.length + authority.selectedImages.length === 0) {
    fail("source_anchored_summary_source_missing");
  }
  const seen = new Set<string>();
  for (const row of [...authority.selectedChunks, ...authority.selectedImages]) {
    canonicalUuid(row.id, "source_anchored_summary_source_id_invalid");
    if (seen.has(row.id)) fail("source_anchored_summary_source_duplicate");
    seen.add(row.id);
    if (row.index_generation_id !== undefined && row.index_generation_id !== indexGenerationId) {
      fail("source_anchored_summary_source_generation_mismatch");
    }
    if (row.page_number !== null && (!Number.isInteger(row.page_number) || row.page_number <= 0)) {
      fail("source_anchored_summary_source_page_invalid");
    }
  }
  return { documentId, indexGenerationId };
}

function validateIdArray(value: unknown, expected: readonly string[], code: string): string[] {
  const ids = exactArray(value, code, expected.length).map((id) => canonicalUuid(id, code));
  if (!sameArray(ids, expected)) fail(code);
  return ids;
}

function validateClaimIdArray(value: unknown, allowlist: readonly string[], code: string): string[] {
  const ids = exactArray(value, code, allowlist.length).map((id) => canonicalUuid(id, code));
  const seen = new Set<string>();
  let last = -1;
  for (const id of ids) {
    const index = allowlist.indexOf(id);
    if (index < 0 || index <= last || seen.has(id)) fail(code);
    last = index;
    seen.add(id);
  }
  return ids;
}

function validateProfileItem(args: {
  value: unknown;
  profileKey: (typeof SOURCE_ANCHORED_PROFILE_KEYS)[number];
  chunkIds: readonly string[];
  imageIds: readonly string[];
  chunkPages: ReadonlyMap<string, number | null>;
  imagePages: ReadonlyMap<string, number | null>;
}): SourceAnchoredSummaryProfileItem {
  const value = record(args.value, "source_anchored_summary_profile_item_invalid");
  exactKeys(
    value,
    ["text", "source_chunk_ids", "source_image_ids", "pages", "evidence_type", "support"],
    "source_anchored_summary_profile_item_invalid",
  );
  const text = boundedCanonicalText(value.text, "source_anchored_summary_profile_text_invalid", 600);
  const source_chunk_ids = validateClaimIdArray(
    value.source_chunk_ids,
    args.chunkIds,
    "source_anchored_summary_claim_chunk_invalid",
  );
  const source_image_ids = validateClaimIdArray(
    value.source_image_ids,
    args.imageIds,
    "source_anchored_summary_claim_image_invalid",
  );
  const evidence_type = value.evidence_type;
  const support = value.support;
  if (typeof evidence_type !== "string" || !EVIDENCE_TYPES.has(evidence_type)) {
    fail("source_anchored_summary_evidence_type_invalid");
  }
  if (typeof support !== "string" || !SUPPORT_LEVELS.has(support)) {
    fail("source_anchored_summary_support_invalid");
  }
  if (support !== "not_found" && source_chunk_ids.length + source_image_ids.length === 0) {
    fail("source_anchored_summary_claim_anchor_required");
  }
  if (support === "not_found") {
    if (args.profileKey !== "not_covered" && args.profileKey !== "source_quality_notes") {
      fail("source_anchored_summary_not_found_location_invalid");
    }
    if (!text.startsWith(NOT_FOUND_PREFIX)) fail("source_anchored_summary_not_found_text_invalid");
  }
  const expectedPages = derivedPages(source_chunk_ids, source_image_ids, args.chunkPages, args.imagePages);
  const pages = exactArray(value.pages, "source_anchored_summary_claim_pages_invalid", expectedPages.length);
  if (pages.some((page) => typeof page !== "number") || !sameArray(pages as number[], expectedPages)) {
    fail("source_anchored_summary_claim_pages_invalid");
  }
  return {
    text,
    source_chunk_ids,
    source_image_ids,
    pages: expectedPages,
    evidence_type: evidence_type as SourceAnchoredSummaryProfileItem["evidence_type"],
    support: support as SourceAnchoredSummaryProfileItem["support"],
  };
}

function validateProfile(
  value: unknown,
  chunkIds: readonly string[],
  imageIds: readonly string[],
  chunkPages: ReadonlyMap<string, number | null>,
  imagePages: ReadonlyMap<string, number | null>,
): SourceAnchoredClinicalProfile {
  const source = record(value, "source_anchored_summary_profile_invalid");
  exactKeys(source, ["overview", ...SOURCE_ANCHORED_PROFILE_KEYS], "source_anchored_summary_profile_invalid");
  const result: Record<string, unknown> = {
    overview: boundedCanonicalText(source.overview, "source_anchored_summary_profile_overview_invalid", 5000),
  };
  for (const key of SOURCE_ANCHORED_PROFILE_KEYS) {
    const max = key === "best_questions" ? 8 : 6;
    result[key] = exactArray(source[key], "source_anchored_summary_profile_array_invalid", max).map((item) =>
      validateProfileItem({ value: item, profileKey: key, chunkIds, imageIds, chunkPages, imagePages }),
    );
  }
  return result as SourceAnchoredClinicalProfile;
}

function projectedClaimItems(profile: SourceAnchoredClinicalProfile) {
  return CLAIM_PROJECTION_KEYS.flatMap((key) => profile[key]).filter(
    (item) => item.support !== "not_found" && item.source_chunk_ids.length + item.source_image_ids.length > 0,
  );
}

export function projectSourceAnchoredSummary(profile: SourceAnchoredClinicalProfile): string {
  // Both aggregate fields use canonical whitespace, just like the validated items.
  return projectedClaimItems(profile)
    .slice(0, 8)
    .map((item) => `- ${item.text}`)
    .join(" ");
}

function labelMatch(text: string, phrase: string) {
  const haystack = text.toLowerCase();
  let offset = haystack.indexOf(phrase);
  while (offset >= 0) {
    const before = offset === 0 ? "" : (Array.from(haystack.slice(0, offset)).at(-1) ?? "");
    const afterIndex = offset + phrase.length;
    const after = afterIndex >= haystack.length ? "" : (Array.from(haystack.slice(afterIndex))[0] ?? "");
    const boundary = (value: string) => !value || !/[\p{L}\p{N}]/u.test(value);
    if (boundary(before) && boundary(after)) return true;
    offset = haystack.indexOf(phrase, offset + 1);
  }
  return false;
}

function labelItems(profile: SourceAnchoredClinicalProfile) {
  return SOURCE_ANCHORED_PROFILE_KEYS.flatMap((key) => profile[key]).filter(
    (item) => item.support !== "not_found" && item.source_chunk_ids.length + item.source_image_ids.length > 0,
  );
}

export function projectSourceAnchoredLabels(payload: SourceAnchoredSummaryPayload): ProjectedSourceAnchoredLabel[] {
  const items = labelItems(payload.clinical_specifics.profile);
  return payload.labels.map((label) => {
    const match = items.find((item) => labelMatch(item.text, label.label));
    if (!match) fail("source_anchored_summary_label_unanchored");
    return {
      ...label,
      source_chunk_ids: [...match.source_chunk_ids],
      source_image_ids: [...match.source_image_ids],
      pages: [...match.pages],
    };
  });
}

function validateLabels(value: unknown, profile: SourceAnchoredClinicalProfile) {
  const source = exactArray(value, "source_anchored_summary_labels_invalid", 32);
  const labels: Array<{ label: string; label_type: SourceAnchoredSummaryLabelType; confidence: number }> = [];
  const seen = new Set<string>();
  const items = labelItems(profile);
  for (const item of source) {
    const raw = record(item, "source_anchored_summary_label_invalid");
    exactKeys(raw, ["label", "label_type", "confidence"], "source_anchored_summary_label_invalid");
    const original = boundedCanonicalText(raw.label, "source_anchored_summary_label_invalid", 120);
    const label = original.toLowerCase();
    if (label !== original) fail("source_anchored_summary_label_invalid");
    if (typeof raw.label_type !== "string" || !LABEL_TYPES.has(raw.label_type as SourceAnchoredSummaryLabelType)) {
      fail("source_anchored_summary_label_invalid");
    }
    if (typeof raw.confidence !== "number") fail("source_anchored_summary_label_invalid");
    const confidence = raw.confidence;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) fail("source_anchored_summary_label_invalid");
    const key = `${raw.label_type}\u0000${label}`;
    if (seen.has(key) || !items.some((profileItem) => labelMatch(profileItem.text, label))) {
      fail("source_anchored_summary_label_unanchored");
    }
    seen.add(key);
    labels.push({ label, label_type: raw.label_type as SourceAnchoredSummaryLabelType, confidence });
  }
  const sorted = [...labels].sort((a, b) => a.label_type.localeCompare(b.label_type) || a.label.localeCompare(b.label));
  if (labels.some((label, index) => label !== sorted[index])) fail("source_anchored_summary_labels_unsorted");
  return labels;
}

function exactProjection(actual: unknown, expected: readonly string[], code: string) {
  const value = exactCanonicalStringArray(actual, code, 8);
  if (!sameArray(value, expected)) fail(code);
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

export type PersistedSourceAnchoredSummaryProjection = Readonly<{
  summary?: unknown;
  clinical_specifics?: unknown;
  source_chunk_ids?: unknown;
  source_image_ids?: unknown;
  model?: unknown;
  generated_at?: unknown;
  metadata?: unknown;
}>;

function sameJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameJson(item, right[index]))
    );
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return sameArray(leftKeys, rightKeys) && leftKeys.every((key) => sameJson(leftRecord[key], rightRecord[key]));
}

function sameGeneratedAt(value: unknown, expected: string): boolean {
  if (value instanceof Date) return value.toISOString() === expected;
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === expected;
}

export function persistedSourceAnchoredSummaryProjectionMatches(
  persisted: PersistedSourceAnchoredSummaryProjection | null | undefined,
  payload: SourceAnchoredSummaryPayload,
): boolean {
  if (!persisted) return false;
  const metadata =
    persisted.metadata && typeof persisted.metadata === "object" && !Array.isArray(persisted.metadata)
      ? (persisted.metadata as Record<string, unknown>)
      : {};
  return (
    persisted.summary === payload.summary &&
    sameJson(persisted.clinical_specifics, payload.clinical_specifics) &&
    sameJson(persisted.source_chunk_ids, payload.source_chunk_ids) &&
    sameJson(persisted.source_image_ids, payload.source_image_ids) &&
    persisted.model === payload.model &&
    sameGeneratedAt(persisted.generated_at, payload.generated_at) &&
    sameJson(metadata[SOURCE_ANCHORED_SUMMARY_METADATA_KEY], payload) &&
    metadata[SOURCE_ANCHORED_SUMMARY_PROJECTION_COMPLETE_KEY] === true
  );
}

export function normalizeSourceAnchoredSummary(
  input: unknown,
  authority: SourceAnchoredSummaryAuthority,
): SourceAnchoredSummaryPayload {
  const expected = validateAuthority(authority);
  const raw = record(input, "source_anchored_summary_payload_invalid");
  exactKeys(
    raw,
    [
      "summary_kind",
      "summary_version",
      "document_id",
      "index_generation_id",
      "model",
      "model_version",
      "generated_at",
      "source_chunk_ids",
      "source_image_ids",
      "summary",
      "clinical_specifics",
      "labels",
      "heuristic_fallback",
    ],
    "source_anchored_summary_payload_invalid",
  );
  if (raw.summary_version !== SOURCE_ANCHORED_SUMMARY_VERSION) fail("source_anchored_summary_version_invalid");
  if (canonicalUuid(raw.document_id, "source_anchored_summary_document_id_invalid") !== expected.documentId) {
    fail("source_anchored_summary_document_mismatch");
  }
  if (
    canonicalUuid(raw.index_generation_id, "source_anchored_summary_generation_invalid") !== expected.indexGenerationId
  ) {
    fail("source_anchored_summary_generation_mismatch");
  }
  const source_chunk_ids = validateIdArray(
    raw.source_chunk_ids,
    authority.selectedChunks.map((row) => row.id),
    "source_anchored_summary_chunk_anchors_invalid",
  );
  const source_image_ids = validateIdArray(
    raw.source_image_ids,
    authority.selectedImages.map((row) => row.id),
    "source_anchored_summary_image_anchors_invalid",
  );
  if (source_chunk_ids.length + source_image_ids.length === 0) fail("source_anchored_summary_source_missing");
  const profileSource = record(raw.clinical_specifics, "source_anchored_summary_clinical_specifics_invalid");
  exactKeys(
    profileSource,
    [
      "profile",
      "actions",
      "thresholds_timing",
      "medication_monitoring",
      "risk_escalation",
      "documentation_forms",
      "exceptions_gaps",
    ],
    "source_anchored_summary_clinical_specifics_invalid",
  );
  const profile = validateProfile(
    profileSource.profile,
    source_chunk_ids,
    source_image_ids,
    sourcePages(authority.selectedChunks),
    sourcePages(authority.selectedImages),
  );
  const summary = boundedCanonicalText(raw.summary, "source_anchored_summary_text_invalid", 5000);
  const model = boundedCanonicalText(raw.model, "source_anchored_summary_model_invalid", 200);
  const model_version = boundedCanonicalText(raw.model_version, "source_anchored_summary_model_version_invalid", 200);
  const generated_at = exactIso(raw.generated_at);
  const heuristic = raw.summary_kind === "heuristic_fallback" && raw.heuristic_fallback === true;
  const structured = raw.summary_kind === "structured" && raw.heuristic_fallback === false;
  if (!heuristic && !structured) fail("source_anchored_summary_kind_invalid");

  const clinical_specifics = {
    profile,
    actions: exactProjection(
      profileSource.actions,
      profile.key_clinical_actions.map((item) => item.text),
      "source_anchored_summary_actions_projection_invalid",
    ),
    thresholds_timing: exactProjection(
      profileSource.thresholds_timing,
      profile.thresholds_timing.map((item) => item.text),
      "source_anchored_summary_thresholds_projection_invalid",
    ),
    medication_monitoring: exactProjection(
      profileSource.medication_monitoring,
      profile.medication_dose_monitoring.map((item) => item.text),
      "source_anchored_summary_medication_projection_invalid",
    ),
    risk_escalation: exactProjection(
      profileSource.risk_escalation,
      profile.escalation_risk_warnings.map((item) => item.text),
      "source_anchored_summary_risk_projection_invalid",
    ),
    documentation_forms: exactProjection(
      profileSource.documentation_forms,
      profile.required_forms_documentation.map((item) => item.text),
      "source_anchored_summary_documentation_projection_invalid",
    ),
    exceptions_gaps: exactProjection(
      profileSource.exceptions_gaps,
      profile.not_covered.map((item) => item.text),
      "source_anchored_summary_gaps_projection_invalid",
    ),
  };

  const labels = validateLabels(raw.labels, profile);
  if (structured) {
    if (model !== authority.expectedStructuredModel || model_version !== authority.expectedStructuredModelVersion) {
      fail("source_anchored_summary_structured_model_invalid");
    }
    const projection = projectSourceAnchoredSummary(profile);
    if (!projection || summary !== projection || profile.overview !== projection) {
      fail("source_anchored_summary_projection_invalid");
    }
  } else {
    if (model !== SOURCE_ANCHORED_HEURISTIC_MODEL || model_version !== SOURCE_ANCHORED_HEURISTIC_MODEL_VERSION) {
      fail("source_anchored_summary_fallback_model_invalid");
    }
    if (summary !== SOURCE_ANCHORED_FALLBACK_MESSAGE || profile.overview !== SOURCE_ANCHORED_FALLBACK_MESSAGE) {
      fail("source_anchored_summary_fallback_projection_invalid");
    }
    if (labels.length !== 0) fail("source_anchored_summary_fallback_labels_invalid");
    const note = profile.source_quality_notes;
    const expectedChunk = authority.selectedChunks[0];
    const expectedImage = expectedChunk ? undefined : authority.selectedImages[0];
    const expectedChunkIds = expectedChunk ? [expectedChunk.id] : [];
    const expectedImageIds = expectedImage ? [expectedImage.id] : [];
    const expectedPages = derivedPages(
      expectedChunkIds,
      expectedImageIds,
      sourcePages(authority.selectedChunks),
      sourcePages(authority.selectedImages),
    );
    if (
      note.length !== 1 ||
      note[0].text !== SOURCE_ANCHORED_FALLBACK_MESSAGE ||
      note[0].support !== "partial" ||
      note[0].evidence_type !== (expectedChunk ? "text" : "image") ||
      !sameArray(note[0].source_chunk_ids, expectedChunkIds) ||
      !sameArray(note[0].source_image_ids, expectedImageIds) ||
      !sameArray(note[0].pages, expectedPages) ||
      SOURCE_ANCHORED_PROFILE_KEYS.some((key) => key !== "source_quality_notes" && profile[key].length !== 0) ||
      Object.entries(clinical_specifics).some(
        ([key, value]) => key !== "profile" && Array.isArray(value) && value.length !== 0,
      )
    ) {
      fail("source_anchored_summary_fallback_projection_invalid");
    }
  }

  const payload: SourceAnchoredSummaryPayload = {
    summary_kind: raw.summary_kind as SourceAnchoredSummaryPayload["summary_kind"],
    summary_version: SOURCE_ANCHORED_SUMMARY_VERSION,
    document_id: expected.documentId,
    index_generation_id: expected.indexGenerationId,
    model,
    model_version,
    generated_at,
    source_chunk_ids: [...source_chunk_ids],
    source_image_ids: [...source_image_ids],
    summary,
    clinical_specifics,
    labels,
    heuristic_fallback: heuristic,
  };
  projectSourceAnchoredLabels(payload);
  return deepFreeze(payload);
}

export function buildSourceAnchoredFallbackPayload(
  authority: SourceAnchoredSummaryAuthority,
  options: Readonly<{ generatedAt?: string }> = {},
): SourceAnchoredSummaryPayload {
  const expected = validateAuthority(authority);
  const anchor = authority.selectedChunks[0] ?? authority.selectedImages[0];
  const chunk = authority.selectedChunks.length > 0;
  const item = {
    text: SOURCE_ANCHORED_FALLBACK_MESSAGE,
    source_chunk_ids: chunk ? [anchor.id] : [],
    source_image_ids: chunk ? [] : [anchor.id],
    pages: anchor.page_number && anchor.page_number > 0 ? [anchor.page_number] : [],
    evidence_type: chunk ? "text" : "image",
    support: "partial",
  } as const;
  const profile: SourceAnchoredClinicalProfile = {
    overview: SOURCE_ANCHORED_FALLBACK_MESSAGE,
    applies_to: [],
    key_clinical_actions: [],
    medication_dose_monitoring: [],
    thresholds_timing: [],
    escalation_risk_warnings: [],
    required_forms_documentation: [],
    not_covered: [],
    important_tables_images: [],
    best_questions: [],
    source_quality_notes: [item],
  };
  return normalizeSourceAnchoredSummary(
    {
      summary_kind: "heuristic_fallback",
      summary_version: SOURCE_ANCHORED_SUMMARY_VERSION,
      document_id: expected.documentId,
      index_generation_id: expected.indexGenerationId,
      model: SOURCE_ANCHORED_HEURISTIC_MODEL,
      model_version: SOURCE_ANCHORED_HEURISTIC_MODEL_VERSION,
      generated_at: options.generatedAt ?? new Date().toISOString(),
      source_chunk_ids: authority.selectedChunks.map((row) => row.id),
      source_image_ids: authority.selectedImages.map((row) => row.id),
      summary: SOURCE_ANCHORED_FALLBACK_MESSAGE,
      clinical_specifics: {
        profile,
        actions: [],
        thresholds_timing: [],
        medication_monitoring: [],
        risk_escalation: [],
        documentation_forms: [],
        exceptions_gaps: [],
      },
      labels: [],
      heuristic_fallback: true,
    },
    authority,
  );
}
