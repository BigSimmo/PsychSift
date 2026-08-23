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
const sha = (character: string) => `sha256:${character.repeat(64)}`;

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
      reference: "operator-evidence:database-backup:2026-08-24",
      digest: sha("a"),
      verifiedAt: "2026-08-24T05:30:00.000Z",
    },
    pitr: {
      enabled: true as const,
      rpoMinutes: 2,
      reference: "operator-evidence:pitr:2026-08-24",
      digest: sha("b"),
      verifiedAt: "2026-08-24T05:30:00.000Z",
    },
    storageRecovery: {
      inventoryReference: "operator-evidence:storage-inventory:2026-08-23",
      inventoryDigest: sha("c"),
      recoveryReference: "runbook:storage-recovery:v1",
      recoveryDigest: sha("d"),
      verifiedAt: "2026-08-23T12:00:00.000Z",
    },
    restoreDrill: {
      reportReference: "operator-evidence:isolated-restore:2026-08-01",
      reportDigest: sha("e"),
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

  it.each([
    ["wrong project", { projectRef: "differentprojectref000" }, /project/i],
    ["wrong operation", { operation: "site-release" }, /operation/i],
    ["PITR disabled", { pitr: { ...recoveryInput().pitr, enabled: false } }, /pitr/i],
    ["RPO weaker than required", { pitr: { ...recoveryInput().pitr, rpoMinutes: 30 } }, /rpo/i],
    ["expired envelope", { validUntil: "2026-08-24T11:59:59.000Z" }, /expired|valid/i],
    ["stale verification", { verifiedAt: "2026-08-23T11:59:59.000Z" }, /24 hours|fresh/i],
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
      { databaseBackup: { ...recoveryInput().databaseBackup, reference: "https://backup.example/x?token=secret" } },
    ],
    ["provider token", { providerToken: "secret-value" }],
    ["raw provider output", { rawProviderOutput: { backups: ["private"] } }],
  ])("rejects %s instead of retaining provider output", (_name, mutation) => {
    expect(() => parseRecoveryReadinessEvidence(recoveryInput(mutation))).toThrow();
  });
});

describe("append-only activation and rollback receipts", () => {
  it("binds an immutable activation identity to exact evidence, state, and prior retained resource", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const evidence = parseRecoveryReadinessEvidence(recoveryInput());
    const receipt = parseActivationReceipt(activationInput(evidence));

    expect(assertActivationReceiptBinding(receipt, evidence, projectRef)).toBe(receipt);
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

    expect(assertRollbackReceiptBinding(rollback, activation, evidence, projectRef)).toBe(rollback);
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
