import { createHash } from "node:crypto";

import { assertIndexableCatalogueEntry, australianSourceByKey } from "@/lib/australian-source-catalogue";
import { diagnosisFullText, presentationFullText } from "@/lib/differentials";
import type { DifferentialPresentationWorkflow, DifferentialRecord } from "@/lib/differential-snapshot";
import {
  rowToDifferentialRecord,
  rowToPresentationWorkflow,
  type DifferentialRecordRow,
} from "@/lib/differential-records";
import { env } from "@/lib/env";
import { formRecordSearchText } from "@/lib/forms";
import { rowToMedicationRecord, type MedicationRecordRow } from "@/lib/medication-records";
import { safeErrorLogDetails } from "@/lib/privacy";
import { registryCorpusDetailHref } from "@/lib/registry-corpus-links";
import { rowToServiceRecord, type RegistryRecordKind, type RegistryRecordRow } from "@/lib/registry-records";
import { serviceRecordSearchText } from "@/lib/services";
import type { Json, TablesInsert, Vector } from "@/lib/supabase/database.types";

export type RegistryCorpusKind = "service" | "form" | "medication" | "differential";

export type RegistryDocumentIntent =
  "operational-process" | "documentation-requirement" | "medication-instruction" | "decision-support";

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

export type RegistryCorpusEntry = {
  kind: RegistryCorpusKind;
  subkind: string | null;
  ownerId: string;
  recordId: string;
  slug: string;
  title: string;
  subtitle: string | null;
  content: string;
  searchText: string;
  sourceStatus: string;
  validationStatus: string;
  metadata: Record<string, Json>;
};

function assertRegistryCorpusEntryAdmission(entry: RegistryCorpusEntry) {
  const catalogueKey = entry.metadata.source_catalogue_key;
  if (catalogueKey === undefined || catalogueKey === null) return;
  if (typeof catalogueKey !== "string" || !catalogueKey.trim()) {
    throw new Error("Registry corpus source catalogue key must be a non-empty string.");
  }
  assertIndexableCatalogueEntry(australianSourceByKey(catalogueKey));
}

export type RegistryCorpusEmbedResult = {
  documentCount: number;
  chunkCount: number;
  skipped?: boolean;
  reason?: "disabled" | "not_found" | "failed";
  errorMessage?: string;
};

export type RegistryCorpusEditTarget =
  | { corpusKind: "service" | "form"; ownerId: string; slug: string }
  | { corpusKind: "medication"; ownerId: string; slug: string }
  | { corpusKind: "differential"; ownerId: string; slug: string; differentialKind?: DifferentialRecordRow["kind"] };

const REGISTRY_EMBEDDING_WRITE_BATCH_SIZE = 64;

const registryDocumentIntents: Record<RegistryCorpusKind, RegistryDocumentIntent> = {
  service: "operational-process",
  form: "documentation-requirement",
  medication: "medication-instruction",
  differential: "decision-support",
};

/** Stable smart-v2 intent for each registry family. Registry identity is
 * authoritative here; document text must not collapse every registry record
 * into the generic classifier fallback. */
export function registryDocumentIntent(kind: RegistryCorpusKind) {
  return registryDocumentIntents[kind];
}

/** Evidence attached to the registry document and chunk metadata. This records
 * the status already held by the curated registry row; it never promotes that
 * status or claims a review that the producer did not receive. */
function registryClinicalValidationEvidence(entry: RegistryCorpusEntry): Record<string, Json> {
  return {
    status: entry.validationStatus,
    basis:
      entry.validationStatus === "unverified"
        ? "Registry record has no recorded clinical validation."
        : "Validation status preserved from the curated registry governance record; status changes require clinical review.",
    evidence_type: "registry_governance_record",
    evidence_text: null,
    registry_record_kind: entry.kind,
    registry_record_id: entry.recordId,
  };
}

/** Sha256. */
function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** Deterministic uuid. */
function deterministicUuid(seed: string) {
  const hex = sha256(seed).slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16] ?? "8", 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

/** Compact text. */
function compactText(parts: unknown[], limit = 8000) {
  const text = parts
    .flatMap((part) => (Array.isArray(part) ? part : [part]))
    .map((part) =>
      String(part ?? "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
  return text.length <= limit ? text : `${text.slice(0, limit - 3).trim()}...`;
}

/** Registry base metadata. */
function registryBaseMetadata(entry: RegistryCorpusEntry): Record<string, Json> {
  return {
    source_kind: "registry_record",
    registry_record_kind: entry.kind,
    registry_record_subkind: entry.subkind,
    registry_record_id: entry.recordId,
    registry_record_slug: entry.slug,
    source_title: entry.title,
    document_status: entry.sourceStatus,
    clinical_validation_status: entry.validationStatus,
    clinical_validation_evidence: registryClinicalValidationEvidence(entry),
    extraction_quality: "good",
    publisher: "Clinical KB registry",
    jurisdiction: "WA/local clinical workspace",
  };
}

/** Registry document id. */
export function registryCorpusDocumentId(kind: RegistryCorpusKind, recordId: string) {
  return deterministicUuid(`registry-document:${kind}:${recordId}`);
}

/** Registry document id. */
function registryDocumentId(entry: RegistryCorpusEntry) {
  return registryCorpusDocumentId(entry.kind, entry.recordId);
}

/** Corpus document id for a differential record row. Chunks cascade from the
 *  document, so deleting this id fully removes a pruned record from the
 *  corpus. Used by the differentials seed CLI when cleaning up stale rows. */
export function differentialCorpusDocumentId(recordId: string) {
  return deterministicUuid(`registry-document:differential:${recordId}`);
}

/** Registry chunk id. */
function registryChunkId(entry: RegistryCorpusEntry) {
  return deterministicUuid(`registry-chunk:${entry.kind}:${entry.recordId}`);
}

/** Registry entry metadata. */
function registryEntryMetadata(entry: RegistryCorpusEntry): Record<string, Json> {
  return { ...registryBaseMetadata(entry), ...entry.metadata };
}

/** Registry corpus identity. */
function registryCorpusIdentity(entry: RegistryCorpusEntry) {
  return {
    documentId: registryDocumentId(entry),
    metadata: registryEntryMetadata(entry),
  };
}

/** Registry document row. */
function registryDocumentRow(entry: RegistryCorpusEntry): TablesInsert<"documents"> {
  const { documentId, metadata } = registryCorpusIdentity(entry);
  const detailHref = registryCorpusDetailHref({
    kind: entry.kind,
    slug: entry.slug,
    subkind: entry.subkind,
    recordId: entry.recordId,
  });
  return {
    id: documentId,
    owner_id: entry.ownerId,
    title: entry.title,
    description: entry.subtitle,
    file_name: `${entry.kind}-${entry.slug}.registry.json`,
    file_type: "application/vnd.clinical-kb.registry+json",
    file_size: Buffer.byteLength(entry.content, "utf8"),
    storage_path: `registry://${entry.kind}/${entry.recordId}`,
    source_path: `registry://${entry.kind}/${entry.slug}`,
    status: "indexed",
    page_count: 1,
    chunk_count: 1,
    image_count: 0,
    content_hash: sha256(entry.content),
    metadata: {
      ...metadata,
      registry_detail_href: detailHref,
    },
  };
}

function registryDocumentRowPreservingOwner(
  entry: RegistryCorpusEntry,
  existing: Record<string, unknown> | null | undefined,
): TablesInsert<"documents"> {
  const document = registryDocumentRow(entry);
  if (!existing) return document;
  const storedOwnerId = existing.owner_id;
  if (storedOwnerId !== null && storedOwnerId !== entry.ownerId) {
    throw new Error(`Registry corpus owner mismatch for document ${document.id}; refusing to change tenant scope.`);
  }
  return { ...document, owner_id: storedOwnerId };
}

/** Registry chunk row. */
function registryChunkRow(entry: RegistryCorpusEntry, embedding: Vector): TablesInsert<"document_chunks"> {
  const { documentId, metadata } = registryCorpusIdentity(entry);
  return {
    id: registryChunkId(entry),
    document_id: documentId,
    chunk_index: 0,
    page_number: 1,
    section_heading: "Registry summary",
    section_path: ["Registry summary"],
    content: entry.content,
    retrieval_synopsis: entry.subtitle,
    token_estimate: Math.ceil(entry.content.length / 4),
    image_ids: [],
    content_hash: sha256(entry.content),
    embedding,
    metadata,
  };
}

/** Order-insensitive JSON encoding so built rows compare stably against jsonb
 *  columns, whose object key order Postgres normalizes. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function mergeRegistryGeneratedLabelMetadata(existing: Json | null, required: Json | null) {
  const existingMetadata =
    existing && typeof existing === "object" && !Array.isArray(existing) ? (existing as Record<string, Json>) : {};
  const requiredMetadata =
    required && typeof required === "object" && !Array.isArray(required) ? (required as Record<string, Json>) : {};
  const reviewStatus = existingMetadata.review_status ?? requiredMetadata.review_status;
  return {
    ...existingMetadata,
    ...requiredMetadata,
    ...(reviewStatus === undefined ? {} : { review_status: reviewStatus }),
  } satisfies Record<string, Json>;
}

/** True when the stored document row already matches every field the registry
 *  derivation would write — content_hash alone cannot see drift in derived
 *  metadata (kind/subkind/slug/detail href), so compare the full expected row. */
function registryDocumentRowCurrent(
  existing: Record<string, unknown> | null | undefined,
  expected: TablesInsert<"documents">,
) {
  if (!existing) return false;
  return Object.entries(expected).every(([key, value]) => stableJson(existing[key]) === stableJson(value));
}

function registryDocumentIntentLabel(
  entry: RegistryCorpusEntry,
  ownerId: string | null = entry.ownerId,
): TablesInsert<"document_labels"> {
  return {
    document_id: registryDocumentId(entry),
    owner_id: ownerId,
    label: registryDocumentIntent(entry.kind),
    label_type: "document_intent",
    confidence: 1,
    source: "generated",
    metadata: {
      generated_by: "registry-corpus-producer",
      registry_governance_version: "registry-governance-v1",
      registry_record_kind: entry.kind,
      registry_record_id: entry.recordId,
      label_tier: "primary",
      review_status: "new",
    },
  };
}

export type RegistryGovernanceProjection = {
  kind: RegistryCorpusKind;
  recordId: string;
  slug: string;
  ownerId: string;
  documentId: string;
  requiredMetadata: Record<string, Json>;
  intentLabel: TablesInsert<"document_labels">;
};

/** Provider-free governance projection for an already materialized registry
 * document. This deliberately excludes document content, chunks, and
 * embeddings so reconciliation can repair metadata and generated labels
 * without invoking the corpus embedding path. */
export function registryGovernanceProjection(entry: RegistryCorpusEntry): RegistryGovernanceProjection {
  return {
    kind: entry.kind,
    recordId: entry.recordId,
    slug: entry.slug,
    ownerId: entry.ownerId,
    documentId: registryDocumentId(entry),
    requiredMetadata: registryBaseMetadata(entry),
    intentLabel: registryDocumentIntentLabel(entry),
  };
}

async function reconcileRegistryGeneratedLabels(
  supabase: AdminClient,
  entries: RegistryCorpusEntry[],
  documentOwnerById: Map<string, string | null>,
) {
  const documentIds = entries.map(registryDocumentId);
  const expectedIntentByDocument = new Map(
    entries.map((entry) => [registryDocumentId(entry), registryDocumentIntent(entry.kind)]),
  );
  const { data: existingLabels, error: existingLabelError } = await supabase
    .from("document_labels")
    .select("id,document_id,label,label_type,source,confidence,metadata")
    .in("document_id", documentIds);
  if (existingLabelError) throw new Error(`Registry label preflight failed: ${existingLabelError.message}`);

  const staleGeneratedLabelIds = (existingLabels ?? []).flatMap((label) => {
    if (label.source !== "generated") return [];
    if (label.label_type === "site") return [label.id];
    if (label.label_type === "document_intent" && label.label !== expectedIntentByDocument.get(label.document_id)) {
      return [label.id];
    }
    return [];
  });
  if (staleGeneratedLabelIds.length > 0) {
    const { error: deleteError } = await supabase.from("document_labels").delete().in("id", staleGeneratedLabelIds);
    if (deleteError) throw new Error(`Registry label cleanup failed: ${deleteError.message}`);
  }

  const expectedIntentLabels = entries.map((entry) => {
    const documentId = registryDocumentId(entry);
    const expected = registryDocumentIntentLabel(
      entry,
      documentOwnerById.has(documentId) ? (documentOwnerById.get(documentId) ?? null) : entry.ownerId,
    );
    const existing = (existingLabels ?? []).find(
      (label) =>
        label.document_id === documentId &&
        label.source === expected.source &&
        label.label_type === expected.label_type &&
        label.label === expected.label,
    );
    return {
      ...expected,
      confidence: existing?.confidence ?? expected.confidence,
      metadata: mergeRegistryGeneratedLabelMetadata(existing?.metadata ?? null, expected.metadata ?? null),
    };
  });
  const { error: upsertError } = await supabase
    .from("document_labels")
    .upsert(expectedIntentLabels, { onConflict: "document_id,label_type,label,source" });
  if (upsertError) throw new Error(`Registry intent label upsert failed: ${upsertError.message}`);
}

/** Registry corpus embedding enabled. */
export function registryCorpusEmbeddingEnabled() {
  return env.RAG_REGISTRY_CORPUS_EMBEDDING === true;
}

/** Clinical registry rows to corpus entries. */
export function clinicalRegistryRowsToCorpusEntries(rows: RegistryRecordRow[]): RegistryCorpusEntry[] {
  return rows.map((row) => {
    const kind: RegistryRecordKind = row.kind === "form" ? "form" : "service";
    const record = rowToServiceRecord(row);
    const searchText = kind === "form" ? formRecordSearchText(record) : serviceRecordSearchText(record);
    const content = compactText([
      `${kind === "form" ? "Form" : "Service"}: ${record.title}`,
      record.subtitle,
      record.route && `Route: ${record.route}`,
      record.eligibility && `Eligibility: ${record.eligibility}`,
      record.referral && `Referral: ${record.referral}`,
      record.location && `Location: ${record.location}`,
      record.bestUse && `Best use: ${record.bestUse}`,
      record.primaryContact && `Primary contact: ${record.primaryContact.value} ${record.primaryContact.detail ?? ""}`,
      record.tags?.length ? `Tags: ${record.tags.join(", ")}` : null,
      record.catchments?.length ? `Catchments: ${record.catchments.join(", ")}` : null,
      searchText,
    ]);
    return {
      kind,
      subkind: kind,
      ownerId: row.owner_id,
      recordId: row.id,
      slug: row.slug,
      title: record.title,
      subtitle: record.subtitle ?? null,
      content,
      searchText,
      sourceStatus: row.source_status,
      validationStatus: row.validation_status,
      metadata: {
        catalogue_label: row.catalogue_label,
        tags: row.tags,
        catchments: row.catchments,
      },
    };
  });
}

/** Medication rows to corpus entries. */
export function medicationRowsToCorpusEntries(rows: MedicationRecordRow[]): RegistryCorpusEntry[] {
  return rows.map((row) => {
    const record = rowToMedicationRecord(row);
    const sectionText = Array.isArray(record.sections)
      ? record.sections
          .flatMap((section) => [
            section.title,
            section.type,
            ...(section.rows ?? []).flatMap((item) => [item.key, item.val]),
          ])
          .join(" ")
      : "";
    const quickText = Array.isArray(record.quick)
      ? record.quick.flatMap((item) => [item.label, item.value]).join(" ")
      : "";
    const searchText = compactText(
      [record.name, record.slug, record.class, record.subclass, record.category, sectionText, quickText],
      4000,
    );
    return {
      kind: "medication",
      subkind: record.category || record.class || null,
      ownerId: row.owner_id,
      recordId: row.id,
      slug: row.slug,
      title: record.name,
      subtitle: record.class || row.category,
      content: compactText([
        `Medication: ${record.name}`,
        record.class && `Class: ${record.class}`,
        record.subclass && `Subclass: ${record.subclass}`,
        record.schedule && `Schedule: ${record.schedule}`,
        record.tag && `Tag: ${record.tag}`,
        sectionText,
        quickText,
      ]),
      searchText,
      sourceStatus: row.source_status,
      validationStatus: row.validation_status,
      metadata: {
        medication_class: row.class,
        medication_subclass: row.subclass,
        tags: row.tag ? [row.tag] : [],
      },
    };
  });
}

/** Differential rows to corpus entries. */
export function differentialRowsToCorpusEntries(rows: DifferentialRecordRow[]): RegistryCorpusEntry[] {
  return rows.map((row) => {
    const isPresentation = row.kind === "presentation";
    const payload = isPresentation ? rowToPresentationWorkflow(row) : rowToDifferentialRecord(row);
    const searchText = isPresentation
      ? presentationFullText(payload as DifferentialPresentationWorkflow)
      : diagnosisFullText(payload as DifferentialRecord);
    return {
      kind: "differential",
      subkind: isPresentation ? "presentation" : "diagnosis",
      ownerId: row.owner_id,
      recordId: row.id,
      slug: row.slug,
      title: row.title,
      subtitle: row.subtitle,
      content: compactText([
        `${isPresentation ? "Presentation workflow" : "Differential diagnosis"}: ${row.title}`,
        row.subtitle,
        row.clinical_hinge && `Clinical hinge: ${row.clinical_hinge}`,
        row.tags.length ? `Tags: ${row.tags.join(", ")}` : null,
        searchText,
      ]),
      searchText,
      sourceStatus: row.source_status,
      validationStatus: row.validation_status,
      metadata: {
        differential_kind: row.kind,
        status: row.status,
        tags: row.tags,
      },
    };
  });
}

/** Embed registry corpus entries. */
export async function embedRegistryCorpusEntries(supabase: AdminClient, entries: RegistryCorpusEntry[]) {
  if (entries.length === 0) return { documentCount: 0, chunkCount: 0 };

  for (const entry of entries) assertRegistryCorpusEntryAdmission(entry);

  const { embedTexts } = await import("@/lib/openai");
  let documentCount = 0;
  let chunkCount = 0;

  for (let start = 0; start < entries.length; start += REGISTRY_EMBEDDING_WRITE_BATCH_SIZE) {
    const batch = entries.slice(start, start + REGISTRY_EMBEDDING_WRITE_BATCH_SIZE);
    const derivedDocuments = batch.map(registryDocumentRow);
    const documentIds = derivedDocuments
      .map((document) => document.id)
      .filter((id): id is string => typeof id === "string");
    const chunkIds = batch.map(registryChunkId);

    const { data: existingDocuments, error: existingDocumentError } = await supabase
      .from("documents")
      .select("*")
      .in("id", documentIds);
    if (existingDocumentError) {
      throw new Error(`Registry corpus preflight failed: ${existingDocumentError.message}`);
    }
    const { data: existingChunks, error: existingChunkError } = await supabase
      .from("document_chunks")
      .select("id, content_hash, embedding")
      .in("id", chunkIds);
    if (existingChunkError) {
      throw new Error(`Registry corpus chunk preflight failed: ${existingChunkError.message}`);
    }

    const existingDocumentById = new Map((existingDocuments ?? []).map((document) => [document.id, document]));
    const existingChunkById = new Map((existingChunks ?? []).map((chunk) => [chunk.id, chunk]));
    const documents = batch.map((entry, index) => {
      const documentId = derivedDocuments[index]?.id;
      return registryDocumentRowPreservingOwner(
        entry,
        typeof documentId === "string" ? existingDocumentById.get(documentId) : null,
      );
    });
    const documentOwnerById = new Map(
      documents.flatMap((document) =>
        typeof document.id === "string"
          ? ([[document.id, document.owner_id ?? null]] as Array<[string, string | null]>)
          : [],
      ),
    );
    const pendingEntries = batch.flatMap((entry, index) => {
      const document = documents[index];
      if (!document?.id) return [];
      const existingDocument = existingDocumentById.get(document.id);
      const existingChunk = existingChunkById.get(registryChunkId(entry));
      const expectedHash = sha256(entry.content);
      const needsEmbedding = existingChunk?.content_hash !== expectedHash || existingChunk?.embedding == null;
      // Row drift that content_hash cannot see (a metadata/title derivation
      // change) still refreshes the stored rows, reusing the current embedding.
      if (!needsEmbedding && registryDocumentRowCurrent(existingDocument, document)) return [];
      return [{ entry, document, needsEmbedding, existingEmbedding: existingChunk?.embedding ?? null }];
    });

    if (pendingEntries.length > 0) {
      const pendingDocuments = pendingEntries.map((pending) => pending.document);
      const entriesToEmbed = pendingEntries.filter((pending) => pending.needsEmbedding);
      const embeddings =
        entriesToEmbed.length > 0 ? await embedTexts(entriesToEmbed.map((pending) => pending.entry.content)) : [];
      let embeddingIndex = 0;
      const pendingChunks = pendingEntries.map((pending) =>
        registryChunkRow(
          pending.entry,
          (pending.needsEmbedding ? embeddings[embeddingIndex++] : pending.existingEmbedding) as Vector,
        ),
      );
      const pendingDocumentIds = pendingDocuments
        .map((document) => document.id)
        .filter((id): id is string => typeof id === "string");
      const existingPendingDocuments = pendingDocumentIds.flatMap((id) => {
        const document = existingDocumentById.get(id);
        return document ? [document] : [];
      });
      const existingPendingDocumentIds = new Set(existingPendingDocuments.map((document) => document.id));

      const { error: documentError } = await supabase.from("documents").upsert(pendingDocuments, { onConflict: "id" });
      if (documentError) throw new Error(`Registry corpus document upsert failed: ${documentError.message}`);

      const { error: chunkError } = await supabase.from("document_chunks").upsert(pendingChunks, { onConflict: "id" });
      if (chunkError) {
        const insertedDocumentIds = pendingDocumentIds.filter((id) => !existingPendingDocumentIds.has(id));
        const rollbackErrors: string[] = [];
        if (insertedDocumentIds.length > 0) {
          const { error: deleteError } = await supabase.from("documents").delete().in("id", insertedDocumentIds);
          if (deleteError) rollbackErrors.push(`delete failed: ${deleteError.message}`);
        }
        if (existingPendingDocuments.length > 0) {
          const { error: restoreError } = await supabase
            .from("documents")
            .upsert(existingPendingDocuments, { onConflict: "id" });
          if (restoreError) rollbackErrors.push(`restore failed: ${restoreError.message}`);
        }
        const suffix = rollbackErrors.length > 0 ? `; rollback errors: ${rollbackErrors.join(", ")}` : "";
        throw new Error(`Registry corpus chunk upsert failed: ${chunkError.message}${suffix}`);
      }

      documentCount += pendingDocuments.length;
      chunkCount += pendingChunks.length;
    }

    await reconcileRegistryGeneratedLabels(supabase, batch, documentOwnerById);
  }

  return { documentCount, chunkCount };
}

/** Embed clinical registry rows. */
export function embedClinicalRegistryRows(supabase: AdminClient, rows: RegistryRecordRow[]) {
  return embedRegistryCorpusEntries(supabase, clinicalRegistryRowsToCorpusEntries(rows));
}

/** Embed medication rows. */
export function embedMedicationRows(supabase: AdminClient, rows: MedicationRecordRow[]) {
  return embedRegistryCorpusEntries(supabase, medicationRowsToCorpusEntries(rows));
}

/** Embed differential rows. */
export function embedDifferentialRows(supabase: AdminClient, rows: DifferentialRecordRow[]) {
  return embedRegistryCorpusEntries(supabase, differentialRowsToCorpusEntries(rows));
}

async function bestEffortRegistryCorpusSync(
  enabled: boolean,
  sync: () => Promise<RegistryCorpusEmbedResult>,
  scope: string,
): Promise<RegistryCorpusEmbedResult> {
  if (!enabled) return skippedRegistryEmbedResult("disabled");

  try {
    return await sync();
  } catch (error) {
    console.error(`[${scope}] registry corpus sync failed`, safeErrorLogDetails(error));
    return {
      documentCount: 0,
      chunkCount: 0,
      skipped: true,
      reason: "failed",
      errorMessage: "Registry corpus synchronization failed.",
    };
  }
}

/** Best-effort corpus reconciliation for stored service and form rows. */
export function bestEffortSyncClinicalRegistryRows(
  supabase: AdminClient,
  rows: RegistryRecordRow[],
  scope = "registry",
) {
  return bestEffortRegistryCorpusSync(
    registryCorpusEmbeddingEnabled(),
    () => embedClinicalRegistryRows(supabase, rows),
    scope,
  );
}

/** Best-effort corpus reconciliation for stored medication rows. */
export function bestEffortSyncMedicationRows(
  supabase: AdminClient,
  rows: MedicationRecordRow[],
  scope = "medications",
) {
  return bestEffortRegistryCorpusSync(
    registryCorpusEmbeddingEnabled(),
    () => embedMedicationRows(supabase, rows),
    scope,
  );
}

/** Best-effort corpus reconciliation for stored differential rows. */
export function bestEffortSyncDifferentialRows(
  supabase: AdminClient,
  rows: DifferentialRecordRow[],
  scope = "differentials",
) {
  return bestEffortRegistryCorpusSync(
    registryCorpusEmbeddingEnabled(),
    () => embedDifferentialRows(supabase, rows),
    scope,
  );
}

/** Reload an owner's rows for a table and embed them, returning the chunk count
 *  written. Shared by the registry/medication/differential seed CLIs, which each
 *  re-read their own rows (rather than reusing the upsert response) so the
 *  embedded corpus always reflects what is actually stored. */
export async function embedReloadedOwnerRows<Row>(
  reload: PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
  embed: (rows: Row[]) => Promise<{ chunkCount: number }>,
  tableLabel: string,
) {
  const { data, error } = await reload;
  if (error) throw new Error(`Could not reload ${tableLabel} rows for embedding: ${error.message}`);
  const { chunkCount } = await embed(data ?? []);
  return chunkCount;
}

/** Skipped registry embed result. */
function skippedRegistryEmbedResult(reason: RegistryCorpusEmbedResult["reason"]): RegistryCorpusEmbedResult {
  return { documentCount: 0, chunkCount: 0, skipped: true, reason };
}

/** Reembed clinical registry record by slug. */
export async function reembedClinicalRegistryRecordBySlug(
  supabase: AdminClient,
  args: { ownerId: string; slug: string; kind?: RegistryRecordKind },
): Promise<RegistryCorpusEmbedResult> {
  if (!registryCorpusEmbeddingEnabled()) return skippedRegistryEmbedResult("disabled");

  let query = supabase.from("clinical_registry_records").select("*").eq("owner_id", args.ownerId).eq("slug", args.slug);
  if (args.kind) query = query.eq("kind", args.kind);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Could not load registry record for re-embedding: ${error.message}`);
  if (!data) return skippedRegistryEmbedResult("not_found");

  return embedClinicalRegistryRows(supabase, [data as RegistryRecordRow]);
}

/** Reembed medication record by slug. */
export async function reembedMedicationRecordBySlug(
  supabase: AdminClient,
  args: { ownerId: string; slug: string },
): Promise<RegistryCorpusEmbedResult> {
  if (!registryCorpusEmbeddingEnabled()) return skippedRegistryEmbedResult("disabled");

  const { data, error } = await supabase
    .from("medication_records")
    .select("*")
    .eq("owner_id", args.ownerId)
    .eq("slug", args.slug)
    .maybeSingle();
  if (error) throw new Error(`Could not load medication record for re-embedding: ${error.message}`);
  if (!data) return skippedRegistryEmbedResult("not_found");

  return embedMedicationRows(supabase, [data as MedicationRecordRow]);
}

/** Reembed differential record by slug. */
export async function reembedDifferentialRecordBySlug(
  supabase: AdminClient,
  args: { ownerId: string; slug: string; kind?: DifferentialRecordRow["kind"] },
): Promise<RegistryCorpusEmbedResult> {
  if (!registryCorpusEmbeddingEnabled()) return skippedRegistryEmbedResult("disabled");

  let query = supabase.from("differential_records").select("*").eq("owner_id", args.ownerId).eq("slug", args.slug);
  if (args.kind) query = query.eq("kind", args.kind);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Could not load differential record for re-embedding: ${error.message}`);
  if (!data) return skippedRegistryEmbedResult("not_found");

  return embedDifferentialRows(supabase, [data as DifferentialRecordRow]);
}

/** Reembed registry record after edit. */
export function reembedRegistryRecordAfterEdit(
  supabase: AdminClient,
  target: RegistryCorpusEditTarget,
): Promise<RegistryCorpusEmbedResult> {
  if (target.corpusKind === "medication") {
    return reembedMedicationRecordBySlug(supabase, { ownerId: target.ownerId, slug: target.slug });
  }

  if (target.corpusKind === "differential") {
    return reembedDifferentialRecordBySlug(supabase, {
      ownerId: target.ownerId,
      slug: target.slug,
      kind: target.differentialKind,
    });
  }

  return reembedClinicalRegistryRecordBySlug(supabase, {
    ownerId: target.ownerId,
    slug: target.slug,
    kind: target.corpusKind,
  });
}

/** Best effort reembed registry record after edit. */
export async function bestEffortReembedRegistryRecordAfterEdit(args: {
  supabase: AdminClient;
  target: RegistryCorpusEditTarget;
  scope: string;
}) {
  return bestEffortRegistryCorpusSync(
    registryCorpusEmbeddingEnabled(),
    () => reembedRegistryRecordAfterEdit(args.supabase, args.target),
    args.scope,
  );
}
