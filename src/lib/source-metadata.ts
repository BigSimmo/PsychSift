import {
  WA_DOCUMENT_CONTROL_ENDORSEMENT_BASIS,
  WA_DOCUMENT_CONTROL_ENDORSEMENT_LABEL,
  hasWaDocumentControlEndorsement,
} from "@/lib/clinical-validation-basis";
import { classifySourceAuthority, type SourceDesignation } from "@/lib/source-authority-registry";
import type { ClinicalSourceMetadata, ClinicalSourceMetadataInput } from "@/lib/types";

const knownStatuses = new Set(["current", "review_due", "outdated", "unknown"]);
const knownValidation = new Set(["unverified", "locally_reviewed", "approved", "unknown"]);
const knownExtraction = new Set(["good", "partial", "poor", "unknown"]);
const knownSourceKinds = new Set(["document", "registry_record"]);
const knownRegistryRecordKinds = new Set(["service", "form", "medication", "differential"]);
const knownCorpusScopes = new Set([
  "uploaded_local",
  "clinical_kb_site",
  "australian_public",
  "international_supplementary",
]);
const knownSourceRoles = new Set([
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
const knownContentModes = new Set(["indexed_content", "link_only"]);
const knownChangeStates = new Set(["unchanged", "changed", "withdrawn", "superseded", "unknown"]);
const knownLicencePolicies = new Set([
  "review_required",
  "public_index_permitted",
  "metadata_link_only",
  "index_forbidden",
]);

type SourceMetadataDiagnosticReason =
  | "credentialed_url"
  | "https_required"
  | "invalid_https_url"
  | "invalid_iso_date"
  | "invalid_sha256"
  | "unrecognized_enum";

type SourceMetadataDiagnostic = Readonly<{
  reason: SourceMetadataDiagnosticReason;
  input_type: string;
  input_length: number | null;
}>;

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// This module renders in the browser (the source badges are client components and
// ship in the standalone design-system bundle), so it must not pull in the
// server-oriented structured logger: that module reads `process.env`, which is a
// ReferenceError in a browser and unmounts the whole React tree. `field`/`value`
// here are enum diagnostics, never secrets or patient text, so the logger's
// redaction pass is not needed and a plain structured warn is equivalent.
// Exported as an object so tests can spy on the seam the way they previously spied
// on `logger.warn`; the default implementation stays quiet under NODE_ENV=test.
export const sourceMetadataDiagnostics = {
  warn(field: string, diagnostic: SourceMetadataDiagnostic) {
    if (typeof process !== "undefined" && process.env && process.env.NODE_ENV === "test") return;
    console.warn(
      JSON.stringify({
        level: "warn",
        message: `source-metadata: unrecognized ${field}`,
        field,
        ...diagnostic,
      }),
    );
  },
};

function diagnosticInputType(value: unknown) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function warnInvalid(field: string, value: unknown, reason: SourceMetadataDiagnosticReason) {
  sourceMetadataDiagnostics.warn(field, {
    reason,
    input_type: diagnosticInputType(value),
    input_length: typeof value === "string" ? value.length : null,
  });
}

function enumOrDefault<T extends string | null>(value: unknown, allowed: Set<string>, fallback: T, field: string): T {
  if (typeof value === "string" && allowed.has(value)) return value as T;
  // A present-but-unrecognized string is a real data-entry defect (typo, renamed
  // enum, malformed ingest) that would otherwise collapse into the fallback and be
  // indistinguishable from a genuinely-absent value. Trace it so it is fixable.
  // Absent / null / empty values are the legitimate default and stay silent — they
  // are the common case and would drown the signal. The returned value is unchanged,
  // so this is observability only: no ranking/retrieval behaviour changes.
  if (typeof value === "string" && value.trim()) {
    warnInvalid(field, value, "unrecognized_enum");
  }
  return fallback;
}

const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/;
const isoDateTime = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

function hasValidCalendarDate(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function isValidIsoDate(value: string) {
  const dateOnlyMatch = isoDateOnly.exec(value);
  if (dateOnlyMatch) {
    return hasValidCalendarDate(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]), Number(dateOnlyMatch[3]));
  }

  const dateTimeMatch = isoDateTime.exec(value);
  if (!dateTimeMatch) return false;
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = dateTimeMatch;
  if (!hasValidCalendarDate(Number(year), Number(month), Number(day))) return false;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
  if (offsetHour !== undefined) {
    const parsedOffsetHour = Number(offsetHour);
    const parsedOffsetMinute = Number(offsetMinute);
    if (parsedOffsetHour > 14 || parsedOffsetMinute > 59) return false;
    if (parsedOffsetHour === 14 && parsedOffsetMinute !== 0) return false;
  }
  return !Number.isNaN(Date.parse(value));
}

function isoDateOrNull(value: unknown, field: string) {
  const normalized = stringOrNull(value);
  if (!normalized) return null;
  if (isValidIsoDate(normalized)) return normalized;
  warnInvalid(field, normalized, "invalid_iso_date");
  return null;
}

function httpsUrlOrNull(value: unknown, field: string) {
  const normalized = stringOrNull(value);
  if (!normalized) return null;
  let reason: SourceMetadataDiagnosticReason = "invalid_https_url";
  try {
    const parsed = new URL(normalized);
    if (parsed.username || parsed.password) reason = "credentialed_url";
    else if (parsed.protocol !== "https:") reason = "https_required";
    else return normalized;
  } catch {
    // The redacted diagnostic below is the single failure signal for malformed URLs.
  }
  warnInvalid(field, normalized, reason);
  return null;
}

function sha256OrNull(value: unknown, field: string) {
  const normalized = stringOrNull(value);
  if (!normalized) return null;
  if (/^[a-fA-F0-9]{64}$/.test(normalized)) return normalized;
  warnInvalid(field, normalized, "invalid_sha256");
  return null;
}

export function normalizeClinicalSourceMetadata(input: ClinicalSourceMetadataInput): ClinicalSourceMetadata {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  return {
    source_kind: enumOrDefault(value.source_kind, knownSourceKinds, null, "source_kind"),
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
    corpus_scope: enumOrDefault(value.corpus_scope, knownCorpusScopes, null, "corpus_scope"),
    source_role: enumOrDefault(value.source_role, knownSourceRoles, null, "source_role"),
    content_mode: enumOrDefault(value.content_mode, knownContentModes, null, "content_mode"),
    source_catalogue_key: stringOrNull(value.source_catalogue_key),
    source_policy_version: stringOrNull(value.source_policy_version),
    canonical_url: httpsUrlOrNull(value.canonical_url, "canonical_url"),
    effective_date: isoDateOrNull(value.effective_date, "effective_date"),
    expiry_date: isoDateOrNull(value.expiry_date, "expiry_date"),
    supersedes_document_id: stringOrNull(value.supersedes_document_id),
    superseded_by_document_id: stringOrNull(value.superseded_by_document_id),
    retrieved_at: isoDateOrNull(value.retrieved_at, "retrieved_at"),
    content_hash: sha256OrNull(value.content_hash, "content_hash"),
    change_state: enumOrDefault(value.change_state, knownChangeStates, "unknown", "change_state"),
    licence_policy: enumOrDefault(value.licence_policy, knownLicencePolicies, null, "licence_policy"),
    document_status: enumOrDefault(value.document_status, knownStatuses, "unknown", "document_status"),
    clinical_validation_status: enumOrDefault(
      value.clinical_validation_status,
      knownValidation,
      "unverified",
      "clinical_validation_status",
    ),
    extraction_quality: enumOrDefault(value.extraction_quality, knownExtraction, "unknown", "extraction_quality"),
    // Only the WA document-control endorsement basis survives normalization, and only as its
    // basis: authority classification, claim eligibility and labels read it downstream. Every
    // other input normalizes exactly as before (no key added), so existing outputs are unchanged.
    ...(hasWaDocumentControlEndorsement(value)
      ? { clinical_validation_evidence: { basis: WA_DOCUMENT_CONTROL_ENDORSEMENT_BASIS } }
      : {}),
  };
}

/** Compatibility name retained for existing rendering and retrieval consumers. */
export function normalizeSourceMetadata(input: unknown): ClinicalSourceMetadata {
  const safeInput = input && typeof input === "object" && !Array.isArray(input) ? input : null;
  return normalizeClinicalSourceMetadata(safeInput as ClinicalSourceMetadataInput);
}

// Only WA's own health services count by name. A bare "health service" also matched
// interstate publishers such as Queensland's "Metro North Hospital and Health Service".
const LOCAL_SOURCE =
  /\b(?:wa|western australia|north metropolitan|east metropolitan|south metropolitan|perth|child and adolescent health service|country health service)\b/;

/** True when a source's jurisdiction or publisher names Western Australia: the "Local" filter. */
export function isLocalSource(metadata: Pick<ClinicalSourceMetadata, "jurisdiction" | "publisher">): boolean {
  return LOCAL_SOURCE.test(`${metadata.jurisdiction ?? ""} ${metadata.publisher ?? ""}`.toLowerCase());
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

/** Built once; en-AU / Australia/Perth are constants, so a shared instance formats identically. */
const CLINICAL_DATE_FORMAT = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Australia/Perth",
});

export function formatClinicalDate(value: string | null | undefined) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return CLINICAL_DATE_FORMAT.format(date);
}

export function sourceStatusLabel(
  metadata?: Partial<Pick<ClinicalSourceMetadata, "source_kind" | "document_status">> | null,
) {
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

export function validationStatusLabel(
  metadata?: Partial<
    Pick<ClinicalSourceMetadata, "clinical_validation_status" | "clinical_validation_evidence">
  > | null,
) {
  const status = metadata?.clinical_validation_status ?? "unverified";
  if (status === "approved") return "Approved";
  if (status === "locally_reviewed") return "Locally reviewed";
  if (hasWaDocumentControlEndorsement(metadata)) return WA_DOCUMENT_CONTROL_ENDORSEMENT_LABEL;
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

export function clipboardProvenanceLine(metadata?: Partial<ClinicalSourceMetadata> | null) {
  const source = metadata ?? normalizeSourceMetadata(null);
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

export function sourceDesignationSummary(metadata?: Partial<ClinicalSourceMetadata> | null) {
  const classification = classifySourceAuthority(metadata);
  return sourceDesignationLabel(classification.designation);
}
