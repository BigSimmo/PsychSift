import { z } from "zod";

import {
  parseIngestionAuditInput,
  parseIngestionAuditInventory,
  type IngestionAuditInput,
  type IngestionAuditInventory,
} from "../../src/lib/ingestion-audit";
import { isRegistryProjectionDocument, metadataRecord, type IndexingHealthDocument } from "./indexing-health-document";

export type IndexingHealthAuditAdapterArgs = {
  documentId: string;
  indexingHealthDocument: IndexingHealthDocument;
  expectedPageCount: number | null;
  actualChunkCount: number | null;
  auditEvidence: IngestionAuditInput | null;
};

export type IndexingHealthAuditAdapterResult =
  | { kind: "document"; input: IngestionAuditInput }
  | {
      kind: "excluded";
      documentId: string;
      reason: "registry_or_site_separate_control_plane";
    };

const indexingHealthDocumentSchema = z
  .object({
    status: z.string().nullable(),
    file_name: z.string().nullable(),
    page_count: z.number().int().nonnegative().nullable(),
    chunk_count: z.number().int().nonnegative().nullable(),
    metadata: z.unknown(),
  })
  .strict();

const adapterInventorySchema = z
  .object({
    schemaVersion: z.literal(1),
    inventoryVersion: z.string().trim().min(1),
    indexingHealthDocuments: z.array(
      z
        .object({
          documentId: z.string().trim().min(1),
          indexingHealthDocument: indexingHealthDocumentSchema,
          expectedPageCount: z.number().int().nonnegative().nullable(),
          actualChunkCount: z.number().int().nonnegative().nullable(),
          auditEvidence: z.unknown().nullable(),
        })
        .strict(),
    ),
    retrievedDocumentIdsByCase: z.record(z.string().trim().min(1), z.array(z.string().trim().min(1))),
  })
  .strict();

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function separateControlPlane(document: IndexingHealthDocument) {
  const metadata = metadataRecord(document.metadata);
  return (
    isRegistryProjectionDocument(document) ||
    metadata.source_kind === "registry_record" ||
    metadata.corpus_scope === "clinical_kb_site"
  );
}

export function adaptIndexingHealthDocumentToAuditInput(
  args: IndexingHealthAuditAdapterArgs,
): IndexingHealthAuditAdapterResult {
  const indexingHealthDocument = indexingHealthDocumentSchema.parse(args.indexingHealthDocument);
  if (separateControlPlane(indexingHealthDocument)) {
    return {
      kind: "excluded",
      documentId: args.documentId,
      reason: "registry_or_site_separate_control_plane",
    };
  }

  const metadata = metadataRecord(indexingHealthDocument.metadata);
  if (
    indexingHealthDocument.status !== "indexed" ||
    indexingHealthDocument.page_count === null ||
    indexingHealthDocument.chunk_count === null ||
    args.expectedPageCount === null ||
    args.actualChunkCount === null ||
    args.auditEvidence === null ||
    typeof metadata.source_excluded !== "boolean"
  ) {
    throw new Error("Indexing-health audit evidence unavailable; document audit remains fail-closed.");
  }

  const evidence = parseIngestionAuditInput(args.auditEvidence);
  const input = parseIngestionAuditInput({
    ...evidence,
    documentId: args.documentId,
    metadata: {
      publisher: stringOrNull(metadata.publisher),
      jurisdiction: stringOrNull(metadata.jurisdiction),
      corpusScope: stringOrNull(metadata.corpus_scope),
      sourceRole: stringOrNull(metadata.source_role),
      contentMode: stringOrNull(metadata.content_mode),
      licencePolicy: stringOrNull(metadata.licence_policy),
      sourcePolicyVersion: stringOrNull(metadata.source_policy_version),
      sourceCatalogueKey: stringOrNull(metadata.source_catalogue_key),
      sourceExcluded: metadata.source_excluded,
    },
    counts: {
      ...evidence.counts,
      pages: { expected: args.expectedPageCount, actual: indexingHealthDocument.page_count },
      chunks: { expected: indexingHealthDocument.chunk_count, actual: args.actualChunkCount },
    },
  });
  return { kind: "document", input };
}

export function parseProviderFreeIngestionAuditInventory(input: unknown): IngestionAuditInventory {
  if (!input || typeof input !== "object" || !("indexingHealthDocuments" in input)) {
    return parseIngestionAuditInventory(input);
  }

  const inventory = adapterInventorySchema.parse(input);
  const documents = inventory.indexingHealthDocuments.flatMap((record) => {
    const result = adaptIndexingHealthDocumentToAuditInput({
      ...record,
      auditEvidence: record.auditEvidence === null ? null : parseIngestionAuditInput(record.auditEvidence),
    });
    return result.kind === "document" ? [result.input] : [];
  });
  return parseIngestionAuditInventory({
    schemaVersion: 1,
    inventoryVersion: inventory.inventoryVersion,
    documents,
    retrievedDocumentIdsByCase: inventory.retrievedDocumentIdsByCase,
  });
}
