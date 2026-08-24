import { createHmac, timingSafeEqual } from "node:crypto";

import {
  assertActivationReceiptBinding,
  assertRecoveryReadinessForOperation,
  assertRollbackReceiptBinding,
  parseRecoveryReadinessEvidence,
  type ActivationReceipt,
  type RecoveryReadinessEvidence,
  type RollbackReceipt,
} from "@/lib/recovery-readiness-evidence";
import { siteContentSyncCanonicalJson, siteContentSyncDigest } from "@/lib/site-content/site-content-sync";

export type SiteContentRecoveryValidationPurpose = "adopt" | "begin" | "verify" | "activate" | "rollback";

export type SiteContentRecoveryValidationBinding = Readonly<{
  version: "site-content-recovery-validation-v1";
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

export function createSiteContentEvidenceValidationBinding(
  purpose: Exclude<SiteContentRecoveryValidationPurpose, "activate" | "rollback">,
  evidenceInput: unknown,
  payload: unknown,
  options: { expectedProjectRef: string; now: Date; secret: string },
): SiteContentRecoveryValidationBinding {
  const evidence = parseRecoveryReadinessEvidence(evidenceInput);
  assertRecoveryReadinessForOperation(evidence, "site-release", options.expectedProjectRef, options.now);
  const withoutMac = {
    version: "site-content-recovery-validation-v1" as const,
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
  secret: string,
) {
  const { mac, ...withoutMac } = input;
  if (!/^[a-f0-9]{64}$/.test(mac)) return false;
  const expected = bindingMac(withoutMac, secret);
  return timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(expected, "hex"));
}

export function siteContentRecoveryBindingPayload(purpose: SiteContentRecoveryValidationPurpose, payload: unknown) {
  return { purpose, payloadDigest: siteContentSyncDigest(payload) } as const;
}

export type { RecoveryReadinessEvidence };
