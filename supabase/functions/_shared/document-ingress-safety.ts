import { createHash } from "node:crypto";

export const PROVIDER_EGRESS_PURPOSES = ["caption", "embedding", "summary", "deep_memory"] as const;

export type ProviderEgressPurpose = (typeof PROVIDER_EGRESS_PURPOSES)[number];
export type ContentSha256 = `sha256:${string}`;

export type IngressHardGateCode =
  | "admission_missing"
  | "binding_invalid"
  | "scanner_unavailable"
  | "malware_detected"
  | "active_content_detected"
  | "identifier_detected"
  | "hidden_text_conflict"
  | "unsupported_encrypted_document"
  | "excluded_source"
  | "link_only_content"
  | "index_licence_not_permitted"
  | "source_policy_mismatch"
  | "safety_observation_invalid";

export type IngressRemediationAction =
  | "obtain_current_admission"
  | "reload_current_generation"
  | "repeat_safety_checks"
  | "remove_or_quarantine_unsafe_content"
  | "review_source_eligibility"
  | "confirm_index_rights"
  | "refresh_source_policy";

export type IngressHardGateReason = Readonly<{
  code: IngressHardGateCode;
  action: IngressRemediationAction;
}>;

export type ProviderEgressBinding = Readonly<{
  admissionEventId: string;
  documentId: string;
  generationId: string;
  jobId: string;
  attemptId: string;
  leaseId: string;
  contentSha256: ContentSha256;
  authorityDigest: ContentSha256;
}>;

/**
 * Values supplied by a trusted adapter after it has performed the underlying
 * checks. This module does not scan bytes, query current database rights, or
 * establish that an adapter is trustworthy. Raw document text is deliberately
 * absent: caller-supplied content can never create provider-egress authority.
 */
export type DocumentIngressSafetyObservations = Readonly<{
  binding: ProviderEgressBinding;
  policyVersion: string;
  purpose: ProviderEgressPurpose;
  admission: "current" | "missing" | "revoked" | "stale";
  ownerScope: "permitted" | "denied";
  rights: "permitted" | "denied";
  purposeClearance: "permitted" | "denied";
  scanner: Readonly<{
    verdict: "clean" | "malware" | "unavailable";
    scannerVersion: string;
    contentSha256: ContentSha256;
  }>;
  activeContent: "absent" | "detected";
  identifiers: "absent" | "detected";
  hiddenText: "consistent" | "not_applicable" | "conflict";
  encryption: "not_encrypted" | "supported" | "unsupported";
  source: "eligible" | "excluded" | "link_only";
  indexLicence: "permitted" | "not_permitted";
  sourcePolicy: "matched" | "mismatch";
}>;

export type DocumentIngressSafetyResult =
  | Readonly<{
      verdict: "pass";
      binding: ProviderEgressBinding;
      purpose: ProviderEgressPurpose;
      policyVersion: string;
      checks: readonly string[];
      evidenceDigest: ContentSha256;
    }>
  | Readonly<{
      verdict: "quarantine";
      binding: ProviderEgressBinding | null;
      purpose: ProviderEgressPurpose | null;
      policyVersion: string;
      codes: readonly IngressHardGateCode[];
      reasons: readonly IngressHardGateReason[];
      evidenceDigest: ContentSha256;
    }>;

const contentSha256Pattern = /^sha256:[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isContentSha256(value: unknown): value is ContentSha256 {
  return typeof value === "string" && contentSha256Pattern.test(value);
}

function isPurpose(value: unknown): value is ProviderEgressPurpose {
  return typeof value === "string" && (PROVIDER_EGRESS_PURPOSES as readonly string[]).includes(value);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function freezeBinding(binding: ProviderEgressBinding): ProviderEgressBinding {
  return Object.freeze({ ...binding });
}

function readBinding(value: unknown, reasons: Map<IngressHardGateCode, IngressRemediationAction>) {
  if (!isRecord(value)) {
    reasons.set("admission_missing", "obtain_current_admission");
    reasons.set("binding_invalid", "reload_current_generation");
    return null;
  }

  const admissionEventId = value.admissionEventId;
  const documentId = value.documentId;
  const generationId = value.generationId;
  const jobId = value.jobId;
  const attemptId = value.attemptId;
  const leaseId = value.leaseId;
  const contentSha256 = value.contentSha256;
  const authorityDigest = value.authorityDigest;

  if (!isNonEmptyString(admissionEventId)) reasons.set("admission_missing", "obtain_current_admission");
  if (
    !isNonEmptyString(documentId) ||
    !isNonEmptyString(generationId) ||
    !isNonEmptyString(jobId) ||
    !isNonEmptyString(attemptId) ||
    !isNonEmptyString(leaseId) ||
    !isContentSha256(contentSha256) ||
    !isContentSha256(authorityDigest)
  ) {
    reasons.set("binding_invalid", "reload_current_generation");
  }

  if (
    !isNonEmptyString(admissionEventId) ||
    !isNonEmptyString(documentId) ||
    !isNonEmptyString(generationId) ||
    !isNonEmptyString(jobId) ||
    !isNonEmptyString(attemptId) ||
    !isNonEmptyString(leaseId) ||
    !isContentSha256(contentSha256) ||
    !isContentSha256(authorityDigest)
  ) {
    return null;
  }

  return freezeBinding({
    admissionEventId,
    documentId,
    generationId,
    jobId,
    attemptId,
    leaseId,
    contentSha256,
    authorityDigest,
  });
}

function digestEvidence(value: object): ContentSha256 {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function normalizedStatus<T extends string>(value: unknown, allowed: readonly T[]): T | "invalid" {
  return isOneOf(value, allowed) ? value : "invalid";
}

function addInvalidObservation(reasons: Map<IngressHardGateCode, IngressRemediationAction>) {
  reasons.set("safety_observation_invalid", "repeat_safety_checks");
}

/**
 * Deterministically evaluates trusted adapter observations. Unknown, missing,
 * and malformed observations fail closed. This decision is local evidence only;
 * it does not prove that the adapter checked the current database state or ran a
 * real scanner.
 */
export function evaluateDocumentIngressSafety(input: unknown): DocumentIngressSafetyResult {
  const reasons = new Map<IngressHardGateCode, IngressRemediationAction>();
  const record = isRecord(input) ? input : {};
  if (!isRecord(input)) addInvalidObservation(reasons);

  const binding = readBinding(record.binding, reasons);
  const policyVersion = isNonEmptyString(record.policyVersion) ? record.policyVersion.trim() : "unverified";
  if (policyVersion === "unverified") addInvalidObservation(reasons);

  const purpose = isPurpose(record.purpose) ? record.purpose : null;
  if (purpose === null) addInvalidObservation(reasons);

  const admission = normalizedStatus(record.admission, ["current", "missing", "revoked", "stale"] as const);
  if (admission !== "current") reasons.set("admission_missing", "obtain_current_admission");

  const ownerScope = normalizedStatus(record.ownerScope, ["permitted", "denied"] as const);
  const rights = normalizedStatus(record.rights, ["permitted", "denied"] as const);
  const purposeClearance = normalizedStatus(record.purposeClearance, ["permitted", "denied"] as const);
  if (ownerScope === "denied" || purposeClearance === "denied") {
    reasons.set("source_policy_mismatch", "refresh_source_policy");
  }
  if (rights === "denied") reasons.set("index_licence_not_permitted", "confirm_index_rights");
  if (ownerScope === "invalid" || rights === "invalid" || purposeClearance === "invalid") {
    addInvalidObservation(reasons);
  }

  const scanner = isRecord(record.scanner) ? record.scanner : {};
  const scannerVerdict = normalizedStatus(scanner.verdict, ["clean", "malware", "unavailable"] as const);
  const scannerVersion = isNonEmptyString(scanner.scannerVersion) ? scanner.scannerVersion.trim() : "invalid";
  const scannerContentSha256 = isContentSha256(scanner.contentSha256) ? scanner.contentSha256 : "invalid";
  if (
    scannerVerdict === "unavailable" ||
    scannerVerdict === "invalid" ||
    scannerVersion === "invalid" ||
    scannerContentSha256 === "invalid" ||
    (binding !== null && scannerContentSha256 !== binding.contentSha256)
  ) {
    reasons.set("scanner_unavailable", "repeat_safety_checks");
  }
  if (scannerVerdict === "malware") reasons.set("malware_detected", "remove_or_quarantine_unsafe_content");

  const activeContent = normalizedStatus(record.activeContent, ["absent", "detected"] as const);
  const identifiers = normalizedStatus(record.identifiers, ["absent", "detected"] as const);
  const hiddenText = normalizedStatus(record.hiddenText, ["consistent", "not_applicable", "conflict"] as const);
  const encryption = normalizedStatus(record.encryption, ["not_encrypted", "supported", "unsupported"] as const);
  const source = normalizedStatus(record.source, ["eligible", "excluded", "link_only"] as const);
  const indexLicence = normalizedStatus(record.indexLicence, ["permitted", "not_permitted"] as const);
  const sourcePolicy = normalizedStatus(record.sourcePolicy, ["matched", "mismatch"] as const);

  if (activeContent === "detected") {
    reasons.set("active_content_detected", "remove_or_quarantine_unsafe_content");
  }
  if (identifiers === "detected") reasons.set("identifier_detected", "remove_or_quarantine_unsafe_content");
  if (hiddenText === "conflict") reasons.set("hidden_text_conflict", "repeat_safety_checks");
  if (encryption === "unsupported") {
    reasons.set("unsupported_encrypted_document", "review_source_eligibility");
  }
  if (source === "excluded") reasons.set("excluded_source", "review_source_eligibility");
  if (source === "link_only") reasons.set("link_only_content", "review_source_eligibility");
  if (indexLicence === "not_permitted") {
    reasons.set("index_licence_not_permitted", "confirm_index_rights");
  }
  if (sourcePolicy === "mismatch") reasons.set("source_policy_mismatch", "refresh_source_policy");

  if (
    activeContent === "invalid" ||
    identifiers === "invalid" ||
    hiddenText === "invalid" ||
    encryption === "invalid" ||
    source === "invalid" ||
    indexLicence === "invalid" ||
    sourcePolicy === "invalid"
  ) {
    addInvalidObservation(reasons);
  }

  const normalizedEvidence = {
    binding,
    policyVersion,
    purpose,
    admission,
    ownerScope,
    rights,
    purposeClearance,
    scanner: {
      verdict: scannerVerdict,
      version: scannerVersion,
      contentSha256: scannerContentSha256,
    },
    activeContent,
    identifiers,
    hiddenText,
    encryption,
    source,
    indexLicence,
    sourcePolicy,
    codes: [...reasons.keys()],
  };
  const evidenceDigest = digestEvidence(normalizedEvidence);

  if (reasons.size > 0 || binding === null || purpose === null) {
    const frozenReasons = Object.freeze(
      [...reasons].map(([code, action]) => Object.freeze({ code, action }) satisfies IngressHardGateReason),
    );
    return Object.freeze({
      verdict: "quarantine",
      binding,
      purpose,
      policyVersion,
      codes: Object.freeze(frozenReasons.map((reason) => reason.code)),
      reasons: frozenReasons,
      evidenceDigest,
    });
  }

  const checks = Object.freeze([
    "admission:current",
    "owner_scope:permitted",
    "rights:permitted",
    `purpose:${purpose}:permitted`,
    `scanner:clean:${scannerVersion}`,
    "active_content:absent",
    "identifiers:absent",
    `hidden_text:${hiddenText}`,
    `encryption:${encryption}`,
    "source:eligible",
    "index_licence:permitted",
    "source_policy:matched",
  ]);
  return Object.freeze({ verdict: "pass", binding, purpose, policyVersion, checks, evidenceDigest });
}

declare const providerEgressPermitType: unique symbol;

/** An opaque, authority-local runtime capability. It has no serializable claims. */
export type ProviderEgressPermit = Readonly<{ [providerEgressPermitType]: true }>;

export type ProviderEgressDenialCode =
  | "untrusted_safety_result"
  | "provider_egress_denied"
  | "provider_egress_binding_mismatch"
  | "provider_egress_purpose_mismatch"
  | "provider_egress_policy_evidence_mismatch"
  | "provider_egress_permit_invalid"
  | "provider_egress_permit_revoked"
  | "provider_egress_permit_stale";

export class ProviderEgressDeniedError extends Error {
  readonly code: ProviderEgressDenialCode;

  constructor(code: ProviderEgressDenialCode) {
    super(code);
    this.name = "ProviderEgressDeniedError";
    this.code = code;
  }
}

function assertExactProviderEgressBinding(actual: ProviderEgressBinding, expected: ProviderEgressBinding): void {
  if (
    actual.admissionEventId !== expected.admissionEventId ||
    actual.documentId !== expected.documentId ||
    actual.generationId !== expected.generationId ||
    actual.jobId !== expected.jobId ||
    actual.attemptId !== expected.attemptId ||
    actual.leaseId !== expected.leaseId ||
    actual.contentSha256 !== expected.contentSha256 ||
    actual.authorityDigest !== expected.authorityDigest
  ) {
    throw new ProviderEgressDeniedError("provider_egress_binding_mismatch");
  }
}

export type ProviderEgressPolicyEvidence = Readonly<{
  policyVersion: string;
  evidenceDigest: ContentSha256;
}>;

export type DocumentIngressSafetyAuthority = Readonly<{
  evaluate(input: unknown): DocumentIngressSafetyResult;
  issuePermit(
    result: DocumentIngressSafetyResult,
    expectedBinding: ProviderEgressBinding,
    purpose: ProviderEgressPurpose,
  ): ProviderEgressPermit;
  assertPermit(
    permit: ProviderEgressPermit,
    expectedBinding: ProviderEgressBinding,
    purpose: ProviderEgressPurpose,
    expectedPolicyEvidence: ProviderEgressPolicyEvidence,
  ): void;
  revokePermit(permit: ProviderEgressPermit): void;
}>;

type AuthorityOptions = Readonly<{
  permitTtlMs: number;
  now?: () => number;
}>;

type PermitRecord = {
  binding: ProviderEgressBinding;
  purpose: ProviderEgressPurpose;
  evidenceDigest: ContentSha256;
  policyVersion: string;
  issuedAt: number;
  expiresAt: number;
  revoked: boolean;
};

/**
 * Creates an in-memory permit authority. Callers choose an explicit short TTL.
 * A permit never substitutes for a fresh database-rights check: before every
 * actual egress, the caller must load current authority and pass the resulting
 * admission/job/attempt/lease/authority-digest binding to assertPermit. Loading
 * that state and reacting to database revocation belong at the caller boundary.
 */
export function createDocumentIngressSafetyAuthority(options: AuthorityOptions): DocumentIngressSafetyAuthority {
  if (!Number.isSafeInteger(options.permitTtlMs) || options.permitTtlMs <= 0) {
    throw new TypeError("permitTtlMs must be a positive safe integer");
  }
  const now = options.now ?? Date.now;
  const evaluatedResults = new WeakSet<object>();
  const permits = new WeakMap<object, PermitRecord>();

  function evaluate(input: unknown): DocumentIngressSafetyResult {
    const result = evaluateDocumentIngressSafety(input);
    evaluatedResults.add(result);
    return result;
  }

  function issuePermit(
    result: DocumentIngressSafetyResult,
    expectedBinding: ProviderEgressBinding,
    purpose: ProviderEgressPurpose,
  ): ProviderEgressPermit {
    if (!evaluatedResults.has(result)) throw new ProviderEgressDeniedError("untrusted_safety_result");
    if (result.verdict !== "pass") throw new ProviderEgressDeniedError("provider_egress_denied");
    assertExactProviderEgressBinding(result.binding, expectedBinding);
    if (result.purpose !== purpose) throw new ProviderEgressDeniedError("provider_egress_purpose_mismatch");

    const issuedAt = now();
    const expiresAt = issuedAt + options.permitTtlMs;
    if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) {
      throw new ProviderEgressDeniedError("provider_egress_permit_stale");
    }
    const permit = Object.freeze(Object.create(null)) as ProviderEgressPermit;
    permits.set(permit, {
      binding: freezeBinding(result.binding),
      purpose,
      evidenceDigest: result.evidenceDigest,
      policyVersion: result.policyVersion,
      issuedAt,
      expiresAt,
      revoked: false,
    });
    return permit;
  }

  function assertPermit(
    permit: ProviderEgressPermit,
    expectedBinding: ProviderEgressBinding,
    purpose: ProviderEgressPurpose,
    expectedPolicyEvidence: ProviderEgressPolicyEvidence,
  ): void {
    const permitRecord = permits.get(permit);
    if (!permitRecord) throw new ProviderEgressDeniedError("provider_egress_permit_invalid");
    if (permitRecord.revoked) throw new ProviderEgressDeniedError("provider_egress_permit_revoked");
    const checkedAt = now();
    if (!Number.isSafeInteger(checkedAt) || checkedAt < permitRecord.issuedAt || checkedAt >= permitRecord.expiresAt) {
      throw new ProviderEgressDeniedError("provider_egress_permit_stale");
    }
    if (permitRecord.purpose !== purpose) {
      throw new ProviderEgressDeniedError("provider_egress_purpose_mismatch");
    }
    assertExactProviderEgressBinding(permitRecord.binding, expectedBinding);
    if (
      !isRecord(expectedPolicyEvidence) ||
      !isNonEmptyString(expectedPolicyEvidence.policyVersion) ||
      !isContentSha256(expectedPolicyEvidence.evidenceDigest) ||
      permitRecord.policyVersion !== expectedPolicyEvidence.policyVersion ||
      permitRecord.evidenceDigest !== expectedPolicyEvidence.evidenceDigest
    ) {
      throw new ProviderEgressDeniedError("provider_egress_policy_evidence_mismatch");
    }
  }

  function revokePermit(permit: ProviderEgressPermit): void {
    const permitRecord = permits.get(permit);
    if (!permitRecord) throw new ProviderEgressDeniedError("provider_egress_permit_invalid");
    permitRecord.revoked = true;
  }

  return Object.freeze({ evaluate, issuePermit, assertPermit, revokePermit });
}
