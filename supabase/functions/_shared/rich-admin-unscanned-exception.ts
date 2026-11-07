import { createHash } from "node:crypto";
import type { ContentSha256, ProviderEgressBinding, ProviderEgressPurpose } from "./document-ingress-safety.ts";

export const RICH_ADMIN_UNSCANNED_POLICY = "administrator-rich-source-unscanned-v2" as const;
const sha = /^sha256:[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export type RichAdminUnscannedEvidence = {
  version: typeof RICH_ADMIN_UNSCANNED_POLICY;
  grant: {
    exceptionId: string;
    approvalReferenceSha256: string;
    status: "active";
    issuedAt: string;
    expiresAt: string;
    allowedPurposes: ProviderEgressPurpose[];
  };
  provenance: {
    documentOwnerId: string | null;
    stewardId: string;
    administratorId: string;
    administratorActive: true;
    scope: "owner_private" | "existing_shared_library_stewardship";
    existingSharedPublic: boolean;
    admissionDigest: string;
    binding: ProviderEgressBinding;
  };
};
export type RichAdminUnscannedScope = {
  binding: ProviderEgressBinding;
  documentOwnerId: string | null;
  stewardId: string;
  scope: "owner_private" | "existing_shared_library_stewardship";
  existingSharedPublic: boolean;
  admissionDigest: string;
};
declare const receiptType: unique symbol;
export type RichAdminUnscannedReceipt = Readonly<{ [receiptType]: true }>;
type RecordValue = {
  binding: ProviderEgressBinding;
  grantDigest: ContentSha256;
  expiresAtMs: number;
  documentOwnerId: string | null;
  stewardId: string;
  scope: RichAdminUnscannedScope["scope"];
  purpose: ProviderEgressPurpose;
};
const receipts = new WeakMap<object, RecordValue>();
function refuse(): never {
  throw new Error("rich_admin_unscanned_exception_invalid");
}
function keys(value: unknown, names: readonly string[]): void {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== names.length ||
    names.some((name) => !Object.hasOwn(value, name))
  )
    refuse();
}
const matches = (value: unknown, expression: RegExp) => typeof value === "string" && expression.test(value);
function timestamp(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return refuse();
  const result = Date.parse(value);
  const canonical = value.includes(".")
    ? value.replace(/\.(\d{1,3})Z$/, (_match, fraction: string) => `.${fraction.padEnd(3, "0")}Z`)
    : value.replace(/Z$/, ".000Z");
  if (!Number.isFinite(result) || new Date(result).toISOString() !== canonical) return refuse();
  return result;
}
function bindingMatches(a: Readonly<ProviderEgressBinding>, b: Readonly<ProviderEgressBinding>): boolean {
  return (
    Object.keys(a).length === 8 && (Object.keys(b) as (keyof ProviderEgressBinding)[]).every((key) => a[key] === b[key])
  );
}

/** Actual server evidence is detached and checked every time; raw records never become permits. */
export function snapshotRichAdminUnscannedEvidence(value: unknown): RichAdminUnscannedEvidence {
  let e: RichAdminUnscannedEvidence;
  try {
    e = JSON.parse(JSON.stringify(value)) as RichAdminUnscannedEvidence;
  } catch {
    return refuse();
  }
  keys(e, ["version", "grant", "provenance"]);
  keys(e.grant, ["exceptionId", "approvalReferenceSha256", "status", "issuedAt", "expiresAt", "allowedPurposes"]);
  keys(e.provenance, [
    "documentOwnerId",
    "stewardId",
    "administratorId",
    "administratorActive",
    "scope",
    "existingSharedPublic",
    "admissionDigest",
    "binding",
  ]);
  const p = e.provenance;
  keys(p.binding, [
    "admissionEventId",
    "documentId",
    "generationId",
    "jobId",
    "attemptId",
    "leaseId",
    "contentSha256",
    "authorityDigest",
  ]);
  if (
    e.version !== RICH_ADMIN_UNSCANNED_POLICY ||
    e.grant.status !== "active" ||
    !matches(e.grant.exceptionId, uuid) ||
    !matches(e.grant.approvalReferenceSha256, sha) ||
    !Array.isArray(e.grant.allowedPurposes) ||
    e.grant.allowedPurposes.length < 1 ||
    e.grant.allowedPurposes.length > 4 ||
    e.grant.allowedPurposes.some((purpose) => !["caption", "embedding", "summary", "deep_memory"].includes(purpose)) ||
    (p.documentOwnerId !== null && !matches(p.documentOwnerId, uuid)) ||
    !matches(p.stewardId, uuid) ||
    !matches(p.administratorId, uuid) ||
    p.administratorActive !== true ||
    !["owner_private", "existing_shared_library_stewardship"].includes(p.scope) ||
    typeof p.existingSharedPublic !== "boolean" ||
    !matches(p.admissionDigest, sha) ||
    (["admissionEventId", "documentId", "generationId", "jobId", "leaseId"] as const).some(
      (key) => !matches(p.binding[key], uuid),
    ) ||
    !matches(p.binding.contentSha256, sha) ||
    !matches(p.binding.authorityDigest, sha) ||
    typeof p.binding.attemptId !== "string" ||
    !p.binding.attemptId ||
    p.binding.attemptId.length > 256
  )
    refuse();
  const start = timestamp(e.grant.issuedAt),
    end = timestamp(e.grant.expiresAt),
    now = Date.now();
  if (
    start > now ||
    end <= now ||
    end <= start ||
    end - start > 86400000 ||
    new Set(e.grant.allowedPurposes).size !== e.grant.allowedPurposes.length ||
    p.stewardId !== p.administratorId ||
    (p.scope === "owner_private"
      ? p.documentOwnerId !== p.stewardId || p.existingSharedPublic
      : p.documentOwnerId !== null || !p.existingSharedPublic)
  )
    refuse();
  return e;
}

export function issueRichAdminUnscannedReceipt(
  value: unknown,
  scope: RichAdminUnscannedScope,
  purpose: ProviderEgressPurpose,
  contentSha256: ContentSha256,
): RichAdminUnscannedReceipt {
  const e = snapshotRichAdminUnscannedEvidence(value),
    p = e.provenance;
  if (
    !e.grant.allowedPurposes.includes(purpose) ||
    !bindingMatches(p.binding as ProviderEgressBinding, scope.binding) ||
    p.documentOwnerId !== scope.documentOwnerId ||
    p.stewardId !== scope.stewardId ||
    p.scope !== scope.scope ||
    p.existingSharedPublic !== scope.existingSharedPublic ||
    p.admissionDigest !== scope.admissionDigest ||
    !matches(contentSha256, sha)
  )
    refuse();
  const token = Object.freeze(Object.create(null)) as RichAdminUnscannedReceipt;
  const grantDigest = `sha256:${createHash("sha256").update(JSON.stringify(e)).digest("hex")}` as ContentSha256;
  receipts.set(token, {
    binding: Object.freeze({ ...scope.binding, contentSha256 }),
    grantDigest,
    expiresAtMs: Date.parse(e.grant.expiresAt),
    documentOwnerId: p.documentOwnerId,
    stewardId: p.stewardId,
    scope: p.scope,
    purpose,
  });
  return token;
}

export function readRichAdminUnscannedReceipt(
  token: unknown,
  binding: ProviderEgressBinding,
  purpose: ProviderEgressPurpose,
): RecordValue | null {
  if (!token || typeof token !== "object") return null;
  const record = receipts.get(token);
  if (
    !record ||
    record.expiresAtMs <= Date.now() ||
    record.purpose !== purpose ||
    !bindingMatches(record.binding, binding)
  )
    return null;
  return { ...record, binding: { ...record.binding } };
}
