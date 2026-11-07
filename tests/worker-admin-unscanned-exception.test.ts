import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_UNSCANNED_EXCEPTION_POLICY,
  issueAdminUnscannedExceptionReceipt,
  snapshotAdminUnscannedExceptionEvidence,
  type AdminUnscannedExceptionEvidence,
  type AdminUnscannedExceptionScope,
} from "../supabase/functions/_shared/admin-unscanned-exception";
import {
  createDocumentIngressSafetyAuthority,
  evaluateDocumentIngressSafety,
  type DocumentIngressSafetyObservations,
} from "../src/lib/document-ingress-safety";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (n: string) => `sha256:${n.repeat(64)}` as const;
function fixture() {
  const admissionDigest = hash("c");
  const binding = {
    admissionEventId: uuid(1),
    documentId: uuid(2),
    generationId: uuid(3),
    jobId: uuid(4),
    attemptId: "synthetic-attempt",
    leaseId: uuid(5),
    contentSha256: hash("a"),
    authorityDigest: hash("b"),
  };
  const scope: AdminUnscannedExceptionScope = {
    binding,
    ownerId: uuid(6),
    admissionDigest,
    catalogueKey: "tga",
    mimeType: "text/plain",
    sourceByteLength: 100,
  };
  const evidence: AdminUnscannedExceptionEvidence = {
    grant: {
      policyVersion: ADMIN_UNSCANNED_EXCEPTION_POLICY,
      exceptionId: uuid(7),
      status: "active",
      administratorId: uuid(8),
      ownerId: scope.ownerId,
      binding: { ...binding },
      admissionDigest,
      catalogueKey: scope.catalogueKey,
      mimeType: "text/plain",
      sourceByteLength: 100,
      purpose: "embedding",
      approvalReferenceSha256: hash("d"),
      issuedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    },
    admission: {
      sourceChannel: "admin_api",
      actorKind: "administrator",
      administratorId: uuid(8),
      administratorActive: true,
      ownerId: scope.ownerId,
      documentId: binding.documentId,
      admissionEventId: binding.admissionEventId,
      admissionDigest,
      sourceSha256: binding.contentSha256,
    },
  };
  const receipt = issueAdminUnscannedExceptionReceipt(evidence, scope, binding.contentSha256);
  const observations: DocumentIngressSafetyObservations = {
    binding,
    policyVersion: "synthetic-operative-rights-and-source-policy",
    purpose: "embedding",
    admission: "current",
    ownerScope: "permitted",
    rights: "permitted",
    purposeClearance: "permitted",
    scanner: {
      verdict: "unscanned",
      scannerVersion: ADMIN_UNSCANNED_EXCEPTION_POLICY,
      contentSha256: binding.contentSha256,
      exceptionReceipt: receipt,
    },
    activeContent: "absent",
    identifiers: "absent",
    hiddenText: "not_applicable",
    encryption: "not_encrypted",
    source: "eligible",
    indexLicence: "permitted",
    sourcePolicy: "matched",
  };
  return { binding, scope, evidence, receipt, observations };
}
afterEach(() => vi.useRealTimers());

describe("source-scoped administrator unscanned exception", () => {
  it("reports unscanned and binds expiry without manufacturing a clean scanner result", () => {
    const f = fixture();
    const result = evaluateDocumentIngressSafety(f.observations);
    expect(result).toMatchObject({ verdict: "pass", validUntilMs: Date.parse(f.evidence.grant.expiresAt) });
    if (result.verdict !== "pass") throw new Error("expected pass");
    expect(result.checks).toContainEqual(expect.stringMatching(/^scanner:unscanned:/));
    expect(result.checks.some((check) => check.startsWith("scanner:clean"))).toBe(false);
  });

  it.each([
    "admissionEventId",
    "documentId",
    "generationId",
    "jobId",
    "attemptId",
    "leaseId",
    "contentSha256",
    "authorityDigest",
  ] as const)("refuses a grant for a different %s", (key) => {
    const f = fixture();
    expect(() =>
      issueAdminUnscannedExceptionReceipt(
        f.evidence,
        {
          ...f.scope,
          binding: { ...f.binding, [key]: key.endsWith("Sha256") || key === "authorityDigest" ? hash("e") : uuid(99) },
        },
        f.binding.contentSha256,
      ),
    ).toThrow(/^admin_unscanned_exception_invalid$/);
  });
  it.each([
    ["ownerId", uuid(99)],
    ["admissionDigest", hash("e")],
    ["catalogueKey", "nhmrc"],
    ["mimeType", "application/pdf"],
    ["sourceByteLength", 101],
  ])("refuses a different source scope %s", (key, value) => {
    const f = fixture();
    expect(() =>
      issueAdminUnscannedExceptionReceipt(f.evidence, { ...f.scope, [key]: value }, f.binding.contentSha256),
    ).toThrow();
  });

  it.each([
    { sourceChannel: "backend_import" },
    { actorKind: "trusted_backend" },
    { administratorActive: false },
    { administratorId: uuid(99) },
    { documentId: uuid(99) },
    { ownerId: uuid(99) },
    { admissionEventId: uuid(99) },
    { admissionDigest: hash("e") },
    { sourceSha256: hash("e") },
  ])("refuses missing or conflicting current administrator provenance: %j", (override) => {
    const f = fixture();
    expect(() =>
      snapshotAdminUnscannedExceptionEvidence({ ...f.evidence, admission: { ...f.evidence.admission, ...override } }),
    ).toThrow();
  });

  it.each([
    { status: "revoked" },
    { purpose: "caption" },
    { policyVersion: "unknown" },
    { issuedAt: "not-a-date" },
    { expiresAt: "2000-01-01T00:00:00.000Z" },
    { issuedAt: "2099-01-01T00:00:00.000Z" },
    { expiresAt: "2099-01-02T00:00:00.000Z" },
    { admissionDigest: "not-a-digest" },
    { approvalReferenceSha256: "not-a-digest" },
    { extra: true },
  ])("rejects revoked, malformed or unbounded grants: %j", (override) => {
    const f = fixture();
    expect(() =>
      snapshotAdminUnscannedExceptionEvidence({ ...f.evidence, grant: { ...f.evidence.grant, ...override } }),
    ).toThrow();
  });

  it("rejects JSON records, cloned receipts, other payloads, purposes and missing receipts", () => {
    const f = fixture();
    for (const receipt of [f.evidence, JSON.parse(JSON.stringify(f.receipt)), { ...f.receipt }, undefined]) {
      expect(
        evaluateDocumentIngressSafety({
          ...f.observations,
          scanner: { ...f.observations.scanner, exceptionReceipt: receipt },
        }).verdict,
      ).toBe("quarantine");
    }
    expect(evaluateDocumentIngressSafety({ ...f.observations, purpose: "summary" }).verdict).toBe("quarantine");
    expect(
      evaluateDocumentIngressSafety({ ...f.observations, binding: { ...f.binding, contentSha256: hash("e") } }).verdict,
    ).toBe("quarantine");
    const payloadHash = hash("e");
    const payloadReceipt = issueAdminUnscannedExceptionReceipt(f.evidence, f.scope, payloadHash);
    expect(
      evaluateDocumentIngressSafety({
        ...f.observations,
        binding: { ...f.binding, contentSha256: payloadHash },
        scanner: { ...f.observations.scanner, contentSha256: payloadHash, exceptionReceipt: payloadReceipt },
      }).verdict,
    ).toBe("pass");
  });

  it.each([
    { admission: "revoked" },
    { rights: "denied" },
    { ownerScope: "denied" },
    { purposeClearance: "denied" },
    { identifiers: "detected" },
    { activeContent: "detected" },
    { hiddenText: "conflict" },
    { encryption: "unsupported" },
    { source: "link_only" },
    { indexLicence: "not_permitted" },
    { sourcePolicy: "mismatch" },
    { scanner: { verdict: "malware", scannerVersion: "real-scanner", contentSha256: hash("a") } },
  ])("never overrides other safety refusals: %j", (override) => {
    expect(evaluateDocumentIngressSafety({ ...fixture().observations, ...override }).verdict).toBe("quarantine");
  });

  it("expires at the grant boundary during evaluation, permit issuance and permit use", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T12:00:00.000Z"));
    const f = fixture();
    const authority = createDocumentIngressSafetyAuthority({ permitTtlMs: 30_000 });
    const result = authority.evaluate(f.observations);
    const permit = authority.issuePermit(result, f.binding, "embedding");
    vi.setSystemTime(Date.now() + 999);
    expect(() => authority.assertPermit(permit, f.binding, "embedding", result)).not.toThrow();
    vi.setSystemTime(Date.now() + 1);
    expect(authority.evaluate(f.observations).verdict).toBe("quarantine");
    expect(() => authority.assertPermit(permit, f.binding, "embedding", result)).toThrow(
      /provider_egress_permit_stale/,
    );
    expect(() => authority.issuePermit(result, f.binding, "embedding")).toThrow(/provider_egress_permit_stale/);
  });
});
