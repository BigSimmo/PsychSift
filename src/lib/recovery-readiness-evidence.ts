import { createHash } from "node:crypto";
import { z } from "zod";

import {
  assertDocumentGenerationPromotionIdentity,
  type DocumentGenerationPromotionIdentity,
} from "@/lib/reindex-pipeline";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RECEIPT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_EVIDENCE_VALIDITY_SECONDS = 86_400;
const MAX_RECOVERY_EVIDENCE_AGE_SECONDS = 86_400;
const MAX_RECOVERY_RPO_SECONDS = 86_400;
const MAX_RESTORE_DRILL_AGE_SECONDS = 7_776_000;
const MAX_RESTORE_DRILL_RTO_SECONDS = 86_400;

const boundedIdentitySchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.trim() === value, { message: "Identity must not have surrounding whitespace." });
const projectRefSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{2,63}$/);
const sha256Schema = z.string().regex(SHA256_PATTERN);
const operationSchema = z.enum(["site_release", "document_generation"]);
const canonicalTimestampSchema = z.string().refine(
  (value) => {
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
  },
  { message: "Timestamp must be a canonical ISO-8601 UTC value." },
);

const databaseEvidenceSchema = z
  .object({
    evidenceId: boundedIdentitySchema,
    recoveryMode: z.literal("pitr"),
    observedAt: canonicalTimestampSchema,
    latestRecoveryPointAt: canonicalTimestampSchema,
    maximumAgeSeconds: z.number().int().positive().max(MAX_RECOVERY_EVIDENCE_AGE_SECONDS),
    maximumRpoSeconds: z.number().int().positive().max(MAX_RECOVERY_RPO_SECONDS),
    restorable: z.literal(true),
  })
  .strict();

const storageEvidenceSchema = z
  .object({
    evidenceId: boundedIdentitySchema,
    recoveryMode: z.literal("versioned_backup"),
    observedAt: canonicalTimestampSchema,
    latestRecoveryPointAt: canonicalTimestampSchema,
    maximumAgeSeconds: z.number().int().positive().max(MAX_RECOVERY_EVIDENCE_AGE_SECONDS),
    maximumRpoSeconds: z.number().int().positive().max(MAX_RECOVERY_RPO_SECONDS),
    recoverable: z.literal(true),
  })
  .strict();

const restoreDrillSchema = z
  .object({
    evidenceId: boundedIdentitySchema,
    drillId: boundedIdentitySchema,
    completedAt: canonicalTimestampSchema,
    maximumAgeSeconds: z.number().int().positive().max(MAX_RESTORE_DRILL_AGE_SECONDS),
    environment: z.literal("isolated"),
    databaseRestored: z.literal(true),
    storageRestored: z.literal(true),
    authRestored: z.literal(true).optional(),
    configRestored: z.literal(true).optional(),
    measuredRpoSeconds: z.number().int().nonnegative().max(MAX_RECOVERY_RPO_SECONDS).optional(),
    measuredRtoSeconds: z.number().int().positive().max(MAX_RESTORE_DRILL_RTO_SECONDS).optional(),
    integrityDigest: sha256Schema,
    outcome: z.literal("succeeded"),
  })
  .strict();

const recoveryReadinessGovernedSchema = z
  .object({
    version: z.literal("recovery-readiness-evidence-v1"),
    projectRef: projectRefSchema,
    operation: operationSchema,
    issuedAt: canonicalTimestampSchema,
    validUntil: canonicalTimestampSchema,
    database: databaseEvidenceSchema,
    storage: storageEvidenceSchema,
    restoreDrill: restoreDrillSchema,
  })
  .strict()
  .superRefine((evidence, context) => {
    const evidenceIds = [evidence.database.evidenceId, evidence.storage.evidenceId, evidence.restoreDrill.evidenceId];
    if (new Set(evidenceIds).size !== evidenceIds.length) {
      context.addIssue({ code: "custom", message: "Recovery surfaces require separate evidence identities." });
    }
  });

const recoveryReadinessEvidenceSchema = recoveryReadinessGovernedSchema.extend({ digest: sha256Schema }).strict();

export type RecoveryOperation = z.infer<typeof operationSchema>;
export type RecoveryReadinessDigest = string;
export type RecoveryReadinessEvidence = Readonly<z.infer<typeof recoveryReadinessEvidenceSchema>>;

export type SiteReleasePromotionIdentity = Readonly<{
  kind: "site_release";
  siteReleaseId: string;
  siteReleaseDigest: string;
  previousSiteReleaseId: string;
  previousSiteReleaseDigest: string;
}>;

export type PromotionResourceIdentity = SiteReleasePromotionIdentity | DocumentGenerationPromotionIdentity;

export type ActivationReceipt = Readonly<{
  version: "activation-receipt-v1";
  receiptId: string;
  promotionId: string;
  projectRef: string;
  operation: RecoveryOperation;
  recoveryReadinessDigest: RecoveryReadinessDigest;
  activatedAt: string;
  resource: PromotionResourceIdentity;
}>;

export type RollbackTarget =
  | Readonly<{
      kind: "site_release";
      siteReleaseId: string;
      siteReleaseDigest: string;
    }>
  | Readonly<{
      kind: "document_generation";
      documentId: string;
      generationId: string;
      generationDigest: string;
    }>;

export type RollbackReceipt = Readonly<{
  version: "rollback-receipt-v1";
  receiptId: string;
  activationReceiptId: string;
  promotionId: string;
  projectRef: string;
  operation: RecoveryOperation;
  rolledBackAt: string;
  method: "retained_previous";
  requiresReconstruction: false;
  outcome: "succeeded";
  target: RollbackTarget;
}>;

type Clock = { now: () => Date };

const systemClock: Clock = { now: () => new Date() };

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical recovery evidence cannot encode non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(compareCodeUnits)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error(`Canonical recovery evidence cannot encode ${typeof value}.`);
}

function sha256(domain: string, value: unknown): string {
  return createHash("sha256")
    .update(`${domain}\n${canonicalJson(value)}`, "utf8")
    .digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function governedEvidence(value: z.infer<typeof recoveryReadinessGovernedSchema>) {
  return {
    version: value.version,
    projectRef: value.projectRef,
    operation: value.operation,
    issuedAt: value.issuedAt,
    validUntil: value.validUntil,
    database: value.database,
    storage: value.storage,
    restoreDrill: value.restoreDrill,
  };
}

export function recoveryReadinessDigest(input: unknown): RecoveryReadinessDigest {
  return sha256("recovery-readiness-evidence-digest-v1", input);
}

export function parseRecoveryReadinessEvidence(input: unknown): RecoveryReadinessEvidence {
  const parsed = recoveryReadinessEvidenceSchema.safeParse(input);
  if (!parsed.success) {
    if (
      parsed.error.issues.some((issue) => issue.message === "Recovery surfaces require separate evidence identities.")
    ) {
      throw new Error("Recovery surfaces require separate evidence identities.");
    }
    throw new Error("Recovery readiness evidence has a missing, extra, or invalid shape.");
  }
  const expectedDigest = recoveryReadinessDigest(governedEvidence(parsed.data));
  if (parsed.data.digest !== expectedDigest) {
    throw new Error("Recovery readiness evidence digest does not match its governed fields.");
  }
  return deepFreeze(parsed.data);
}

function timestamp(value: string): number {
  return Date.parse(value);
}

function assertNotFuture(label: string, value: number, now: number) {
  if (value > now) throw new Error(`${label} is in the future.`);
}

function assertRecoverySurfaceFresh(
  label: "Database" | "Storage",
  surface: {
    observedAt: string;
    latestRecoveryPointAt: string;
    maximumAgeSeconds: number;
    maximumRpoSeconds: number;
  },
  issuedAt: number,
  now: number,
) {
  const observedAt = timestamp(surface.observedAt);
  const latestRecoveryPointAt = timestamp(surface.latestRecoveryPointAt);
  assertNotFuture(`${label} recovery evidence`, observedAt, now);
  if (observedAt > issuedAt) throw new Error(`${label} recovery evidence is newer than the governed artifact.`);
  if (now - observedAt > surface.maximumAgeSeconds * 1_000) {
    throw new Error(`${label} recovery evidence is stale.`);
  }
  if (latestRecoveryPointAt > observedAt) {
    throw new Error(`${label} recovery point is in the future relative to its observation.`);
  }
  if (observedAt - latestRecoveryPointAt > surface.maximumRpoSeconds * 1_000) {
    throw new Error(`${label} recovery evidence exceeds its RPO.`);
  }
}

export function assertRecoveryReadinessForOperation(
  evidence: RecoveryReadinessEvidence,
  operation: RecoveryOperation,
  expectedProjectRef: string,
  clock: Clock = systemClock,
): RecoveryReadinessEvidence {
  const parsed = parseRecoveryReadinessEvidence(evidence);
  if (parsed.operation !== operation) {
    throw new Error(`Recovery readiness evidence operation does not match ${operation}.`);
  }
  if (parsed.projectRef !== expectedProjectRef) {
    throw new Error("Recovery readiness evidence project binding does not match the expected project.");
  }
  const now = clock.now().getTime();
  if (!Number.isFinite(now)) throw new Error("Recovery readiness evaluation clock is invalid.");
  const issuedAt = timestamp(parsed.issuedAt);
  const validUntil = timestamp(parsed.validUntil);
  assertNotFuture("Recovery readiness evidence", issuedAt, now);
  if (validUntil <= issuedAt || validUntil - issuedAt > MAX_EVIDENCE_VALIDITY_SECONDS * 1_000) {
    throw new Error("Recovery readiness evidence has an invalid validity window.");
  }
  if (now > validUntil) throw new Error("Recovery readiness evidence is expired or stale.");

  assertRecoverySurfaceFresh("Database", parsed.database, issuedAt, now);
  assertRecoverySurfaceFresh("Storage", parsed.storage, issuedAt, now);

  const drillCompletedAt = timestamp(parsed.restoreDrill.completedAt);
  assertNotFuture("Restore drill evidence", drillCompletedAt, now);
  if (drillCompletedAt > issuedAt) throw new Error("Restore drill evidence is newer than the governed artifact.");
  if (now - drillCompletedAt > parsed.restoreDrill.maximumAgeSeconds * 1_000) {
    throw new Error("Restore drill evidence is stale.");
  }
  return evidence;
}

const siteReleasePromotionIdentitySchema = z
  .object({
    kind: z.literal("site_release"),
    siteReleaseId: boundedIdentitySchema,
    siteReleaseDigest: sha256Schema,
    previousSiteReleaseId: boundedIdentitySchema,
    previousSiteReleaseDigest: sha256Schema,
  })
  .strict()
  .superRefine((identity, context) => {
    if (identity.siteReleaseId === identity.previousSiteReleaseId) {
      context.addIssue({ code: "custom", message: "Current and previous site releases must be distinct." });
    }
  });

const documentGenerationPromotionIdentitySchema = z
  .object({
    kind: z.literal("document_generation"),
    documentId: boundedIdentitySchema,
    generationId: boundedIdentitySchema,
    generationDigest: sha256Schema,
    previousGenerationId: boundedIdentitySchema,
    previousGenerationDigest: sha256Schema,
  })
  .strict();

const promotionResourceSchema = z.discriminatedUnion("kind", [
  siteReleasePromotionIdentitySchema,
  documentGenerationPromotionIdentitySchema,
]);

const activationReceiptSchema = z
  .object({
    version: z.literal("activation-receipt-v1"),
    receiptId: z.string().regex(RECEIPT_ID_PATTERN),
    promotionId: boundedIdentitySchema,
    projectRef: projectRefSchema,
    operation: operationSchema,
    recoveryReadinessDigest: sha256Schema,
    activatedAt: canonicalTimestampSchema,
    resource: promotionResourceSchema,
  })
  .strict();

function assertPromotionResource(value: unknown): PromotionResourceIdentity {
  const parsed = promotionResourceSchema.safeParse(value);
  if (!parsed.success) {
    if (
      value &&
      typeof value === "object" &&
      "kind" in value &&
      value.kind === "document_generation" &&
      !("previousGenerationId" in value)
    ) {
      throw new Error("Document generation activation requires previousGenerationId.");
    }
    throw new Error("Promotion resource identity has a missing, extra, or invalid shape.");
  }
  if (parsed.data.kind === "document_generation") {
    return assertDocumentGenerationPromotionIdentity(parsed.data);
  }
  return parsed.data;
}

function expectedOperation(resource: PromotionResourceIdentity): RecoveryOperation {
  return resource.kind;
}

function expectedPromotionPrefix(resource: PromotionResourceIdentity): string {
  return resource.kind === "site_release" ? "site-release:" : "document-generation:";
}

function activationReceiptFields(receipt: Omit<ActivationReceipt, "receiptId">) {
  return {
    version: receipt.version,
    promotionId: receipt.promotionId,
    projectRef: receipt.projectRef,
    operation: receipt.operation,
    recoveryReadinessDigest: receipt.recoveryReadinessDigest,
    activatedAt: receipt.activatedAt,
    resource: receipt.resource,
  };
}

function activationReceiptId(receipt: Omit<ActivationReceipt, "receiptId">): string {
  return `sha256:${sha256("activation-receipt-identity-v1", activationReceiptFields(receipt))}`;
}

export function parseActivationReceipt(input: unknown, clock: Clock = systemClock): ActivationReceipt {
  const parsed = activationReceiptSchema.safeParse(input);
  if (!parsed.success) throw new Error("Activation receipt has a missing, extra, or invalid shape.");
  const resource = assertPromotionResource(parsed.data.resource);
  if (parsed.data.operation !== expectedOperation(resource)) {
    throw new Error("Activation receipt operation does not match its resource identity.");
  }
  if (!parsed.data.promotionId.startsWith(expectedPromotionPrefix(resource))) {
    throw new Error("Activation receipt promotion identity belongs to a different resource domain.");
  }
  const evaluatedAt = clock.now().getTime();
  if (!Number.isFinite(evaluatedAt)) throw new Error("Activation receipt evaluation clock is invalid.");
  if (timestamp(parsed.data.activatedAt) > evaluatedAt) {
    throw new Error("Activation receipt activatedAt is in the future.");
  }
  const withoutId = { ...parsed.data, resource } as ActivationReceipt;
  const expected = activationReceiptId(withoutId);
  if (parsed.data.receiptId !== expected) {
    throw new Error("Activation receipt identity does not match its immutable fields.");
  }
  return deepFreeze({ ...parsed.data, resource });
}

export function createActivationReceipt(
  input: {
    promotionId: string;
    activatedAt: string;
    resource: unknown;
    evidence: RecoveryReadinessEvidence;
    expectedProjectRef: string;
  },
  clock: Clock = systemClock,
): ActivationReceipt {
  const resource = assertPromotionResource(input.resource);
  const operation = expectedOperation(resource);
  const evidence = assertRecoveryReadinessForOperation(input.evidence, operation, input.expectedProjectRef, clock);
  if (!input.promotionId.startsWith(expectedPromotionPrefix(resource))) {
    throw new Error("Activation promotion identity belongs to a different resource domain.");
  }
  const activatedAtResult = canonicalTimestampSchema.safeParse(input.activatedAt);
  if (!activatedAtResult.success) throw new Error("Activation receipt activatedAt is invalid.");
  const activatedAt = timestamp(input.activatedAt);
  const evaluatedAt = clock.now().getTime();
  if (activatedAt > evaluatedAt) throw new Error("Activation receipt activatedAt is in the future.");
  if (activatedAt < timestamp(evidence.issuedAt) || activatedAt > timestamp(evidence.validUntil)) {
    throw new Error("Activation receipt activatedAt is outside the readiness evidence window.");
  }
  const fields: Omit<ActivationReceipt, "receiptId"> = {
    version: "activation-receipt-v1",
    promotionId: input.promotionId,
    projectRef: evidence.projectRef,
    operation,
    recoveryReadinessDigest: evidence.digest,
    activatedAt: input.activatedAt,
    resource,
  };
  return parseActivationReceipt({ ...fields, receiptId: activationReceiptId(fields) }, clock);
}

const siteReleaseRollbackTargetSchema = z
  .object({
    kind: z.literal("site_release"),
    siteReleaseId: boundedIdentitySchema,
    siteReleaseDigest: sha256Schema,
  })
  .strict();

const documentGenerationRollbackTargetSchema = z
  .object({
    kind: z.literal("document_generation"),
    documentId: boundedIdentitySchema,
    generationId: boundedIdentitySchema,
    generationDigest: sha256Schema,
  })
  .strict();

const rollbackTargetSchema = z.discriminatedUnion("kind", [
  siteReleaseRollbackTargetSchema,
  documentGenerationRollbackTargetSchema,
]);

const rollbackReceiptSchema = z
  .object({
    version: z.literal("rollback-receipt-v1"),
    receiptId: z.string().regex(RECEIPT_ID_PATTERN),
    activationReceiptId: z.string().regex(RECEIPT_ID_PATTERN),
    promotionId: boundedIdentitySchema,
    projectRef: projectRefSchema,
    operation: operationSchema,
    rolledBackAt: canonicalTimestampSchema,
    method: z.literal("retained_previous"),
    requiresReconstruction: z.literal(false),
    outcome: z.literal("succeeded"),
    target: rollbackTargetSchema,
  })
  .strict();

function rollbackReceiptFields(receipt: Omit<RollbackReceipt, "receiptId">) {
  return {
    version: receipt.version,
    activationReceiptId: receipt.activationReceiptId,
    promotionId: receipt.promotionId,
    projectRef: receipt.projectRef,
    operation: receipt.operation,
    rolledBackAt: receipt.rolledBackAt,
    method: receipt.method,
    requiresReconstruction: receipt.requiresReconstruction,
    outcome: receipt.outcome,
    target: receipt.target,
  };
}

function rollbackReceiptId(receipt: Omit<RollbackReceipt, "receiptId">): string {
  return `sha256:${sha256("rollback-receipt-identity-v1", rollbackReceiptFields(receipt))}`;
}

function assertRollbackTarget(target: RollbackTarget, activation: ActivationReceipt) {
  const resource = activation.resource;
  if (resource.kind === "site_release") {
    if (
      target.kind !== "site_release" ||
      target.siteReleaseId !== resource.previousSiteReleaseId ||
      target.siteReleaseDigest !== resource.previousSiteReleaseDigest
    ) {
      throw new Error("Rollback target does not match the retained previous site release.");
    }
    return;
  }
  if (
    target.kind !== "document_generation" ||
    target.documentId !== resource.documentId ||
    target.generationId !== resource.previousGenerationId ||
    target.generationDigest !== resource.previousGenerationDigest
  ) {
    throw new Error("Rollback target does not match the retained previous document generation.");
  }
}

export function parseRollbackReceipt(
  input: unknown,
  activationReceipt: ActivationReceipt,
  clock: Clock = systemClock,
): RollbackReceipt {
  const activation = parseActivationReceipt(activationReceipt, clock);
  const parsed = rollbackReceiptSchema.safeParse(input);
  if (!parsed.success) throw new Error("Rollback receipt has a missing, extra, or invalid shape.");
  if (
    parsed.data.activationReceiptId !== activation.receiptId ||
    parsed.data.promotionId !== activation.promotionId ||
    parsed.data.projectRef !== activation.projectRef ||
    parsed.data.operation !== activation.operation
  ) {
    throw new Error("Rollback receipt is not bound to the activation promotion identity.");
  }
  if (timestamp(parsed.data.rolledBackAt) < timestamp(activation.activatedAt)) {
    throw new Error("Rollback receipt predates its activation receipt.");
  }
  const evaluatedAt = clock.now().getTime();
  if (!Number.isFinite(evaluatedAt)) throw new Error("Rollback receipt evaluation clock is invalid.");
  if (timestamp(parsed.data.rolledBackAt) > evaluatedAt) {
    throw new Error("Rollback receipt rolledBackAt is in the future.");
  }
  assertRollbackTarget(parsed.data.target, activation);
  const expected = rollbackReceiptId(parsed.data);
  if (parsed.data.receiptId !== expected) {
    throw new Error("Rollback receipt identity does not match its immutable fields.");
  }
  return deepFreeze(parsed.data);
}

export function createRollbackReceipt(
  input: {
    activationReceipt: ActivationReceipt;
    rolledBackAt: string;
    method: string;
    requiresReconstruction: boolean;
    outcome: string;
    target: unknown;
  },
  clock: Clock = systemClock,
): RollbackReceipt {
  if (input.method !== "retained_previous" || input.requiresReconstruction !== false) {
    throw new Error("Rollback evidence requiring reconstruction is not accepted.");
  }
  if (input.outcome !== "succeeded") throw new Error("Rollback receipt must record a successful outcome.");
  const activation = parseActivationReceipt(input.activationReceipt, clock);
  const rolledBackAtResult = canonicalTimestampSchema.safeParse(input.rolledBackAt);
  if (!rolledBackAtResult.success) throw new Error("Rollback receipt rolledBackAt is invalid.");
  const evaluatedAt = clock.now().getTime();
  if (!Number.isFinite(evaluatedAt)) throw new Error("Rollback receipt evaluation clock is invalid.");
  if (timestamp(input.rolledBackAt) > evaluatedAt) throw new Error("Rollback receipt rolledBackAt is in the future.");
  const targetResult = rollbackTargetSchema.safeParse(input.target);
  if (!targetResult.success) throw new Error("Rollback target has a missing, extra, or invalid shape.");
  assertRollbackTarget(targetResult.data, activation);
  const fields: Omit<RollbackReceipt, "receiptId"> = {
    version: "rollback-receipt-v1",
    activationReceiptId: activation.receiptId,
    promotionId: activation.promotionId,
    projectRef: activation.projectRef,
    operation: activation.operation,
    rolledBackAt: input.rolledBackAt,
    method: "retained_previous",
    requiresReconstruction: false,
    outcome: "succeeded",
    target: targetResult.data,
  };
  return parseRollbackReceipt({ ...fields, receiptId: rollbackReceiptId(fields) }, activation, clock);
}
