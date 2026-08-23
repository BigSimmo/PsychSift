import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  activationReceiptDigest,
  assertActivationReceiptBinding,
  assertRecoveryReadinessForOperation,
  assertRollbackReceiptBinding,
  parseActivationReceipt,
  parseRecoveryReadinessEvidence,
  parseRollbackReceipt,
  recoveryReadinessDigest,
  rollbackReceiptDigest,
  type ActivationReceipt,
  type RecoveryReadinessEvidence,
  type RollbackReceipt,
} from "../src/lib/recovery-readiness-evidence";
import { runVerifyRecoveryReadinessEvidenceCli } from "../scripts/verify-recovery-readiness-evidence";

const now = "2026-08-24T12:00:00.000Z";
const projectRef = "sjrfecxgysukkwxsowpy";
const recoveryBasisId = "10101010-1010-4010-8010-101010101010";
const sha = (character: string) => `sha256:${character.repeat(64)}`;
const reference = (
  kind: "database-backup" | "pitr-status" | "storage-inventory" | "storage-recovery" | "restore-drill",
  id: string,
) => ({ kind, id });

function recoveryInput(overrides: Record<string, unknown> = {}) {
  const payload = {
    version: 1 as const,
    evidenceId: "11111111-1111-4111-8111-111111111111",
    projectRef,
    operation: "document-generation" as const,
    verifiedAt: "2026-08-24T06:00:00.000Z",
    validUntil: "2026-08-25T06:00:00.000Z",
    requiredRpoMinutes: 5,
    databaseBackup: {
      projectRef,
      recoveryBasisId,
      reference: reference("database-backup", "backup-2026-08-24-001"),
      digest: sha("a"),
      verifiedAt: "2026-08-24T05:30:00.000Z",
    },
    pitr: {
      projectRef,
      recoveryBasisId,
      enabled: true as const,
      rpoMinutes: 2,
      reference: reference("pitr-status", "pitr-window-2026-08-24-001"),
      digest: sha("b"),
      verifiedAt: "2026-08-24T05:30:00.000Z",
    },
    storageRecovery: {
      projectRef,
      recoveryBasisId,
      inventoryReference: reference("storage-inventory", "storage-inventory-2026-08-23-001"),
      inventoryDigest: sha("c"),
      recoveryReference: reference("storage-recovery", "storage-recovery-runbook-v1"),
      recoveryDigest: sha("d"),
      verifiedAt: "2026-08-23T12:00:00.000Z",
    },
    restoreDrill: {
      projectRef,
      recoveryBasisId,
      targetProjectRef: "isolatedrestore000001",
      reportReference: reference("restore-drill", "isolated-restore-2026-08-01-001"),
      reportDigest: sha("e"),
      databaseBackupDigest: sha("a"),
      pitrDigest: sha("b"),
      storageInventoryDigest: sha("c"),
      storageRecoveryDigest: sha("d"),
      completedAt: "2026-08-01T00:00:00.000Z",
      outcome: "passed" as const,
      target: "isolated-project" as const,
    },
    ...overrides,
  };
  return { ...payload, digest: recoveryReadinessDigest(payload) };
}

function activationInput(evidence: RecoveryReadinessEvidence, overrides: Record<string, unknown> = {}) {
  const payload = {
    version: 1 as const,
    receiptId: "22222222-2222-4222-8222-222222222222",
    sequence: 7,
    recordedAt: "2026-08-24T07:00:00.000Z",
    projectRef,
    operation: "document-generation" as const,
    recoveryEvidenceId: evidence.evidenceId,
    recoveryEvidenceDigest: evidence.digest,
    stateDigest: sha("f"),
    resource: {
      kind: "document-generation" as const,
      documentId: "33333333-3333-4333-8333-333333333333",
      generationId: "44444444-4444-4444-8444-444444444444",
      generationDigest: sha("1"),
    },
    previousResource: {
      kind: "document-generation" as const,
      documentId: "33333333-3333-4333-8333-333333333333",
      generationId: "55555555-5555-4555-8555-555555555555",
      generationDigest: sha("2"),
    },
    ...overrides,
  };
  return { ...payload, digest: activationReceiptDigest(payload) };
}

function rollbackInput(activation: ActivationReceipt, overrides: Record<string, unknown> = {}) {
  const payload = {
    version: 1 as const,
    receiptId: "66666666-6666-4666-8666-666666666666",
    sequence: activation.sequence + 1,
    recordedAt: "2026-08-26T07:00:00.000Z",
    projectRef,
    operation: activation.operation,
    activationReceiptId: activation.receiptId,
    activationReceiptDigest: activation.digest,
    recoveryEvidenceDigest: activation.recoveryEvidenceDigest,
    failedResource: activation.resource,
    restoredResource: activation.previousResource,
    restorationMethod: "retained-pointer" as const,
    ...overrides,
  };
  return { ...payload, digest: rollbackReceiptDigest(payload) };
}

describe("recovery readiness evidence", () => {
  it("parses and freezes project-bound provider-free evidence with a canonical digest", () => {
    const input = recoveryInput();
    const reordered = Object.fromEntries(Object.entries(input).reverse());
    const evidence = parseRecoveryReadinessEvidence(reordered);

    expect(evidence.digest).toBe(input.digest);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.storageRecovery)).toBe(true);
    expect(recoveryReadinessDigest(evidence)).toBe(input.digest);
  });

  it("accepts fresh PITR, database, Storage, and isolated restore evidence for the exact operation", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const evidence = parseRecoveryReadinessEvidence(recoveryInput());

    expect(assertRecoveryReadinessForOperation(evidence, "document-generation", projectRef)).toBe(evidence);
    vi.useRealTimers();
  });

  it("accepts the exact 24-hour database and PITR freshness boundary", () => {
    const at = new Date(now);
    const boundary = "2026-08-23T12:00:00.000Z";
    const evidence = parseRecoveryReadinessEvidence(
      recoveryInput({
        verifiedAt: boundary,
        databaseBackup: { ...recoveryInput().databaseBackup, verifiedAt: boundary },
        pitr: { ...recoveryInput().pitr, verifiedAt: boundary },
      }),
    );
    expect(assertRecoveryReadinessForOperation(evidence, evidence.operation, projectRef, at)).toBe(evidence);
  });

  it.each([
    ["wrong project", { projectRef: "differentprojectref000" }, /project/i],
    ["wrong operation", { operation: "site-release" }, /operation/i],
    ["PITR disabled", { pitr: { ...recoveryInput().pitr, enabled: false } }, /pitr/i],
    ["RPO weaker than required", { pitr: { ...recoveryInput().pitr, rpoMinutes: 30 } }, /rpo/i],
    ["expired envelope", { validUntil: "2026-08-24T11:59:59.000Z" }, /expired|valid/i],
    ["stale verification", { verifiedAt: "2026-08-23T11:59:59.000Z" }, /24 hours|fresh/i],
    [
      "stale database backup",
      { databaseBackup: { ...recoveryInput().databaseBackup, verifiedAt: "2020-01-01T00:00:00.000Z" } },
      /database|24 hours|fresh/i,
    ],
    [
      "stale PITR status",
      { pitr: { ...recoveryInput().pitr, verifiedAt: "2020-01-01T00:00:00.000Z" } },
      /pitr|24 hours|fresh/i,
    ],
    [
      "stale Storage inventory",
      { storageRecovery: { ...recoveryInput().storageRecovery, verifiedAt: "2026-08-17T11:59:59.000Z" } },
      /storage/i,
    ],
    ["failed restore drill", { restoreDrill: { ...recoveryInput().restoreDrill, outcome: "failed" } }, /restore/i],
    [
      "stale restore drill",
      { restoreDrill: { ...recoveryInput().restoreDrill, completedAt: "2026-05-26T11:59:59.000Z" } },
      /restore/i,
    ],
  ])("rejects %s", (_name, overrides, message) => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const evidence = parseRecoveryReadinessEvidence(recoveryInput(overrides));
    const expectedOperation = "operation" in overrides ? "document-generation" : evidence.operation;
    const expectedProject = "projectRef" in overrides ? projectRef : evidence.projectRef;
    expect(() => assertRecoveryReadinessForOperation(evidence, expectedOperation, expectedProject)).toThrow(message);
    vi.useRealTimers();
  });

  it("fails closed on invalid or disordered clocks and evidence beyond bounded future skew", () => {
    const evidence = parseRecoveryReadinessEvidence(recoveryInput());
    expect(() =>
      assertRecoveryReadinessForOperation(evidence, evidence.operation, projectRef, new Date(Number.NaN)),
    ).toThrow(/clock|time|finite/i);

    const invalidOrder = parseRecoveryReadinessEvidence(recoveryInput({ validUntil: "2026-08-24T05:59:59.000Z" }));
    expect(() =>
      assertRecoveryReadinessForOperation(invalidOrder, invalidOrder.operation, projectRef, new Date(now)),
    ).toThrow(/order|valid/i);

    const future = parseRecoveryReadinessEvidence(
      recoveryInput({
        verifiedAt: "2026-08-24T12:06:00.000Z",
        validUntil: "2026-08-25T12:06:00.000Z",
        databaseBackup: { ...recoveryInput().databaseBackup, verifiedAt: "2026-08-24T12:06:00.000Z" },
        pitr: { ...recoveryInput().pitr, verifiedAt: "2026-08-24T12:06:00.000Z" },
      }),
    );
    expect(() => assertRecoveryReadinessForOperation(future, future.operation, projectRef, new Date(now))).toThrow(
      /future|skew/i,
    );
  });

  it("binds every recovery layer and the isolated drill to one exact project and recovery basis", () => {
    const mixedProject = parseRecoveryReadinessEvidence(
      recoveryInput({
        databaseBackup: { ...recoveryInput().databaseBackup, projectRef: "differentprojectref000" },
      }),
    );
    expect(() =>
      assertRecoveryReadinessForOperation(mixedProject, mixedProject.operation, projectRef, new Date(now)),
    ).toThrow(/project/i);

    const mixedBasis = parseRecoveryReadinessEvidence(
      recoveryInput({
        restoreDrill: { ...recoveryInput().restoreDrill, storageRecoveryDigest: sha("9") },
      }),
    );
    expect(() =>
      assertRecoveryReadinessForOperation(mixedBasis, mixedBasis.operation, projectRef, new Date(now)),
    ).toThrow(/basis|digest|restore/i);
  });

  it("rejects a digest mismatch and missing recovery layers", () => {
    expect(() => parseRecoveryReadinessEvidence({ ...recoveryInput(), digest: sha("0") })).toThrow(/digest/i);
    const { storageRecovery: _storageRecovery, ...missingStorage } = recoveryInput();
    expect(() => parseRecoveryReadinessEvidence(missingStorage)).toThrow();
    const { restoreDrill: _restoreDrill, ...missingRestore } = recoveryInput();
    expect(() => parseRecoveryReadinessEvidence(missingRestore)).toThrow();
  });

  it.each([
    [
      "signed URL",
      {
        databaseBackup: {
          ...recoveryInput().databaseBackup,
          reference: reference("database-backup", "https://backup.example/x?token=secret"),
        },
      },
    ],
    ["provider token", { providerToken: "secret-value" }],
    ["raw provider output", { rawProviderOutput: { backups: ["private"] } }],
  ])("rejects %s instead of retaining provider output", (_name, mutation) => {
    expect(() => parseRecoveryReadinessEvidence(recoveryInput(mutation))).toThrow();
  });

  it.each([
    ['{"providerPayload":{"backup":"private-record"}}'],
    ["provider output\nsecond line"],
    ["//backup.example/private"],
    ["s3://private-bucket/object"],
    ["azure-backup?sig=signed-value"],
    ["opaque id with whitespace"],
  ])("rejects non-opaque evidence reference payload %s", (id) => {
    expect(() =>
      parseRecoveryReadinessEvidence(
        recoveryInput({
          databaseBackup: {
            ...recoveryInput().databaseBackup,
            reference: reference("database-backup", id),
          },
        }),
      ),
    ).toThrow(/reference|invalid/i);
  });
});

describe("append-only activation and rollback receipts", () => {
  it("binds an immutable activation identity to exact evidence, state, and prior retained resource", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const evidence = parseRecoveryReadinessEvidence(recoveryInput());
    const receipt = parseActivationReceipt(activationInput(evidence));

    expect(assertActivationReceiptBinding(receipt, evidence, projectRef)).toStrictEqual(receipt);
    expect(Object.isFrozen(receipt.resource)).toBe(true);
    expect(receipt.resource).not.toEqual(receipt.previousResource);
    vi.useRealTimers();
  });

  it("rejects absent previous-generation identity, operation drift, and replaceable receipt content", () => {
    const evidence = parseRecoveryReadinessEvidence(recoveryInput());
    const input = activationInput(evidence);
    const { previousResource: _previousResource, ...withoutPrevious } = input;
    expect(() => parseActivationReceipt(withoutPrevious)).toThrow(/previous|resource/i);

    const operationDrift = activationInput(evidence, { operation: "site-release" });
    expect(() => parseActivationReceipt(operationDrift)).toThrow(/resource|operation/i);

    expect(() => parseActivationReceipt({ ...input, stateDigest: sha("9") })).toThrow(/digest/i);
  });

  it("allows rollback after evidence expires only by restoring the exact retained prior resource", () => {
    const evidence = parseRecoveryReadinessEvidence(recoveryInput());
    const activation = parseActivationReceipt(activationInput(evidence));
    const rollback = parseRollbackReceipt(rollbackInput(activation));
    vi.useFakeTimers();
    vi.setSystemTime("2026-12-01T00:00:00.000Z");

    expect(
      assertRollbackReceiptBinding(rollback, activation, evidence, projectRef, new Date("2026-12-01T00:00:00Z")),
    ).toStrictEqual(rollback);
    vi.useRealTimers();
  });

  it("rejects digest, project, operation, sequence, and retained-resource mismatches", () => {
    const evidence = parseRecoveryReadinessEvidence(recoveryInput());
    const activation = parseActivationReceipt(activationInput(evidence));
    const valid = rollbackInput(activation);

    for (const mutation of [
      { activationReceiptDigest: sha("8") },
      { recoveryEvidenceDigest: sha("8") },
      { projectRef: "differentprojectref000" },
      { operation: "site-release" },
      { sequence: activation.sequence },
      {
        restoredResource: {
          ...activation.previousResource,
          generationId: "77777777-7777-4777-8777-777777777777",
        },
      },
    ]) {
      expect(() => {
        const candidate = parseRollbackReceipt(rollbackInput(activation, mutation));
        assertRollbackReceiptBinding(candidate, activation, evidence, projectRef);
      }).toThrow();
    }
    expect(() => parseRollbackReceipt({ ...valid, restorationMethod: "reconstructed" })).toThrow(/retained/i);
  });

  it("rejects reused receipt identity, equal append time, and future activation or rollback receipts", () => {
    const evidence = parseRecoveryReadinessEvidence(recoveryInput());
    const activation = parseActivationReceipt(activationInput(evidence));
    const reusedId = parseRollbackReceipt(rollbackInput(activation, { receiptId: activation.receiptId }));
    expect(() =>
      assertRollbackReceiptBinding(reusedId, activation, evidence, projectRef, new Date("2026-08-26T08:00:00Z")),
    ).toThrow(/identity|receipt/i);

    const equalTime = parseRollbackReceipt(rollbackInput(activation, { recordedAt: activation.recordedAt }));
    expect(() =>
      assertRollbackReceiptBinding(equalTime, activation, evidence, projectRef, new Date("2026-08-26T08:00:00Z")),
    ).toThrow(/append|time|order/i);

    const futureActivation = parseActivationReceipt(
      activationInput(evidence, { recordedAt: "2026-08-24T12:06:00.000Z" }),
    );
    expect(() => assertActivationReceiptBinding(futureActivation, evidence, projectRef, new Date(now))).toThrow(
      /future|skew/i,
    );

    const futureRollback = parseRollbackReceipt(rollbackInput(activation, { recordedAt: "2026-08-26T08:06:00.000Z" }));
    expect(() =>
      assertRollbackReceiptBinding(futureRollback, activation, evidence, projectRef, new Date("2026-08-26T08:00:00Z")),
    ).toThrow(/future|skew/i);
  });

  it("rejects disordered or future promotion evidence during rollback without reapplying freshness", () => {
    const disorderedEvidence = parseRecoveryReadinessEvidence(
      recoveryInput({ validUntil: "2026-08-24T05:59:00.000Z" }),
    );
    const earlyActivation = parseActivationReceipt(
      activationInput(disorderedEvidence, { recordedAt: "2026-08-24T05:58:00.000Z" }),
    );
    const rollback = parseRollbackReceipt(rollbackInput(earlyActivation, { recordedAt: "2026-08-24T07:00:00.000Z" }));
    expect(() =>
      assertRollbackReceiptBinding(rollback, earlyActivation, disorderedEvidence, projectRef, new Date(now)),
    ).toThrow(/clock|order|valid/i);

    const futureEvidence = parseRecoveryReadinessEvidence(recoveryInput());
    const futureBasisActivation = parseActivationReceipt(
      activationInput(futureEvidence, { recordedAt: "2026-08-24T05:55:00.000Z" }),
    );
    const futureBasisRollback = parseRollbackReceipt(
      rollbackInput(futureBasisActivation, { recordedAt: "2026-08-24T05:56:00.000Z" }),
    );
    expect(() =>
      assertRollbackReceiptBinding(
        futureBasisRollback,
        futureBasisActivation,
        futureEvidence,
        projectRef,
        new Date("2026-08-24T05:51:00.000Z"),
      ),
    ).toThrow(/future|skew/i);
  });
});

describe("offline recovery evidence verifier", () => {
  it("is import-safe and emits only bounded identity and digest JSON", async () => {
    const source = readFileSync(new URL("../scripts/verify-recovery-readiness-evidence.ts", import.meta.url), "utf8");
    expect(source).toContain("import.meta.url === pathToFileURL(resolve(process.argv[1])).href");
    expect(source).not.toContain("supabase-recovery-status");

    const evidence = recoveryInput();
    const stdout = vi.fn();
    await runVerifyRecoveryReadinessEvidenceCli(
      [
        "--input",
        "synthetic.json",
        "--operation",
        "document-generation",
        "--project-ref",
        projectRef,
        "--digest",
        evidence.digest,
      ],
      { readText: async () => JSON.stringify(evidence), stdout, now: new Date(now) },
    );

    const output = stdout.mock.calls[0]?.[0] as string;
    expect(JSON.parse(output)).toEqual({
      status: "valid",
      version: 1,
      evidenceId: evidence.evidenceId,
      projectRef,
      operation: "document-generation",
      digest: evidence.digest,
    });
    expect(output).not.toContain("operator-evidence");
  });

  it("rejects a CLI digest mismatch without echoing artifact content", async () => {
    const evidence = recoveryInput();
    const stdout = vi.fn();
    await expect(
      runVerifyRecoveryReadinessEvidenceCli(
        [
          "--input",
          "synthetic.json",
          "--operation",
          "document-generation",
          "--project-ref",
          projectRef,
          "--digest",
          sha("0"),
        ],
        { readText: async () => JSON.stringify(evidence), stdout },
      ),
    ).rejects.toThrow(/digest/i);
    expect(stdout).not.toHaveBeenCalled();
  });
});
