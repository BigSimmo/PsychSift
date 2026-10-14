import { createHash } from "node:crypto";
import { buildDocumentSections, buildDocumentMemoryCards } from "../src/lib/deep-memory-preparation";
import { buildDocumentIndexUnitInputs, type IndexUnitVisualImage } from "../src/lib/document-index-units";
import {
  freezeGenerationEvidence,
  generationEvidenceBytes,
  parseIssuedAttemptControl,
  unitIdentity,
  type GenerationEvidenceUnitId,
  type IssuedAttemptControl,
} from "../src/lib/ingestion-generation-evidence";
import { candidateChunkId, candidateImageRowSchema, preparedRowSchema } from "./candidate-chunks";
import type { WholeOriginalPreparedUnit } from "./whole-original-supplier";

type Document = Parameters<typeof buildDocumentSections>[0]["document"];
type UnitId = GenerationEvidenceUnitId;
export type ManagedLocalMemoryRow<T> = {
  body: T;
  planningId: UnitId;
  dependencies: UnitId[];
};
function refuse(reason: string): never {
  throw new Error(`managed_local_memory_${reason}`);
}
function copy<T>(value: T): T {
  // The shared serializer refuses accessors, non-data objects and undefined values.
  return JSON.parse(generationEvidenceBytes(value).toString("utf8")) as T;
}
function planningId(issued: IssuedAttemptControl, family: UnitId["family"], ordinal: number): UnitId {
  const bytes = createHash("sha256")
    .update(generationEvidenceBytes(["deep_memory", family, issued.documentId, issued.generationId, ordinal]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 0x50;
  bytes[8] = (bytes[8] & 63) | 0x80;
  const hex = bytes.toString("hex");
  return {
    family,
    key: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  };
}
function ids(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id)) refuse("invalid_parent_ids");
  return value as string[];
}
function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") refuse("invalid_image_metadata");
  return value;
}

/** Pure, pre-embedding preparation. No upsert, model generation or provider function is invoked. */
export function prepareManagedLocalMemoryProducer(args: {
  document: Document;
  issued: IssuedAttemptControl;
  coreUnits: WholeOriginalPreparedUnit[];
}) {
  const input = copy(args);
  const issued = parseIssuedAttemptControl(input.issued);
  const document = input.document;
  if (document.id !== issued.documentId || typeof document.owner_id !== "string" || !document.owner_id)
    refuse("document_control_mismatch");
  const selected = input.coreUnits.filter((unit) => ["chunks", "images"].includes(unit.declaration.id.family));
  if (selected.length > 800) refuse("input_budget_exceeded");
  const parents = new Map<string, UnitId>();
  for (const unit of selected) {
    if (unit.declaration.groupKey !== "worker_core") refuse("foreign_parent_group");
    const key = unitIdentity(unit.declaration.id);
    if (parents.has(key)) refuse("duplicate_parent");
    parents.set(key, unit.declaration.id);
  }
  const chunkRows = selected
    .filter((unit) => unit.declaration.id.family === "chunks")
    .map((unit) => {
      const row = preparedRowSchema.parse(unit.body);
      if (
        unit.auxiliary ||
        row.id !== unit.declaration.id.key ||
        row.id !== candidateChunkId(issued.documentId, issued.generationId, row.chunk_index) ||
        row.document_id !== issued.documentId ||
        row.index_generation_id !== issued.generationId ||
        row.metadata.index_generation_id !== issued.generationId ||
        row.metadata.source_path !== (document.source_path ?? null)
      )
        refuse("chunk_control_mismatch");
      return row;
    });
  if (!chunkRows.length) refuse("chunks_required");
  if (chunkRows.reduce((size, chunk) => size + Buffer.byteLength(chunk.content, "utf8"), 0) > 4_000_000)
    refuse("input_budget_exceeded");
  const imageRows = selected
    .filter((unit) => unit.declaration.id.family === "images")
    .flatMap((unit) => {
      const row = candidateImageRowSchema.parse(unit.body);
      if (
        row.id !== unit.declaration.id.key ||
        row.document_id !== issued.documentId ||
        row.index_generation_id !== issued.generationId ||
        row.owner_id !== document.owner_id ||
        (row.metadata.index_generation_id !== undefined && row.metadata.index_generation_id !== issued.generationId) ||
        (row.metadata.source_path !== undefined && row.metadata.source_path !== (document.source_path ?? null))
      )
        refuse("image_control_mismatch");
      if (unit.auxiliary !== (row.source_kind === "cover_page")) refuse("auxiliary_classification_mismatch");
      if (unit.auxiliary) {
        parents.delete(unitIdentity(unit.declaration.id));
        return [];
      }
      return [row];
    });
  const parent = (family: "chunks" | "images", key: string): UnitId => {
    const ref = parents.get(unitIdentity({ family, key }));
    if (!ref) refuse("missing_or_foreign_parent");
    return ref;
  };
  for (const chunk of chunkRows) for (const id of chunk.image_ids) parent("images", id);
  const images: IndexUnitVisualImage[] = imageRows.map((row) => {
    const metadata = row.metadata;
    const rows = metadata.table_rows;
    if (
      rows !== undefined &&
      (!Array.isArray(rows) ||
        rows.some((cells) => !Array.isArray(cells) || cells.some((cell) => typeof cell !== "string")))
    )
      refuse("invalid_image_metadata");
    return {
      id: row.id,
      pageNumber: row.page_number,
      sourceKind: row.source_kind,
      caption: row.caption,
      imageType: row.image_type,
      labels: row.labels,
      metadata,
      tableRows: rows as string[][] | undefined,
      tableColumns: metadata.table_columns === undefined ? null : ids(metadata.table_columns),
      tableTitle: text(metadata.table_title),
      tableLabel: text(metadata.table_label),
      tableRole: text(metadata.table_role),
      tableTextSnippet: text(metadata.table_text),
      accessibleTableMarkdown: text(metadata.accessible_table_markdown),
    };
  });
  if (images.reduce((size, image) => size + (image.tableRows?.length ?? 0), 0) > 400) refuse("input_budget_exceeded");
  const builtSections = buildDocumentSections({ document, chunks: chunkRows });
  const builtCards = buildDocumentMemoryCards({
    document,
    chunks: chunkRows,
    images: imageRows,
    sections: builtSections,
    modelProfile: null,
  });
  const builtIndexes = buildDocumentIndexUnitInputs({
    document,
    chunks: chunkRows,
    images,
    sections: builtSections,
    modelProfile: null,
    summary: null,
  });
  const sectionParents = new Map(
    builtSections.map((section, ordinal) => [section.section_index, planningId(issued, "sections", ordinal)]),
  );
  const unique = (refs: UnitId[]) => [...new Map(refs.map((ref) => [unitIdentity(ref), ref])).values()];
  const row = <T extends { document_id: string; owner_id?: string | null; metadata?: Record<string, unknown> }>(
    body: T,
    family: UnitId["family"],
    ordinal: number,
    dependencies: UnitId[],
  ): ManagedLocalMemoryRow<T> => {
    if (
      body.document_id !== document.id ||
      body.owner_id !== document.owner_id ||
      (body.metadata?.index_generation_id !== null && body.metadata?.index_generation_id !== issued.generationId)
    )
      refuse("output_control_mismatch");
    return { body, planningId: planningId(issued, family, ordinal), dependencies: unique(dependencies) };
  };
  const sections = builtSections.map((body, ordinal) =>
    row(
      body,
      "sections",
      ordinal,
      body.chunk_ids.map((id) => parent("chunks", id)),
    ),
  );
  const memoryCards = builtCards.map((body, ordinal) => {
    const dependencies = [
      ...body.source_chunk_ids.map((id) => parent("chunks", id)),
      ...ids(body.metadata?.chunk_ids).map((id) => parent("chunks", id)),
      ...body.source_image_ids.map((id) => parent("images", id)),
    ];
    if (body.section_index !== undefined) {
      const section = sectionParents.get(body.section_index);
      if (!section) refuse("missing_section_parent");
      dependencies.push(section);
    }
    return row(body, "memory_cards", ordinal, dependencies);
  });
  const indexUnits = builtIndexes.map((body, ordinal) => {
    const dependencies: UnitId[] = [
      ...ids(body.metadata.chunk_ids).map((id) => parent("chunks", id)),
      ...ids(body.metadata.source_chunk_ids).map((id) => parent("chunks", id)),
      ...ids(body.metadata.source_image_ids).map((id) => parent("images", id)),
    ];
    if (body.source_chunk_id) dependencies.push(parent("chunks", body.source_chunk_id));
    if (body.source_image_id) dependencies.push(parent("images", body.source_image_id));
    if (body.unit_type === "document_profile")
      dependencies.push(...chunkRows.map((chunk) => parent("chunks", chunk.id)));
    if (body.metadata.source === "document_sections") {
      const matching = builtSections.filter((section) =>
        generationEvidenceBytes(section.chunk_ids).equals(generationEvidenceBytes(body.metadata.chunk_ids)),
      );
      if (matching.length !== 1) refuse("missing_section_parent");
      dependencies.push(sectionParents.get(matching[0].section_index)!);
    }
    return row(body, "index_units", ordinal, dependencies);
  });
  return freezeGenerationEvidence({ sections, memoryCards, indexUnits });
}
