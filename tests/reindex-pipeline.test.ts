import { describe, expect, it } from "vitest";
import {
  abandonedReindexGenerationTotal,
  assertDocumentGenerationReceiptPair,
  committedIndexGeneration,
  hasAbandonedReindexGenerations,
  imageRowNeedsGenerationRestamp,
  isAbandonedStagedGeneration,
  hasIncompleteDocumentsWithoutOpenJobs,
  isAtomicReindexCandidate,
  isCommittedGenerationMetadata,
  isReindexQueueClear,
  type DocumentGenerationActivationReceipt,
  type DocumentGenerationRollbackReceipt,
} from "../src/lib/reindex-pipeline";
import {
  activationReceiptDigest,
  parseActivationReceipt,
  parseRollbackReceipt,
  rollbackReceiptDigest,
} from "../src/lib/recovery-readiness-evidence";

describe("reindex pipeline queue state", () => {
  it("does not declare the queue clear while documents are still processing", () => {
    expect(
      isReindexQueueClear({
        openJobs: 0,
        queuedDocuments: 0,
        processingDocuments: 1,
        failedDocuments: 0,
      }),
    ).toBe(false);
  });

  it("flags orphaned incomplete documents when no jobs remain", () => {
    expect(
      hasIncompleteDocumentsWithoutOpenJobs({
        openJobs: 0,
        queuedDocuments: 0,
        processingDocuments: 1,
        failedDocuments: 0,
      }),
    ).toBe(true);
    expect(
      hasIncompleteDocumentsWithoutOpenJobs({
        openJobs: 0,
        queuedDocuments: 1,
        processingDocuments: 0,
        failedDocuments: 1,
      }),
    ).toBe(false);
  });

  it("declares the queue clear only when no open jobs or incomplete documents remain", () => {
    expect(
      isReindexQueueClear({
        openJobs: 0,
        queuedDocuments: 0,
        processingDocuments: 0,
        failedDocuments: 0,
      }),
    ).toBe(true);
  });

  it("treats indexed documents as atomic reindex candidates", () => {
    expect(isAtomicReindexCandidate({ status: "indexed", metadata: { index_generation_id: "old-generation" } })).toBe(
      true,
    );
    expect(isAtomicReindexCandidate({ status: "queued", metadata: { index_generation_id: "old-generation" } })).toBe(
      false,
    );
  });

  it("compares generated artifacts against the committed document generation", () => {
    expect(committedIndexGeneration({ index_generation_id: "generation-a" })).toBe("generation-a");
    expect(isCommittedGenerationMetadata({ rowMetadata: {}, committedGeneration: "generation-a" })).toBe(true);
    expect(
      isCommittedGenerationMetadata({
        rowMetadata: { index_generation_id: "generation-b" },
        committedGeneration: "generation-a",
      }),
    ).toBe(false);
    expect(
      isCommittedGenerationMetadata({
        rowMetadata: { index_generation_id: "generation-a" },
        committedGeneration: "generation-a",
      }),
    ).toBe(true);
    expect(
      isCommittedGenerationMetadata({
        rowMetadata: { index_generation_id: "legacy-generation" },
        committedGeneration: null,
      }),
    ).toBe(true);
  });

  it("identifies image rows that still need typed generation columns populated", () => {
    expect(
      imageRowNeedsGenerationRestamp({
        indexGenerationId: null,
        metadata: { index_generation_id: "generation-a" },
        committedGeneration: "generation-a",
      }),
    ).toBe(true);
    expect(
      imageRowNeedsGenerationRestamp({
        indexGenerationId: "generation-a",
        metadata: { index_generation_id: "generation-a" },
        committedGeneration: "generation-a",
      }),
    ).toBe(false);
    expect(
      imageRowNeedsGenerationRestamp({
        indexGenerationId: "generation-b",
        metadata: { index_generation_id: "generation-b" },
        committedGeneration: "generation-a",
      }),
    ).toBe(true);
  });

  it("identifies abandoned staged generation rows without flagging legacy generationless rows", () => {
    expect(
      isAbandonedStagedGeneration({
        rowGenerationId: "generation-b",
        committedGeneration: "generation-a",
      }),
    ).toBe(true);
    expect(
      isAbandonedStagedGeneration({
        rowMetadata: { index_generation_id: "generation-a" },
        committedGeneration: "generation-a",
      }),
    ).toBe(false);
    expect(
      isAbandonedStagedGeneration({
        rowMetadata: {},
        committedGeneration: "generation-a",
      }),
    ).toBe(false);
  });

  it("summarizes abandoned staged generation cleanup counts", () => {
    expect(
      abandonedReindexGenerationTotal({
        document_chunks: 2,
        document_images: 1,
        document_table_facts: 0,
      }),
    ).toBe(3);
    expect(hasAbandonedReindexGenerations({ document_chunks: 0, document_images: 0 })).toBe(false);
    expect(hasAbandonedReindexGenerations({ document_chunks: 0, document_images: 1 })).toBe(true);
  });

  it("requires document rollback to restore the retained real prior generation", () => {
    const activationPayload = {
      version: 1 as const,
      receiptId: "11111111-1111-4111-8111-111111111111",
      sequence: 10,
      recordedAt: "2026-08-24T07:00:00.000Z",
      projectRef: "sjrfecxgysukkwxsowpy",
      operation: "document-generation" as const,
      recoveryEvidenceId: "22222222-2222-4222-8222-222222222222",
      recoveryEvidenceDigest: `sha256:${"a".repeat(64)}`,
      stateDigest: `sha256:${"b".repeat(64)}`,
      resource: {
        kind: "document-generation" as const,
        documentId: "33333333-3333-4333-8333-333333333333",
        generationId: "44444444-4444-4444-8444-444444444444",
        generationDigest: `sha256:${"c".repeat(64)}`,
      },
      previousResource: {
        kind: "document-generation" as const,
        documentId: "33333333-3333-4333-8333-333333333333",
        generationId: "55555555-5555-4555-8555-555555555555",
        generationDigest: `sha256:${"d".repeat(64)}`,
      },
    };
    const activation = parseActivationReceipt({
      ...activationPayload,
      digest: activationReceiptDigest(activationPayload),
    }) as DocumentGenerationActivationReceipt;
    const rollbackPayload = {
      version: 1 as const,
      receiptId: "66666666-6666-4666-8666-666666666666",
      sequence: 11,
      recordedAt: "2026-08-25T07:00:00.000Z",
      projectRef: activation.projectRef,
      operation: activation.operation,
      activationReceiptId: activation.receiptId,
      activationReceiptDigest: activation.digest,
      recoveryEvidenceDigest: activation.recoveryEvidenceDigest,
      failedResource: activation.resource,
      restoredResource: activation.previousResource,
      restorationMethod: "retained-pointer" as const,
    };
    const rollback = parseRollbackReceipt({
      ...rollbackPayload,
      digest: rollbackReceiptDigest(rollbackPayload),
    }) as DocumentGenerationRollbackReceipt;

    expect(assertDocumentGenerationReceiptPair(activation, rollback)).toEqual({ activation, rollback });

    const reconstructedPayload = {
      ...rollbackPayload,
      restoredResource: {
        ...rollbackPayload.restoredResource,
        generationId: "77777777-7777-4777-8777-777777777777",
      },
    };
    const reconstructed = parseRollbackReceipt({
      ...reconstructedPayload,
      digest: rollbackReceiptDigest(reconstructedPayload),
    }) as DocumentGenerationRollbackReceipt;
    expect(() => assertDocumentGenerationReceiptPair(activation, reconstructed)).toThrow(/retained|previous/i);
  });

  it("keeps site-release identity distinct from document-generation receipts", () => {
    const activationPayload = {
      version: 1 as const,
      receiptId: "88888888-8888-4888-8888-888888888888",
      sequence: 1,
      recordedAt: "2026-08-24T07:00:00.000Z",
      projectRef: "sjrfecxgysukkwxsowpy",
      operation: "site-release" as const,
      recoveryEvidenceId: "99999999-9999-4999-8999-999999999999",
      recoveryEvidenceDigest: `sha256:${"a".repeat(64)}`,
      stateDigest: `sha256:${"b".repeat(64)}`,
      resource: {
        kind: "site-release" as const,
        releaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        releaseDigest: `sha256:${"c".repeat(64)}`,
      },
      previousResource: {
        kind: "site-release" as const,
        releaseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        releaseDigest: `sha256:${"d".repeat(64)}`,
      },
    };
    const siteActivation = parseActivationReceipt({
      ...activationPayload,
      digest: activationReceiptDigest(activationPayload),
    });

    expect(() => assertDocumentGenerationReceiptPair(siteActivation, {})).toThrow(/document-generation/i);
  });
});
