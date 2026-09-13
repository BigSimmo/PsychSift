import { createHash } from "node:crypto";

import {
  assertReceiptAppendOnlyPair,
  type ActivationReceipt,
  type DocumentGenerationIdentity,
  type RollbackReceipt,
} from "@/lib/recovery-readiness-evidence";

type Sha256Digest = `sha256:${string}`;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const bareSha256Pattern = /^[0-9a-f]{64}$/;
const projectRefPattern = /^[a-z0-9_-]{3,100}$/;

function lifecycleRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function lifecycleExactKeys(record: Record<string, unknown>, keys: readonly string[], label: string) {
  if (Object.keys(record).sort().join("|") !== [...keys].sort().join("|")) {
    throw new Error(`${label} contains missing or unexpected fields.`);
  }
}

function lifecycleString(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function lifecycleTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function lifecycleCanonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(lifecycleCanonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, lifecycleCanonicalize(nested)]),
    );
  }
  return value;
}

function lifecycleCanonicalJson(value: unknown): string {
  return JSON.stringify(lifecycleCanonicalize(value));
}

function lifecycleDigest(value: unknown): Sha256Digest {
  return `sha256:${createHash("sha256").update(lifecycleCanonicalJson(value), "utf8").digest("hex")}`;
}

function lifecycleFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) lifecycleFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export type ReindexQueueSnapshot = {
  openJobs: number;
  queuedDocuments: number;
  processingDocuments: number;
  failedDocuments: number;
};

export type AbandonedReindexGenerationCounts = {
  document_chunks?: number;
  document_images?: number;
  document_table_facts?: number;
  document_embedding_fields?: number;
  document_index_units?: number;
  document_memory_cards?: number;
  document_sections?: number;
};

export type DocumentGenerationActivationReceipt = ActivationReceipt &
  Readonly<{
    operation: "document-generation";
    resource: DocumentGenerationIdentity;
    previousResource: DocumentGenerationIdentity;
  }>;

export type DocumentGenerationRollbackReceipt = RollbackReceipt &
  Readonly<{
    operation: "document-generation";
    failedResource: DocumentGenerationIdentity;
    restoredResource: DocumentGenerationIdentity;
  }>;

export function isReindexQueueClear(snapshot: ReindexQueueSnapshot) {
  return (
    snapshot.openJobs === 0 &&
    snapshot.queuedDocuments === 0 &&
    snapshot.processingDocuments === 0 &&
    snapshot.failedDocuments === 0
  );
}

export function hasIncompleteDocumentsWithoutOpenJobs(snapshot: ReindexQueueSnapshot) {
  return (
    snapshot.openJobs === 0 &&
    snapshot.queuedDocuments === 0 &&
    (snapshot.processingDocuments > 0 || snapshot.failedDocuments > 0)
  );
}

export function metadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

type GenerationMarker = { kind: "absent" | "null" | "invalid" } | { kind: "valid"; value: string };

function classifyGenerationValue(value: unknown): GenerationMarker {
  if (value === null) return { kind: "null" };
  if (
    typeof value === "string" &&
    value.length === 36 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    return { kind: "valid", value };
  }
  return { kind: "invalid" };
}

function classifyGenerationMarker(metadata: unknown): GenerationMarker {
  if (metadata == null) return { kind: "absent" };
  if (typeof metadata !== "object" || Array.isArray(metadata)) return { kind: "invalid" };
  if (!Object.hasOwn(metadata, "index_generation_id")) return { kind: "absent" };
  return classifyGenerationValue((metadata as Record<string, unknown>).index_generation_id);
}

export function committedIndexGeneration(metadata: unknown) {
  const marker = classifyGenerationMarker(metadata);
  if (marker.kind === "absent") return null;
  if (marker.kind === "valid") return marker.value;
  // Document authority requires an absent raw key for null G0. Do not erase a
  // present-invalid marker before callers apply visibility or sign artifacts.
  throw new Error("Invalid committed generation metadata.");
}

export function isAtomicReindexCandidate(document: { status?: string | null; metadata?: unknown }) {
  return document.status === "indexed";
}

export function isCommittedGenerationMetadata(args: { rowMetadata?: unknown; committedGeneration?: string | null }) {
  const committed = classifyGenerationValue(args.committedGeneration ?? null);
  if (committed.kind !== "valid" && committed.kind !== "null") return false;
  const row = classifyGenerationMarker(args.rowMetadata);
  // Legacy G0 artifacts are visible only while the document pointer is also
  // G0. Once a typed generation is active, null/absent artifact markers must
  // not remain visible; rollback to G0 likewise hides the failed candidate.
  if (row.kind === "absent" || row.kind === "null") return committed.kind === "null";
  return (
    row.kind === "valid" &&
    committed.kind === "valid" &&
    row.value.toLowerCase() === committed.value.toLowerCase()
  );
}

export function imageRowNeedsGenerationRestamp(args: {
  indexGenerationId: string | null;
  metadata: unknown;
  committedGeneration: string;
}) {
  const committed = classifyGenerationValue(args.committedGeneration);
  const typed = classifyGenerationValue(args.indexGenerationId);
  const metadata = classifyGenerationMarker(args.metadata);
  return (
    committed.kind !== "valid" ||
    typed.kind !== "valid" ||
    metadata.kind !== "valid" ||
    typed.value.toLowerCase() !== committed.value.toLowerCase() ||
    metadata.value.toLowerCase() !== committed.value.toLowerCase()
  );
}

export function isAbandonedStagedGeneration(args: {
  rowMetadata?: unknown;
  rowGenerationId?: string | null;
  committedGeneration?: string | null;
}) {
  const row =
    args.rowGenerationId == null
      ? classifyGenerationMarker(args.rowMetadata)
      : classifyGenerationValue(args.rowGenerationId);
  const committed = classifyGenerationValue(args.committedGeneration ?? null);
  if (row.kind !== "valid" || (committed.kind !== "valid" && committed.kind !== "null")) return false;
  return committed.kind !== "valid" || row.value.toLowerCase() !== committed.value.toLowerCase();
}

export function abandonedReindexGenerationTotal(counts: AbandonedReindexGenerationCounts) {
  return Object.values(counts).reduce((total, value) => total + (Number.isFinite(value) ? Number(value) : 0), 0);
}

export function hasAbandonedReindexGenerations(counts: AbandonedReindexGenerationCounts) {
  return abandonedReindexGenerationTotal(counts) > 0;
}

/**
 * Pure compatibility assertion for the future retained-generation lifecycle.
 * It does not call or alter the legacy destructive commit RPC.
 */
export function assertDocumentGenerationReceiptPair(
  activationInput: unknown,
  rollbackInput: unknown,
): Readonly<{
  activation: DocumentGenerationActivationReceipt;
  rollback: DocumentGenerationRollbackReceipt;
}> {
  const { activation, rollback } = assertReceiptAppendOnlyPair(activationInput, rollbackInput);
  if (
    activation.operation !== "document-generation" ||
    activation.resource.kind !== "document-generation" ||
    activation.previousResource.kind !== "document-generation"
  ) {
    throw new Error("Document-generation activation receipt identity is required.");
  }
  if (rollback.operation !== "document-generation") {
    throw new Error("Document-generation rollback receipt identity is required.");
  }
  const typedRollback = rollback as DocumentGenerationRollbackReceipt;
  if (
    typedRollback.failedResource.kind !== "document-generation" ||
    typedRollback.restoredResource.kind !== "document-generation" ||
    typedRollback.activationReceiptId !== activation.receiptId ||
    typedRollback.failedResource.documentId !== activation.resource.documentId ||
    typedRollback.failedResource.generationId !== activation.resource.generationId ||
    typedRollback.failedResource.generationDigest !== activation.resource.generationDigest ||
    typedRollback.restoredResource.documentId !== activation.previousResource.documentId ||
    typedRollback.restoredResource.generationId !== activation.previousResource.generationId ||
    typedRollback.restoredResource.generationDigest !== activation.previousResource.generationDigest
  ) {
    throw new Error("Document rollback must restore the exact retained previous generation.");
  }
  return Object.freeze({
    activation: activation as DocumentGenerationActivationReceipt,
    rollback: typedRollback,
  });
}

export type DocumentGenerationTechnicalEvidenceReferenceV1 = Readonly<{
  receiptId: string;
  version: "document-generation-technical-evidence-v1";
  jobId: string;
  documentId: string;
  generationId: string;
  admissionEventId: string;
  policyVersion: string;
  stateDigest: Sha256Digest;
  evidenceDigest: Sha256Digest;
  verdict: "activate";
  codes: readonly [];
  receiptDigest: Sha256Digest;
}>;

export type ShadowGenerationPromotionAuthorizationV1 = Readonly<{
  version: 1;
  operation: "promote";
  targetProjectRef: string;
  candidateGenerationId: string;
  planDigest: Sha256Digest;
  stageReceiptDigest: Sha256Digest;
  evaluationReportDigest: Sha256Digest;
  recoveryEvidenceDigest: Sha256Digest;
  stageAuthorizationDigest: Sha256Digest;
  expectedDocumentIds: readonly string[];
  expectedDocumentCount: number;
  expectedTechnicalEvidenceReceiptDigests: readonly Sha256Digest[];
  authorizedAt: string;
  expiresAt: string;
  retainedUntil: string;
  confirmationSha256: Sha256Digest;
}>;

export type PromotableShadowGenerationV1 = Readonly<{
  version: 1;
  projectRef: string;
  candidateGenerationId: string;
  planDigest: Sha256Digest;
  stageReceiptDigest: Sha256Digest;
  evaluationReportDigest: Sha256Digest;
  recoveryEvidenceDigest: Sha256Digest;
  stageAuthorizationDigest: Sha256Digest;
  decision: "GO";
  documents: readonly Readonly<{
    documentId: string;
    baselineGenerationId: string | null;
    currentDocumentStatus: "indexed";
    currentGenerationId: string | null;
    expectedStateDigest: string;
    actualStateDigest: string;
    stageMemberReceiptDigest: Sha256Digest;
    stageAuthorityDigest: Sha256Digest;
    actualAuthorityDigest: Sha256Digest;
  }>[];
  technicalEvidence: readonly DocumentGenerationTechnicalEvidenceReferenceV1[];
  authorization: ShadowGenerationPromotionAuthorizationV1;
  promoteAuthorizationDigest: Sha256Digest;
  trustedNow: string;
}>;

function sameLifecycleArray(left: readonly unknown[], right: readonly unknown[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Pure final preflight over scalar identities extracted by the U04 driver from
 * already validated envelopes. SQL still resolves every technical receipt and
 * refuses promotion until U10 supplies the authoritative lookup seam.
 */
export function assertPromotableShadowGeneration(input: unknown): PromotableShadowGenerationV1 {
  const root = lifecycleRecord(input, "Shadow promotion readiness");
  lifecycleExactKeys(
    root,
    [
      "version",
      "projectRef",
      "candidateGenerationId",
      "planDigest",
      "stageReceiptDigest",
      "evaluationReportDigest",
      "recoveryEvidenceDigest",
      "stageAuthorizationDigest",
      "decision",
      "documents",
      "technicalEvidence",
      "authorization",
      "promoteAuthorizationDigest",
      "trustedNow",
    ],
    "Shadow promotion readiness",
  );
  if (root.version !== 1 || root.decision !== "GO") throw new Error("Shadow evaluation did not pass.");
  const projectRef = lifecycleString(root.projectRef, projectRefPattern, "Project reference");
  const candidateGenerationId = lifecycleString(root.candidateGenerationId, uuidPattern, "Candidate generation");
  const digests = {
    planDigest: lifecycleString(root.planDigest, sha256Pattern, "Plan digest") as Sha256Digest,
    stageReceiptDigest: lifecycleString(root.stageReceiptDigest, sha256Pattern, "Stage receipt digest") as Sha256Digest,
    evaluationReportDigest: lifecycleString(
      root.evaluationReportDigest,
      sha256Pattern,
      "Evaluation report digest",
    ) as Sha256Digest,
    recoveryEvidenceDigest: lifecycleString(
      root.recoveryEvidenceDigest,
      sha256Pattern,
      "Recovery evidence digest",
    ) as Sha256Digest,
    stageAuthorizationDigest: lifecycleString(
      root.stageAuthorizationDigest,
      sha256Pattern,
      "Stage authorization digest",
    ) as Sha256Digest,
  };
  const trustedNow = lifecycleTimestamp(root.trustedNow, "Trusted promotion clock");
  if (!Array.isArray(root.documents) || root.documents.length === 0) {
    throw new Error("Promotion requires an exact document population.");
  }
  const documents = root.documents.map((value, index) => {
    const row = lifecycleRecord(value, `Promotion document ${index + 1}`);
    lifecycleExactKeys(
      row,
      [
        "documentId",
        "baselineGenerationId",
        "currentDocumentStatus",
        "currentGenerationId",
        "expectedStateDigest",
        "actualStateDigest",
        "stageMemberReceiptDigest",
        "stageAuthorityDigest",
        "actualAuthorityDigest",
      ],
      `Promotion document ${index + 1}`,
    );
    const documentId = lifecycleString(row.documentId, uuidPattern, "Document ID");
    const baselineGenerationId =
      row.baselineGenerationId === null
        ? null
        : lifecycleString(row.baselineGenerationId, uuidPattern, "Baseline generation");
    const currentGenerationId =
      row.currentGenerationId === null
        ? null
        : lifecycleString(row.currentGenerationId, uuidPattern, "Current generation");
    if (row.currentDocumentStatus !== "indexed") {
      throw new Error(`Promotion cannot first-publish non-indexed document ${documentId}.`);
    }
    if (currentGenerationId !== baselineGenerationId || currentGenerationId === candidateGenerationId) {
      throw new Error(`Current generation changed for ${documentId}.`);
    }
    const expectedStateDigest = lifecycleString(row.expectedStateDigest, bareSha256Pattern, "Expected state digest");
    const actualStateDigest = lifecycleString(row.actualStateDigest, bareSha256Pattern, "Actual state digest");
    if (expectedStateDigest !== actualStateDigest) throw new Error(`State changed for ${documentId}.`);
    return {
      documentId,
      baselineGenerationId,
      currentDocumentStatus: "indexed" as const,
      currentGenerationId,
      expectedStateDigest,
      actualStateDigest,
      stageMemberReceiptDigest: lifecycleString(
        row.stageMemberReceiptDigest,
        sha256Pattern,
        "Stage member receipt digest",
      ) as Sha256Digest,
      stageAuthorityDigest: lifecycleString(
        row.stageAuthorityDigest,
        sha256Pattern,
        "Stage source authority digest",
      ) as Sha256Digest,
      actualAuthorityDigest: lifecycleString(
        row.actualAuthorityDigest,
        sha256Pattern,
        "Current source authority digest",
      ) as Sha256Digest,
    };
  });
  for (const document of documents) {
    if (document.stageAuthorityDigest !== document.actualAuthorityDigest) {
      throw new Error(`Source authority changed for ${document.documentId}.`);
    }
  }
  const documentIds = documents.map((row) => row.documentId);
  if ([...documentIds].sort().join("|") !== documentIds.join("|") || new Set(documentIds).size !== documentIds.length) {
    throw new Error("Promotion document population must be sorted and unique.");
  }

  if (!Array.isArray(root.technicalEvidence) || root.technicalEvidence.length !== documents.length) {
    throw new Error("Promotion requires exact technical evidence coverage.");
  }
  const technicalEvidence = root.technicalEvidence.map((value, index) => {
    const receipt = lifecycleRecord(value, `Technical evidence ${index + 1}`);
    lifecycleExactKeys(
      receipt,
      [
        "receiptId",
        "version",
        "jobId",
        "documentId",
        "generationId",
        "admissionEventId",
        "policyVersion",
        "stateDigest",
        "evidenceDigest",
        "verdict",
        "codes",
        "receiptDigest",
      ],
      `Technical evidence ${index + 1}`,
    );
    const document = documents[index]!;
    if (
      receipt.version !== "document-generation-technical-evidence-v1" ||
      receipt.verdict !== "activate" ||
      !Array.isArray(receipt.codes) ||
      receipt.codes.length !== 0
    ) {
      throw new Error(`Technical evidence did not authorize ${document.documentId}.`);
    }
    const documentId = lifecycleString(receipt.documentId, uuidPattern, "Technical evidence document ID");
    const generationId = lifecycleString(receipt.generationId, uuidPattern, "Technical evidence generation ID");
    const stateDigest = lifecycleString(receipt.stateDigest, sha256Pattern, "Technical state digest") as Sha256Digest;
    if (
      documentId !== document.documentId ||
      generationId !== candidateGenerationId ||
      stateDigest !== `sha256:${document.expectedStateDigest}`
    ) {
      throw new Error(`Technical evidence identity mismatch for ${document.documentId}.`);
    }
    return {
      receiptId: lifecycleString(receipt.receiptId, uuidPattern, "Technical evidence receipt ID"),
      version: "document-generation-technical-evidence-v1" as const,
      jobId: lifecycleString(receipt.jobId, uuidPattern, "Technical evidence job ID"),
      documentId,
      generationId,
      admissionEventId: lifecycleString(receipt.admissionEventId, uuidPattern, "Admission event ID"),
      policyVersion: lifecycleString(receipt.policyVersion, /^[a-z0-9][a-z0-9._-]{0,119}$/, "Policy version"),
      stateDigest,
      evidenceDigest: lifecycleString(receipt.evidenceDigest, sha256Pattern, "Technical evidence digest") as Sha256Digest,
      verdict: "activate" as const,
      codes: Object.freeze([]) as readonly [],
      receiptDigest: lifecycleString(receipt.receiptDigest, sha256Pattern, "Technical receipt digest") as Sha256Digest,
    };
  });
  if (new Set(technicalEvidence.map((receipt) => receipt.receiptId)).size !== technicalEvidence.length) {
    throw new Error("Technical evidence receipt IDs must be unique.");
  }

  const authorization = lifecycleRecord(root.authorization, "Promote authorization");
  lifecycleExactKeys(
    authorization,
    [
      "version",
      "operation",
      "targetProjectRef",
      "candidateGenerationId",
      "planDigest",
      "stageReceiptDigest",
      "evaluationReportDigest",
      "recoveryEvidenceDigest",
      "stageAuthorizationDigest",
      "expectedDocumentIds",
      "expectedDocumentCount",
      "expectedTechnicalEvidenceReceiptDigests",
      "authorizedAt",
      "expiresAt",
      "retainedUntil",
      "confirmationSha256",
    ],
    "Promote authorization",
  );
  const authorizedAt = lifecycleTimestamp(authorization.authorizedAt, "Promote authorization time");
  const expiresAt = lifecycleTimestamp(authorization.expiresAt, "Promote authorization expiry");
  const retainedUntil = lifecycleTimestamp(authorization.retainedUntil, "Promotion retention deadline");
  if (Date.parse(authorizedAt) > Date.parse(trustedNow) || Date.parse(trustedNow) >= Date.parse(expiresAt)) {
    throw new Error("Promote authorization is not current.");
  }
  if (Date.parse(retainedUntil) <= Date.parse(trustedNow) || Date.parse(retainedUntil) <= Date.parse(authorizedAt)) {
    throw new Error("Promotion retention deadline must be in the future.");
  }
  const expectedDocumentIds = authorization.expectedDocumentIds;
  const expectedTechnicalDigests = authorization.expectedTechnicalEvidenceReceiptDigests;
  if (
    authorization.version !== 1 ||
    authorization.operation !== "promote" ||
    authorization.targetProjectRef !== projectRef ||
    authorization.candidateGenerationId !== candidateGenerationId ||
    authorization.expectedDocumentCount !== documents.length ||
    !Array.isArray(expectedDocumentIds) ||
    !sameLifecycleArray(expectedDocumentIds, documentIds) ||
    !Array.isArray(expectedTechnicalDigests) ||
    !sameLifecycleArray(
      expectedTechnicalDigests,
      technicalEvidence.map((receipt) => receipt.receiptDigest),
    ) ||
    Object.entries(digests).some(([key, value]) => authorization[key] !== value)
  ) {
    throw new Error("Promote authorization does not match the validated generation evidence.");
  }
  lifecycleString(authorization.confirmationSha256, sha256Pattern, "Promote confirmation digest");
  const promoteAuthorizationDigest = lifecycleString(
    root.promoteAuthorizationDigest,
    sha256Pattern,
    "Promote authorization digest",
  ) as Sha256Digest;
  if (lifecycleDigest(authorization) !== promoteAuthorizationDigest) {
    throw new Error("Promote authorization digest mismatch.");
  }
  if (promoteAuthorizationDigest === digests.stageAuthorizationDigest) {
    throw new Error("Promote authorization must be distinct from stage authorization.");
  }
  return lifecycleFreeze({
    version: 1 as const,
    projectRef,
    candidateGenerationId,
    ...digests,
    decision: "GO" as const,
    documents,
    technicalEvidence,
    authorization: authorization as ShadowGenerationPromotionAuthorizationV1,
    promoteAuthorizationDigest,
    trustedNow,
  });
}

export type DocumentGenerationCleanupPlanV1 = Readonly<{
  version: 1;
  projectRef: string;
  targets: readonly Readonly<{ documentId: string; generationId: string }>[];
  expectedCount: number;
  createdAt: string;
  digest: Sha256Digest;
}>;

function parseCleanupPlan(input: unknown): DocumentGenerationCleanupPlanV1 {
  const root = lifecycleRecord(input, "Generation cleanup plan");
  lifecycleExactKeys(root, ["version", "projectRef", "targets", "expectedCount", "createdAt", "digest"], "Generation cleanup plan");
  if (root.version !== 1 || !Array.isArray(root.targets) || root.targets.length === 0) {
    throw new Error("Generation cleanup plan is empty or unsupported.");
  }
  const projectRef = lifecycleString(root.projectRef, projectRefPattern, "Cleanup project reference");
  const targets = root.targets.map((value, index) => {
    const target = lifecycleRecord(value, `Cleanup target ${index + 1}`);
    lifecycleExactKeys(target, ["documentId", "generationId"], `Cleanup target ${index + 1}`);
    return {
      documentId: lifecycleString(target.documentId, uuidPattern, "Cleanup document ID").toLowerCase(),
      generationId: lifecycleString(target.generationId, uuidPattern, "Cleanup generation ID").toLowerCase(),
    };
  });
  const targetKeys = targets.map((target) => `${target.documentId}:${target.generationId}`);
  if ([...targetKeys].sort().join("|") !== targetKeys.join("|") || new Set(targetKeys).size !== targets.length) {
    throw new Error("Generation cleanup targets must be sorted and unique.");
  }
  if (root.expectedCount !== targets.length) throw new Error("Generation cleanup expected count mismatch.");
  const createdAt = lifecycleTimestamp(root.createdAt, "Cleanup plan creation time");
  const suppliedDigest = lifecycleString(root.digest, sha256Pattern, "Cleanup plan digest") as Sha256Digest;
  const payload = { version: 1 as const, projectRef, targets, expectedCount: targets.length, createdAt };
  if (lifecycleDigest(payload) !== suppliedDigest) throw new Error("Generation cleanup plan digest mismatch.");
  return lifecycleFreeze({ ...payload, digest: suppliedDigest });
}

export function assertDocumentGenerationCleanupPlan(input: unknown): DocumentGenerationCleanupPlanV1 {
  return parseCleanupPlan(input);
}

export function planDocumentGenerationCleanup(input: unknown): DocumentGenerationCleanupPlanV1 {
  const root = lifecycleRecord(input, "Generation cleanup planning input");
  lifecycleExactKeys(root, ["version", "projectRef", "createdAt", "trustedNow", "rows"], "Generation cleanup planning input");
  if (root.version !== 1 || !Array.isArray(root.rows) || root.rows.length === 0) {
    throw new Error("Generation cleanup planning input is empty or unsupported.");
  }
  const projectRef = lifecycleString(root.projectRef, projectRefPattern, "Cleanup project reference");
  const createdAt = lifecycleTimestamp(root.createdAt, "Cleanup plan creation time");
  const trustedNow = lifecycleTimestamp(root.trustedNow, "Cleanup planning clock");
  if (Date.parse(createdAt) > Date.parse(trustedNow)) throw new Error("Cleanup plan creation time is in the future.");
  const targets = root.rows.map((value, index) => {
    const row = lifecycleRecord(value, `Cleanup row ${index + 1}`);
    lifecycleExactKeys(
      row,
      ["documentId", "generationId", "state", "activeGenerationId", "retainedUntil"],
      `Cleanup row ${index + 1}`,
    );
    const documentId = lifecycleString(row.documentId, uuidPattern, "Cleanup document ID").toLowerCase();
    const generationId = lifecycleString(row.generationId, uuidPattern, "Cleanup generation ID").toLowerCase();
    const activeGenerationId =
      row.activeGenerationId === null
        ? null
        : lifecycleString(row.activeGenerationId, uuidPattern, "Active generation ID").toLowerCase();
    if (activeGenerationId === generationId) throw new Error(`Cleanup target ${generationId} is active or newly referenced.`);
    if (row.state === "retained") {
      const retainedUntil = lifecycleTimestamp(row.retainedUntil, "Retained generation deadline");
      if (Date.parse(retainedUntil) > Date.parse(trustedNow)) {
        throw new Error(`Retained generation ${generationId} has not expired.`);
      }
    } else if (row.state !== "abandoned" || row.retainedUntil !== null) {
      throw new Error(`Generation ${generationId} is not deletion-authorized.`);
    }
    return { documentId, generationId };
  });
  targets.sort((left, right) =>
    left.documentId === right.documentId
      ? left.generationId.localeCompare(right.generationId)
      : left.documentId.localeCompare(right.documentId),
  );
  const keys = targets.map((target) => `${target.documentId}:${target.generationId}`);
  if (new Set(keys).size !== targets.length) throw new Error("Generation cleanup targets must be unique.");
  const payload = { version: 1 as const, projectRef, targets, expectedCount: targets.length, createdAt };
  return lifecycleFreeze({ ...payload, digest: lifecycleDigest(payload) });
}

export type DocumentGenerationPromotionReceiptV1 = Readonly<{
  version: 1;
  kind: "document-generation-promotion-v1";
  operationId: string;
  projectRef: string;
  candidateGenerationId: string;
  planDigest: Sha256Digest;
  stageReceiptDigest: Sha256Digest;
  evaluationReportDigest: Sha256Digest;
  recoveryEvidenceDigest: Sha256Digest;
  stageAuthorizationDigest: Sha256Digest;
  promoteAuthorizationDigest: Sha256Digest;
  technicalEvidenceReceiptDigests: readonly Sha256Digest[];
  transitions: readonly Readonly<{
    documentId: string;
    fromGenerationId: string | null;
    toGenerationId: string;
    previousServingSnapshotDigest: Sha256Digest;
    candidateServingSnapshotDigest: Sha256Digest;
    retainedUntil: string;
  }>[];
  promotedAt: string;
  receiptDigest: Sha256Digest;
}>;

export type DocumentGenerationLifecycleRollbackReceiptV1 = Readonly<{
  version: 1;
  kind: "document-generation-rollback-v1";
  operationId: string;
  promotionOperationId: string;
  promotionReceiptDigest: Sha256Digest;
  rollbackManifestDigest: Sha256Digest;
  candidateGenerationId: string;
  transitions: readonly Readonly<{
    documentId: string;
    fromGenerationId: string;
    toGenerationId: string | null;
    retainedUntil: string;
  }>[];
  rolledBackAt: string;
  receiptDigest: Sha256Digest;
}>;

function parseLifecycleReceipt(input: unknown, kind: string, keys: readonly string[]): Record<string, unknown> {
  const receipt = lifecycleRecord(input, kind);
  lifecycleExactKeys(receipt, [...keys, "receiptDigest"], kind);
  const supplied = lifecycleString(receipt.receiptDigest, sha256Pattern, `${kind} digest`);
  const { receiptDigest: _receiptDigest, ...payload } = receipt;
  if (lifecycleDigest(payload) !== supplied) throw new Error(`${kind} digest mismatch.`);
  return receipt;
}

export function assertDocumentGenerationPromotionReceipt(input: unknown): DocumentGenerationPromotionReceiptV1 {
  const receipt = parseLifecycleReceipt(input, "Generation promotion receipt", [
    "version", "kind", "operationId", "projectRef", "candidateGenerationId", "planDigest", "stageReceiptDigest",
    "evaluationReportDigest", "recoveryEvidenceDigest", "stageAuthorizationDigest", "promoteAuthorizationDigest",
    "technicalEvidenceReceiptDigests", "transitions", "promotedAt",
  ]);
  if (receipt.version !== 1 || receipt.kind !== "document-generation-promotion-v1") {
    throw new Error("Generation promotion receipt kind is invalid.");
  }
  lifecycleString(receipt.operationId, uuidPattern, "Promotion operation ID");
  lifecycleString(receipt.projectRef, projectRefPattern, "Promotion project reference");
  const candidateGenerationId = lifecycleString(receipt.candidateGenerationId, uuidPattern, "Promotion candidate generation");
  for (const key of ["planDigest", "stageReceiptDigest", "evaluationReportDigest", "recoveryEvidenceDigest",
    "stageAuthorizationDigest", "promoteAuthorizationDigest"] as const) lifecycleString(receipt[key], sha256Pattern, key);
  if (receipt.stageAuthorizationDigest === receipt.promoteAuthorizationDigest)
    throw new Error("Promotion receipt collapsed stage and promote authorization.");
  if (!Array.isArray(receipt.technicalEvidenceReceiptDigests) || receipt.technicalEvidenceReceiptDigests.length === 0)
    throw new Error("Promotion receipt technical evidence is incomplete.");
  receipt.technicalEvidenceReceiptDigests.forEach((value) => lifecycleString(value, sha256Pattern, "Technical receipt digest"));
  if (!Array.isArray(receipt.transitions) || receipt.transitions.length !== receipt.technicalEvidenceReceiptDigests.length)
    throw new Error("Promotion receipt transitions are incomplete.");
  const ids: string[] = [];
  const promotedAt = lifecycleTimestamp(receipt.promotedAt, "Promotion receipt time");
  for (const value of receipt.transitions) {
    const transition = lifecycleRecord(value, "Promotion transition");
    lifecycleExactKeys(transition, ["documentId", "fromGenerationId", "toGenerationId", "previousServingSnapshotDigest",
      "candidateServingSnapshotDigest", "retainedUntil"], "Promotion transition");
    ids.push(lifecycleString(transition.documentId, uuidPattern, "Promotion transition document"));
    if (transition.fromGenerationId !== null) lifecycleString(transition.fromGenerationId, uuidPattern, "Prior generation");
    if (lifecycleString(transition.toGenerationId, uuidPattern, "Promoted generation") !== candidateGenerationId)
      throw new Error("Promotion transition candidate mismatch.");
    lifecycleString(transition.previousServingSnapshotDigest, sha256Pattern, "Previous serving snapshot digest");
    lifecycleString(transition.candidateServingSnapshotDigest, sha256Pattern, "Candidate serving snapshot digest");
    if (Date.parse(lifecycleTimestamp(transition.retainedUntil, "Promotion retention deadline")) <= Date.parse(promotedAt))
      throw new Error("Promotion retention deadline must be after promotion.");
  }
  if ([...ids].sort().join("|") !== ids.join("|") || new Set(ids).size !== ids.length)
    throw new Error("Promotion transitions must be sorted and unique.");
  return lifecycleFreeze(receipt as DocumentGenerationPromotionReceiptV1);
}

export function assertDocumentGenerationLifecycleRollbackReceipt(
  input: unknown,
): DocumentGenerationLifecycleRollbackReceiptV1 {
  const receipt = parseLifecycleReceipt(input, "Generation rollback receipt", [
    "version", "kind", "operationId", "promotionOperationId", "promotionReceiptDigest", "rollbackManifestDigest",
    "candidateGenerationId", "transitions", "rolledBackAt",
  ]);
  if (receipt.version !== 1 || receipt.kind !== "document-generation-rollback-v1")
    throw new Error("Generation rollback receipt kind is invalid.");
  lifecycleString(receipt.operationId, uuidPattern, "Rollback operation ID");
  lifecycleString(receipt.promotionOperationId, uuidPattern, "Promotion operation ID");
  lifecycleString(receipt.promotionReceiptDigest, sha256Pattern, "Promotion receipt digest");
  lifecycleString(receipt.rollbackManifestDigest, sha256Pattern, "Rollback manifest digest");
  const candidateGenerationId = lifecycleString(receipt.candidateGenerationId, uuidPattern, "Rollback candidate generation");
  const rolledBackAt = lifecycleTimestamp(receipt.rolledBackAt, "Rollback receipt time");
  if (!Array.isArray(receipt.transitions) || receipt.transitions.length === 0) throw new Error("Rollback transitions are empty.");
  const ids: string[] = [];
  for (const value of receipt.transitions) {
    const transition = lifecycleRecord(value, "Rollback transition");
    lifecycleExactKeys(transition, ["documentId", "fromGenerationId", "toGenerationId", "retainedUntil"], "Rollback transition");
    ids.push(lifecycleString(transition.documentId, uuidPattern, "Rollback transition document"));
    if (lifecycleString(transition.fromGenerationId, uuidPattern, "Failed generation") !== candidateGenerationId)
      throw new Error("Rollback failed-generation mismatch.");
    if (transition.toGenerationId !== null) lifecycleString(transition.toGenerationId, uuidPattern, "Restored generation");
    if (Date.parse(lifecycleTimestamp(transition.retainedUntil, "Rollback retention deadline")) <= Date.parse(rolledBackAt))
      throw new Error("Rollback retention deadline must be after rollback.");
  }
  if ([...ids].sort().join("|") !== ids.join("|") || new Set(ids).size !== ids.length)
    throw new Error("Rollback transitions must be sorted and unique.");
  return lifecycleFreeze(receipt as DocumentGenerationLifecycleRollbackReceiptV1);
}

export function assertDocumentGenerationLifecycleRollbackPair(
  promotionInput: unknown,
  rollbackInput: unknown,
) {
  const promotion = assertDocumentGenerationPromotionReceipt(promotionInput);
  const rollback = assertDocumentGenerationLifecycleRollbackReceipt(rollbackInput);
  if (
    rollback.promotionOperationId !== promotion.operationId ||
    rollback.promotionReceiptDigest !== promotion.receiptDigest ||
    rollback.candidateGenerationId !== promotion.candidateGenerationId ||
    rollback.transitions.length !== promotion.transitions.length ||
    rollback.operationId === promotion.operationId ||
    Date.parse(rollback.rolledBackAt) <= Date.parse(promotion.promotedAt)
  ) {
    throw new Error("Rollback is not bound to the exact promotion receipt.");
  }
  for (const [index, transition] of rollback.transitions.entries()) {
    const promoted = promotion.transitions[index]!;
    if (
      transition.documentId !== promoted.documentId ||
      transition.fromGenerationId !== promoted.toGenerationId ||
      transition.toGenerationId !== promoted.fromGenerationId
    ) {
      throw new Error("Rollback does not reverse the exact retained pointer transition.");
    }
  }
  return lifecycleFreeze({ promotion, rollback });
}
