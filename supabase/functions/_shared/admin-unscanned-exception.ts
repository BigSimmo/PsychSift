import { createHash } from "node:crypto";
import type { ContentSha256, ProviderEgressBinding, ProviderEgressPurpose } from "./document-ingress-safety.ts";

export const ADMIN_UNSCANNED_EXCEPTION_POLICY = "administrator-source-unscanned-exception-v1" as const;
export const ADMIN_UNSCANNED_EXCEPTION_MAX_VALIDITY_MS = 86_400_000;

/** Independently reloaded by the trusted server supplier, never read from document metadata.
 * These are evidence contracts, not a signature verifier or a database admission reader. */
export type AdminUnscannedExceptionEvidence = Readonly<{
  grant: Readonly<{
    policyVersion: typeof ADMIN_UNSCANNED_EXCEPTION_POLICY;
    exceptionId: string;
    status: "active" | "revoked";
    administratorId: string;
    ownerId: string;
    binding: ProviderEgressBinding;
    admissionDigest: ContentSha256;
    catalogueKey: string;
    mimeType: "text/plain" | "application/pdf";
    sourceByteLength: number;
    purpose: "embedding";
    approvalReferenceSha256: ContentSha256;
    issuedAt: string;
    expiresAt: string;
  }>;
  admission: Readonly<{
    sourceChannel: "admin_api";
    actorKind: "administrator";
    administratorId: string;
    administratorActive: true;
    ownerId: string;
    documentId: string;
    admissionEventId: string;
    admissionDigest: ContentSha256;
    sourceSha256: ContentSha256;
  }>;
}>;

export type AdminUnscannedExceptionScope = Readonly<{
  binding: ProviderEgressBinding;
  ownerId: string;
  /** The authority-facts decoder validates this digest at runtime. */
  admissionDigest: string;
  catalogueKey: string;
  mimeType: string;
  sourceByteLength: number;
}>;

declare const receiptType: unique symbol;
export type AdminUnscannedExceptionReceipt = Readonly<{ [receiptType]: true }>;
type ReceiptRecord = Readonly<{
  binding: ProviderEgressBinding;
  grantDigest: ContentSha256;
  issuedAtMs: number;
  expiresAtMs: number;
}>;
const receipts = new WeakMap<object, ReceiptRecord>();
const bindingKeys = [
  "admissionEventId",
  "documentId",
  "generationId",
  "jobId",
  "attemptId",
  "leaseId",
  "contentSha256",
  "authorityDigest",
] as const;
const sha256 = /^sha256:[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const matches = (value: unknown, pattern: RegExp) => typeof value === "string" && pattern.test(value);
const fail = (): never => {
  throw new Error("admin_unscanned_exception_invalid");
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function exactKeys(value: unknown, keys: readonly string[]) {
  const record = object(value);
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) fail();
}
function timestamp(value: unknown) {
  if (typeof value !== "string") return fail();
  const ms = Date.parse(value);
  if (!Number.isSafeInteger(ms) || new Date(ms).toISOString() !== value) return fail();
  return ms;
}

/** Detach and validate a supplier record. A JSON copy of a record is still NOT a receipt. */
export function snapshotAdminUnscannedExceptionEvidence(value: unknown): AdminUnscannedExceptionEvidence {
  try {
    const evidence = JSON.parse(JSON.stringify(value)) as AdminUnscannedExceptionEvidence;
    exactKeys(evidence, ["grant", "admission"]);
    const { grant, admission } = evidence;
    exactKeys(grant, [
      "policyVersion",
      "exceptionId",
      "status",
      "administratorId",
      "ownerId",
      "binding",
      "admissionDigest",
      "catalogueKey",
      "mimeType",
      "sourceByteLength",
      "purpose",
      "approvalReferenceSha256",
      "issuedAt",
      "expiresAt",
    ]);
    exactKeys(admission, [
      "sourceChannel",
      "actorKind",
      "administratorId",
      "administratorActive",
      "ownerId",
      "documentId",
      "admissionEventId",
      "admissionDigest",
      "sourceSha256",
    ]);
    exactKeys(grant.binding, bindingKeys);
    if (
      grant.policyVersion !== ADMIN_UNSCANNED_EXCEPTION_POLICY ||
      grant.status !== "active" ||
      !matches(grant.exceptionId, uuid) ||
      !matches(grant.administratorId, uuid) ||
      !matches(grant.ownerId, uuid) ||
      !matches(grant.admissionDigest, sha256) ||
      !matches(grant.approvalReferenceSha256, sha256) ||
      !matches(grant.catalogueKey, /^[a-z0-9][a-z0-9_-]{0,99}$/) ||
      !["text/plain", "application/pdf"].includes(grant.mimeType) ||
      !Number.isSafeInteger(grant.sourceByteLength) ||
      grant.sourceByteLength < 1 ||
      grant.sourceByteLength > 157286400 ||
      grant.purpose !== "embedding" ||
      bindingKeys.some(
        (key) => typeof grant.binding[key] !== "string" || !grant.binding[key] || grant.binding[key].length > 256,
      ) ||
      !matches(grant.binding.contentSha256, sha256) ||
      !matches(grant.binding.authorityDigest, sha256) ||
      admission.sourceChannel !== "admin_api" ||
      admission.actorKind !== "administrator" ||
      admission.administratorActive !== true ||
      admission.administratorId !== grant.administratorId ||
      admission.ownerId !== grant.ownerId ||
      admission.documentId !== grant.binding.documentId ||
      admission.admissionEventId !== grant.binding.admissionEventId ||
      admission.admissionDigest !== grant.admissionDigest ||
      admission.sourceSha256 !== grant.binding.contentSha256
    )
      fail();
    const issued = timestamp(grant.issuedAt);
    const expires = timestamp(grant.expiresAt);
    const now = Date.now();
    if (
      issued > now ||
      expires <= now ||
      expires <= issued ||
      expires - issued > ADMIN_UNSCANNED_EXCEPTION_MAX_VALIDITY_MS
    )
      fail();
    Object.freeze(grant.binding);
    Object.freeze(grant);
    Object.freeze(admission);
    return Object.freeze(evidence);
  } catch {
    return fail();
  }
}

/** Trusted inspection adapters call this only after all non-malware checks pass.
 * There is no default grant, environment switch, scanner fallback or metadata lookup. */
export function issueAdminUnscannedExceptionReceipt(
  evidence: AdminUnscannedExceptionEvidence,
  scope: AdminUnscannedExceptionScope,
  checkedContentSha256: ContentSha256,
): AdminUnscannedExceptionReceipt {
  const { grant, admission } = snapshotAdminUnscannedExceptionEvidence(evidence);
  if (
    bindingKeys.some((key) => grant.binding[key] !== scope.binding[key]) ||
    grant.ownerId !== scope.ownerId ||
    grant.admissionDigest !== scope.admissionDigest ||
    grant.catalogueKey !== scope.catalogueKey ||
    grant.mimeType !== scope.mimeType ||
    grant.sourceByteLength !== scope.sourceByteLength ||
    !matches(checkedContentSha256, sha256)
  )
    return fail();
  const receipt = Object.freeze(Object.create(null)) as AdminUnscannedExceptionReceipt;
  const grantDigest: ContentSha256 = `sha256:${createHash("sha256").update(JSON.stringify({ grant, admission })).digest("hex")}`;
  receipts.set(
    receipt,
    Object.freeze({
      binding: Object.freeze({ ...scope.binding, contentSha256: checkedContentSha256 }),
      grantDigest,
      issuedAtMs: timestamp(grant.issuedAt),
      expiresAtMs: timestamp(grant.expiresAt),
    }),
  );
  return receipt;
}

/** Only a live receipt minted in this process for these exact bytes/attempt is accepted. */
export function readAdminUnscannedExceptionReceipt(
  receipt: unknown,
  binding: ProviderEgressBinding,
  purpose: ProviderEgressPurpose,
): ReceiptRecord | null {
  if (!receipt || typeof receipt !== "object") return null;
  const record = receipts.get(receipt);
  const now = Date.now();
  if (
    !record ||
    purpose !== "embedding" ||
    now < record.issuedAtMs ||
    now >= record.expiresAtMs ||
    bindingKeys.some((key) => record.binding[key] !== binding[key])
  )
    return null;
  return record;
}
