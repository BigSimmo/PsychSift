import { createHash } from "node:crypto";
import { z } from "zod";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const uuidSchema = z.string().uuid();
const projectRefSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9_-]{3,100}$/);
const timestampSchema = z.string().datetime({ offset: true });
const operationSchema = z.enum(["site-release", "document-generation"]);
const recoveryBasisIdSchema = uuidSchema;
const opaqueReferenceIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/);

function evidenceReferenceSchema<Kind extends string>(kind: Kind) {
  return z
    .object({
      kind: z.literal(kind),
      id: opaqueReferenceIdSchema,
    })
    .strict();
}

const databaseBackupSchema = z
  .object({
    projectRef: projectRefSchema,
    recoveryBasisId: recoveryBasisIdSchema,
    reference: evidenceReferenceSchema("database-backup"),
    digest: sha256Schema,
    verifiedAt: timestampSchema,
  })
  .strict();

const pitrSchema = z
  .object({
    projectRef: projectRefSchema,
    recoveryBasisId: recoveryBasisIdSchema,
    enabled: z.boolean(),
    rpoMinutes: z
      .number()
      .int()
      .positive()
      .max(24 * 60),
    reference: evidenceReferenceSchema("pitr-status"),
    digest: sha256Schema,
    verifiedAt: timestampSchema,
  })
  .strict();

const storageRecoverySchema = z
  .object({
    projectRef: projectRefSchema,
    recoveryBasisId: recoveryBasisIdSchema,
    inventoryReference: evidenceReferenceSchema("storage-inventory"),
    inventoryDigest: sha256Schema,
    recoveryReference: evidenceReferenceSchema("storage-recovery"),
    recoveryDigest: sha256Schema,
    verifiedAt: timestampSchema,
  })
  .strict();

const restoreDrillSchema = z
  .object({
    projectRef: projectRefSchema,
    recoveryBasisId: recoveryBasisIdSchema,
    targetProjectRef: projectRefSchema,
    reportReference: evidenceReferenceSchema("restore-drill"),
    reportDigest: sha256Schema,
    databaseBackupDigest: sha256Schema,
    pitrDigest: sha256Schema,
    storageInventoryDigest: sha256Schema,
    storageRecoveryDigest: sha256Schema,
    completedAt: timestampSchema,
    outcome: z.enum(["passed", "failed"]),
    target: z.enum(["isolated-project", "in-place"]),
  })
  .strict();

const recoveryReadinessSchema = z
  .object({
    version: z.literal(1),
    evidenceId: uuidSchema,
    projectRef: projectRefSchema,
    operation: operationSchema,
    verifiedAt: timestampSchema,
    validUntil: timestampSchema,
    requiredRpoMinutes: z
      .number()
      .int()
      .positive()
      .max(24 * 60),
    databaseBackup: databaseBackupSchema,
    pitr: pitrSchema,
    storageRecovery: storageRecoverySchema,
    restoreDrill: restoreDrillSchema,
    digest: sha256Schema,
  })
  .strict();

const documentGenerationIdentitySchema = z
  .object({
    kind: z.literal("document-generation"),
    documentId: uuidSchema,
    generationId: uuidSchema,
    generationDigest: sha256Schema,
  })
  .strict();

const siteReleaseIdentitySchema = z
  .object({
    kind: z.literal("site-release"),
    releaseId: uuidSchema,
    releaseDigest: sha256Schema,
  })
  .strict();

const resourceIdentitySchema = z.discriminatedUnion("kind", [
  documentGenerationIdentitySchema,
  siteReleaseIdentitySchema,
]);

const activationReceiptSchema = z
  .object({
    version: z.literal(1),
    receiptId: uuidSchema,
    sequence: z.number().int().positive(),
    recordedAt: timestampSchema,
    projectRef: projectRefSchema,
    operation: operationSchema,
    recoveryEvidenceId: uuidSchema,
    recoveryEvidenceDigest: sha256Schema,
    stateDigest: sha256Schema,
    resource: resourceIdentitySchema,
    previousResource: resourceIdentitySchema,
    digest: sha256Schema,
  })
  .strict()
  .superRefine((receipt, context) => {
    const expectedKind = receipt.operation;
    if (receipt.resource.kind !== expectedKind || receipt.previousResource.kind !== expectedKind) {
      context.addIssue({ code: "custom", message: "Receipt resource identity does not match its operation." });
      return;
    }
    if (receipt.resource.kind === "document-generation" && receipt.previousResource.kind === "document-generation") {
      if (receipt.resource.documentId !== receipt.previousResource.documentId) {
        context.addIssue({ code: "custom", message: "Previous generation belongs to a different document." });
      }
      if (receipt.resource.generationId === receipt.previousResource.generationId) {
        context.addIssue({ code: "custom", message: "Previous generation must name a distinct retained generation." });
      }
    }
    if (receipt.resource.kind === "site-release" && receipt.previousResource.kind === "site-release") {
      if (receipt.resource.releaseId === receipt.previousResource.releaseId) {
        context.addIssue({ code: "custom", message: "Previous release must name a distinct retained release." });
      }
    }
  });

const rollbackReceiptSchema = z
  .object({
    version: z.literal(1),
    receiptId: uuidSchema,
    sequence: z.number().int().positive(),
    recordedAt: timestampSchema,
    projectRef: projectRefSchema,
    operation: operationSchema,
    activationReceiptId: uuidSchema,
    activationReceiptDigest: sha256Schema,
    recoveryEvidenceDigest: sha256Schema,
    failedResource: resourceIdentitySchema,
    restoredResource: resourceIdentitySchema,
    restorationMethod: z.literal("retained-pointer"),
    digest: sha256Schema,
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.failedResource.kind !== receipt.operation || receipt.restoredResource.kind !== receipt.operation) {
      context.addIssue({ code: "custom", message: "Rollback resource identity does not match its operation." });
      return;
    }
    if (
      receipt.failedResource.kind === "document-generation" &&
      receipt.restoredResource.kind === "document-generation"
    ) {
      if (receipt.failedResource.documentId !== receipt.restoredResource.documentId) {
        context.addIssue({ code: "custom", message: "Rollback generations belong to different documents." });
      }
      if (receipt.failedResource.generationId === receipt.restoredResource.generationId) {
        context.addIssue({ code: "custom", message: "Rollback must restore a distinct retained generation." });
      }
    }
    if (receipt.failedResource.kind === "site-release" && receipt.restoredResource.kind === "site-release") {
      if (receipt.failedResource.releaseId === receipt.restoredResource.releaseId) {
        context.addIssue({ code: "custom", message: "Rollback must restore a distinct retained release." });
      }
    }
  });

export type RecoveryOperation = z.infer<typeof operationSchema>;
export type RecoveryReadinessDigest = `sha256:${string}`;
export type EvidenceReference = Readonly<{
  kind: "database-backup" | "pitr-status" | "storage-inventory" | "storage-recovery" | "restore-drill";
  id: string;
}>;
export type RecoveryReadinessEvidence = Readonly<z.infer<typeof recoveryReadinessSchema>>;
export type DocumentGenerationIdentity = Readonly<z.infer<typeof documentGenerationIdentitySchema>>;
export type SiteReleaseIdentity = Readonly<z.infer<typeof siteReleaseIdentitySchema>>;
export type ActivatableResourceIdentity = DocumentGenerationIdentity | SiteReleaseIdentity;
export type ActivationReceipt = Readonly<z.infer<typeof activationReceiptSchema>>;
export type RollbackReceipt = Readonly<z.infer<typeof rollbackReceiptSchema>>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function canonicalDigest(value: unknown): RecoveryReadinessDigest {
  const payload =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => key !== "digest"))
      : value;
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)), "utf8")
    .digest("hex")}`;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function elapsedMilliseconds(now: Date, timestamp: string) {
  return now.getTime() - Date.parse(timestamp);
}

const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

function assertFiniteClock(at: Date) {
  if (!Number.isFinite(at.getTime())) throw new Error("Validation clock must be finite.");
}

function assertNotFuture(now: Date, timestamp: string, label: string) {
  if (elapsedMilliseconds(now, timestamp) < -MAX_FUTURE_CLOCK_SKEW_MS) {
    throw new Error(`${label} exceeds the permitted future clock skew.`);
  }
}

function assertFresh(now: Date, timestamp: string, maximumAgeMs: number, label: string) {
  assertNotFuture(now, timestamp, label);
  if (elapsedMilliseconds(now, timestamp) > maximumAgeMs) {
    throw new Error(`${label} is not fresh enough for this operation.`);
  }
}

function assertEvidenceClockOrder(evidence: RecoveryReadinessEvidence) {
  const verifiedAt = Date.parse(evidence.verifiedAt);
  if (Date.parse(evidence.validUntil) <= verifiedAt) {
    throw new Error("Recovery evidence validity clock order is invalid.");
  }
  for (const [timestamp, label] of [
    [evidence.databaseBackup.verifiedAt, "Database backup verification"],
    [evidence.pitr.verifiedAt, "PITR verification"],
    [evidence.storageRecovery.verifiedAt, "Storage recovery verification"],
    [evidence.restoreDrill.completedAt, "Restore drill completion"],
  ] as const) {
    if (Date.parse(timestamp) > verifiedAt + MAX_FUTURE_CLOCK_SKEW_MS) {
      throw new Error(`${label} is disordered after the evidence verification clock.`);
    }
  }
}

function assertEvidenceNotFuture(evidence: RecoveryReadinessEvidence, at: Date) {
  for (const [timestamp, label] of [
    [evidence.verifiedAt, "Recovery evidence verification"],
    [evidence.databaseBackup.verifiedAt, "Database backup verification"],
    [evidence.pitr.verifiedAt, "PITR verification"],
    [evidence.storageRecovery.verifiedAt, "Storage recovery verification"],
    [evidence.restoreDrill.completedAt, "Restore drill completion"],
  ] as const) {
    assertNotFuture(at, timestamp, label);
  }
}

function sameIdentity(left: ActivatableResourceIdentity, right: ActivatableResourceIdentity) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function recoveryReadinessDigest(input: unknown): RecoveryReadinessDigest {
  return canonicalDigest(input);
}

export function activationReceiptDigest(input: unknown): RecoveryReadinessDigest {
  return canonicalDigest(input);
}

export function rollbackReceiptDigest(input: unknown): RecoveryReadinessDigest {
  return canonicalDigest(input);
}

export function parseRecoveryReadinessEvidence(input: unknown): RecoveryReadinessEvidence {
  const parsed = recoveryReadinessSchema.parse(input);
  if (recoveryReadinessDigest(parsed) !== parsed.digest) {
    throw new Error("Recovery readiness evidence digest does not match its canonical content.");
  }
  return deepFreeze(parsed);
}

export function assertRecoveryReadinessForOperation(
  evidence: RecoveryReadinessEvidence,
  operation: RecoveryOperation,
  expectedProjectRef: string,
  at: Date = new Date(),
): RecoveryReadinessEvidence {
  assertFiniteClock(at);
  if (evidence.projectRef !== expectedProjectRef) throw new Error("Recovery evidence project identity mismatch.");
  if (evidence.operation !== operation) throw new Error("Recovery evidence operation mismatch.");
  if (recoveryReadinessDigest(evidence) !== evidence.digest) throw new Error("Recovery evidence digest mismatch.");

  const currentEvidenceAge = 24 * 60 * 60 * 1_000;
  assertFresh(at, evidence.verifiedAt, currentEvidenceAge, "Recovery evidence verification");
  assertEvidenceClockOrder(evidence);
  if (Date.parse(evidence.validUntil) <= at.getTime()) throw new Error("Recovery evidence validity has expired.");
  if (!evidence.pitr.enabled) throw new Error("Recovery evidence requires PITR to be enabled.");
  if (evidence.pitr.rpoMinutes > evidence.requiredRpoMinutes) {
    throw new Error("PITR RPO is weaker than the operation requirement.");
  }
  assertFresh(at, evidence.databaseBackup.verifiedAt, currentEvidenceAge, "Database backup verification");
  assertFresh(at, evidence.pitr.verifiedAt, currentEvidenceAge, "PITR verification");
  assertFresh(at, evidence.storageRecovery.verifiedAt, 7 * 24 * 60 * 60 * 1_000, "Storage recovery inventory");
  assertNotFuture(at, evidence.restoreDrill.completedAt, "Restore drill completion time");
  assertRecoveryBasisBinding(evidence, expectedProjectRef);
  if (
    evidence.restoreDrill.outcome !== "passed" ||
    evidence.restoreDrill.target !== "isolated-project" ||
    elapsedMilliseconds(at, evidence.restoreDrill.completedAt) > 90 * 24 * 60 * 60 * 1_000
  ) {
    throw new Error("A successful isolated restore drill within 90 days is required.");
  }
  return evidence;
}

export function parseActivationReceipt(input: unknown): ActivationReceipt {
  const parsed = activationReceiptSchema.parse(input);
  if (activationReceiptDigest(parsed) !== parsed.digest) {
    throw new Error("Activation receipt digest does not match its canonical content.");
  }
  return deepFreeze(parsed);
}

export function parseRollbackReceipt(input: unknown): RollbackReceipt {
  const parsed = rollbackReceiptSchema.parse(input);
  if (rollbackReceiptDigest(parsed) !== parsed.digest) {
    throw new Error("Rollback receipt digest does not match its canonical content.");
  }
  return deepFreeze(parsed);
}

export function assertActivationReceiptBinding(
  receiptInput: unknown,
  evidenceInput: unknown,
  expectedProjectRef: string,
  at: Date = new Date(),
): ActivationReceipt {
  assertFiniteClock(at);
  const receipt = parseActivationReceipt(receiptInput);
  const evidence = parseRecoveryReadinessEvidence(evidenceInput);
  assertRecoveryReadinessForOperation(evidence, receipt.operation, expectedProjectRef, at);
  if (receipt.projectRef !== expectedProjectRef || receipt.projectRef !== evidence.projectRef) {
    throw new Error("Activation receipt project identity mismatch.");
  }
  if (receipt.recoveryEvidenceId !== evidence.evidenceId || receipt.recoveryEvidenceDigest !== evidence.digest) {
    throw new Error("Activation receipt recovery evidence binding mismatch.");
  }
  if (Date.parse(receipt.recordedAt) < Date.parse(evidence.verifiedAt)) {
    throw new Error("Activation receipt predates its recovery evidence.");
  }
  if (Date.parse(receipt.recordedAt) > Date.parse(evidence.validUntil)) {
    throw new Error("Activation receipt falls outside the recovery evidence validity window.");
  }
  assertNotFuture(at, receipt.recordedAt, "Activation receipt time");
  return receipt;
}

export function assertReceiptAppendOnlyPair(
  activationInput: unknown,
  rollbackInput: unknown,
): Readonly<{ activation: ActivationReceipt; rollback: RollbackReceipt }> {
  const activation = parseActivationReceipt(activationInput);
  const rollback = parseRollbackReceipt(rollbackInput);
  if (rollback.receiptId === activation.receiptId) {
    throw new Error("Activation and rollback receipt identities must be globally distinct.");
  }
  if (rollback.projectRef !== activation.projectRef || rollback.operation !== activation.operation) {
    throw new Error("Rollback project or operation identity mismatch.");
  }
  if (
    rollback.activationReceiptId !== activation.receiptId ||
    rollback.activationReceiptDigest !== activation.digest ||
    rollback.recoveryEvidenceDigest !== activation.recoveryEvidenceDigest
  ) {
    throw new Error("Rollback activation or recovery digest binding mismatch.");
  }
  if (
    rollback.sequence <= activation.sequence ||
    Date.parse(rollback.recordedAt) <= Date.parse(activation.recordedAt)
  ) {
    throw new Error("Rollback receipt is not in strict append-only order after activation.");
  }
  if (!sameIdentity(rollback.failedResource, activation.resource)) {
    throw new Error("Rollback failed-resource identity does not match activation.");
  }
  if (!sameIdentity(rollback.restoredResource, activation.previousResource)) {
    throw new Error("Rollback must restore the exact retained previous resource without reconstruction.");
  }
  return Object.freeze({ activation, rollback });
}

export function assertRollbackReceiptBinding(
  receiptInput: unknown,
  activationInput: unknown,
  evidenceInput: unknown,
  expectedProjectRef: string,
  at: Date = new Date(),
): RollbackReceipt {
  assertFiniteClock(at);
  const { activation, rollback: receipt } = assertReceiptAppendOnlyPair(activationInput, receiptInput);
  const evidence = parseRecoveryReadinessEvidence(evidenceInput);
  assertEvidenceClockOrder(evidence);
  assertEvidenceNotFuture(evidence, at);
  if (
    receipt.projectRef !== expectedProjectRef ||
    activation.projectRef !== expectedProjectRef ||
    evidence.projectRef !== expectedProjectRef
  ) {
    throw new Error("Rollback project identity mismatch.");
  }
  if (activation.operation !== evidence.operation) {
    throw new Error("Rollback operation mismatch.");
  }
  if (receipt.recoveryEvidenceDigest !== evidence.digest || activation.recoveryEvidenceId !== evidence.evidenceId) {
    throw new Error("Rollback digest binding mismatch.");
  }
  assertRecoveryBasisBinding(evidence, expectedProjectRef);
  if (Date.parse(evidence.verifiedAt) > Date.parse(activation.recordedAt) + MAX_FUTURE_CLOCK_SKEW_MS) {
    throw new Error("Promotion-bound recovery evidence is future-dated relative to activation.");
  }
  if (Date.parse(activation.recordedAt) > Date.parse(evidence.validUntil)) {
    throw new Error("Activation occurred outside the promotion-bound recovery evidence validity window.");
  }
  assertNotFuture(at, activation.recordedAt, "Activation receipt time");
  assertNotFuture(at, receipt.recordedAt, "Rollback receipt time");
  return receipt;
}

function assertRecoveryBasisBinding(evidence: RecoveryReadinessEvidence, expectedProjectRef: string) {
  const layers = [evidence.databaseBackup, evidence.pitr, evidence.storageRecovery, evidence.restoreDrill];
  if (layers.some((layer) => layer.projectRef !== expectedProjectRef)) {
    throw new Error("Recovery layer project identity mismatch.");
  }
  if (layers.some((layer) => layer.recoveryBasisId !== evidence.restoreDrill.recoveryBasisId)) {
    throw new Error("Recovery layers do not share one exact recovery basis identity.");
  }
  if (evidence.restoreDrill.targetProjectRef === expectedProjectRef) {
    throw new Error("Restore drill target must be an identified isolated project.");
  }
  if (
    evidence.restoreDrill.databaseBackupDigest !== evidence.databaseBackup.digest ||
    evidence.restoreDrill.pitrDigest !== evidence.pitr.digest ||
    evidence.restoreDrill.storageInventoryDigest !== evidence.storageRecovery.inventoryDigest ||
    evidence.restoreDrill.storageRecoveryDigest !== evidence.storageRecovery.recoveryDigest
  ) {
    throw new Error("Restore drill digest basis does not match the recovery layers.");
  }
}
