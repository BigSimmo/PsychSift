import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertAuditTargetState,
  auditDocument,
  buildIngestionAuditReport,
  parseIngestionAuditInventory,
  type IngestionAuditInput,
} from "@/lib/ingestion-audit";

function fixture(overrides: Partial<IngestionAuditInput> = {}): IngestionAuditInput {
  return {
    documentId: "guideline-current",
    expectedStateDigest: "a".repeat(64),
    activeGenerationId: "generation-current",
    lifecycle: "current",
    metadata: {
      publisher: "Synthetic authority",
      jurisdiction: "AU-WA",
      sourceRole: "local_guideline",
      contentMode: "indexed_content",
    },
    sourceGovernanceValid: true,
    counts: {
      pages: { expected: 12, actual: 12 },
      chunks: { expected: 24, actual: 24 },
      tables: { expected: 2, actual: 2 },
      images: { expected: 1, actual: 1 },
      searchableUnits: { expected: 27, actual: 27 },
      embeddings: { expected: 27, actual: 27 },
      duplicateChunks: 0,
      orphanedArtifacts: 0,
    },
    unitQuality: {
      policyVersion: "rag-index-unit-quality-v1",
      empty: 0,
      oversized: 0,
      undersized: 0,
      lowInformation: 0,
    },
    structure: {
      chunkBoundsValid: true,
      headingContinuityPassed: true,
      tableContinuityPassed: true,
      extractionQualityPassed: true,
    },
    embeddingContract: {
      expectedModel: "text-embedding-3-small",
      actualModels: ["text-embedding-3-small"],
      expectedDimensions: 1536,
      actualDimensions: [1536],
      expectedStrategy: "chunk-and-structured-units-v1",
      actualStrategies: ["chunk-and-structured-units-v1"],
      completeness: 1,
    },
    chunkGenerations: ["generation-current"],
    mustPassCases: [
      {
        id: "must-pass-current",
        passed: true,
        expectedDocumentRank: 1,
        actualDocumentRank: 1,
        failedExpectations: [],
      },
    ],
    ...overrides,
  };
}

describe("ingestion integrity audit", () => {
  it("does not recommend re-index for a metadata-only defect", () => {
    expect(auditDocument(fixture({ metadata: { ...fixture().metadata, publisher: null } }))).toMatchObject({
      action: "metadata_only",
      reasons: ["metadata_incomplete"],
    });
  });

  it("targets a proven extraction or generation defect", () => {
    expect(
      auditDocument(fixture({ counts: { ...fixture().counts, pages: { expected: 12, actual: 8 } } })),
    ).toMatchObject({
      action: "targeted_reprocess",
      reasons: ["missing_pages"],
    });
    expect(auditDocument(fixture({ activeGenerationId: "g1", chunkGenerations: ["g1", "g2"] }))).toMatchObject({
      action: "shadow_reindex",
      reasons: ["generation_incomplete"],
    });
    expect(auditDocument(fixture({ chunkGenerations: [] }))).toMatchObject({
      action: "shadow_reindex",
      reasons: ["generation_incomplete"],
    });
  });

  it("classifies unit-quality and embedding defects with deterministic precedence", () => {
    expect(auditDocument(fixture({ unitQuality: { ...fixture().unitQuality, empty: 2, oversized: 1 } }))).toMatchObject(
      {
        action: "targeted_reprocess",
        reasons: ["empty_index_units", "oversized_index_units"],
      },
    );
    expect(
      auditDocument(
        fixture({
          embeddingContract: {
            ...fixture().embeddingContract,
            expectedModel: "current-model",
            actualModels: ["old-model"],
          },
        }),
      ),
    ).toMatchObject({
      action: "shadow_reindex",
      reasons: ["embedding_missing_or_mismatched"],
    });
    expect(
      auditDocument(
        fixture({
          counts: { ...fixture().counts, pages: { expected: 12, actual: 0 } },
          embeddingContract: {
            ...fixture().embeddingContract,
            expectedModel: "current-model",
            actualModels: ["old-model"],
          },
        }),
      ),
    ).toMatchObject({
      action: "targeted_reprocess",
      reasons: ["missing_pages", "embedding_missing_or_mismatched"],
    });
  });

  it("blocks ineligible content from a shadow plan even when it also has repairable defects", () => {
    expect(
      auditDocument(
        fixture({ lifecycle: "withdrawn", counts: { ...fixture().counts, pages: { expected: 12, actual: 0 } } }),
      ),
    ).toMatchObject({
      eligibleForShadowPlan: false,
      blockingDisposition: "tombstone",
      reasons: ["withdrawn_or_superseded", "missing_pages"],
    });
    expect(auditDocument(fixture({ sourceGovernanceValid: false }))).toMatchObject({
      eligibleForShadowPlan: false,
      blockingDisposition: "quarantine_review",
      reasons: ["source_governance_invalid"],
    });
  });

  it("fails closed when integrity evidence is absent or state changes after audit", () => {
    const missingEvidence = auditDocument(fixture({ expectedStateDigest: null }));
    expect(missingEvidence).toMatchObject({
      action: "metadata_only",
      eligibleForShadowPlan: false,
      blockingDisposition: "quarantine_review",
      reasons: ["integrity_expectation_missing"],
    });
    expect(() => assertAuditTargetState(missingEvidence, "different-digest")).toThrow(/integrity expectation/i);
    expect(() => assertAuditTargetState(auditDocument(fixture()), "different-digest")).toThrow(/state digest changed/i);
    expect(() => assertAuditTargetState(auditDocument(fixture()), "a".repeat(64))).not.toThrow();
  });

  it("records exact counts and retrieval failures without fabricating repair evidence", () => {
    const result = auditDocument(
      fixture({
        counts: { ...fixture().counts, images: { expected: null, actual: 3 } },
        mustPassCases: [
          {
            id: "must-pass-current",
            passed: false,
            expectedDocumentRank: 1,
            actualDocumentRank: null,
            failedExpectations: ["expected document not retrieved"],
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      action: "shadow_reindex",
      reasons: ["must_pass_retrieval_failed"],
      counts: { images: { expected: null, actual: 3 } },
    });
    expect(result.mustPassCases[0]).toEqual({
      id: "must-pass-current",
      passed: false,
      expectedDocumentRank: 1,
      actualDocumentRank: null,
      failedExpectations: ["expected document not retrieved"],
    });
  });

  it("builds a deterministic privacy-minimised report from inventory metadata only", () => {
    const input = {
      schemaVersion: 1 as const,
      inventoryVersion: "synthetic-active-corpus-v1",
      documents: [fixture()],
      retrievedDocumentIdsByCase: { "must-pass-current": ["guideline-current"] },
    };
    const expectedCoverage = [
      {
        key: "synthetic-current-guideline",
        owner: "Clinical governance",
        reviewStatus: "active" as const,
        expectedDocumentIds: ["guideline-current"],
        mustPassCaseIds: ["must-pass-current"],
      },
    ];

    const first = buildIngestionAuditReport({ inventory: input, expectedCoverage });
    const second = buildIngestionAuditReport({
      inventory: { ...input, documents: [...input.documents].reverse() },
      expectedCoverage: [...expectedCoverage].reverse(),
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: 1,
      inventoryVersion: "synthetic-active-corpus-v1",
      summary: { documents: 1, noChange: 1, blocked: 0 },
    });
    expect(first.populationFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(first)).not.toMatch(/body|content|excerpt|query|filename|object.?key/i);
  });

  it("rejects malformed or content-bearing inventory records", () => {
    const valid = {
      schemaVersion: 1,
      inventoryVersion: "synthetic-active-corpus-v1",
      documents: [fixture()],
      retrievedDocumentIdsByCase: { "must-pass-current": ["guideline-current"] },
    };

    expect(parseIngestionAuditInventory(valid)).toEqual(valid);
    expect(() =>
      parseIngestionAuditInventory({
        ...valid,
        documents: [{ ...fixture(), extractedText: "must never enter the audit inventory" }],
      }),
    ).toThrow(/unrecognized|extractedText/i);
    expect(() =>
      parseIngestionAuditInventory({ ...valid, documents: [{ ...fixture(), expectedStateDigest: "not-a-digest" }] }),
    ).toThrow(/digest|64/i);
  });
});

describe("ingestion audit CLI boundary", () => {
  it("is import-safe and does not create output from importer argv", async () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "ingestion-audit-import-"));
    const unexpectedOutput = join(temporaryRoot, "unexpected.json");
    const originalArgv = [...process.argv];

    try {
      process.argv.push("--output", unexpectedOutput);
      await import("../scripts/audit-ingestion-corpus");
      expect(existsSync(unexpectedOutput)).toBe(false);
    } finally {
      process.argv.splice(0, process.argv.length, ...originalArgv);
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
