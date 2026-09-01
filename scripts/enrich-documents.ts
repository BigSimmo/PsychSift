import { loadEnvConfig } from "@next/env";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/lib/supabase/database.types";
import { createHash } from "node:crypto";
import {
  SOURCE_ANCHORED_MAX_CHUNKS,
  SOURCE_ANCHORED_MAX_IMAGES,
  SOURCE_ANCHORED_SOURCE_PAGE_SIZE,
  requireExactSourceAnchoredGeneration,
} from "../supabase/functions/_shared/source-anchored-summary";

loadEnvConfig(process.cwd());

type EnrichArgs = {
  ownerEmail?: string;
  ownerId?: string;
  allOwners: boolean;
  mode: string;
  limit: number;
  documentId?: string;
  includeCurrent: boolean;
  document?: string;
};

type SupabaseAdmin = Awaited<ReturnType<typeof loadAdminClient>>;
type MetadataRow = { id?: string; document_id: string; metadata?: unknown; source?: string | null };

async function loadAdminClient() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function parseArgs(argv: string[]): EnrichArgs {
  const args: EnrichArgs = {
    ownerEmail: process.env.RAG_EVAL_OWNER_EMAIL,
    ownerId: process.env.RAG_EVAL_OWNER_ID ?? process.env.LOCAL_NO_AUTH_OWNER_ID,
    allOwners:
      !process.env.RAG_EVAL_OWNER_EMAIL && !process.env.RAG_EVAL_OWNER_ID && !process.env.LOCAL_NO_AUTH_OWNER_ID,
    mode: "summaries-labels-images",
    limit: 25,
    includeCurrent: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    if (token === "--all-owners") {
      args.allOwners = true;
      continue;
    }
    if (token === "--include-current") {
      args.includeCurrent = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    index += 1;

    if (token === "--owner-email") args.ownerEmail = value;
    if (token === "--owner-id") args.ownerId = value;
    if (token === "--mode") args.mode = value;
    if (token === "--limit") args.limit = Number.parseInt(value, 10);
    if (token === "--document-id") args.documentId = value;
    if (token === "--document") args.document = value;
  }

  if (!Number.isInteger(args.limit) || args.limit <= 0) throw new Error("--limit must be a positive integer.");
  return args;
}

async function findOwnerIdByEmail(supabase: SupabaseAdmin, email: string) {
  const normalized = email.trim().toLowerCase();
  const perPage = 1000;

  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === normalized);
    if (user?.id) return user.id;
    if (data.users.length < perPage) break;
  }

  throw new Error(`No Supabase Auth user found for ${email}. Sign in once before enriching documents.`);
}

async function loadDocuments(supabase: SupabaseAdmin, args: EnrichArgs, ownerId?: string) {
  let query = supabase
    .from("documents")
    .select("id,owner_id,title,file_name,source_path,status,index_generation_id,metadata")
    .eq("status", "indexed")
    .order("created_at", { ascending: true })
    .limit(args.documentId ? 1 : Math.max(args.limit * 10, 1000));

  if (ownerId) query = query.eq("owner_id", ownerId);
  if (args.documentId) query = query.eq("id", args.documentId);
  if (args.document) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.document);
    if (isUuid) {
      query = query.or(`id.eq.${args.document},file_name.ilike.%${args.document}%,title.ilike.%${args.document}%`);
    } else {
      query = query.or(`file_name.ilike.%${args.document}%,title.ilike.%${args.document}%`);
    }
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function loadEnrichmentCoverage(supabase: SupabaseAdmin, documentIds: string[]) {
  const summaries: MetadataRow[] = [];
  const labels: MetadataRow[] = [];

  for (let start = 0; start < documentIds.length; start += 5) {
    const ids = documentIds.slice(start, start + 5);
    const [summaryResult, labelResult] = await Promise.all([
      supabase.from("document_summaries").select("document_id,metadata").in("document_id", ids),
      supabase.from("document_labels").select("id,document_id,source,metadata").in("document_id", ids),
    ]);

    if (summaryResult.error) throw new Error(summaryResult.error.message);
    if (labelResult.error) throw new Error(labelResult.error.message);
    summaries.push(...((summaryResult.data ?? []) as MetadataRow[]));
    labels.push(...((labelResult.data ?? []) as MetadataRow[]));
  }

  const coverage = new Map<string, { summary?: MetadataRow; labels: MetadataRow[] }>();
  for (const documentId of documentIds) coverage.set(documentId, { labels: [] });
  for (const summary of summaries) {
    coverage.set(summary.document_id, { ...(coverage.get(summary.document_id) ?? { labels: [] }), summary });
  }
  for (const label of labels) {
    const existing = coverage.get(label.document_id) ?? { labels: [] };
    coverage.set(label.document_id, { ...existing, labels: [...existing.labels, label] });
  }

  return coverage;
}

async function loadRowsForDocuments(
  supabase: SupabaseAdmin,
  table: "document_sections" | "document_memory_cards",
  select: string,
  documentIds: string[],
) {
  const rows: MetadataRow[] = [];
  for (let start = 0; start < documentIds.length; start += 5) {
    const ids = documentIds.slice(start, start + 5);
    for (let rangeStart = 0; ; rangeStart += 1000) {
      // Dynamic table/select strings need the untyped client surface.
      const { data, error } = await (supabase as unknown as SupabaseClient)
        .from(table)
        .select(select)
        .in("document_id", ids)
        .range(rangeStart, rangeStart + 999);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as unknown as MetadataRow[]));
      if (!data || data.length < 1000) break;
    }
  }
  return rows;
}

async function loadDeepMemoryCoverage(supabase: SupabaseAdmin, documentIds: string[]) {
  const sections = await loadRowsForDocuments(supabase, "document_sections", "document_id,metadata", documentIds);
  const memoryCards = await loadRowsForDocuments(
    supabase,
    "document_memory_cards",
    "document_id,metadata",
    documentIds,
  );

  const coverage = new Map<string, { sections: MetadataRow[]; memoryCards: MetadataRow[] }>();
  for (const documentId of documentIds) coverage.set(documentId, { sections: [], memoryCards: [] });
  for (const section of sections) {
    const existing = coverage.get(section.document_id) ?? { sections: [], memoryCards: [] };
    coverage.set(section.document_id, { ...existing, sections: [...existing.sections, section] });
  }
  for (const card of memoryCards) {
    const existing = coverage.get(card.document_id) ?? { sections: [], memoryCards: [] };
    coverage.set(card.document_id, { ...existing, memoryCards: [...existing.memoryCards, card] });
  }
  return coverage;
}

async function loadEvidence(supabase: SupabaseAdmin, documentId: string, indexGenerationId: string) {
  const chunks: Array<{
    id: string;
    document_id: string;
    index_generation_id: string;
    page_number: number | null;
    chunk_index: number;
    section_heading: string | null;
    section_path: string[];
    anchor_id: string | null;
    content: string;
    image_ids: string[];
    metadata: Record<string, unknown> | null;
  }> = [];
  const images: Array<{
    id: string;
    document_id: string;
    index_generation_id: string;
    page_number: number | null;
    caption: string;
    image_type: string;
    labels: string[];
    source_kind: string;
    clinical_relevance_score: number;
    metadata: Record<string, unknown> | null;
  }> = [];

  for (let start = 0; ; start += SOURCE_ANCHORED_SOURCE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("document_chunks")
      .select(
        "id,document_id,index_generation_id,page_number,chunk_index,section_heading,section_path,anchor_id,content,image_ids,metadata",
      )
      .eq("document_id", documentId)
      .eq("index_generation_id", indexGenerationId)
      .order("chunk_index", { ascending: true })
      .order("id", { ascending: true })
      .range(start, start + SOURCE_ANCHORED_SOURCE_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    chunks.push(...(data ?? []));
    if (chunks.length > SOURCE_ANCHORED_MAX_CHUNKS) {
      throw new Error("source_anchored_summary_source_limit_exceeded");
    }
    if (!data || data.length < SOURCE_ANCHORED_SOURCE_PAGE_SIZE) break;
  }

  for (let start = 0; ; start += SOURCE_ANCHORED_SOURCE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("document_images")
      .select("id,document_id,index_generation_id,page_number,caption,image_type,labels,source_kind,clinical_relevance_score,metadata")
      .eq("document_id", documentId)
      .eq("index_generation_id", indexGenerationId)
      .eq("searchable", true)
      .order("clinical_relevance_score", { ascending: false, nullsFirst: false })
      .order("page_number", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(start, start + SOURCE_ANCHORED_SOURCE_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    images.push(...(data ?? []));
    if (images.length > SOURCE_ANCHORED_MAX_IMAGES) {
      throw new Error("source_anchored_summary_source_limit_exceeded");
    }
    if (!data || data.length < SOURCE_ANCHORED_SOURCE_PAGE_SIZE) break;
  }

  return { chunks, images };
}

function hashBytes(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function metadataString(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

function hasCurrentEnrichmentVersion(metadata: unknown, expectedVersion: string) {
  return metadataRecord(metadata).rag_enrichment_version === expectedVersion;
}

function hasCurrentMemoryVersion(metadata: unknown, expectedVersion: string) {
  const record = metadataRecord(metadata);
  return record.rag_memory_version === expectedVersion || record.rag_indexing_version === expectedVersion;
}

function needsEnrichmentBackfill(args: {
  document: { metadata?: unknown };
  coverage?: { summary?: MetadataRow; labels: MetadataRow[] };
  memoryCoverage?: { sections: MetadataRow[]; memoryCards: MetadataRow[] };
  ragEnrichmentVersion: string;
  ragDeepMemoryVersion: string;
}) {
  const generatedLabels = args.coverage?.labels.filter((label) => label.source === "generated") ?? [];
  const sections = args.memoryCoverage?.sections ?? [];
  const memoryCards = args.memoryCoverage?.memoryCards ?? [];
  const summaryMetadata = metadataRecord(args.coverage?.summary?.metadata);
  const documentMetadata = metadataRecord(args.document.metadata);
  return (
    !args.coverage?.summary ||
    generatedLabels.length === 0 ||
    !summaryMetadata.coverage_profile ||
    !documentMetadata.coverage_profile ||
    !hasCurrentEnrichmentVersion(args.document.metadata, args.ragEnrichmentVersion) ||
    !hasCurrentEnrichmentVersion(args.coverage.summary?.metadata, args.ragEnrichmentVersion) ||
    generatedLabels.every((label) => !hasCurrentEnrichmentVersion(label.metadata, args.ragEnrichmentVersion)) ||
    sections.length === 0 ||
    memoryCards.length === 0 ||
    !hasCurrentMemoryVersion(args.document.metadata, args.ragDeepMemoryVersion) ||
    sections.every((section) => !hasCurrentMemoryVersion(section.metadata, args.ragDeepMemoryVersion)) ||
    memoryCards.every((card) => !hasCurrentMemoryVersion(card.metadata, args.ragDeepMemoryVersion))
  );
}

async function classifyExistingImages(supabase: SupabaseAdmin, documentId: string) {
  const [
    { env },
    {
      assessClinicalImageUse,
      cheapImageSkipReason,
      classifiedImageSkipReason,
      clinicalImagePolicyVersion,
      imagePlacementDedupeKey,
      lightweightPerceptualHash,
      normalizeImageBbox,
    },
    { classifyAndCaptionImageFromBase64 },
  ] = await Promise.all([import("@/lib/env"), import("@/lib/image-filtering"), import("@/lib/openai")]);
  const { data: images, error } = await supabase
    .from("document_images")
    .select(
      "id,page_number,storage_path,mime_type,caption,bbox,width,height,source_kind,image_hash,image_type,searchable,clinical_relevance_score,skip_reason,labels,metadata",
    )
    .eq("document_id", documentId)
    .order("page_number", { ascending: true });

  if (error) throw new Error(error.message);

  const seenHashes = new Set<string>();
  let searchable = 0;
  let skipped = 0;

  for (const image of images ?? []) {
    const existingMetadata = metadataRecord(image.metadata);
    if (existingMetadata.image_policy_version === clinicalImagePolicyVersion) {
      if (image.searchable) searchable += 1;
      else skipped += 1;
      continue;
    }

    const download = await supabase.storage.from(env.SUPABASE_IMAGE_BUCKET).download(image.storage_path);
    if (download.error || !download.data) {
      await supabase
        .from("document_images")
        .update({ searchable: false, skip_reason: download.error?.message ?? "image unavailable in storage" })
        .eq("id", image.id);
      skipped += 1;
      continue;
    }

    const bytes = Buffer.from(await download.data.arrayBuffer());
    const imageHash = image.image_hash ?? hashBytes(bytes);
    const perceptualHash = lightweightPerceptualHash(imageHash, image.width, image.height);
    const filterImage = {
      bbox: normalizeImageBbox(image.bbox),
      width: image.width,
      height: image.height,
      pageNumber: typeof image.page_number === "number" ? image.page_number : undefined,
      sourceKind: image.source_kind as
        "embedded" | "table_crop" | "diagram_crop" | "page_region" | "fallback" | undefined,
    };
    const cheapSkip = cheapImageSkipReason({
      bytesLength: bytes.length,
      imageHash,
      seenHashes,
      image: filterImage,
    });

    if (cheapSkip) {
      await supabase
        .from("document_images")
        .update({
          searchable: false,
          skip_reason: cheapSkip,
          image_hash: imageHash,
          perceptual_hash: perceptualHash,
          clinical_relevance_score: 0,
        })
        .eq("id", image.id);
      skipped += 1;
      continue;
    }
    const placementKey = imagePlacementDedupeKey({ imageHash, image: filterImage });
    if (placementKey) seenHashes.add(placementKey);

    const baseAssessment = assessClinicalImageUse({
      imageType: image.image_type,
      searchable: image.searchable,
      clinicalRelevanceScore: image.clinical_relevance_score,
      sourceKind: image.source_kind,
      tableRole: metadataString(image.metadata, "table_role"),
      tableText: metadataString(image.metadata, "table_text"),
      tableTitle: metadataString(image.metadata, "table_title"),
      tableLabel: metadataString(image.metadata, "table_label"),
      caption: image.caption,
      labels: Array.isArray(image.labels) ? image.labels : [],
      skipReason: image.skip_reason,
    });
    const classification =
      image.source_kind === "table_crop" && ["administrative", "reference"].includes(baseAssessment.clinical_use_class)
        ? {
            image_type: image.image_type || "clinical_table",
            searchable: false,
            clinical_relevance_score: 0,
            labels: [],
            caption:
              baseAssessment.clinical_use_class === "administrative"
                ? "Administrative document-control table retained for audit, not clinical evidence."
                : "Reference table retained for audit, not clinical evidence.",
            skip_reason: baseAssessment.clinical_use_reason,
            clinical_use_class: baseAssessment.clinical_use_class,
            clinical_use_reason: baseAssessment.clinical_use_reason,
            clinical_signal_score: baseAssessment.clinical_signal_score,
            admin_signal_score: baseAssessment.admin_signal_score,
          }
        : await classifyAndCaptionImageFromBase64({
            base64: bytes.toString("base64"),
            mimeType: image.mime_type,
            nearbyText: image.caption ?? undefined,
            sourceKind: image.source_kind,
            candidateType: metadataString(image.metadata, "candidate_type"),
            tableLabel: metadataString(image.metadata, "table_label"),
            tableTitle: metadataString(image.metadata, "table_title"),
            tableRole: metadataString(image.metadata, "table_role"),
            tableText: metadataString(image.metadata, "table_text"),
          });
    const finalAssessment = assessClinicalImageUse({
      imageType: classification.image_type,
      searchable: classification.searchable,
      clinicalRelevanceScore: classification.clinical_relevance_score,
      sourceKind: image.source_kind,
      tableRole: metadataString(image.metadata, "table_role"),
      tableText: metadataString(image.metadata, "table_text"),
      tableTitle: metadataString(image.metadata, "table_title"),
      tableLabel: metadataString(image.metadata, "table_label"),
      caption: classification.caption,
      labels: classification.labels,
      skipReason: classification.skip_reason,
    });
    const classifiedSkip = classifiedImageSkipReason({
      ...classification,
      searchable: finalAssessment.searchable,
      clinical_relevance_score: finalAssessment.clinical_relevance_score,
      clinical_use_class: finalAssessment.clinical_use_class,
      clinical_use_reason: finalAssessment.clinical_use_reason,
      clinical_signal_score: finalAssessment.clinical_signal_score,
      admin_signal_score: finalAssessment.admin_signal_score,
    } as Parameters<typeof classifiedImageSkipReason>[0]);
    const retainAsAuditTable =
      image.source_kind === "table_crop" &&
      ["administrative", "reference"].includes(finalAssessment.clinical_use_class) &&
      classification.image_type !== "logo_decorative";
    const nextSearchable = finalAssessment.searchable;

    await supabase
      .from("document_images")
      .update({
        caption: classification.caption || image.caption,
        image_type: classification.image_type,
        searchable: nextSearchable,
        clinical_relevance_score: nextSearchable ? finalAssessment.clinical_relevance_score : 0,
        skip_reason: nextSearchable ? null : classifiedSkip,
        image_hash: imageHash,
        perceptual_hash: perceptualHash,
        labels: classification.labels,
        metadata: {
          ...metadataRecord(image.metadata),
          clinical_use_class: finalAssessment.clinical_use_class,
          clinical_use_reason: finalAssessment.clinical_use_reason,
          clinical_signal_score: finalAssessment.clinical_signal_score,
          admin_signal_score: finalAssessment.admin_signal_score,
          image_policy_version: clinicalImagePolicyVersion,
          retained_for_audit: retainAsAuditTable || undefined,
          retained_for_document_view: retainAsAuditTable || undefined,
        },
      })
      .eq("id", image.id);

    if (!nextSearchable) skipped += 1;
    else searchable += 1;
  }

  return { searchable, skipped, total: images?.length ?? 0 };
}

async function stampExistingEnrichmentVersion(args: {
  supabase: SupabaseAdmin;
  document: { id: string; metadata?: unknown };
  coverage: { summary?: MetadataRow; labels: MetadataRow[] };
  ragEnrichmentVersion: string;
}) {
  const stampedAt = new Date().toISOString();
  const marker = {
    rag_enrichment_version: args.ragEnrichmentVersion,
    rag_enrichment_updated_at: stampedAt,
    version_stamped_at: stampedAt,
  };

  const { error: documentError } = await args.supabase
    .from("documents")
    .update({ metadata: { ...metadataRecord(args.document.metadata), ...marker } })
    .eq("id", args.document.id);
  if (documentError) throw new Error(documentError.message);

  if (args.coverage.summary) {
    const { error: summaryError } = await args.supabase
      .from("document_summaries")
      .update({ metadata: { ...metadataRecord(args.coverage.summary.metadata), ...marker } })
      .eq("document_id", args.document.id);
    if (summaryError) throw new Error(summaryError.message);
  }

  for (const label of args.coverage.labels.filter((item) => item.source === "generated")) {
    if (!label.id) continue;
    const { error: labelError } = await args.supabase
      .from("document_labels")
      .update({ metadata: { ...metadataRecord(label.metadata), ...marker } })
      .eq("id", label.id);
    if (labelError) throw new Error(labelError.message);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.ownerId && !args.ownerEmail && !args.allOwners) {
    throw new Error(
      'Provide --owner-id, set LOCAL_NO_AUTH_OWNER_ID or RAG_EVAL_OWNER_ID, provide --owner-email "you@example.com", or pass --all-owners.',
    );
  }
  if (!["summaries-labels-images", "metadata-stamp", "deep-memory"].includes(args.mode)) {
    throw new Error("--mode supports summaries-labels-images, deep-memory, or metadata-stamp.");
  }

  const [
    { requireOpenAIEnv, requireServerEnv },
    { assertSourceAnchoredSummaryPreflight, ragEnrichmentVersion, upsertDocumentEnrichment },
    { ragDeepMemoryVersion, upsertDocumentDeepMemory },
    supabase,
  ] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/document-enrichment"),
    import("@/lib/deep-memory"),
    loadAdminClient(),
  ]);
  requireServerEnv();
  if (args.mode === "summaries-labels-images" || args.mode === "deep-memory") requireOpenAIEnv();

  const ownerId =
    !args.allOwners && args.ownerId
      ? args.ownerId
      : args.ownerEmail && !args.allOwners
        ? await findOwnerIdByEmail(supabase, args.ownerEmail)
        : undefined;
  const loadedDocuments = await loadDocuments(supabase, args, ownerId);
  const coverage = await loadEnrichmentCoverage(
    supabase,
    loadedDocuments.map((document) => document.id),
  );
  const memoryCoverage = await loadDeepMemoryCoverage(
    supabase,
    loadedDocuments.map((document) => document.id),
  );
  const documents = loadedDocuments
    .filter((document) =>
      args.includeCurrent
        ? true
        : needsEnrichmentBackfill({
            document,
            coverage: coverage.get(document.id),
            memoryCoverage: memoryCoverage.get(document.id),
            ragEnrichmentVersion,
            ragDeepMemoryVersion,
          }),
    )
    .slice(0, args.limit);

  console.log(
    `Enriching ${documents.length} indexed document(s). scope=${ownerId ? "owner" : "all"} version=${ragEnrichmentVersion}`,
  );

  let completed = 0;
  const CONCURRENCY = 1;
  const activeTasks = new Set<Promise<void>>();

  for (const document of documents) {
    const documentCoverage = coverage.get(document.id);
    const taskPromise = (async () => {
      let attempts = 0;
      const maxAttempts = 6;
      let success = false;

      while (attempts < maxAttempts && !success) {
        try {
          if (args.mode === "metadata-stamp") {
            if (!documentCoverage?.summary || documentCoverage.labels.every((label) => label.source !== "generated")) {
              console.log(`SKIP cannot metadata-stamp missing enrichment: ${document.file_name}`);
              return;
            }
            await stampExistingEnrichmentVersion({
              supabase,
              document,
              coverage: documentCoverage,
              ragEnrichmentVersion,
            });
            completed += 1;
            console.log(`STAMPED ${document.file_name}`);
            return;
          }

          const indexGenerationId = requireExactSourceAnchoredGeneration(
            document.index_generation_id,
            document.metadata,
          );
          const evidence = await loadEvidence(supabase, document.id, indexGenerationId);
          assertSourceAnchoredSummaryPreflight({
            documentMetadata: document.metadata,
            indexGenerationId,
            chunks: evidence.chunks,
            images: evidence.images,
          });

          let imageMetadata = metadataRecord(document.metadata);
          let imageStats = { searchable: 0, skipped: 0, total: 0 };
          if (args.mode === "summaries-labels-images") {
            imageStats = await classifyExistingImages(supabase, document.id);
            imageMetadata = {
              ...imageMetadata,
              searchable_image_count: imageStats.searchable,
              skipped_image_count: imageStats.skipped,
              image_enriched_at: new Date().toISOString(),
            };
            await supabase
              .from("documents")
              .update({
                image_count: imageStats.searchable,
                metadata: imageMetadata as Json,
              })
              .eq("id", document.id);
          }

          let enrichmentSummary: string | null = null;
          if (args.mode === "summaries-labels-images") {
            const enrichment = await upsertDocumentEnrichment({
              supabase,
              document: { ...document, metadata: imageMetadata },
              indexGenerationId,
              chunks: evidence.chunks,
              images: evidence.images,
            });
            enrichmentSummary = enrichment.summary.summary;
          } else if (args.mode === "deep-memory") {
            const { data: sumData } = await supabase
              .from("document_summaries")
              .select("summary")
              .eq("document_id", document.id)
              .maybeSingle();
            if (sumData?.summary) {
              enrichmentSummary = sumData.summary;
            }
          }
          const deepMemory = await upsertDocumentDeepMemory({
            supabase,
            document: { ...document, metadata: imageMetadata },
            chunks: evidence.chunks as unknown as Parameters<typeof upsertDocumentDeepMemory>[0]["chunks"],
            images: evidence.images as unknown as Parameters<typeof upsertDocumentDeepMemory>[0]["images"],
            summary: enrichmentSummary,
          });
          const { data: latestDoc } = await supabase
            .from("documents")
            .select("metadata")
            .eq("id", document.id)
            .single();
          const latestMetadata = metadataRecord(latestDoc?.metadata);
          await supabase
            .from("documents")
            .update({
              metadata: {
                ...latestMetadata,
                enrichment_status: "completed",
                enrichment_error: null,
              },
            })
            .eq("id", document.id);

          completed += 1;
          console.log(
            `ENRICHED ${document.file_name} chunks=${evidence.chunks.length} sections=${deepMemory.sections.length} memory=${deepMemory.memoryCards.length} images=${imageStats.searchable}/${imageStats.total} skipped=${imageStats.skipped}`,
          );
          success = true;

          // Small delay to space out OpenAI calls
          await new Promise((resolve) => setTimeout(resolve, 1500));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const isRateLimit = /rate limit|rate_limit|429/i.test(errorMessage);

          if (isRateLimit && attempts < maxAttempts - 1) {
            attempts += 1;
            const delayMs = Math.pow(2, attempts) * 8000 + Math.random() * 3000;
            console.warn(
              `Rate limit hit on ${document.file_name}. Waiting ${Math.round(delayMs / 1000)}s before retry ${attempts}/${maxAttempts}...`,
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          } else {
            console.error(`ERROR enriching ${document.file_name}:`, errorMessage);
            break; // Break the retry loop for non-rate-limit errors
          }
        }
      }
    })();

    activeTasks.add(taskPromise);
    taskPromise.then(() => activeTasks.delete(taskPromise));
    if (activeTasks.size >= CONCURRENCY) {
      await Promise.race(activeTasks);
    }
  }

  await Promise.all(activeTasks);

  console.log(`Enrichment complete. completed=${completed} skipped=${documents.length - completed}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
