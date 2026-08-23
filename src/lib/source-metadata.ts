import {
  australianSourceByKey,
  australianSourcePolicyVersion,
  type SourceContentMode,
  type SourceLicencePolicy,
} from "@/lib/australian-source-catalogue";
import {
  catalogueDocumentIdentityCompatible,
  classifySourceAuthority,
  normalizeSourceAuthorityText,
  type SourceDesignation,
} from "@/lib/source-authority-registry";
import type {
  ClinicalSourceMetadata,
  ClinicalSourceMetadataInput,
  ClinicalSourceRole,
  SourceCorpusScope,
} from "@/lib/types";

const knownStatuses = new Set(["current", "review_due", "outdated", "unknown"]);
const knownValidation = new Set(["unverified", "locally_reviewed", "approved", "unknown"]);
const knownExtraction = new Set(["good", "partial", "poor", "unknown"]);
const knownSourceKinds = new Set(["document", "registry_record"]);
const knownRegistryRecordKinds = new Set(["service", "form", "medication", "differential"]);
const knownCorpusScopes = new Set<SourceCorpusScope>([
  "uploaded_local",
  "clinical_kb_site",
  "australian_public",
  "international_supplementary",
]);
const knownSourceRoles = new Set<ClinicalSourceRole>([
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
const knownContentModes = new Set<SourceContentMode>(["indexed_content", "link_only"]);
const knownLicencePolicies = new Set<SourceLicencePolicy>([
  "review_required",
  "public_index_permitted",
  "metadata_link_only",
  "index_forbidden",
]);
const knownChangeStates = new Set(["unchanged", "changed", "withdrawn", "superseded", "unknown"]);
const knownSourcePolicyVersions = new Set([australianSourcePolicyVersion]);
const compatibleNationalJurisdictions = new Set(
  ["Australia", "Australia/National", "Australia/Commonwealth", "Australian national", "Commonwealth of Australia"].map(
    normalizeSourceAuthorityText,
  ),
);

export type SourceMetadataDiagnosticReason = "unsupported_value" | "unsafe_or_invalid_format";

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// This module renders in the browser (the source badges are client components and
// ship in the standalone design-system bundle), so it must not pull in the
// server-oriented structured logger: that module reads `process.env`, which is a
// ReferenceError in a browser and unmounts the whole React tree. `field`/`reason`
// are fixed diagnostic vocabulary, never rejected values, secrets, or patient
// text, so the logger's redaction pass is not needed.
// Exported as an object so tests can spy on the seam the way they previously spied
// on `logger.warn`; the default implementation stays quiet under NODE_ENV=test.
export const sourceMetadataDiagnostics = {
  warn(field: string, reason: SourceMetadataDiagnosticReason) {
    if (typeof process !== "undefined" && process.env && process.env.NODE_ENV === "test") return;
    console.warn(JSON.stringify({ level: "warn", message: `source-metadata: rejected ${field}`, field, reason }));
  },
};

function enumOrDefault<T extends string | null>(value: unknown, allowed: Set<string>, fallback: T, field: string): T {
  if (typeof value === "string" && allowed.has(value)) return value as T;
  // A present-but-unrecognized string is a real data-entry defect (typo, renamed
  // enum, malformed ingest) that would otherwise collapse into the fallback and be
  // indistinguishable from a genuinely-absent value. Trace it so it is fixable.
  // Absent / null / empty values are the legitimate default and stay silent — they
  // are the common case and would drown the signal. The returned value is unchanged,
  // so this is observability only: no ranking/retrieval behaviour changes.
  if (typeof value === "string" && value.trim()) {
    sourceMetadataDiagnostics.warn(field, "unsupported_value");
  }
  return fallback;
}

function validatedStringOrNull(value: unknown, field: string, isValid: (candidate: string) => boolean) {
  const candidate = stringOrNull(value);
  if (!candidate) return null;
  if (isValid(candidate)) return candidate;
  sourceMetadataDiagnostics.warn(field, "unsafe_or_invalid_format");
  return null;
}

function isHttpsUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function isIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isIsoTimestamp(value: string) {
  const match =
    /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
      value,
    );
  return Boolean(match && isIsoDate(match[1]!) && !Number.isNaN(new Date(value).getTime()));
}

function isSha256(value: string) {
  return /^sha256:[a-f0-9]{64}$/i.test(value);
}

function hasExactCatalogueIdentity(value: Record<string, unknown>, sourceKind: string | null) {
  if (sourceKind === "registry_record") return false;
  const key = stringOrNull(value.source_catalogue_key);
  const publisherCode = stringOrNull(value.publisher_code);
  const jurisdiction = stringOrNull(value.jurisdiction);
  if (!key || !publisherCode || !jurisdiction) return false;
  const entry = australianSourceByKey(key);
  const publisher = stringOrNull(value.publisher);
  if (!entry || !publisher) return false;
  const normalizedJurisdiction = normalizeSourceAuthorityText(jurisdiction);
  const catalogueJurisdiction = normalizeSourceAuthorityText(entry.jurisdiction);
  const jurisdictionMatches =
    normalizedJurisdiction === catalogueJurisdiction ||
    (catalogueJurisdiction === normalizeSourceAuthorityText("Australia/National") &&
      compatibleNationalJurisdictions.has(normalizedJurisdiction));
  if (entry.contentMode === "link_only") {
    return Boolean(
      publisher &&
      publisherCode.toUpperCase() === entry.publisherCode.toUpperCase() &&
      normalizeSourceAuthorityText(publisher) === normalizeSourceAuthorityText(entry.publisher) &&
      jurisdictionMatches,
    );
  }
  return catalogueDocumentIdentityCompatible(entry, { publisherCode, publisher, jurisdiction });
}

function normalizedClinicalSourceMetadata(input: unknown): ClinicalSourceMetadata {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const sourceKind = enumOrDefault(value.source_kind, knownSourceKinds, null, "source_kind");
  const catalogueBound = hasExactCatalogueIdentity(value, sourceKind);
  const catalogueKey = stringOrNull(value.source_catalogue_key);
  const catalogueEntry = catalogueBound && catalogueKey ? australianSourceByKey(catalogueKey) : null;
  const protectedLinkOnlyPolicy = catalogueEntry?.contentMode === "link_only";
  const sourcePolicyVersion = catalogueBound
    ? enumOrDefault(value.source_policy_version, knownSourcePolicyVersions, null, "source_policy_version")
    : null;

  return {
    source_kind: sourceKind,
    registry_record_kind: enumOrDefault(
      value.registry_record_kind,
      knownRegistryRecordKinds,
      null,
      "registry_record_kind",
    ),
    registry_record_subkind: stringOrNull(value.registry_record_subkind),
    registry_record_id: stringOrNull(value.registry_record_id),
    registry_record_slug: stringOrNull(value.registry_record_slug),
    source_title: stringOrNull(value.source_title),
    publisher: stringOrNull(value.publisher),
    publisher_code: stringOrNull(value.publisher_code),
    jurisdiction: stringOrNull(value.jurisdiction),
    version: stringOrNull(value.version),
    publication_date: stringOrNull(value.publication_date),
    review_date: stringOrNull(value.review_date),
    uploaded_at: stringOrNull(value.uploaded_at),
    indexed_at: stringOrNull(value.indexed_at),
    uploaded_by: stringOrNull(value.uploaded_by),
    document_status: enumOrDefault(value.document_status, knownStatuses, "unknown", "document_status"),
    clinical_validation_status: enumOrDefault(
      value.clinical_validation_status,
      knownValidation,
      "unverified",
      "clinical_validation_status",
    ),
    extraction_quality: enumOrDefault(value.extraction_quality, knownExtraction, "unknown", "extraction_quality"),
    corpus_scope: enumOrDefault(value.corpus_scope, knownCorpusScopes, null, "corpus_scope"),
    source_role: enumOrDefault(value.source_role, knownSourceRoles, null, "source_role"),
    content_mode: protectedLinkOnlyPolicy
      ? "link_only"
      : catalogueBound
        ? enumOrDefault(value.content_mode, knownContentModes, null, "content_mode")
        : null,
    source_catalogue_key: catalogueBound ? stringOrNull(value.source_catalogue_key) : null,
    source_policy_version: sourcePolicyVersion,
    canonical_url: validatedStringOrNull(value.canonical_url, "canonical_url", isHttpsUrl),
    effective_date: validatedStringOrNull(value.effective_date, "effective_date", isIsoDate),
    expiry_date: validatedStringOrNull(value.expiry_date, "expiry_date", isIsoDate),
    supersedes_document_id: stringOrNull(value.supersedes_document_id),
    superseded_by_document_id: stringOrNull(value.superseded_by_document_id),
    retrieved_at: validatedStringOrNull(value.retrieved_at, "retrieved_at", isIsoTimestamp),
    content_hash: validatedStringOrNull(value.content_hash, "content_hash", isSha256),
    change_state: enumOrDefault(value.change_state, knownChangeStates, "unknown", "change_state"),
    licence_policy: protectedLinkOnlyPolicy
      ? "metadata_link_only"
      : catalogueBound
        ? enumOrDefault(value.licence_policy, knownLicencePolicies, null, "licence_policy")
        : null,
  };
}

export function normalizeSourceMetadata(input: unknown): ClinicalSourceMetadata {
  return normalizedClinicalSourceMetadata(input);
}

export function normalizeClinicalSourceMetadata(input: ClinicalSourceMetadataInput): ClinicalSourceMetadata {
  return normalizedClinicalSourceMetadata(input);
}

const GOVERNANCE_FIELDS = ["document_status", "clinical_validation_status", "extraction_quality"] as const;

/** True when the record carries at least one explicit governance field. */
export function hasRecordedGovernanceFields(input: unknown): boolean {
  if (input == null || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  return GOVERNANCE_FIELDS.some((field) => {
    const fieldValue = value[field];
    return typeof fieldValue === "string" && fieldValue.trim().length > 0;
  });
}

/**
 * Preserve genuinely unrecorded governance metadata while normalizing recorded data.
 * Production `documents.metadata` is NOT NULL DEFAULT '{}'::jsonb and often holds only
 * index bookkeeping keys — treat those the same as null so prompts do not invent
 * adverse `clinical_validation_status: "unverified"`.
 * When some governance fields are present, missing siblings use neutral tokens
 * (`unknown`) rather than inventing adverse `unverified`.
 */
export function normalizeOptionalSourceMetadata(input: unknown): ClinicalSourceMetadata | null {
  if (input == null || !hasRecordedGovernanceFields(input)) return null;
  const value = input as Record<string, unknown>;
  const recorded = (field: (typeof GOVERNANCE_FIELDS)[number]) => {
    const fieldValue = value[field];
    return typeof fieldValue === "string" && fieldValue.trim().length > 0;
  };
  return normalizeSourceMetadata({
    ...value,
    document_status: recorded("document_status") ? value.document_status : "unknown",
    clinical_validation_status: recorded("clinical_validation_status") ? value.clinical_validation_status : "unknown",
    extraction_quality: recorded("extraction_quality") ? value.extraction_quality : "unknown",
  });
}

export function formatClinicalDate(value: string | null | undefined) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Australia/Perth",
  }).format(date);
}

export function sourceStatusLabel(metadata?: ClinicalSourceMetadata | null) {
  const status = metadata?.document_status ?? "unknown";
  if (metadata?.source_kind === "registry_record") {
    if (status === "review_due") return "Registry summary · Review due";
    if (status === "outdated") return "Registry summary · Outdated source";
    return "Registry summary";
  }
  if (status === "current") return "Current source";
  if (status === "review_due") return "Review due";
  if (status === "outdated") return "Outdated source";
  return "Review status unknown";
}

export function validationStatusLabel(metadata?: ClinicalSourceMetadata | null) {
  const status = metadata?.clinical_validation_status ?? "unverified";
  if (status === "approved") return "Approved";
  if (status === "locally_reviewed") return "Locally reviewed";
  if (status === "unknown") return "Validation unknown";
  return "Not locally validated";
}

export function extractionQualityLabel(metadata?: ClinicalSourceMetadata | null) {
  const status = metadata?.extraction_quality ?? "unknown";
  if (status === "good") return "Good extraction";
  if (status === "partial") return "Partial extraction";
  if (status === "poor") return "Poor extraction";
  return "Extraction unknown";
}

export function sourceProvenanceSummary(metadata?: ClinicalSourceMetadata | null) {
  const source = metadata ?? normalizeSourceMetadata(null);
  const reviewDate = formatClinicalDate(source.review_date);
  // Publisher/jurisdiction/review segments are dropped when unknown — a run of
  // "unknown" fillers is noise. The status and validation labels are always
  // kept: "Review status unknown" / "Not locally validated" are clinical
  // governance warnings, not filler.
  return [
    source.publisher,
    source.jurisdiction,
    reviewDate === "Unknown" ? null : `review ${reviewDate}`,
    sourceStatusLabel(source),
    validationStatusLabel(source),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function clipboardProvenanceLine(metadata?: ClinicalSourceMetadataInput) {
  const source = normalizeSourceMetadata(metadata);
  // Copied provenance stays fully explicit (including "Unknown" values): the
  // clipboard line is an audit artifact, unlike the visible summary above
  // which drops unknown filler segments for readability.
  return [
    `Designation: ${sourceDesignationSummary(source)}`,
    `Review status: ${sourceStatusLabel(source)}`,
    `Validation: ${validationStatusLabel(source)}`,
    `Review date: ${formatClinicalDate(source.review_date)}`,
    `Jurisdiction: ${source.jurisdiction ?? "Unknown"}`,
  ].join(" | ");
}

export function sourceDesignationLabel(designation: SourceDesignation) {
  if (designation === "official") return "Official";
  if (designation === "trusted") return "Trusted";
  return "Unclassified";
}

export function sourceDesignationDescription(metadata?: ClinicalSourceMetadata | null) {
  const classification = classifySourceAuthority(metadata);
  if (classification.designation === "official") {
    return classification.officialBasis === "wa_hospital"
      ? "Authenticated source issued by a recognised WA hospital. Official does not imply current, locally approved, or clinically relevant."
      : "Authenticated source issued by a recognised WA health-service network. Official does not imply current, locally approved, or clinically relevant.";
  }
  if (classification.designation === "trusted") {
    return "Recognised authority outside the Official WA hospital/network scope. Trusted does not imply current, locally approved, or clinically relevant.";
  }
  return "Source authority is unknown, ambiguous, conflicting, or a registry summary. Treat as unclassified provenance.";
}

export function sourceDesignationSummary(metadata?: ClinicalSourceMetadata | null) {
  const classification = classifySourceAuthority(metadata);
  return sourceDesignationLabel(classification.designation);
}
