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
const evidenceReferenceSchema = z.string().trim().min(1).max(500);

const databaseBackupSchema = z
  .object({
    reference: evidenceReferenceSchema,
    digest: sha256Schema,
    verifiedAt: timestampSchema,
  })
  .strict();

const pitrSchema = z
  .object({
    enabled: z.boolean(),
    rpoMinutes: z
      .number()
      .int()
      .positive()
      .max(24 * 60),
    reference: evidenceReferenceSchema,
    digest: sha256Schema,
    verifiedAt: timestampSchema,
  })
  .strict();

const storageRecoverySchema = z
  .object({
    inventoryReference: evidenceReferenceSchema,
    inventoryDigest: sha256Schema,
    recoveryReference: evidenceReferenceSchema,
    recoveryDigest: sha256Schema,
    verifiedAt: timestampSchema,
  })
  .strict();

const restoreDrillSchema = z
  .object({
    reportReference: evidenceReferenceSchema,
    reportDigest: sha256Schema,
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

function assertSafeReference(reference: string) {
  if (
    /^https?:\/\//i.test(reference) ||
    /(?:token|secret|password|signature|x-amz-|credential|bearer|signed[-_ ]?url)/i.test(reference) ||
    /eyJ[a-zA-Z0-9_-]{20,}\./.test(reference)
  ) {
    throw new Error("Recovery evidence references must be opaque, content-free identifiers without secrets or URLs.");
  }
}

function assertEvidenceReferencesSafe(evidence: z.infer<typeof recoveryReadinessSchema>) {
  for (const reference of [
    evidence.databaseBackup.reference,
    evidence.pitr.reference,
    evidence.storageRecovery.inventoryReference,
    evidence.storageRecovery.recoveryReference,
    evidence.restoreDrill.reportReference,
  ]) {
    assertSafeReference(reference);
  }
}

function elapsedMilliseconds(now: Date, timestamp: string) {
  return now.getTime() - Date.parse(timestamp);
}

function assertNotFuture(now: Date, timestamp: string, label: string) {
  if (elapsedMilliseconds(now, timestamp) < 0) throw new Error(`${label} cannot be in the future.`);
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
  assertEvidenceReferencesSafe(parsed);
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
  if (evidence.projectRef !== expectedProjectRef) throw new Error("Recovery evidence project identity mismatch.");
  if (evidence.operation !== operation) throw new Error("Recovery evidence operation mismatch.");
  if (recoveryReadinessDigest(evidence) !== evidence.digest) throw new Error("Recovery evidence digest mismatch.");

  assertNotFuture(at, evidence.verifiedAt, "Recovery evidence verification time");
  if (elapsedMilliseconds(at, evidence.verifiedAt) > 24 * 60 * 60 * 1_000) {
    throw new Error("Recovery evidence is not fresh within 24 hours.");
  }
  if (Date.parse(evidence.validUntil) <= at.getTime()) throw new Error("Recovery evidence validity has expired.");
  if (!evidence.pitr.enabled) throw new Error("Recovery evidence requires PITR to be enabled.");
  if (evidence.pitr.rpoMinutes > evidence.requiredRpoMinutes) {
    throw new Error("PITR RPO is weaker than the operation requirement.");
  }
  for (const [timestamp, label] of [
    [evidence.databaseBackup.verifiedAt, "Database backup verification time"],
    [evidence.pitr.verifiedAt, "PITR verification time"],
    [evidence.storageRecovery.verifiedAt, "Storage recovery verification time"],
    [evidence.restoreDrill.completedAt, "Restore drill completion time"],
  ] as const) {
    assertNotFuture(at, timestamp, label);
  }
  if (elapsedMilliseconds(at, evidence.storageRecovery.verifiedAt) > 7 * 24 * 60 * 60 * 1_000) {
    throw new Error("Storage recovery inventory is older than seven days.");
  }
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
  receipt: ActivationReceipt,
  evidence: RecoveryReadinessEvidence,
  expectedProjectRef: string,
  at: Date = new Date(),
): ActivationReceipt {
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
  return receipt;
}

export function assertRollbackReceiptBinding(
  receipt: RollbackReceipt,
  activation: ActivationReceipt,
  evidence: RecoveryReadinessEvidence,
  expectedProjectRef: string,
): RollbackReceipt {
  if (
    receipt.projectRef !== expectedProjectRef ||
    activation.projectRef !== expectedProjectRef ||
    evidence.projectRef !== expectedProjectRef
  ) {
    throw new Error("Rollback project identity mismatch.");
  }
  if (receipt.operation !== activation.operation || activation.operation !== evidence.operation) {
    throw new Error("Rollback operation mismatch.");
  }
  if (
    receipt.activationReceiptId !== activation.receiptId ||
    receipt.activationReceiptDigest !== activation.digest ||
    receipt.recoveryEvidenceDigest !== activation.recoveryEvidenceDigest ||
    receipt.recoveryEvidenceDigest !== evidence.digest ||
    activation.recoveryEvidenceId !== evidence.evidenceId
  ) {
    throw new Error("Rollback digest binding mismatch.");
  }
  if (receipt.sequence <= activation.sequence || Date.parse(receipt.recordedAt) < Date.parse(activation.recordedAt)) {
    throw new Error("Rollback receipt is not append-only after its activation receipt.");
  }
  if (!sameIdentity(receipt.failedResource, activation.resource)) {
    throw new Error("Rollback failed-resource identity does not match activation.");
  }
  if (!sameIdentity(receipt.restoredResource, activation.previousResource)) {
    throw new Error("Rollback must restore the exact retained previous resource without reconstruction.");
  }
  return receipt;
}
