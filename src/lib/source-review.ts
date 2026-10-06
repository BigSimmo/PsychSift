import { z } from "zod";

import { hasWaDocumentControlEndorsement } from "@/lib/clinical-validation-basis";
import { perthCalendarDate } from "@/lib/perth-time";
import { sourceAuthorityForPublisherCode } from "@/lib/source-authority-registry";

export const BMJ_THIRD_PARTY_ATTESTATION_POLICY_VERSION = "bmj-third-party-reference-attestation-v1" as const;
export const BMJ_THIRD_PARTY_ATTESTATION_EVIDENCE_TYPE = "structured_bmj_third_party_attestation" as const;
export const BMJ_THIRD_PARTY_ATTESTATION_BASIS = "third_party_reference_attested" as const;

export const sourceReviewDecisionSchema = z.enum([
  "locally_reviewed",
  "approved",
  "third_party_reference_attested",
  "rejected",
  "decommissioned",
  "superseded",
]);

export type SourceReviewDecision = z.infer<typeof sourceReviewDecisionSchema>;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function nonEmptyText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nonEmptyTextArray(value: unknown) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => Boolean(nonEmptyText(item)));
}

function normalizedNonEmptyTextArray(value: unknown) {
  if (!nonEmptyTextArray(value)) return null;
  return (value as unknown[]).map((item) => nonEmptyText(item) as string);
}

const uuidSchema = z.string().uuid();
const offsetDateTimeSchema = z.string().datetime({ offset: true });
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function isTraceableUuid(value: unknown) {
  const candidate = nonEmptyText(value);
  return Boolean(candidate && candidate !== NIL_UUID && uuidSchema.safeParse(candidate).success);
}

function isValidNonFutureAttestationTimestamp(value: unknown, now: Date) {
  const candidate = nonEmptyText(value);
  if (!candidate || !offsetDateTimeSchema.safeParse(candidate).success) return false;
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) && timestamp <= now.getTime();
}

export function isValidReviewDate(value: string, now = new Date()) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value <= perthCalendarDate(now)
  );
}

/**
 * Canonical ASCII normalizer for the narrow BMJ attestation policy. Keep this
 * behaviorally equivalent to the regexp_replace expressions in
 * record_source_review_v2 (migration and schema replay snapshot).
 */
export function normalizeBmjAttestationAuthorityText(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/]+/g, " ")
    .trim();
}

/**
 * The third-party policy is deliberately BMJ-specific. A publisher code by
 * itself is insufficient: the independently stored publisher and jurisdiction
 * must both agree with the canonical authority registry.
 */
export function hasCompatibleBmjAuthorityMetadata(metadataValue: unknown) {
  const metadata = record(metadataValue);
  const publisherCode = nonEmptyText(metadata.publisher_code)?.toUpperCase();
  const authority = sourceAuthorityForPublisherCode(publisherCode);
  const publisher = nonEmptyText(metadata.publisher);
  const jurisdiction = nonEmptyText(metadata.jurisdiction);
  if (publisherCode !== "BMJ" || authority?.key !== "bmj-best-practice" || !publisher || !jurisdiction) return false;

  const normalizedPublisher = normalizeBmjAttestationAuthorityText(publisher);
  const normalizedJurisdiction = normalizeBmjAttestationAuthorityText(jurisdiction);
  return (
    authority.publisherAliases.some(
      (candidate) => normalizeBmjAttestationAuthorityText(candidate) === normalizedPublisher,
    ) &&
    authority.jurisdictions.some(
      (candidate) => normalizeBmjAttestationAuthorityText(candidate) === normalizedJurisdiction,
    )
  );
}

export type BmjThirdPartyAttestationInput = {
  documentStatus: string;
  metadata: unknown;
  evidenceReferences: string[];
  reviewDate: string | null;
  policyVersion: string | null;
  reviewerQualification: string | null;
};

export type BmjThirdPartyAttestationEvent = {
  document_id: string;
  reviewer_id: string;
  decision: string;
  evidence_references: readonly string[] | null;
  new_document_status: string;
  new_validation_status: string;
  review_date: string | null;
  policy_version: string | null;
  reviewer_qualification: string | null;
  created_at: string;
};

export type SourceReviewDebtDocument = {
  documentId: string;
  metadata: unknown;
};

export function bmjThirdPartyAttestationRejectionReasons(input: BmjThirdPartyAttestationInput, now = new Date()) {
  const reasons: string[] = [];
  const metadata = record(input.metadata);
  if (input.documentStatus !== "indexed") reasons.push("document_not_indexed");
  if (!hasCompatibleBmjAuthorityMetadata(metadata)) reasons.push("incompatible_bmj_authority_metadata");
  if ((nonEmptyText(metadata.clinical_validation_status) ?? "unverified") !== "unverified") {
    reasons.push("clinical_validation_not_unverified");
  }
  if (!nonEmptyTextArray(input.evidenceReferences)) reasons.push("missing_evidence_references");
  if (!input.reviewDate || !isValidReviewDate(input.reviewDate, now)) reasons.push("invalid_review_date");
  if (input.policyVersion !== BMJ_THIRD_PARTY_ATTESTATION_POLICY_VERSION) reasons.push("wrong_policy_version");
  if (!nonEmptyText(input.reviewerQualification)) reasons.push("missing_reviewer_qualification");
  return reasons;
}

/** Validate the metadata half of a v1 BMJ attestation. */
function hasCompleteCurrentBmjThirdPartyAttestationMetadata(metadataValue: unknown, now: Date) {
  const metadata = record(metadataValue);
  const evidence = record(metadata.clinical_validation_evidence);
  const reviewDate = nonEmptyText(evidence.review_date);
  return (
    (nonEmptyText(metadata.clinical_validation_status) ?? "unverified") === "unverified" &&
    nonEmptyText(metadata.document_status) === "current" &&
    hasCompatibleBmjAuthorityMetadata(metadata) &&
    nonEmptyText(metadata.governance_disposition) === BMJ_THIRD_PARTY_ATTESTATION_BASIS &&
    nonEmptyText(evidence.status) === "unverified" &&
    nonEmptyText(evidence.basis) === BMJ_THIRD_PARTY_ATTESTATION_BASIS &&
    nonEmptyText(evidence.evidence_type) === BMJ_THIRD_PARTY_ATTESTATION_EVIDENCE_TYPE &&
    nonEmptyText(evidence.publisher_code)?.toUpperCase() === "BMJ" &&
    nonEmptyText(evidence.policy_version) === BMJ_THIRD_PARTY_ATTESTATION_POLICY_VERSION &&
    Boolean(nonEmptyText(evidence.reviewer_qualification)) &&
    nonEmptyTextArray(evidence.evidence_references) &&
    Boolean(reviewDate && isValidReviewDate(reviewDate, now)) &&
    isValidNonFutureAttestationTimestamp(evidence.attested_at, now) &&
    isTraceableUuid(evidence.attested_by)
  );
}

function sameTimestamp(left: unknown, right: unknown) {
  const leftText = nonEmptyText(left);
  const rightText = nonEmptyText(right);
  if (!leftText || !rightText) return false;
  const leftTimestamp = Date.parse(leftText);
  const rightTimestamp = Date.parse(rightText);
  return Number.isFinite(leftTimestamp) && Number.isFinite(rightTimestamp) && leftTimestamp === rightTimestamp;
}

function sameTextArray(left: unknown, right: unknown) {
  const leftValues = normalizedNonEmptyTextArray(left);
  const rightValues = normalizedNonEmptyTextArray(right);
  if (!leftValues || !rightValues || leftValues.length !== rightValues.length) return false;
  return leftValues.every((value, index) => value === rightValues[index]);
}

/**
 * A complete operational attestation requires both the current metadata view
 * and the immutable event that produced it. Metadata shape alone is never
 * sufficient to remove a source from the unattested-review work queue.
 */
export function hasCompleteCurrentBmjThirdPartyAttestation(
  document: SourceReviewDebtDocument,
  attestationEvents: readonly BmjThirdPartyAttestationEvent[],
  now = new Date(),
) {
  if (!hasCompleteCurrentBmjThirdPartyAttestationMetadata(document.metadata, now)) return false;

  const metadata = record(document.metadata);
  const evidence = record(metadata.clinical_validation_evidence);
  const attestedBy = nonEmptyText(evidence.attested_by);
  const policyVersion = nonEmptyText(evidence.policy_version);
  const qualification = nonEmptyText(evidence.reviewer_qualification);
  const reviewDate = nonEmptyText(evidence.review_date);

  return attestationEvents.some(
    (event) =>
      event.document_id === document.documentId &&
      event.decision === BMJ_THIRD_PARTY_ATTESTATION_BASIS &&
      nonEmptyText(event.reviewer_id) === attestedBy &&
      nonEmptyText(event.policy_version) === policyVersion &&
      nonEmptyText(event.reviewer_qualification) === qualification &&
      nonEmptyText(event.review_date) === reviewDate &&
      nonEmptyText(event.new_document_status) === nonEmptyText(metadata.document_status) &&
      nonEmptyText(event.new_validation_status) === "unverified" &&
      sameTextArray(event.evidence_references, evidence.evidence_references) &&
      sameTimestamp(event.created_at, evidence.attested_at),
  );
}

export function countOperationalUnattestedReviewDebt(
  documents: readonly SourceReviewDebtDocument[],
  attestationEvents: readonly BmjThirdPartyAttestationEvent[],
  now = new Date(),
) {
  const unverified = documents.filter((document) => {
    const status = nonEmptyText(record(document.metadata).clinical_validation_status);
    return !status || status === "unverified";
  });
  const completeBmjAttestations = unverified.filter((document) =>
    hasCompleteCurrentBmjThirdPartyAttestation(document, attestationEvents, now),
  ).length;
  // Like a BMJ attestation, a WA document-control endorsement records a non-review fact and
  // leaves the source unverified; it is counted apart from unattested debt (#JYH1FH).
  const waDocumentControlEndorsements = unverified.filter((document) =>
    hasWaDocumentControlEndorsement(document.metadata),
  ).length;
  return {
    raw_unverified_validation: unverified.length,
    complete_bmj_third_party_attestations: completeBmjAttestations,
    wa_document_control_endorsements: waDocumentControlEndorsements,
    unattested_review_debt: unverified.length - completeBmjAttestations - waDocumentControlEndorsements,
  };
}
