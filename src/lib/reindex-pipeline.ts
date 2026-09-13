import {
  assertReceiptAppendOnlyPair,
  type ActivationReceipt,
  type DocumentGenerationIdentity,
  type RollbackReceipt,
} from "@/lib/recovery-readiness-evidence";

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
  // Existing ordinary artifact nulls remain legacy; document null markers do not.
  if (row.kind === "absent" || row.kind === "null") return true;
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
