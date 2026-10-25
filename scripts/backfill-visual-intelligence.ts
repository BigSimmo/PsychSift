import { loadEnvConfig } from "@next/env";
import type { Json, TablesInsert } from "@/lib/supabase/database.types";
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
};

type BackfillDocumentRow = {
  id: string;
  owner_id: string | null;
  title: string;
  file_name: string;
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

async function loadCandidateImages() {
  const { data, error } = await supabase
    .from("document_images")
    .select("id,document_id,page_number,caption,image_type,source_kind,labels,metadata")
    .eq("searchable", true)
    .or(
      [
        "metadata->>visual_intelligence_version.is.null",
        `metadata->>visual_intelligence_version.neq.${visualIntelligenceVersion}`,
        "metadata->>visual_backfill_status.eq.retry",
      ].join(","),
    )
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as BackfillImageRow[];
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
    .select("id,owner_id,title,file_name")
    .eq("id", documentId)
    .single();
  if (error) throw new Error(error.message);
  return data as BackfillDocumentRow;
}

async function loadChunks(documentId: string) {
  const { data, error } = await supabase
    .from("document_chunks")
    .select("id,document_id,page_number,chunk_index,section_heading,section_path,content,metadata,image_ids")
    .eq("document_id", documentId)
    .order("chunk_index", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as IndexUnitChunk[];
}

async function markImage(image: BackfillImageRow, patch: Record<string, unknown>) {
  const metadata = { ...(image.metadata ?? {}), ...patch };
  const { error } = await supabase
    .from("document_images")
    .update({ metadata: metadata as Json })
    .eq("id", image.id);
  if (error) throw new Error(error.message);
}

async function backfillDocument(documentId: string, images: BackfillImageRow[]) {
  const document = await loadDocument(documentId);
  const chunks = await loadChunks(documentId);
  const visualImages = images.map(imageToVisualInput);
  const units = buildVisualDocumentIndexUnitInputs({ document, chunks, images: visualImages });
  const counts = unitCounts(units);
  console.log(
    `${dryRun ? "[dry-run] " : ""}${document.file_name}: ${images.length} image(s), ${units.length} visual unit(s) ${JSON.stringify(counts)}`,
  );
  if (dryRun) return;

  const imageIds = images.map((image) => image.id);
  for (const image of images) {
    await markImage(image, {
      visual_backfill_status: "processing",
      visual_backfill_started_at: new Date().toISOString(),
    });
  }
  const { error: deleteError } = await supabase
    .from("document_index_units")
    .delete()
    .eq("document_id", documentId)
    .in("source_image_id", imageIds)
    .in("unit_type", [
      "visual_summary",
      "flowchart_step",
      "diagram_decision",
      "risk_matrix_cell",
      "medication_chart_row",
      "chart_finding",
      "visual_askable_question",
      "table_threshold",
    ]);
  // Inserting on top of rows that failed to delete would leave duplicate visual units.
  if (deleteError) throw new Error(deleteError.message);

  if (units.length > 0) {
    const embeddings = await embedTexts(units.map(embeddingTextForDocumentIndexUnit));
    for (let start = 0; start < units.length; start += 50) {
      const batch = units.slice(start, start + 50).map((unit, index) => ({
        ...unit,
        embedding: embeddings[start + index],
      }));
      const { error } = await supabase
        .from("document_index_units")
        .insert(batch as unknown as TablesInsert<"document_index_units">[]);
      if (error) throw new Error(error.message);
    }
  }

  for (const image of images) {
    const profile = imageToVisualInput(image).structuredVisualProfile;
    await markImage(image, {
      visual_intelligence_version: visualIntelligenceVersion,
      structured_visual_profile: profile,
      structured_extraction_confidence: profile?.confidence ?? null,
      visual_backfill_status: "completed",
      visual_backfill_completed_at: new Date().toISOString(),
    });
  }
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
      if (!dryRun) {
        for (const image of documentImages) {
          await markImage(image, {
            visual_backfill_status: "retry",
            visual_backfill_error: message.slice(0, 500),
          });
        }
      }
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
