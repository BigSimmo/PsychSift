import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import {
  assertActivationReceiptBinding,
  assertRecoveryReadinessForOperation,
  assertRollbackReceiptBinding,
  parseRecoveryReadinessEvidence,
  type ActivationReceipt,
  type RecoveryReadinessEvidence,
  type RollbackReceipt,
} from "@/lib/recovery-readiness-evidence";
import {
  assertSiteContentSyncPlan,
  siteContentSyncCanonicalJson,
  siteContentSyncDigest,
} from "@/lib/site-content/site-content-sync";
import { assertSiteContentReleaseVerificationEvidence } from "@/lib/site-content/site-content-release-evidence";

export type SiteContentRecoveryValidationPurpose = "adopt" | "begin" | "verify" | "activate" | "rollback";

export type SiteContentRecoveryValidationBinding = Readonly<{
  version: "site-content-recovery-validation-v1";
  bindingId: string;
  purpose: SiteContentRecoveryValidationPurpose;
  projectRef: string;
  recoveryEvidenceDigest: `sha256:${string}`;
  payloadDigest: `sha256:${string}`;
  validatedAt: string;
  mac: string;
}>;

type ActivationInput = {
  action: "activate";
  evidence: unknown;
  activation: unknown;
  rollback?: undefined;
  expected: Pick<ActivationReceipt, "resource" | "previousResource" | "stateDigest">;
};

type RollbackInput = {
  action: "rollback";
  evidence: unknown;
  activation: unknown;
  rollback: unknown;
  expected: Pick<ActivationReceipt, "resource" | "previousResource" | "stateDigest">;
};

function bindingMac(binding: Omit<SiteContentRecoveryValidationBinding, "mac">, secret: string) {
  if (secret.length < 16) throw new Error("Site-content recovery validation secret is not configured safely.");
  return createHmac("sha256", secret).update(siteContentSyncCanonicalJson(binding)).digest("hex");
}

function assertSiteReleaseReceipt(receipt: ActivationReceipt) {
  if (
    receipt.operation !== "site-release" ||
    receipt.resource.kind !== "site-release" ||
    receipt.previousResource.kind !== "site-release"
  ) {
    throw new Error("Exact site-release activation identities are required.");
  }
}

function assertEvidenceTransitionPayload(
  purpose: Exclude<SiteContentRecoveryValidationPurpose, "activate" | "rollback">,
  payload: unknown,
  now: Date,
) {
  if (purpose === "begin") return assertSiteContentSyncPlan(payload);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Canonical site-content evidence transition payload is required.");
  }
  const transition = payload as { plan?: unknown; verificationEvidence?: unknown; records?: unknown };
  const plan = assertSiteContentSyncPlan(transition.plan);
  assertSiteContentReleaseVerificationEvidence(transition.verificationEvidence, plan, { now });
  if (purpose === "adopt") {
    if (!Array.isArray(transition.records)) throw new Error("Adoption records are required.");
    const expected = plan.operations
      .filter((operation) => operation.operation !== "tombstone")
      .map(({ logicalId, contentHash }) => ({ logicalId, contentHash }))
      .sort((left, right) => left.logicalId.localeCompare(right.logicalId));
    const actual = transition.records
      .map((record) => {
        if (!record || typeof record !== "object") throw new Error("Adoption record is invalid.");
        const value = record as { logicalId?: unknown; contentHash?: unknown };
        return { logicalId: value.logicalId, contentHash: value.contentHash };
      })
      .sort((left, right) => String(left.logicalId).localeCompare(String(right.logicalId)));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error("Adoption records do not match the canonical plan population.");
    }
  }
  return plan;
}

export function createSiteContentEvidenceValidationBinding(
  purpose: Exclude<SiteContentRecoveryValidationPurpose, "activate" | "rollback">,
  evidenceInput: unknown,
  payload: unknown,
  options: { expectedProjectRef: string; now: Date; secret: string },
): SiteContentRecoveryValidationBinding {
  const evidence = parseRecoveryReadinessEvidence(evidenceInput);
  assertRecoveryReadinessForOperation(evidence, "site-release", options.expectedProjectRef, options.now);
  const plan = assertEvidenceTransitionPayload(purpose, payload, options.now);
  if (plan.projectRef !== options.expectedProjectRef || plan.recoveryEvidenceDigest !== evidence.digest) {
    throw new Error("Evidence transition plan/recovery identity mismatch.");
  }
  const withoutMac = {
    version: "site-content-recovery-validation-v1" as const,
    bindingId: randomUUID(),
    purpose,
    projectRef: options.expectedProjectRef,
    recoveryEvidenceDigest: evidence.digest as `sha256:${string}`,
    payloadDigest: siteContentSyncDigest(payload),
    validatedAt: options.now.toISOString(),
  };
  return Object.freeze({ ...withoutMac, mac: bindingMac(withoutMac, options.secret) });
}

export function createSiteContentRecoveryValidationBinding(
  input: ActivationInput | RollbackInput,
  options: { expectedProjectRef: string; now: Date; secret: string },
): SiteContentRecoveryValidationBinding {
  const evidence = parseRecoveryReadinessEvidence(input.evidence);
  const activation = assertActivationReceiptBinding(
    input.activation,
    evidence,
    options.expectedProjectRef,
    options.now,
  );
  assertSiteReleaseReceipt(activation);
  if (
    siteContentSyncDigest({
      resource: activation.resource,
      previousResource: activation.previousResource,
      stateDigest: activation.stateDigest,
    }) !== siteContentSyncDigest(input.expected)
  ) {
    throw new Error("Activation target, predecessor, or state digest binding mismatch.");
  }
  let rollback: RollbackReceipt | undefined;
  if (input.action === "rollback") {
    rollback = assertRollbackReceiptBinding(
      input.rollback,
      activation,
      evidence,
      options.expectedProjectRef,
      options.now,
    );
  }
  const payload = {
    action: input.action,
    evidence,
    activation,
    ...(rollback ? { rollback } : {}),
  };
  const withoutMac = {
    version: "site-content-recovery-validation-v1" as const,
    bindingId: randomUUID(),
    purpose: input.action,
    projectRef: options.expectedProjectRef,
    recoveryEvidenceDigest: evidence.digest as `sha256:${string}`,
    payloadDigest: siteContentSyncDigest(payload),
    validatedAt: options.now.toISOString(),
  };
  return Object.freeze({ ...withoutMac, mac: bindingMac(withoutMac, options.secret) });
}

export function verifySiteContentRecoveryValidationBinding(
  input: SiteContentRecoveryValidationBinding,
  options: {
    secret: string;
    expectedPurpose: SiteContentRecoveryValidationPurpose;
    expectedProjectRef: string;
    expectedRecoveryEvidenceDigest: string;
    payload: unknown;
    now: Date;
  },
) {
  try {
    const { mac, ...withoutMac } = input;
    const validatedAt = Date.parse(input.validatedAt);
    if (
      !/^[a-f0-9]{64}$/.test(mac) ||
      input.version !== "site-content-recovery-validation-v1" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.bindingId) ||
      input.purpose !== options.expectedPurpose ||
      input.projectRef !== options.expectedProjectRef ||
      input.recoveryEvidenceDigest !== options.expectedRecoveryEvidenceDigest ||
      input.payloadDigest !== siteContentSyncDigest(options.payload) ||
      !Number.isFinite(validatedAt) ||
      Math.abs(options.now.getTime() - validatedAt) > 5 * 60 * 1000
    ) {
      return false;
    }
    const expected = bindingMac(withoutMac, options.secret);
    return timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export function siteContentRecoveryBindingPayload(purpose: SiteContentRecoveryValidationPurpose, payload: unknown) {
  return { purpose, payloadDigest: siteContentSyncDigest(payload) } as const;
}

export type { RecoveryReadinessEvidence };
