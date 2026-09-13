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

const baselineGeneration = "11111111-1111-4111-8111-111111111111";
const candidateGeneration = "22222222-2222-4222-8222-222222222222";

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
    expect(committedIndexGeneration({ index_generation_id: baselineGeneration })).toBe(baselineGeneration);
    expect(isCommittedGenerationMetadata({ rowMetadata: {}, committedGeneration: baselineGeneration })).toBe(false);
    expect(isCommittedGenerationMetadata({ rowMetadata: {}, committedGeneration: null })).toBe(true);
    expect(
      isCommittedGenerationMetadata({
        rowMetadata: { index_generation_id: candidateGeneration },
        committedGeneration: baselineGeneration,
      }),
    ).toBe(false);
    expect(
      isCommittedGenerationMetadata({
        rowMetadata: { index_generation_id: baselineGeneration },
        committedGeneration: baselineGeneration,
      }),
    ).toBe(true);
    expect(
      isCommittedGenerationMetadata({
        rowMetadata: { index_generation_id: candidateGeneration },
        committedGeneration: null,
      }),
    ).toBe(false);
  });

  it("identifies image rows that still need typed generation columns populated", () => {
    expect(
      imageRowNeedsGenerationRestamp({
        indexGenerationId: null,
        metadata: { index_generation_id: baselineGeneration },
        committedGeneration: baselineGeneration,
      }),
    ).toBe(true);
    expect(
      imageRowNeedsGenerationRestamp({
        indexGenerationId: baselineGeneration,
        metadata: { index_generation_id: baselineGeneration },
        committedGeneration: baselineGeneration,
      }),
    ).toBe(false);
    expect(
      imageRowNeedsGenerationRestamp({
        indexGenerationId: candidateGeneration,
        metadata: { index_generation_id: candidateGeneration },
        committedGeneration: baselineGeneration,
      }),
    ).toBe(true);
  });

  it("identifies abandoned staged generation rows without flagging legacy generationless rows", () => {
    expect(
      isAbandonedStagedGeneration({
        rowGenerationId: candidateGeneration,
        committedGeneration: baselineGeneration,
      }),
    ).toBe(true);
    expect(
      isAbandonedStagedGeneration({
        rowMetadata: { index_generation_id: baselineGeneration },
        committedGeneration: baselineGeneration,
      }),
    ).toBe(false);
    expect(
      isAbandonedStagedGeneration({
        rowMetadata: {},
        committedGeneration: baselineGeneration,
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

    expect(() =>
      assertDocumentGenerationReceiptPair(activation, {
        operation: "document-generation",
        activationReceiptId: activation.receiptId,
        failedResource: activation.resource,
        restoredResource: activation.previousResource,
      }),
    ).toThrow(/receipt|digest|invalid/i);

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

describe("ordinary generation visibility during shadow reindex", () => {
  it("does not expose tagged C when the live baseline is null", () => {
    expect(
      isCommittedGenerationMetadata({
        rowMetadata: { index_generation_id: candidateGeneration },
        committedGeneration: null,
      }),
    ).toBe(false);
  });

  it("does not expose tagged C when the caller has no committed generation", () => {
    expect(
      isCommittedGenerationMetadata({ rowMetadata: { index_generation_id: candidateGeneration } }),
    ).toBe(false);
  });

  it("retains exact G0 and excludes C under a valid committed pointer", () => {
    expect(
      isCommittedGenerationMetadata({
        rowMetadata: { index_generation_id: baselineGeneration },
        committedGeneration: baselineGeneration,
      }),
    ).toBe(true);
    expect(
      isCommittedGenerationMetadata({
        rowMetadata: { index_generation_id: candidateGeneration },
        committedGeneration: baselineGeneration,
      }),
    ).toBe(false);
  });

  const legacyRows: Array<[string, unknown]> = [
    ["absent metadata", undefined],
    ["null metadata", null],
    ["absent generation marker", {}],
    ["explicit null generation marker", { index_generation_id: null }],
  ];

  it.each(legacyRows)("retains supported untagged legacy rows with %s", (_name, rowMetadata) => {
    expect(isCommittedGenerationMetadata({ rowMetadata, committedGeneration: null })).toBe(true);
    expect(isCommittedGenerationMetadata({ rowMetadata, committedGeneration: baselineGeneration })).toBe(false);
  });

  const malformedMarkers: Array<[string, unknown]> = [
    ["empty string", ""],
    ["whitespace string", " \t "],
    ["number", 0],
    ["boolean", false],
    ["object", { candidate: candidateGeneration }],
    ["array", [candidateGeneration]],
    ["non-UUID string", "generation-a"],
    ["padded UUID", ` ${candidateGeneration} `],
    ["newline-suffixed UUID", `${candidateGeneration}\n`],
    ["present undefined", undefined],
  ];

  it.each(malformedMarkers)(
    "refuses a present-invalid %s marker instead of admitting it as legacy",
    (_name, marker) => {
      const rowMetadata = { index_generation_id: marker };
      expect.soft(isCommittedGenerationMetadata({ rowMetadata, committedGeneration: null })).toBe(false);
      expect.soft(isCommittedGenerationMetadata({ rowMetadata, committedGeneration: baselineGeneration })).toBe(false);
    },
  );
});

describe("document generation marker authority", () => {
  it.each([
    ["absent metadata", undefined],
    ["null metadata", null],
    ["absent own marker", {}],
  ] as const)("supports null G0 only for %s", (_name, metadata) => {
    expect(committedIndexGeneration(metadata)).toBeNull();
  });

  it.each([
    baselineGeneration,
    "ABCDEFAB-CDEF-ABCD-EFAB-ABCDEFABCDEF",
    "00000000-0000-0000-0000-000000000000",
  ])("retains the exact valid UUID source spelling %s", (generation) => {
    const metadata = Object.freeze({ index_generation_id: generation });
    expect(committedIndexGeneration(metadata)).toBe(generation);
    expect(metadata.index_generation_id).toBe(generation);
  });

  it.each([
    ["explicit JSON null", null],
    ["present undefined", undefined],
  ] as const)("refuses a document marker containing %s", (_name, marker) => {
    expect(() => committedIndexGeneration({ index_generation_id: marker })).toThrow(
      "Invalid committed generation metadata.",
    );
  });

  const malformedCommitted: Array<[string, unknown]> = [
    ["empty string", ""],
    ["whitespace", " \t "],
    ["non-UUID string", "synthetic-sensitive-marker"],
    ["padded UUID", ` ${baselineGeneration} `],
    ["newline-suffixed UUID", `${baselineGeneration}\n`],
    ["truncated UUID", baselineGeneration.slice(0, -1)],
    ["number", 0],
    ["boolean", false],
    ["object", { generation: baselineGeneration }],
    ["array", [baselineGeneration]],
  ];

  it.each(malformedCommitted)("refuses %s document identity without exposing its value", (_name, marker) => {
    expect(() => committedIndexGeneration({ index_generation_id: marker })).toThrow(
      new Error("Invalid committed generation metadata."),
    );
    // Direct callers cannot bypass the getter and admit legacy rows with an
    // invalid non-null committed argument. This remains a nonthrowing filter.
    expect(
      isCommittedGenerationMetadata({ rowMetadata: {}, committedGeneration: marker as string }),
    ).toBe(false);
    expect(
      isCommittedGenerationMetadata({
        rowMetadata: { index_generation_id: null },
        committedGeneration: marker as string,
      }),
    ).toBe(false);
  });

  it("compares UUID identity case-insensitively without rewriting metadata", () => {
    const lower = "abcdefab-cdef-abcd-efab-abcdefabcdef";
    const upper = lower.toUpperCase();
    const rowMetadata = Object.freeze({ index_generation_id: upper });

    expect(isCommittedGenerationMetadata({ rowMetadata, committedGeneration: lower })).toBe(true);
    expect(
      isCommittedGenerationMetadata({ rowMetadata: { index_generation_id: lower }, committedGeneration: upper }),
    ).toBe(true);
    expect(
      imageRowNeedsGenerationRestamp({
        indexGenerationId: lower,
        metadata: rowMetadata,
        committedGeneration: lower,
      }),
    ).toBe(false);
    expect(isAbandonedStagedGeneration({ rowMetadata, committedGeneration: lower })).toBe(false);
    expect(rowMetadata.index_generation_id).toBe(upper);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["absent marker", {}],
    ["null marker", { index_generation_id: null }],
  ] as const)("keeps artifact %s semantics separate from document authority", (_name, metadata) => {
    expect(
      imageRowNeedsGenerationRestamp({
        indexGenerationId: baselineGeneration,
        metadata,
        committedGeneration: baselineGeneration,
      }),
    ).toBe(true);
    expect(
      isAbandonedStagedGeneration({ rowMetadata: metadata, committedGeneration: baselineGeneration }),
    ).toBe(false);
    expect(isAbandonedStagedGeneration({ rowMetadata: metadata, committedGeneration: null })).toBe(false);
  });

  it.each([
    ["string", "malformed-metadata"],
    ["number", 1],
    ["boolean", false],
    ["array", []],
  ] as const)("refuses malformed outer %s metadata without treating it as absent", (_name, metadata) => {
    expect(() => committedIndexGeneration(metadata)).toThrow("Invalid committed generation metadata.");
    expect(isCommittedGenerationMetadata({ rowMetadata: metadata, committedGeneration: null })).toBe(false);
  });

  it("does not classify malformed row identity as abandoned", () => {
    expect(
      isAbandonedStagedGeneration({
        rowGenerationId: "malformed-generation",
        rowMetadata: { index_generation_id: candidateGeneration },
        committedGeneration: baselineGeneration,
      }),
    ).toBe(false);
    expect(
      isAbandonedStagedGeneration({
        rowMetadata: { index_generation_id: "malformed-generation" },
        committedGeneration: null,
      }),
    ).toBe(false);
  });

  it("does not classify a valid row as abandoned against malformed document identity", () => {
    expect(
      isAbandonedStagedGeneration({
        rowGenerationId: candidateGeneration,
        committedGeneration: "malformed-generation",
      }),
    ).toBe(false);
    expect(isAbandonedStagedGeneration({ rowGenerationId: candidateGeneration, committedGeneration: null })).toBe(true);
  });
});
