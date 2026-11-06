import {
  assertLegacyMaintenanceSnapshot,
  maintenanceMetadata,
  replaceMaintenanceArtifacts,
} from "@/lib/ingestion-maintenance";
import { loadEnvConfig } from "@next/env";
import {
  buildVisualDocumentIndexUnitInputs,
  embeddingTextForDocumentIndexUnit,
  type IndexUnitChunk,
  type IndexUnitVisualImage,
} from "@/lib/document-index-units";
import {
  deterministicStructuredVisualProfile,
  visualIntelligenceVersion,
  type StructuredVisualProfile,
} from "@/lib/visual-intelligence";

loadEnvConfig(process.cwd());

type AdminClient = ReturnType<(typeof import("@/lib/supabase/admin"))["createAdminClient"]>;

let supabase: AdminClient;
let embedTexts: (texts: string[]) => Promise<number[][]>;

async function initDependencies() {
  const [openaiModule, supabaseModule] = await Promise.all([import("@/lib/openai"), import("@/lib/supabase/admin")]);
  embedTexts = openaiModule.embedTexts;
  supabase = supabaseModule.createAdminClient();
}

type BackfillImageRow = {
  id: string;
  document_id: string;
  page_number: number | null;
  caption: string | null;
  image_type: string | null;
  source_kind: string | null;
  labels: string[] | null;
  metadata: Record<string, unknown> | null;
  index_generation_id: string | null;
};

type BackfillDocumentRow = {
  id: string;
  owner_id: string | null;
  title: string;
  file_name: string;
  metadata: Record<string, unknown>;
  updated_at: string;
};

function argValue(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function numberArg(name: string, fallback: number) {
  const value = Number(argValue(name, String(fallback)));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const limit = numberArg("--limit", 10);
const dryRun = process.argv.includes("--dry-run");
const reportOnly = dryRun || process.argv.includes("--report");

function metadataText(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataStringArray(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return Array.isArray(value) ? value.map(String) : null;
}

function metadataRows(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return Array.isArray(value) ? (value as string[][]) : null;
}

function imageToVisualInput(image: BackfillImageRow): IndexUnitVisualImage {
  const metadata = image.metadata ?? {};
  const existingProfile =
    typeof metadata.structured_visual_profile === "object" && metadata.structured_visual_profile !== null
      ? (metadata.structured_visual_profile as StructuredVisualProfile)
      : null;
  const profile =
    existingProfile ??
    deterministicStructuredVisualProfile({
      imageType: image.image_type,
      caption: image.caption,
      tableTitle: metadataText(metadata, "table_title"),
      tableLabel: metadataText(metadata, "table_label"),
      tableTextSnippet: metadataText(metadata, "table_text_snippet") ?? metadataText(metadata, "table_text"),
      tableRows: metadataRows(metadata, "table_rows"),
      tableColumns: metadataStringArray(metadata, "table_columns"),
      metadata,
      sourceImageId: image.id,
      pageNumber: image.page_number,
      sourceRegion:
        metadata.bbox && typeof metadata.bbox === "object" && !Array.isArray(metadata.bbox)
          ? (metadata.bbox as Record<string, unknown>)
          : null,
    });

  return {
    id: image.id,
    caption: image.caption,
    pageNumber: image.page_number,
    imageType: image.image_type,
    sourceKind: image.source_kind,
    labels: image.labels ?? [],
    tableLabel: metadataText(metadata, "table_label"),
    tableTitle: metadataText(metadata, "table_title"),
    tableTextSnippet: metadataText(metadata, "table_text_snippet") ?? metadataText(metadata, "table_text"),
    tableRole: metadataText(metadata, "table_role"),
    accessibleTableMarkdown: metadataText(metadata, "accessible_table_markdown"),
    tableRows: metadataRows(metadata, "table_rows"),
    tableColumns: metadataStringArray(metadata, "table_columns"),
    structuredVisualProfile: profile,
    candidatePriorityScore: Number(metadata.candidate_priority_score ?? 0.62),
    imageQualityScore: Number(metadata.image_quality_score ?? 0.62),
    cropCompleteness: Number(metadata.crop_completeness ?? 0.62),
    ocrTextDensity: Number(metadata.ocr_text_density ?? 0),
    metadata,
  };
}

function committedGeneration(metadata: unknown) {
  const value = maintenanceMetadata(metadata).index_generation_id;
  return typeof value === "string" ? value : null;
}

/**
 * Candidates from each document's committed generation only. Retained images from an older
 * generation can stay searchable with a stale version; backfillDocument would discard them, so
 * filtering after a plain `.limit()` could fill every run with them and starve later candidates.
 * Page past them until `limit` committed-generation candidates are found or the rows run out.
 */
async function loadCandidateImages() {
  const candidates: BackfillImageRow[] = [];
  const generations = new Map<string, string | null>();
  const looked = new Set<string>();
  const pageSize = Math.max(limit, 100);
  for (let offset = 0; candidates.length < limit; offset += pageSize) {
    const { data, error } = await supabase
      .from("document_images")
      .select("id,document_id,page_number,caption,image_type,source_kind,labels,metadata,index_generation_id")
      .eq("searchable", true)
      .or(
        [
          "metadata->>visual_intelligence_version.is.null",
          `metadata->>visual_intelligence_version.neq.${visualIntelligenceVersion}`,
          "metadata->>visual_backfill_status.eq.retry",
        ].join(","),
      )
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as BackfillImageRow[];
    const unknown = Array.from(new Set(page.map((image) => image.document_id))).filter((id) => !looked.has(id));
    if (unknown.length) {
      const { data: documents, error: documentError } = await supabase
        .from("documents")
        .select("id,metadata")
        .in("id", unknown);
      if (documentError) throw new Error(documentError.message);
      for (const id of unknown) looked.add(id);
      for (const document of documents ?? []) generations.set(document.id, committedGeneration(document.metadata));
    }
    for (const image of page) {
      if (candidates.length >= limit) break;
      // A document that no longer exists has no committed generation and yields no candidates.
      if (generations.has(image.document_id) && generations.get(image.document_id) === image.index_generation_id)
        candidates.push(image);
    }
    if (page.length < pageSize) break;
  }
  return candidates;
}

function statusForImage(image: BackfillImageRow) {
  const metadata = image.metadata ?? {};
  const status = metadata.visual_backfill_status;
  if (typeof status === "string" && status.trim()) return status;
  return metadata.visual_intelligence_version === visualIntelligenceVersion ? "completed" : "pending";
}

function unitCounts(units: Array<{ unit_type: string }>) {
  return units.reduce<Record<string, number>>((counts, unit) => {
    counts[unit.unit_type] = (counts[unit.unit_type] ?? 0) + 1;
    return counts;
  }, {});
}

async function printCoverageReport(images: BackfillImageRow[]) {
  const documentIds = Array.from(new Set(images.map((image) => image.document_id)));
  const { data: visualUnits, error } = documentIds.length
    ? await supabase
        .from("document_index_units")
        .select("document_id,unit_type,source_image_id")
        .in("document_id", documentIds)
        .in("unit_type", [
          "visual_summary",
          "flowchart_step",
          "diagram_decision",
          "risk_matrix_cell",
          "medication_chart_row",
          "chart_finding",
          "visual_askable_question",
          "table_threshold",
        ])
    : { data: [], error: null };
  if (error) throw new Error(error.message);

  const rows = documentIds.map((documentId) => {
    const documentImages = images.filter((image) => image.document_id === documentId);
    const units = (visualUnits ?? []).filter((unit) => unit.document_id === documentId);
    return {
      document_id: documentId,
      searchable_images: documentImages.length,
      image_statuses: documentImages.reduce<Record<string, number>>((counts, image) => {
        const status = statusForImage(image);
        counts[status] = (counts[status] ?? 0) + 1;
        return counts;
      }, {}),
      visual_units: units.length,
      visual_unit_types: unitCounts(units),
      images_with_retrievable_units: new Set(units.map((unit) => unit.source_image_id).filter(Boolean)).size,
      missing_retrievable_image_units: Math.max(
        0,
        documentImages.filter((image) => statusForImage(image) === "completed").length -
          new Set(units.map((unit) => unit.source_image_id).filter(Boolean)).size,
      ),
    };
  });
  const globalVisualUnitTypes = rows.reduce<Record<string, number>>((counts, row) => {
    for (const [unitType, count] of Object.entries(row.visual_unit_types)) {
      counts[unitType] = (counts[unitType] ?? 0) + count;
    }
    return counts;
  }, {});
  const missingRetrievableImageUnits = rows.reduce((sum, row) => sum + row.missing_retrievable_image_units, 0);

  console.log(
    JSON.stringify(
      {
        mode: reportOnly ? "report" : "backfill",
        visual_intelligence_version: visualIntelligenceVersion,
        candidate_image_limit: limit,
        candidate_images: images.length,
        candidate_documents: documentIds.length,
        visual_unit_types: globalVisualUnitTypes,
        missing_retrievable_image_units: missingRetrievableImageUnits,
        documents_missing_retrievable_image_units: rows.filter((row) => row.missing_retrievable_image_units > 0).length,
        documents: rows,
      },
      null,
      2,
    ),
  );
}

async function loadDocument(documentId: string) {
  const { data, error } = await supabase
    .from("documents")
    .select("id,owner_id,title,file_name,metadata,updated_at")
    .eq("id", documentId)
    .single();
  if (error) throw new Error(error.message);
  return data as BackfillDocumentRow;
}

async function loadChunks(documentId: string, generation: string | null) {
  let query = supabase
    .from("document_chunks")
    .select("id,document_id,page_number,chunk_index,section_heading,section_path,content,metadata,image_ids")
    .eq("document_id", documentId);
  query = generation ? query.eq("index_generation_id", generation) : query.is("index_generation_id", null);
  const { data, error } = await query.order("chunk_index", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as IndexUnitChunk[];
}

async function backfillDocument(documentId: string, images: BackfillImageRow[]) {
  const document = await loadDocument(documentId);
  if (!dryRun) assertLegacyMaintenanceSnapshot(document);
  const generation = committedGeneration(document.metadata);
  // Recheck against the fresh snapshot: the committed generation can move after candidate selection.
  images = images.filter((image) => image.index_generation_id === generation);
  if (images.length === 0) return;
  const chunks = await loadChunks(documentId, generation);
  const visualImages = images.map(imageToVisualInput);
  const units = buildVisualDocumentIndexUnitInputs({ document, chunks, images: visualImages });
  const counts = unitCounts(units);
  console.log(
    `${dryRun ? "[dry-run] " : ""}${document.file_name}: ${images.length} image(s), ${units.length} visual unit(s) ${JSON.stringify(counts)}`,
  );
  if (dryRun) return;

  // Prepare every embedding before replacing any searchable evidence.
  const embeddings = units.length ? await embedTexts(units.map(embeddingTextForDocumentIndexUnit)) : [];
  if (embeddings.length !== units.length) throw new Error("Visual embedding count mismatch.");
  await replaceMaintenanceArtifacts({
    supabase,
    document,
    operation: "visual",
    payload: {
      image_ids: images.map((image) => image.id),
      units: units.map((unit, index) => ({ ...unit, index_generation_id: generation, embedding: embeddings[index] })),
      image_patches: images.map((image) => {
        const profile = imageToVisualInput(image).structuredVisualProfile;
        return {
          id: image.id,
          metadata: {
            visual_intelligence_version: visualIntelligenceVersion,
            structured_visual_profile: profile,
            structured_extraction_confidence: profile?.confidence ?? null,
            visual_backfill_status: "completed",
            visual_backfill_completed_at: new Date().toISOString(),
          },
        };
      }),
    },
  });
}

async function main() {
  await initDependencies();
  const images = await loadCandidateImages();
  if (images.length === 0) {
    console.log("No visual intelligence backfill candidates found.");
    return;
  }
  if (reportOnly) {
    await printCoverageReport(images);
    if (dryRun) {
      // Continue into dry-run unit generation so phase-1 reports include expected artifact counts.
    } else {
      return;
    }
  }
  const imagesByDocument = new Map<string, BackfillImageRow[]>();
  for (const image of images) {
    imagesByDocument.set(image.document_id, [...(imagesByDocument.get(image.document_id) ?? []), image]);
  }

  let failedDocuments = 0;
  for (const [documentId, documentImages] of imagesByDocument) {
    try {
      await backfillDocument(documentId, documentImages);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failedDocuments += 1;
      console.warn(`Visual backfill failed for document ${documentId}: ${message}`);
      // The original evidence and image metadata remain unchanged on failure.
      // A later invocation recomputes from a fresh committed snapshot.
    }
  }
  if (failedDocuments > 0) {
    console.error(`Visual backfill failed for ${failedDocuments} of ${imagesByDocument.size} document(s).`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
