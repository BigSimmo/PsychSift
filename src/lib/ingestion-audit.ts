import { createHash } from "node:crypto";

import { z } from "zod";

import {
  auditExpectedSourceCoverage,
  type ExpectedSourceCoverageRecord,
  type SourceCoverageFinding,
} from "./source-coverage-registry";

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
  | "must_pass_retrieval_failed";

export type ExpectedActualCount = {
  expected: number | null;
  actual: number;
};

export type IngestionDocumentAudit = {
  documentId: string;
  expectedStateDigest: string;
  activeGenerationId: string | null;
  action: IngestionAuditAction;
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
  mustPassCases: Array<{
    id: string;
    passed: boolean;
    expectedDocumentRank: number | null;
    actualDocumentRank: number | null;
    failedExpectations: string[];
  }>;
};

const countSchema = z
  .object({
    expected: z.number().int().nonnegative().nullable(),
    actual: z.number().int().nonnegative(),
  })
  .strict();

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
        sourceRole: z.string().trim().min(1).max(100).nullable(),
        contentMode: z.string().trim().min(1).max(100).nullable(),
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
    chunkGenerations: z.array(z.string().trim().min(1)),
    mustPassCases: z.array(
      z
        .object({
          id: z.string().trim().min(1),
          passed: z.boolean(),
          expectedDocumentRank: z.number().int().positive().nullable(),
          actualDocumentRank: z.number().int().positive().nullable(),
          failedExpectations: z.array(z.string().trim().min(1).max(200)),
        })
        .strict(),
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
  });

export type IngestionAuditInput = z.infer<typeof auditInputSchema>;
export type IngestionAuditInventory = z.infer<typeof ingestionAuditInventorySchema>;

export type IngestionAuditReport = Readonly<{
  schemaVersion: 1;
  inventoryVersion: string;
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
  "embedding_missing_or_mismatched",
  "generation_incomplete",
  "must_pass_retrieval_failed",
];

const targetedReasons = new Set<IngestionAuditReason>([
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
]);
const shadowReasons = new Set<IngestionAuditReason>([
  "embedding_missing_or_mismatched",
  "generation_incomplete",
  "must_pass_retrieval_failed",
]);

function isMissing(count: ExpectedActualCount) {
  return count.expected !== null && count.actual < count.expected;
}

function hasMetadataGap(metadata: IngestionAuditInput["metadata"]) {
  return Object.values(metadata).some((value) => !value);
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

  if (!input.expectedStateDigest) measured.add("integrity_expectation_missing");
  if (hasMetadataGap(input.metadata)) measured.add("metadata_incomplete");
  if (!input.sourceGovernanceValid || input.lifecycle === "quarantined" || input.lifecycle === "review_due") {
    measured.add("source_governance_invalid");
  }
  if (input.lifecycle === "withdrawn" || input.lifecycle === "superseded") measured.add("withdrawn_or_superseded");
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
  if (embeddingContractMismatch(input)) measured.add("embedding_missing_or_mismatched");
  if (generationIncomplete(input)) measured.add("generation_incomplete");
  if (input.mustPassCases.some((testCase) => !testCase.passed)) measured.add("must_pass_retrieval_failed");

  const reasons = reasonOrder.filter((reason) => measured.has(reason));
  const tombstone = input.lifecycle === "withdrawn" || input.lifecycle === "superseded";
  const quarantine =
    !input.expectedStateDigest ||
    !input.sourceGovernanceValid ||
    input.lifecycle === "quarantined" ||
    input.lifecycle === "review_due";

  return {
    documentId: input.documentId,
    expectedStateDigest: input.expectedStateDigest ?? "",
    activeGenerationId: input.activeGenerationId,
    action: classifyAction(reasons),
    eligibleForShadowPlan: !tombstone && !quarantine,
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
    mustPassCases: input.mustPassCases
      .map((testCase) => ({
        ...structuredClone(testCase),
        failedExpectations: [...testCase.failedExpectations].sort(),
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
  expectedCoverage: readonly ExpectedSourceCoverageRecord[];
}): IngestionAuditReport {
  const inventory = ingestionAuditInventorySchema.parse(args.inventory);
  const documents = inventory.documents
    .map(auditDocument)
    .toSorted((left, right) => left.documentId.localeCompare(right.documentId));
  const retrievedDocumentIdsByCase = new Map(
    Object.entries(inventory.retrievedDocumentIdsByCase).map(([caseId, documentIds]) => [caseId, new Set(documentIds)]),
  );
  const sourceCoverage = auditExpectedSourceCoverage({
    expected: args.expectedCoverage,
    activeDocumentIds: new Set(
      documents.filter((document) => document.eligibleForShadowPlan).map((document) => document.documentId),
    ),
    retrievedDocumentIdsByCase,
  });
  const summary = Object.freeze({
    documents: documents.length,
    noChange: documents.filter((document) => document.action === "no_change").length,
    metadataOnly: documents.filter((document) => document.action === "metadata_only").length,
    targetedReprocess: documents.filter((document) => document.action === "targeted_reprocess").length,
    shadowReindex: documents.filter((document) => document.action === "shadow_reindex").length,
    blocked: documents.filter((document) => !document.eligibleForShadowPlan).length,
  });
  const fingerprintInput = {
    inventoryVersion: inventory.inventoryVersion,
    documents,
    sourceCoverage: [...sourceCoverage],
  };

  return Object.freeze({
    schemaVersion: 1 as const,
    inventoryVersion: inventory.inventoryVersion,
    populationFingerprint: sha256(fingerprintInput),
    documents: Object.freeze(documents),
    sourceCoverage,
    summary,
  });
}
