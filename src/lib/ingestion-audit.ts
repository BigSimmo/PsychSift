import { createHash } from "node:crypto";

import { z } from "zod";

import {
  australianSourceByKey,
  australianSourcePolicyVersion,
  isIndexableAustralianSource,
  type SourceContentMode,
  type SourceLicencePolicy,
} from "./australian-source-catalogue";
import {
  isKnownClinicalSourceRole,
  isKnownSourceContentMode,
  isKnownSourceCorpusScope,
  isKnownSourceLicencePolicy,
} from "./source-metadata";
import {
  auditExpectedSourceCoverage,
  parseExpectedSourceCoverageRegistry,
  type ExpectedSourceCoverageRegistry,
  type SourceCoverageFinding,
} from "./source-coverage-registry";
import type { ClinicalSourceRole, SourceCorpusScope } from "./types";

export type IngestionAuditAction = "no_change" | "metadata_only" | "targeted_reprocess" | "shadow_reindex";
export type IngestionAuditReason =
  | "integrity_expectation_missing"
  | "metadata_incomplete"
  | "source_governance_invalid"
  | "withdrawn_or_superseded"
  | "missing_pages"
  | "missing_chunks"
  | "duplicate_chunks"
  | "orphaned_artifacts"
  | "empty_index_units"
  | "oversized_index_units"
  | "undersized_index_units"
  | "low_information_index_units"
  | "chunk_bounds_invalid"
  | "heading_continuity_failed"
  | "table_continuity_failed"
  | "extraction_quality_poor"
  | "embedding_missing_or_mismatched"
  | "generation_incomplete"
  | "must_pass_retrieval_failed"
  | "count_mismatch"
  | "provenance_mismatch";

export type IngestionFailureCode =
  | "document_not_retrieved"
  | "document_rank_exceeded"
  | "source_role_mismatch"
  | "governance_block"
  | "case_timeout"
  | "provider_failure";

export type ExpectedActualCount = {
  expected: number | null;
  actual: number;
};

export type IngestionDocumentAudit = {
  documentId: string;
  expectedStateDigest: string;
  activeGenerationId: string | null;
  action: IngestionAuditAction;
  diagnosticAction: IngestionAuditAction;
  eligibleForShadowPlan: boolean;
  blockingDisposition: "quarantine_review" | "tombstone" | null;
  reasons: IngestionAuditReason[];
  counts: {
    pages: ExpectedActualCount;
    chunks: ExpectedActualCount;
    tables: ExpectedActualCount;
    images: ExpectedActualCount;
    searchableUnits: ExpectedActualCount;
    embeddings: ExpectedActualCount;
    duplicateChunks: number;
    orphanedArtifacts: number;
  };
  unitQuality: {
    policyVersion: string;
    empty: number;
    oversized: number;
    undersized: number;
    lowInformation: number;
  };
  embeddingContract: {
    expectedModel: string;
    actualModels: string[];
    expectedDimensions: number;
    actualDimensions: number[];
    expectedStrategy: string;
    actualStrategies: string[];
    completeness: number;
  };
  provenance: IngestionAuditProvenance;
  mustPassCases: Array<{
    id: string;
    passed: boolean;
    expectedDocumentRank: number | null;
    actualDocumentRank: number | null;
    failureCodes: IngestionFailureCode[];
  }>;
};

type ProvenanceEvidence = {
  contentHash: string;
  extractionVersion: string;
  parserVersion: string;
  parserConfigVersion: string;
  chunkerVersion: string;
  indexUnitVersion: string;
  validationVersion: string;
  sourcePolicyVersion: string;
};

export type IngestionAuditProvenance = {
  review: {
    contractVersion: string;
    evidenceDigest: string;
    reviewedAt: string;
    reviewerRole: "clinical_governance" | "corpus_steward" | "source_governance";
  };
  expected: ProvenanceEvidence;
  actual: ProvenanceEvidence;
};

const countSchema = z
  .object({
    expected: z.number().int().nonnegative().nullable(),
    actual: z.number().int().nonnegative(),
  })
  .strict();

const canonicalSourceRoleSchema = z.custom<ClinicalSourceRole>(isKnownClinicalSourceRole, {
  message: "sourceRole must use the canonical ClinicalSourceRole vocabulary",
});
const canonicalCorpusScopeSchema = z.custom<SourceCorpusScope>(isKnownSourceCorpusScope, {
  message: "corpusScope must use the canonical SourceCorpusScope vocabulary",
});
const canonicalContentModeSchema = z.custom<SourceContentMode>(isKnownSourceContentMode, {
  message: "contentMode must use the canonical source content-mode vocabulary",
});
const canonicalLicencePolicySchema = z.custom<SourceLicencePolicy>(isKnownSourceLicencePolicy, {
  message: "licencePolicy must use the canonical source licence-policy vocabulary",
});
const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const versionSchema = z.string().trim().min(1).max(100);
const provenanceEvidenceSchema = z
  .object({
    contentHash: sha256Schema,
    extractionVersion: versionSchema,
    parserVersion: versionSchema,
    parserConfigVersion: versionSchema,
    chunkerVersion: versionSchema,
    indexUnitVersion: versionSchema,
    validationVersion: versionSchema,
    sourcePolicyVersion: versionSchema,
  })
  .strict();
const provenanceSchema = z
  .object({
    review: z
      .object({
        contractVersion: versionSchema,
        evidenceDigest: sha256Schema,
        reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        reviewerRole: z.enum(["clinical_governance", "corpus_steward", "source_governance"]),
      })
      .strict(),
    expected: provenanceEvidenceSchema,
    actual: provenanceEvidenceSchema,
  })
  .strict();
const ingestionFailureCodeSchema = z.enum([
  "document_not_retrieved",
  "document_rank_exceeded",
  "source_role_mismatch",
  "governance_block",
  "case_timeout",
  "provider_failure",
]);

const auditInputSchema = z
  .object({
    documentId: z.string().trim().min(1),
    expectedStateDigest: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    activeGenerationId: z.string().trim().min(1).nullable(),
    lifecycle: z.enum(["current", "review_due", "superseded", "withdrawn", "quarantined"]),
    metadata: z
      .object({
        publisher: z.string().trim().min(1).max(200).nullable(),
        jurisdiction: z.string().trim().min(1).max(100).nullable(),
        corpusScope: canonicalCorpusScopeSchema.nullable(),
        sourceRole: canonicalSourceRoleSchema.nullable(),
        contentMode: canonicalContentModeSchema.nullable(),
        licencePolicy: canonicalLicencePolicySchema.nullable(),
        sourcePolicyVersion: versionSchema.nullable(),
        sourceCatalogueKey: z.string().trim().min(1).max(100).nullable(),
        sourceExcluded: z.boolean(),
      })
      .strict(),
    sourceGovernanceValid: z.boolean(),
    counts: z
      .object({
        pages: countSchema,
        chunks: countSchema,
        tables: countSchema,
        images: countSchema,
        searchableUnits: countSchema,
        embeddings: countSchema,
        duplicateChunks: z.number().int().nonnegative(),
        orphanedArtifacts: z.number().int().nonnegative(),
      })
      .strict(),
    unitQuality: z
      .object({
        policyVersion: z.string().trim().min(1),
        empty: z.number().int().nonnegative(),
        oversized: z.number().int().nonnegative(),
        undersized: z.number().int().nonnegative(),
        lowInformation: z.number().int().nonnegative(),
      })
      .strict(),
    structure: z
      .object({
        chunkBoundsValid: z.boolean(),
        headingContinuityPassed: z.boolean(),
        tableContinuityPassed: z.boolean(),
        extractionQualityPassed: z.boolean(),
      })
      .strict(),
    embeddingContract: z
      .object({
        expectedModel: z.string().trim().min(1),
        actualModels: z.array(z.string().trim().min(1)),
        expectedDimensions: z.number().int().positive(),
        actualDimensions: z.array(z.number().int().positive()),
        expectedStrategy: z.string().trim().min(1),
        actualStrategies: z.array(z.string().trim().min(1)),
        completeness: z.number().min(0).max(1),
      })
      .strict(),
    provenance: provenanceSchema,
    chunkGenerations: z.array(z.string().trim().min(1)),
    mustPassCases: z.array(
      z
        .object({
          id: z.string().trim().min(1),
          passed: z.boolean(),
          expectedDocumentRank: z.number().int().positive().nullable(),
          actualDocumentRank: z.number().int().positive().nullable(),
          failureCodes: z.array(ingestionFailureCodeSchema),
        })
        .strict()
        .superRefine((testCase, context) => {
          if (new Set(testCase.failureCodes).size !== testCase.failureCodes.length) {
            context.addIssue({ code: "custom", message: "duplicate failure code", path: ["failureCodes"] });
          }
          if (testCase.passed && (testCase.actualDocumentRank === null || testCase.failureCodes.length > 0)) {
            context.addIssue({ code: "custom", message: "passed retrieval case has failure evidence" });
          }
          if (!testCase.passed && testCase.failureCodes.length === 0) {
            context.addIssue({ code: "custom", message: "failed retrieval case requires a failure code" });
          }
        }),
    ),
  })
  .strict();

const ingestionAuditInventorySchema = z
  .object({
    schemaVersion: z.literal(1),
    inventoryVersion: z.string().trim().min(1),
    documents: z.array(auditInputSchema),
    retrievedDocumentIdsByCase: z.record(z.string().trim().min(1), z.array(z.string().trim().min(1))),
  })
  .strict()
  .superRefine((inventory, context) => {
    const documentIds = new Set<string>();
    for (const [index, document] of inventory.documents.entries()) {
      if (documentIds.has(document.documentId)) {
        context.addIssue({
          code: "custom",
          message: "duplicate document ID",
          path: ["documents", index, "documentId"],
        });
      }
      documentIds.add(document.documentId);
    }
    for (const [caseId, ids] of Object.entries(inventory.retrievedDocumentIdsByCase)) {
      if (new Set(ids).size !== ids.length) {
        context.addIssue({
          code: "custom",
          message: "duplicate retrieved document ID",
          path: ["retrievedDocumentIdsByCase", caseId],
        });
      }
    }
    for (const [documentIndex, document] of inventory.documents.entries()) {
      const caseIds = new Set<string>();
      for (const [caseIndex, testCase] of document.mustPassCases.entries()) {
        if (caseIds.has(testCase.id)) {
          context.addIssue({
            code: "custom",
            message: "duplicate document must-pass case ID",
            path: ["documents", documentIndex, "mustPassCases", caseIndex, "id"],
          });
        }
        caseIds.add(testCase.id);
        if (!Object.hasOwn(inventory.retrievedDocumentIdsByCase, testCase.id)) {
          context.addIssue({
            code: "custom",
            message: `retrieval measurement missing for ${testCase.id}`,
            path: ["retrievedDocumentIdsByCase", testCase.id],
          });
          continue;
        }
        const retrieved = inventory.retrievedDocumentIdsByCase[testCase.id]!.includes(document.documentId);
        const hasRank = testCase.actualDocumentRank !== null;
        const codes = new Set(testCase.failureCodes);
        const rankExceeded = codes.has("document_rank_exceeded");
        const mustBeAbsent =
          codes.has("document_not_retrieved") || codes.has("case_timeout") || codes.has("provider_failure");
        const consistent = testCase.passed
          ? retrieved &&
            hasRank &&
            (testCase.expectedDocumentRank === null ||
              (testCase.actualDocumentRank !== null && testCase.actualDocumentRank <= testCase.expectedDocumentRank))
          : retrieved === hasRank &&
            (!mustBeAbsent || (!retrieved && !hasRank)) &&
            (!rankExceeded ||
              (retrieved &&
                testCase.expectedDocumentRank !== null &&
                testCase.actualDocumentRank !== null &&
                testCase.actualDocumentRank > testCase.expectedDocumentRank));
        if (!consistent || (rankExceeded && mustBeAbsent)) {
          context.addIssue({
            code: "custom",
            message: "contradictory retrieval evidence: presence, rank, or failure code mismatch",
            path: ["documents", documentIndex, "mustPassCases", caseIndex, "passed"],
          });
        }
      }
    }
  });

export type IngestionAuditInput = z.infer<typeof auditInputSchema>;
export type IngestionAuditInventory = z.infer<typeof ingestionAuditInventorySchema>;

export type IngestionAuditReport = Readonly<{
  schemaVersion: 1;
  inventoryVersion: string;
  coverageVersion: string;
  populationFingerprint: string;
  documents: readonly IngestionDocumentAudit[];
  sourceCoverage: readonly SourceCoverageFinding[];
  summary: Readonly<{
    documents: number;
    noChange: number;
    metadataOnly: number;
    targetedReprocess: number;
    shadowReindex: number;
    blocked: number;
  }>;
}>;

const reasonOrder: readonly IngestionAuditReason[] = [
  "integrity_expectation_missing",
  "metadata_incomplete",
  "source_governance_invalid",
  "withdrawn_or_superseded",
  "count_mismatch",
  "missing_pages",
  "missing_chunks",
  "duplicate_chunks",
  "orphaned_artifacts",
  "empty_index_units",
  "oversized_index_units",
  "undersized_index_units",
  "low_information_index_units",
  "chunk_bounds_invalid",
  "heading_continuity_failed",
  "table_continuity_failed",
  "extraction_quality_poor",
  "provenance_mismatch",
  "embedding_missing_or_mismatched",
  "generation_incomplete",
  "must_pass_retrieval_failed",
];

const targetedReasons = new Set<IngestionAuditReason>([
  "count_mismatch",
  "missing_pages",
  "missing_chunks",
  "duplicate_chunks",
  "orphaned_artifacts",
  "empty_index_units",
  "oversized_index_units",
  "undersized_index_units",
  "low_information_index_units",
  "chunk_bounds_invalid",
  "heading_continuity_failed",
  "table_continuity_failed",
  "extraction_quality_poor",
  "provenance_mismatch",
]);
const shadowReasons = new Set<IngestionAuditReason>([
  "embedding_missing_or_mismatched",
  "generation_incomplete",
  "must_pass_retrieval_failed",
]);

function isMissing(count: ExpectedActualCount) {
  return count.expected !== null && count.actual < count.expected;
}

function isSurplus(count: ExpectedActualCount) {
  return count.expected !== null && count.actual > count.expected;
}

function hasMetadataGap(metadata: IngestionAuditInput["metadata"]) {
  return Object.entries(metadata).some(([key, value]) => key !== "sourceCatalogueKey" && value === null);
}

const documentOwnedCorpusScopes = new Set<SourceCorpusScope>([
  "uploaded_local",
  "australian_public",
  "international_supplementary",
]);

function sourcePolicyIsValid(input: IngestionAuditInput) {
  const metadata = input.metadata;
  if (
    !input.sourceGovernanceValid ||
    metadata.sourceExcluded ||
    !metadata.corpusScope ||
    !metadata.sourceRole ||
    !metadata.contentMode ||
    !metadata.licencePolicy ||
    !metadata.sourcePolicyVersion ||
    !documentOwnedCorpusScopes.has(metadata.corpusScope) ||
    metadata.contentMode !== "indexed_content" ||
    metadata.sourceRole === "reference_link" ||
    metadata.licencePolicy !== "public_index_permitted"
  ) {
    return false;
  }

  if (metadata.corpusScope !== "australian_public") return true;
  if (!metadata.sourceCatalogueKey || metadata.sourcePolicyVersion !== australianSourcePolicyVersion) return false;
  const catalogue = australianSourceByKey(metadata.sourceCatalogueKey);
  return Boolean(
    catalogue &&
    catalogue.roles.includes(metadata.sourceRole) &&
    isIndexableAustralianSource(metadata.sourceCatalogueKey, metadata.licencePolicy),
  );
}

export function reviewedProvenanceEvidenceDigest(args: {
  contractVersion: string;
  expected: IngestionAuditProvenance["expected"];
}) {
  return sha256({
    schemaVersion: "ingestion-provenance-review-v1",
    contractVersion: args.contractVersion,
    expected: args.expected,
  });
}

function hasValidReviewedProvenance(input: IngestionAuditInput) {
  return (
    input.provenance.review.evidenceDigest ===
    reviewedProvenanceEvidenceDigest({
      contractVersion: input.provenance.review.contractVersion,
      expected: input.provenance.expected,
    })
  );
}

function provenanceMismatch(input: IngestionAuditInput) {
  return (
    !hasValidReviewedProvenance(input) ||
    JSON.stringify(input.provenance.expected) !== JSON.stringify(input.provenance.actual) ||
    input.provenance.actual.sourcePolicyVersion !== input.metadata.sourcePolicyVersion
  );
}

function embeddingContractMismatch(input: IngestionAuditInput) {
  const contract = input.embeddingContract;
  return (
    isMissing(input.counts.embeddings) ||
    contract.actualModels.length !== 1 ||
    contract.actualModels[0] !== contract.expectedModel ||
    contract.actualDimensions.length !== 1 ||
    contract.actualDimensions[0] !== contract.expectedDimensions ||
    contract.actualStrategies.length !== 1 ||
    contract.actualStrategies[0] !== contract.expectedStrategy ||
    contract.completeness !== 1
  );
}

function generationIncomplete(input: IngestionAuditInput) {
  if (!input.activeGenerationId) return true;
  if (input.counts.chunks.actual > 0 && input.chunkGenerations.length === 0) return true;
  return input.chunkGenerations.some((generation) => generation !== input.activeGenerationId);
}

function classifyAction(reasons: readonly IngestionAuditReason[]): IngestionAuditAction {
  if (reasons.some((reason) => targetedReasons.has(reason))) return "targeted_reprocess";
  if (reasons.some((reason) => shadowReasons.has(reason))) return "shadow_reindex";
  if (reasons.length > 0) return "metadata_only";
  return "no_change";
}

export function parseIngestionAuditInventory(input: unknown): IngestionAuditInventory {
  return ingestionAuditInventorySchema.parse(input);
}

export function auditDocument(rawInput: IngestionAuditInput): IngestionDocumentAudit {
  const input = auditInputSchema.parse(rawInput);
  const measured = new Set<IngestionAuditReason>();
  const validSourcePolicy = sourcePolicyIsValid(input);

  if (!input.expectedStateDigest) measured.add("integrity_expectation_missing");
  if (hasMetadataGap(input.metadata)) measured.add("metadata_incomplete");
  if (!validSourcePolicy || input.lifecycle === "quarantined" || input.lifecycle === "review_due") {
    measured.add("source_governance_invalid");
  }
  if (input.lifecycle === "withdrawn" || input.lifecycle === "superseded") measured.add("withdrawn_or_superseded");
  if (
    isSurplus(input.counts.pages) ||
    isSurplus(input.counts.chunks) ||
    isSurplus(input.counts.tables) ||
    isSurplus(input.counts.images) ||
    isSurplus(input.counts.searchableUnits) ||
    isSurplus(input.counts.embeddings)
  ) {
    measured.add("count_mismatch");
  }
  if (isMissing(input.counts.pages)) measured.add("missing_pages");
  if (isMissing(input.counts.chunks) || isMissing(input.counts.searchableUnits)) measured.add("missing_chunks");
  if (input.counts.duplicateChunks > 0) measured.add("duplicate_chunks");
  if (input.counts.orphanedArtifacts > 0) measured.add("orphaned_artifacts");
  if (input.unitQuality.empty > 0) measured.add("empty_index_units");
  if (input.unitQuality.oversized > 0) measured.add("oversized_index_units");
  if (input.unitQuality.undersized > 0) measured.add("undersized_index_units");
  if (input.unitQuality.lowInformation > 0) measured.add("low_information_index_units");
  if (!input.structure.chunkBoundsValid) measured.add("chunk_bounds_invalid");
  if (!input.structure.headingContinuityPassed) measured.add("heading_continuity_failed");
  if (!input.structure.tableContinuityPassed || isMissing(input.counts.tables)) measured.add("table_continuity_failed");
  if (!input.structure.extractionQualityPassed || isMissing(input.counts.images))
    measured.add("extraction_quality_poor");
  if (provenanceMismatch(input)) measured.add("provenance_mismatch");
  if (embeddingContractMismatch(input)) measured.add("embedding_missing_or_mismatched");
  if (generationIncomplete(input)) measured.add("generation_incomplete");
  if (input.mustPassCases.some((testCase) => !testCase.passed)) measured.add("must_pass_retrieval_failed");

  const reasons = reasonOrder.filter((reason) => measured.has(reason));
  const tombstone = input.lifecycle === "withdrawn" || input.lifecycle === "superseded";
  const quarantine =
    !input.expectedStateDigest ||
    !validSourcePolicy ||
    !hasValidReviewedProvenance(input) ||
    input.lifecycle === "quarantined" ||
    input.lifecycle === "review_due";
  const diagnosticAction = classifyAction(reasons);
  const blocked = tombstone || quarantine;

  return {
    documentId: input.documentId,
    expectedStateDigest: input.expectedStateDigest ?? "",
    activeGenerationId: input.activeGenerationId,
    action: blocked ? "no_change" : diagnosticAction,
    diagnosticAction,
    eligibleForShadowPlan: !blocked,
    blockingDisposition: tombstone ? "tombstone" : quarantine ? "quarantine_review" : null,
    reasons,
    counts: structuredClone(input.counts),
    unitQuality: structuredClone(input.unitQuality),
    embeddingContract: {
      ...structuredClone(input.embeddingContract),
      actualModels: [...input.embeddingContract.actualModels].sort(),
      actualDimensions: [...input.embeddingContract.actualDimensions].sort((left, right) => left - right),
      actualStrategies: [...input.embeddingContract.actualStrategies].sort(),
    },
    provenance: structuredClone(input.provenance),
    mustPassCases: input.mustPassCases
      .map((testCase) => ({
        ...structuredClone(testCase),
        failureCodes: [...testCase.failureCodes].sort(),
      }))
      .toSorted((left, right) => left.id.localeCompare(right.id)),
  };
}

export function assertAuditTargetState(audit: IngestionDocumentAudit, actualStateDigest: string) {
  if (!audit.expectedStateDigest) {
    throw new Error(`Document ${audit.documentId} has no reviewed integrity expectation.`);
  }
  if (audit.expectedStateDigest !== actualStateDigest) {
    throw new Error(`Document ${audit.documentId} state digest changed after the audit was created.`);
  }
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function buildIngestionAuditReport(args: {
  inventory: IngestionAuditInventory;
  expectedCoverage: ExpectedSourceCoverageRegistry;
}): IngestionAuditReport {
  const inventory = ingestionAuditInventorySchema.parse(args.inventory);
  const expectedCoverage = parseExpectedSourceCoverageRegistry(args.expectedCoverage);
  const documents = inventory.documents
    .map(auditDocument)
    .toSorted((left, right) => left.documentId.localeCompare(right.documentId));
  const retrievedDocumentIdsByCase = new Map(
    Object.entries(inventory.retrievedDocumentIdsByCase).map(([caseId, documentIds]) => [caseId, new Set(documentIds)]),
  );
  const eligibleDocumentIds = new Set(
    documents.filter((document) => document.eligibleForShadowPlan).map((document) => document.documentId),
  );
  for (const record of expectedCoverage.records) {
    if (record.reviewStatus !== "active") continue;
    for (const documentId of record.expectedDocumentIds.filter((id) => eligibleDocumentIds.has(id))) {
      const document = inventory.documents.find((candidate) => candidate.documentId === documentId);
      for (const caseId of record.mustPassCaseIds) {
        if (!document?.mustPassCases.some((testCase) => testCase.id === caseId)) {
          throw new Error(`Retrieval measurement ${caseId} lacks document evidence for ${documentId}.`);
        }
      }
    }
  }
  const sourceCoverage = auditExpectedSourceCoverage({
    expected: expectedCoverage.records,
    activeDocumentIds: eligibleDocumentIds,
    retrievedDocumentIdsByCase,
  });
  const actionableDocuments = documents.filter((document) => document.eligibleForShadowPlan);
  const summary = Object.freeze({
    documents: documents.length,
    noChange: actionableDocuments.filter((document) => document.action === "no_change").length,
    metadataOnly: actionableDocuments.filter((document) => document.action === "metadata_only").length,
    targetedReprocess: actionableDocuments.filter((document) => document.action === "targeted_reprocess").length,
    shadowReindex: actionableDocuments.filter((document) => document.action === "shadow_reindex").length,
    blocked: documents.filter((document) => !document.eligibleForShadowPlan).length,
  });
  const fingerprintInput = {
    inventoryVersion: inventory.inventoryVersion,
    coverageVersion: expectedCoverage.coverageVersion,
    documents,
    sourceCoverage: [...sourceCoverage],
  };

  return Object.freeze({
    schemaVersion: 1 as const,
    inventoryVersion: inventory.inventoryVersion,
    coverageVersion: expectedCoverage.coverageVersion,
    populationFingerprint: sha256(fingerprintInput),
    documents: Object.freeze(documents),
    sourceCoverage,
    summary,
  });
}
