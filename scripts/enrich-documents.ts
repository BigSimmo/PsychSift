import { loadEnvConfig } from "@next/env";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/lib/supabase/database.types";
import { createHash } from "node:crypto";
import { type EnrichArgs, parseEnrichArgs } from "./lib/enrich-documents-args";
import { findOwnerIdByEmail } from "./lib/find-owner-id-by-email";

loadEnvConfig(process.cwd());

type SupabaseAdmin = Awaited<ReturnType<typeof loadAdminClient>>;
type MetadataRow = { id?: string; document_id: string; metadata?: unknown; source?: string | null };

async function loadAdminClient() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

async function loadDocuments(supabase: SupabaseAdmin, args: EnrichArgs, ownerId?: string) {
  let query = supabase
    .from("documents")
    .select("id,owner_id,title,file_name,source_path,status,metadata")
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

async function loadEvidence(supabase: SupabaseAdmin, documentId: string) {
  const chunks: Array<{
    id: string;
    document_id: string;
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
    page_number: number | null;
    caption: string;
    image_type: string;
    labels: string[];
    source_kind: string;
    clinical_relevance_score: number;
    metadata: Record<string, unknown> | null;
  }> = [];

  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from("document_chunks")
      .select(
        "id,document_id,page_number,chunk_index,section_heading,section_path,anchor_id,content,image_ids,metadata",
      )
      .eq("document_id", documentId)
      .order("chunk_index", { ascending: true })
      .range(start, start + 999);
    if (error) throw new Error(error.message);
    chunks.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from("document_images")
      .select("id,page_number,caption,image_type,labels,source_kind,clinical_relevance_score,metadata")
      .eq("document_id", documentId)
      .eq("searchable", true)
      .order("clinical_relevance_score", { ascending: false })
      .range(start, start + 999);
    if (error) throw new Error(error.message);
    images.push(...(data ?? []));
    if (!data || data.length < 1000) break;
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
      const { error: skipError } = await supabase
        .from("document_images")
        .update({ searchable: false, skip_reason: download.error?.message ?? "image unavailable in storage" })
        .eq("id", image.id);
      if (skipError) throw new Error(skipError.message);
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
      const { error: cheapSkipError } = await supabase
        .from("document_images")
        .update({
          searchable: false,
          skip_reason: cheapSkip,
          image_hash: imageHash,
          perceptual_hash: perceptualHash,
          clinical_relevance_score: 0,
        })
        .eq("id", image.id);
      if (cheapSkipError) throw new Error(cheapSkipError.message);
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

    const { error: imageUpdateError } = await supabase
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
    if (imageUpdateError) throw new Error(imageUpdateError.message);

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
  const args = parseEnrichArgs(process.argv.slice(2));

  // Confirm the target project before any client exists: this script writes through the
  // service-role key, so a stale or mismatched .env.local must stop it here.
  const { checkSupabaseProjectConfig, expectedSupabaseProject, formatSupabaseProjectCheck } =
    await import("@/lib/supabase/project");
  const projectCheck = checkSupabaseProjectConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_PROJECT_REF: process.env.SUPABASE_PROJECT_REF,
    SUPABASE_PROJECT_NAME: process.env.SUPABASE_PROJECT_NAME,
  });
  if (projectCheck.status === "missing" || projectCheck.status === "mismatch") {
    throw new Error(`Project check failed: ${formatSupabaseProjectCheck(projectCheck)}`);
  }
  console.log(`Project: ${expectedSupabaseProject.name} (${expectedSupabaseProject.ref})`);

  const [
    { requireOpenAIEnv, requireServerEnv },
    { ragEnrichmentVersion, upsertDocumentEnrichment },
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
        ? await findOwnerIdByEmail(supabase, args.ownerEmail, { purpose: "enriching documents" })
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
    `${args.write ? "Enriching" : "DRY RUN — would enrich"} ${documents.length} indexed document(s). scope=${ownerId ? "owner" : "all"} mode=${args.mode} version=${ragEnrichmentVersion}`,
  );

  if (!args.write) {
    for (const document of documents) console.log(`  WOULD ENRICH ${document.file_name} (${document.id})`);
    console.log("\nNo writes performed and no OpenAI call made. Re-run with --write to persist enrichment.");
    return;
  }

  let completed = 0;
  let failed = 0;
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
            const { error: imageCountError } = await supabase
              .from("documents")
              .update({
                image_count: imageStats.searchable,
                metadata: imageMetadata as Json,
              })
              .eq("id", document.id);
            if (imageCountError) throw new Error(imageCountError.message);
          }

          const evidence = await loadEvidence(supabase, document.id);
          if (evidence.chunks.length === 0) {
            console.log(`SKIP no chunks: ${document.file_name}`);
            return;
          }

          let enrichmentSummary: string | null = null;
          if (args.mode === "summaries-labels-images") {
            const enrichment = await upsertDocumentEnrichment({
              supabase,
              document: { ...document, metadata: imageMetadata },
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
          // A failed read would leave latestMetadata empty, and the write below would then replace
          // the document's whole metadata with only the status fields.
          const { data: latestDoc, error: latestDocError } = await supabase
            .from("documents")
            .select("metadata")
            .eq("id", document.id)
            .single();
          if (latestDocError) throw new Error(latestDocError.message);
          const latestMetadata = metadataRecord(latestDoc?.metadata);
          const { error: statusError } = await supabase
            .from("documents")
            .update({
              metadata: {
                ...latestMetadata,
                enrichment_status: "completed",
                enrichment_error: null,
              },
            })
            .eq("id", document.id);
          if (statusError) throw new Error(statusError.message);

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
            failed += 1;
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

  console.log(
    `Enrichment complete. completed=${completed} failed=${failed} skipped=${documents.length - completed - failed}`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
