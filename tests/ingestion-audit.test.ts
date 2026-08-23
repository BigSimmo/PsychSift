import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertAuditTargetState,
  auditDocument,
  buildIngestionAuditReport,
  parseIngestionAuditInventory,
  reviewedProvenanceEvidenceDigest,
  type IngestionAuditInput,
  type IngestionFailureCode,
} from "@/lib/ingestion-audit";
import { auditExpectedSourceCoverage } from "@/lib/source-coverage-registry";

const reviewedProvenance = {
  review: {
    contractVersion: "ingestion-provenance-v1",
    evidenceDigest: "sha256:f9f6034458857f0ef1c75f245a854a138b06cb6c129b5c6803aa41cba029e925",
    reviewedAt: "2026-08-23",
    reviewerRole: "clinical_governance",
  },
  expected: {
    contentHash: `sha256:${"1".repeat(64)}`,
    extractionVersion: "extractor-v1",
    parserVersion: "parser-v1",
    parserConfigVersion: "parser-config-v1",
    chunkerVersion: "chunker-v1",
    indexUnitVersion: "index-unit-v1",
    validationVersion: "validation-v1",
    sourcePolicyVersion: "synthetic-source-policy-v1",
  },
  actual: {
    contentHash: `sha256:${"1".repeat(64)}`,
    extractionVersion: "extractor-v1",
    parserVersion: "parser-v1",
    parserConfigVersion: "parser-config-v1",
    chunkerVersion: "chunker-v1",
    indexUnitVersion: "index-unit-v1",
    validationVersion: "validation-v1",
    sourcePolicyVersion: "synthetic-source-policy-v1",
  },
} as const;

function fixture(overrides: Partial<IngestionAuditInput> = {}): IngestionAuditInput {
  return {
    documentId: "guideline-current",
    expectedStateDigest: "a".repeat(64),
    activeGenerationId: "generation-current",
    lifecycle: "current",
    metadata: {
      publisher: "Synthetic authority",
      jurisdiction: "AU-WA",
      corpusScope: "uploaded_local",
      sourceRole: "local_guideline",
      contentMode: "indexed_content",
      licencePolicy: "public_index_permitted",
      sourcePolicyVersion: "synthetic-source-policy-v1",
      sourceCatalogueKey: null,
      sourceExcluded: false,
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
    provenance: reviewedProvenance,
    chunkGenerations: ["generation-current"],
    mustPassCases: [
      {
        id: "must-pass-current",
        passed: true,
        expectedDocumentRank: 1,
        actualDocumentRank: 1,
        failureCodes: [],
      },
    ],
    ...overrides,
  };
}

describe("ingestion integrity audit", () => {
  it("requires measured retrieval evidence and rejects document/map contradictions", () => {
    const expectedCoverage = [
      {
        key: "synthetic-current-guideline",
        owner: "Clinical governance",
        reviewStatus: "active" as const,
        expectedDocumentIds: ["guideline-current"],
        mustPassCaseIds: ["must-pass-current"],
      },
    ];

    expect(() =>
      buildIngestionAuditReport({
        inventory: {
          schemaVersion: 1,
          inventoryVersion: "missing-retrieval-measurement",
          documents: [fixture()],
          retrievedDocumentIdsByCase: {},
        },
        expectedCoverage: {
          schemaVersion: 1,
          coverageVersion: "missing-retrieval-coverage-v1",
          records: expectedCoverage,
        },
      }),
    ).toThrow(/retrieval measurement.*must-pass-current|must-pass-current.*retrieval measurement/i);

    for (const [passed, retrievedDocumentIds] of [
      [true, []],
      [false, ["guideline-current"]],
    ] as const) {
      expect(() =>
        buildIngestionAuditReport({
          inventory: {
            schemaVersion: 1,
            inventoryVersion: "contradictory-retrieval-measurement",
            documents: [
              fixture({
                mustPassCases: [
                  {
                    id: "must-pass-current",
                    passed,
                    expectedDocumentRank: 1,
                    actualDocumentRank: passed ? 1 : null,
                    failureCodes: passed ? [] : ["document_not_retrieved"],
                  },
                ],
              }),
            ],
            retrievedDocumentIdsByCase: { "must-pass-current": [...retrievedDocumentIds] },
          },
          expectedCoverage: {
            schemaVersion: 1,
            coverageVersion: "contradictory-retrieval-coverage-v1",
            records: expectedCoverage,
          },
        }),
      ).toThrow(/contradictory retrieval evidence/i);
    }

    expect(
      auditExpectedSourceCoverage({
        expected: expectedCoverage,
        activeDocumentIds: new Set(["guideline-current"]),
        retrievedDocumentIdsByCase: new Map([["must-pass-current", new Set()]]),
      }),
    ).toMatchObject([{ outcome: "retrieval_miss" }]);
    expect(() =>
      auditExpectedSourceCoverage({
        expected: expectedCoverage,
        activeDocumentIds: new Set(["guideline-current"]),
        retrievedDocumentIdsByCase: new Map(),
      }),
    ).toThrow(/retrieval measurement.*must-pass-current|must-pass-current.*retrieval measurement/i);
  });

  it("validates bounded failure codes against measured presence and rank evidence", () => {
    type CaseEvidence = IngestionAuditInput["mustPassCases"][number];
    const buildCaseReport = (testCase: CaseEvidence, retrieved: boolean) =>
      buildIngestionAuditReport({
        inventory: {
          schemaVersion: 1,
          inventoryVersion: `failure-code-${testCase.failureCodes.join("-")}`,
          documents: [fixture({ mustPassCases: [testCase] })],
          retrievedDocumentIdsByCase: {
            "must-pass-current": retrieved ? ["guideline-current"] : [],
          },
        },
        expectedCoverage: {
          schemaVersion: 1,
          coverageVersion: "failure-code-coverage-v1",
          records: [
            {
              key: "synthetic-current-guideline",
              owner: "Clinical governance",
              reviewStatus: "active",
              expectedDocumentIds: ["guideline-current"],
              mustPassCaseIds: ["must-pass-current"],
            },
          ],
        },
      });
    const failedCase = (
      failureCode: IngestionFailureCode,
      actualDocumentRank: number | null,
      expectedDocumentRank: number | null = 1,
    ): CaseEvidence => ({
      id: "must-pass-current",
      passed: false,
      expectedDocumentRank,
      actualDocumentRank,
      failureCodes: [failureCode],
    });

    const indexDefects: Array<{ testCase: CaseEvidence; retrieved: boolean }> = [
      { testCase: failedCase("document_not_retrieved", null), retrieved: false },
      { testCase: failedCase("document_rank_exceeded", 3), retrieved: true },
    ];
    for (const row of indexDefects) {
      expect(() => buildCaseReport(row.testCase, row.retrieved)).not.toThrow();
      expect(buildCaseReport(row.testCase, row.retrieved).documents[0]).toMatchObject({
        action: "shadow_reindex",
        reasons: ["must_pass_retrieval_failed"],
      });
    }

    const nonIndexFailures: Array<{
      testCase: CaseEvidence;
      retrieved: boolean;
      reason: "integrity_expectation_missing" | "source_governance_invalid";
    }> = [
      { testCase: failedCase("source_role_mismatch", 2), retrieved: true, reason: "source_governance_invalid" },
      { testCase: failedCase("source_role_mismatch", null), retrieved: false, reason: "source_governance_invalid" },
      { testCase: failedCase("governance_block", 1), retrieved: true, reason: "source_governance_invalid" },
      { testCase: failedCase("governance_block", null), retrieved: false, reason: "source_governance_invalid" },
      { testCase: failedCase("case_timeout", null), retrieved: false, reason: "integrity_expectation_missing" },
      { testCase: failedCase("provider_failure", null), retrieved: false, reason: "integrity_expectation_missing" },
    ];
    for (const row of nonIndexFailures) {
      expect(auditDocument(fixture({ mustPassCases: [row.testCase] }))).toMatchObject({
        action: "no_change",
        eligibleForShadowPlan: false,
        blockingDisposition: "quarantine_review",
        reasons: [row.reason],
      });
      expect(() => buildCaseReport(row.testCase, row.retrieved)).toThrow(/non-index|incomplete.*retrieval/i);
    }

    const invalid: Array<{ testCase: CaseEvidence; retrieved: boolean }> = [
      { testCase: failedCase("document_not_retrieved", 1), retrieved: true },
      { testCase: failedCase("document_rank_exceeded", null), retrieved: false },
      { testCase: failedCase("document_rank_exceeded", 1), retrieved: true },
      { testCase: failedCase("source_role_mismatch", null), retrieved: true },
      { testCase: failedCase("governance_block", 1), retrieved: false },
      { testCase: failedCase("case_timeout", 1), retrieved: true },
      { testCase: failedCase("provider_failure", 1), retrieved: true },
    ];
    for (const row of invalid) {
      expect(() => buildCaseReport(row.testCase, row.retrieved)).toThrow(/retrieval|rank|failure evidence/i);
    }
    expect(() =>
      buildCaseReport(
        {
          id: "must-pass-current",
          passed: true,
          expectedDocumentRank: 1,
          actualDocumentRank: 3,
          failureCodes: [],
        },
        true,
      ),
    ).toThrow(/rank|failure evidence/i);
  });

  it("imports canonical source policy and cannot be overridden by a governance boolean", () => {
    expect(() =>
      auditDocument(
        fixture({
          metadata: {
            ...fixture().metadata,
            sourceRole: "invented_authority",
          } as unknown as IngestionAuditInput["metadata"],
        }),
      ),
    ).toThrow(/sourceRole|source role/i);

    expect(
      auditDocument(
        fixture({
          metadata: {
            ...fixture().metadata,
            corpusScope: "uploaded_local",
            contentMode: "link_only",
            licencePolicy: "metadata_link_only",
            sourcePolicyVersion: "synthetic-source-policy-v1",
            sourceExcluded: false,
          },
          sourceGovernanceValid: true,
        }) as IngestionAuditInput,
      ),
    ).toMatchObject({
      action: "no_change",
      diagnosticAction: "metadata_only",
      eligibleForShadowPlan: false,
      blockingDisposition: "quarantine_review",
      reasons: ["source_governance_invalid"],
    });

    expect(
      auditDocument(
        fixture({
          metadata: {
            ...fixture().metadata,
            corpusScope: "uploaded_local",
            contentMode: "indexed_content",
            licencePolicy: "public_index_permitted",
            sourcePolicyVersion: "synthetic-source-policy-v1",
            sourceExcluded: true,
          },
          sourceGovernanceValid: true,
        }) as IngestionAuditInput,
      ),
    ).toMatchObject({
      action: "no_change",
      diagnosticAction: "metadata_only",
      eligibleForShadowPlan: false,
      blockingDisposition: "quarantine_review",
      reasons: ["source_governance_invalid"],
    });

    const australianPolicyProvenance = {
      ...reviewedProvenance,
      review: {
        ...reviewedProvenance.review,
        evidenceDigest: "sha256:a713fd9d21002147e9fae04f6e5479b1ffd41f7462f71a0b4072c089f62e591c",
      },
      expected: { ...reviewedProvenance.expected, sourcePolicyVersion: "australian-source-policy-v1" },
      actual: { ...reviewedProvenance.actual, sourcePolicyVersion: "australian-source-policy-v1" },
    };
    for (const protectedMetadata of [
      {
        sourceRole: "reference_link",
        contentMode: "link_only",
        licencePolicy: "metadata_link_only",
        sourceCatalogueKey: "etg-complete",
      },
      {
        sourceRole: "professional_review",
        contentMode: "indexed_content",
        licencePolicy: "index_forbidden",
        sourceCatalogueKey: "nps-medicinewise",
      },
      {
        sourceRole: "clinical_reference",
        contentMode: "indexed_content",
        licencePolicy: "public_index_permitted",
        sourceCatalogueKey: "healthdirect",
      },
    ] as const) {
      expect(
        auditDocument(
          fixture({
            metadata: {
              ...fixture().metadata,
              corpusScope: "australian_public",
              sourcePolicyVersion: "australian-source-policy-v1",
              ...protectedMetadata,
            },
            provenance: australianPolicyProvenance,
            sourceGovernanceValid: true,
          }),
        ),
      ).toMatchObject({
        action: "no_change",
        eligibleForShadowPlan: false,
        blockingDisposition: "quarantine_review",
        reasons: ["source_governance_invalid"],
      });
    }
  });

  it("blocks site-registry content from the document audit control plane", () => {
    expect(
      auditDocument(
        fixture({
          metadata: { ...fixture().metadata, corpusScope: "clinical_kb_site" },
          sourceGovernanceValid: true,
        }),
      ),
    ).toMatchObject({
      action: "no_change",
      diagnosticAction: "metadata_only",
      eligibleForShadowPlan: false,
      blockingDisposition: "quarantine_review",
      reasons: ["source_governance_invalid"],
    });
  });

  it("detects over-count drift and records complete reviewed provenance", () => {
    expect(
      auditDocument(
        fixture({
          counts: { ...fixture().counts, pages: { expected: 12, actual: 13 } },
          provenance: reviewedProvenance,
        } as Partial<IngestionAuditInput>),
      ),
    ).toMatchObject({ action: "targeted_reprocess", reasons: ["count_mismatch"] });

    expect(
      auditDocument(
        fixture({
          provenance: {
            ...reviewedProvenance,
            actual: { ...reviewedProvenance.actual, parserVersion: "parser-v2" },
          },
        } as Partial<IngestionAuditInput>),
      ),
    ).toMatchObject({ action: "targeted_reprocess", reasons: ["provenance_mismatch"] });
  });

  it("binds the reviewed evidence digest to the complete expected provenance payload", () => {
    const reversedExpected = Object.fromEntries(
      Object.entries(reviewedProvenance.expected).reverse(),
    ) as typeof reviewedProvenance.expected;
    expect(
      reviewedProvenanceEvidenceDigest({
        contractVersion: reviewedProvenance.review.contractVersion,
        expected: reversedExpected,
      }),
    ).toBe(reviewedProvenance.review.evidenceDigest);
    expect(
      reviewedProvenanceEvidenceDigest({
        contractVersion: reviewedProvenance.review.contractVersion,
        expected: { ...reviewedProvenance.expected, parserVersion: "parser-v2" },
      }),
    ).not.toBe(reviewedProvenance.review.evidenceDigest);

    expect(
      auditDocument(
        fixture({
          provenance: {
            ...reviewedProvenance,
            expected: { ...reviewedProvenance.expected, parserVersion: "parser-v2" },
            actual: { ...reviewedProvenance.actual, parserVersion: "parser-v2" },
          },
        }),
      ),
    ).toMatchObject({
      action: "no_change",
      diagnosticAction: "targeted_reprocess",
      eligibleForShadowPlan: false,
      blockingDisposition: "quarantine_review",
      reasons: ["provenance_mismatch"],
    });
  });

  it("binds the complete reviewed coverage contract to report identity", () => {
    const inventory = {
      schemaVersion: 1 as const,
      inventoryVersion: "coverage-version-fingerprint",
      documents: [fixture({ provenance: reviewedProvenance } as Partial<IngestionAuditInput>)],
      retrievedDocumentIdsByCase: { "must-pass-current": ["guideline-current"] },
    };
    const registry = {
      schemaVersion: 1 as const,
      coverageVersion: "coverage-v1",
      records: [
        {
          key: "synthetic-current-guideline",
          owner: "Clinical governance",
          reviewStatus: "active" as const,
          expectedDocumentIds: ["guideline-current"],
          mustPassCaseIds: ["must-pass-current"],
        },
      ],
    };
    const first = buildIngestionAuditReport({ inventory, expectedCoverage: registry });
    const second = buildIngestionAuditReport({
      inventory,
      expectedCoverage: { ...registry, coverageVersion: "coverage-v2" },
    });

    expect(first.coverageVersion).toBe("coverage-v1");
    expect(first.populationFingerprint).not.toBe(second.populationFingerprint);
  });

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
    const blocked = auditDocument(
      fixture({ lifecycle: "withdrawn", counts: { ...fixture().counts, pages: { expected: 12, actual: 0 } } }),
    );
    expect(blocked).toMatchObject({
      action: "no_change",
      diagnosticAction: "targeted_reprocess",
      eligibleForShadowPlan: false,
      blockingDisposition: "tombstone",
      reasons: ["withdrawn_or_superseded", "missing_pages"],
    });
    expect(auditDocument(fixture({ sourceGovernanceValid: false }))).toMatchObject({
      eligibleForShadowPlan: false,
      blockingDisposition: "quarantine_review",
      reasons: ["source_governance_invalid"],
    });

    const blockedLifecycleDocuments = (["withdrawn", "superseded", "quarantined", "review_due"] as const).map(
      (lifecycle) =>
        fixture({
          documentId: `blocked-${lifecycle}`,
          lifecycle,
          mustPassCases: [],
        }),
    );
    for (const document of blockedLifecycleDocuments) {
      expect(auditDocument(document)).toMatchObject({
        action: "no_change",
        eligibleForShadowPlan: false,
      });
    }

    const report = buildIngestionAuditReport({
      inventory: {
        schemaVersion: 1,
        inventoryVersion: "blocked-actions",
        documents: blockedLifecycleDocuments,
        retrievedDocumentIdsByCase: {},
      },
      expectedCoverage: { schemaVersion: 1, coverageVersion: "blocked-actions-v1", records: [] },
    });
    expect(report.summary).toMatchObject({
      documents: 4,
      noChange: 0,
      metadataOnly: 0,
      targetedReprocess: 0,
      shadowReindex: 0,
      blocked: 4,
    });
  });

  it("fails closed when integrity evidence is absent or state changes after audit", () => {
    const missingEvidence = auditDocument(fixture({ expectedStateDigest: null }));
    expect(missingEvidence).toMatchObject({
      action: "no_change",
      diagnosticAction: "metadata_only",
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
            failureCodes: ["document_not_retrieved"],
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
      failureCodes: ["document_not_retrieved"],
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

    const first = buildIngestionAuditReport({
      inventory: input,
      expectedCoverage: {
        schemaVersion: 1,
        coverageVersion: "synthetic-source-coverage-v1",
        records: expectedCoverage,
      },
    });
    const second = buildIngestionAuditReport({
      inventory: { ...input, documents: [...input.documents].reverse() },
      expectedCoverage: {
        schemaVersion: 1,
        coverageVersion: "synthetic-source-coverage-v1",
        records: [...expectedCoverage].reverse(),
      },
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: 1,
      inventoryVersion: "synthetic-active-corpus-v1",
      summary: { documents: 1, noChange: 1, blocked: 0 },
    });
    expect(first.populationFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain("synthetic_private_excerpt");
    const durableKeys = new Set<string>();
    const visit = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      for (const [key, nested] of Object.entries(value)) {
        durableKeys.add(key);
        visit(nested);
      }
    };
    visit(first);
    for (const forbiddenKey of ["body", "content", "excerpt", "query", "filename", "objectKey", "extractedText"]) {
      expect(durableKeys).not.toContain(forbiddenKey);
    }
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
    expect(() =>
      parseIngestionAuditInventory({
        ...valid,
        documents: [
          {
            ...fixture(),
            mustPassCases: [
              {
                id: "must-pass-current",
                passed: false,
                expectedDocumentRank: 1,
                actualDocumentRank: null,
                failedExpectations: ["synthetic_private_excerpt"],
              },
            ],
          },
        ],
      }),
    ).toThrow(/failure|expectation|unrecognized/i);
    expect(() =>
      parseIngestionAuditInventory({
        ...valid,
        documents: [
          {
            ...fixture(),
            mustPassCases: [
              {
                id: "must-pass-current",
                passed: false,
                expectedDocumentRank: 1,
                actualDocumentRank: null,
                failureCodes: ["synthetic_private_excerpt"],
              },
            ],
          },
        ],
      }),
    ).toThrow(/failureCodes|invalid option/i);
  });

  it("adapts the existing indexing-health contract without admitting missing or site evidence", async () => {
    const { adaptIndexingHealthDocumentToAuditInput, parseProviderFreeIngestionAuditInventory } =
      await import("../scripts/lib/indexing-audit-adapter");
    const indexingHealthDocument = {
      status: "indexed",
      file_name: "synthetic-guideline.pdf",
      page_count: 10,
      chunk_count: 24,
      metadata: {
        source_kind: "document",
        publisher: " Synthetic authority ",
        jurisdiction: "AU-WA",
        corpus_scope: "uploaded_local",
        source_role: " local_guideline ",
        content_mode: "indexed_content",
        licence_policy: "public_index_permitted",
        source_policy_version: "synthetic-source-policy-v1",
        source_catalogue_key: null,
        source_excluded: false,
      },
    };
    const ordinary = adaptIndexingHealthDocumentToAuditInput({
      documentId: "adapted-guideline",
      indexingHealthDocument,
      expectedPageCount: 12,
      actualChunkCount: 18,
      auditEvidence: fixture({ documentId: "adapted-guideline" }),
    });
    expect(ordinary).toMatchObject({
      kind: "document",
      input: {
        documentId: "adapted-guideline",
        counts: {
          pages: { expected: 12, actual: 10 },
          chunks: { expected: 24, actual: 18 },
        },
        metadata: {
          corpusScope: "uploaded_local",
          sourceRole: "local_guideline",
          contentMode: "indexed_content",
        },
      },
    });
    for (const [expectedPageCount, chunkCount] of [
      [10, 24],
      [12, 20],
    ] as const) {
      expect(() =>
        adaptIndexingHealthDocumentToAuditInput({
          documentId: "adapted-guideline",
          indexingHealthDocument: { ...indexingHealthDocument, chunk_count: chunkCount },
          expectedPageCount,
          actualChunkCount: 18,
          auditEvidence: fixture({ documentId: "adapted-guideline" }),
        }),
      ).toThrow(/reviewed.*expected|expected.*count/i);
    }
    for (const [key, value] of [
      ["publisher", "Different synthetic authority"],
      ["jurisdiction", "AU-NSW"],
      ["corpus_scope", "australian_public"],
      ["source_role", "clinical_reference"],
      ["content_mode", "link_only"],
      ["licence_policy", "link_only"],
      ["source_policy_version", "synthetic-source-policy-v2"],
      ["source_catalogue_key", "synthetic-catalogue-key"],
      ["source_excluded", true],
    ] as const) {
      expect(() =>
        adaptIndexingHealthDocumentToAuditInput({
          documentId: "adapted-guideline",
          indexingHealthDocument: {
            ...indexingHealthDocument,
            metadata: { ...indexingHealthDocument.metadata, [key]: value },
          },
          expectedPageCount: 12,
          actualChunkCount: 18,
          auditEvidence: fixture({ documentId: "adapted-guideline" }),
        }),
      ).toThrow(/reviewed.*governance|governance.*metadata/i);
    }
    expect(() =>
      adaptIndexingHealthDocumentToAuditInput({
        documentId: "foreign-guideline",
        indexingHealthDocument,
        expectedPageCount: 12,
        actualChunkCount: 18,
        auditEvidence: fixture({ documentId: "evidence-owner-guideline" }),
      }),
    ).toThrow(/document identity|evidence.*document/i);
    expect(() =>
      adaptIndexingHealthDocumentToAuditInput({
        documentId: "missing-evidence",
        indexingHealthDocument,
        expectedPageCount: null,
        actualChunkCount: null,
        auditEvidence: null,
      }),
    ).toThrow(/indexing-health audit evidence unavailable/i);

    const registry = adaptIndexingHealthDocumentToAuditInput({
      documentId: "synthetic-registry",
      indexingHealthDocument: {
        ...indexingHealthDocument,
        file_name: "synthetic-service.registry.json",
        metadata: { source_kind: "registry_record", registry_record_id: "synthetic-service" },
      },
      expectedPageCount: null,
      actualChunkCount: null,
      auditEvidence: null,
    });
    expect(registry).toEqual({
      kind: "excluded",
      documentId: "synthetic-registry",
      reason: "registry_or_site_separate_control_plane",
    });
    const site = adaptIndexingHealthDocumentToAuditInput({
      documentId: "synthetic-site-record",
      indexingHealthDocument: {
        ...indexingHealthDocument,
        metadata: { ...indexingHealthDocument.metadata, corpus_scope: "clinical_kb_site" },
      },
      expectedPageCount: null,
      actualChunkCount: null,
      auditEvidence: null,
    });
    expect(site).toEqual({
      kind: "excluded",
      documentId: "synthetic-site-record",
      reason: "registry_or_site_separate_control_plane",
    });

    expect(
      parseProviderFreeIngestionAuditInventory({
        schemaVersion: 1,
        inventoryVersion: "synthetic-indexing-health-adapter-v1",
        indexingHealthDocuments: [
          {
            documentId: "adapted-guideline",
            indexingHealthDocument,
            expectedPageCount: 12,
            actualChunkCount: 18,
            auditEvidence: fixture({ documentId: "adapted-guideline" }),
          },
        ],
        retrievedDocumentIdsByCase: { "must-pass-current": ["adapted-guideline"] },
      }),
    ).toMatchObject({
      inventoryVersion: "synthetic-indexing-health-adapter-v1",
      documents: [{ documentId: "adapted-guideline" }],
    });
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
