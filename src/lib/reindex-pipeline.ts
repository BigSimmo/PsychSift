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

export function committedIndexGeneration(metadata: unknown) {
  const generation = metadataRecord(metadata).index_generation_id;
  return typeof generation === "string" && generation.trim() ? generation.trim() : null;
}

export function isAtomicReindexCandidate(document: { status?: string | null; metadata?: unknown }) {
  return document.status === "indexed";
}

export function isCommittedGenerationMetadata(args: { rowMetadata?: unknown; committedGeneration?: string | null }) {
  const rowGeneration = committedIndexGeneration(args.rowMetadata);
  if (!rowGeneration) return true;
  if (!args.committedGeneration) return true;
  return rowGeneration === args.committedGeneration;
}

export function imageRowNeedsGenerationRestamp(args: {
  indexGenerationId: string | null;
  metadata: unknown;
  committedGeneration: string;
}) {
  if (args.indexGenerationId !== args.committedGeneration) return true;
  return committedIndexGeneration(args.metadata) !== args.committedGeneration;
}

export function isAbandonedStagedGeneration(args: {
  rowMetadata?: unknown;
  rowGenerationId?: string | null;
  committedGeneration?: string | null;
}) {
  const rowGeneration =
    typeof args.rowGenerationId === "string" && args.rowGenerationId.trim()
      ? args.rowGenerationId.trim()
      : committedIndexGeneration(args.rowMetadata);
  if (!rowGeneration) return false;
  return rowGeneration !== (args.committedGeneration ?? null);
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
