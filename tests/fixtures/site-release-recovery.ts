import {
  activationReceiptDigest,
  parseActivationReceipt,
  parseRecoveryReadinessEvidence,
  parseRollbackReceipt,
  recoveryReadinessDigest,
  rollbackReceiptDigest,
} from "../../src/lib/recovery-readiness-evidence";

export const siteReleaseProjectRef = "sjrfecxgysukkwxsowpy";
export const siteReleaseCandidateId = "11111111-1111-4111-8111-111111111111";
export const siteReleasePreviousId = "22222222-2222-4222-8222-222222222222";
export const siteReleaseGenerationId = "33333333-3333-4333-8333-333333333333";
export const siteReleaseNow = new Date("2026-08-24T12:00:00.000Z");
export const fixtureSha = (character: string) => `sha256:${character.repeat(64).slice(0, 64)}` as const;

const reference = (
  kind: "database-backup" | "pitr-status" | "storage-inventory" | "storage-recovery" | "restore-drill",
  id: string,
) => ({ kind, id });

export function validSiteReleaseRecoveryFixture(
  options: { candidateReleaseDigest?: `sha256:${string}`; stateDigest?: `sha256:${string}` } = {},
) {
  const evidencePayload = {
    version: 1 as const,
    evidenceId: "44444444-4444-4444-8444-444444444444",
    projectRef: siteReleaseProjectRef,
    operation: "site-release" as const,
    verifiedAt: "2026-08-24T06:00:00.000Z",
    validUntil: "2026-08-25T06:00:00.000Z",
    requiredRpoMinutes: 5,
    databaseBackup: {
      projectRef: siteReleaseProjectRef,
      recoveryBasisId: "55555555-5555-4555-8555-555555555555",
      reference: reference("database-backup", "backup-synthetic"),
      digest: fixtureSha("a"),
      verifiedAt: "2026-08-24T05:30:00.000Z",
    },
    pitr: {
      projectRef: siteReleaseProjectRef,
      recoveryBasisId: "55555555-5555-4555-8555-555555555555",
      enabled: true as const,
      rpoMinutes: 2,
      reference: reference("pitr-status", "pitr-synthetic"),
      digest: fixtureSha("b"),
      verifiedAt: "2026-08-24T05:30:00.000Z",
    },
    storageRecovery: {
      projectRef: siteReleaseProjectRef,
      recoveryBasisId: "55555555-5555-4555-8555-555555555555",
      inventoryReference: reference("storage-inventory", "inventory-synthetic"),
      inventoryDigest: fixtureSha("c"),
      recoveryReference: reference("storage-recovery", "recovery-synthetic"),
      recoveryDigest: fixtureSha("d"),
      verifiedAt: "2026-08-23T12:00:00.000Z",
    },
    restoreDrill: {
      projectRef: siteReleaseProjectRef,
      recoveryBasisId: "55555555-5555-4555-8555-555555555555",
      targetProjectRef: "isolatedrestore000001",
      reportReference: reference("restore-drill", "restore-synthetic"),
      reportDigest: fixtureSha("e"),
      databaseBackupDigest: fixtureSha("a"),
      pitrDigest: fixtureSha("b"),
      storageInventoryDigest: fixtureSha("c"),
      storageRecoveryDigest: fixtureSha("d"),
      completedAt: "2026-08-01T00:00:00.000Z",
      outcome: "passed" as const,
      target: "isolated-project" as const,
    },
  };
  const evidence = parseRecoveryReadinessEvidence({
    ...evidencePayload,
    digest: recoveryReadinessDigest(evidencePayload),
  });
  const activationPayload = {
    version: 1 as const,
    receiptId: "66666666-6666-4666-8666-666666666666",
    sequence: 7,
    recordedAt: "2026-08-24T07:00:00.000Z",
    projectRef: siteReleaseProjectRef,
    operation: "site-release" as const,
    recoveryEvidenceId: evidence.evidenceId,
    recoveryEvidenceDigest: evidence.digest,
    stateDigest: options.stateDigest ?? fixtureSha("f"),
    resource: {
      kind: "site-release" as const,
      releaseId: siteReleaseCandidateId,
      releaseDigest: options.candidateReleaseDigest ?? fixtureSha("1"),
    },
    previousResource: {
      kind: "site-release" as const,
      releaseId: siteReleasePreviousId,
      releaseDigest: fixtureSha("2"),
    },
  };
  const activation = parseActivationReceipt({
    ...activationPayload,
    digest: activationReceiptDigest(activationPayload),
  });
  const rollbackPayload = {
    version: 1 as const,
    receiptId: "77777777-7777-4777-8777-777777777777",
    sequence: 8,
    recordedAt: "2026-08-24T08:00:00.000Z",
    projectRef: siteReleaseProjectRef,
    operation: "site-release" as const,
    activationReceiptId: activation.receiptId,
    activationReceiptDigest: activation.digest,
    recoveryEvidenceDigest: evidence.digest,
    failedResource: activation.resource,
    restoredResource: activation.previousResource,
    restorationMethod: "retained-pointer" as const,
  };
  const rollback = parseRollbackReceipt({ ...rollbackPayload, digest: rollbackReceiptDigest(rollbackPayload) });
  return {
    evidence,
    activation: activation as typeof activation & {
      operation: "site-release";
      resource: typeof activationPayload.resource;
      previousResource: typeof activationPayload.previousResource;
    },
    rollback,
  };
}
