// Inline enrichment after the core index commits: read back the committed rows, then run
// document enrichment, document-level embedding fields and deep memory under the attempt.
// Moved from worker/main.ts; the runtime services arrive through IngestionStageContext.
import type { SupabaseClient } from "@supabase/supabase-js";
import { IngestionAttemptError, type IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import { env } from "../src/lib/env";
import { upsertDocumentEnrichment } from "../src/lib/document-enrichment";
import { upsertDocumentDeepMemory } from "../src/lib/deep-memory";
import { safeErrorLogDetails } from "../src/lib/privacy";
import { runIngestionEnrichmentStage } from "./behavior";
import { insertDocumentLevelEmbeddingFields, type insertEmbeddedChunks } from "./chunk-indexing";
import { buildIndexQualityPayload, type extractionMetrics } from "./index-quality-payload";
import type { OptionalIndexWriteIssue } from "./ingestion-errors";
import { sanitizeJsonbRecord } from "./ingestion-sanitize";
import type { IngestionStageContext } from "./ingestion-stage-context";
import { assertEnrichmentChunkRows, assertEnrichmentImageRows } from "./row-contracts";
import type { JobRow } from "./types";

async function loadEnrichmentRows(supabase: SupabaseClient, documentId: string, indexGenerationId: string) {
  const chunks: unknown[] = [];
  const images: unknown[] = [];
  const MAX_ENRICHMENT_CHUNKS = 5000;

  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from("document_chunks")
      .select(
        "id,document_id,index_generation_id,page_number,chunk_index,section_heading,section_path,heading_level,parent_heading,anchor_id,content,image_ids,metadata",
      )
      .eq("document_id", documentId)
      .eq("index_generation_id", indexGenerationId)
      .order("chunk_index", { ascending: true })
      .range(start, start + 999);
    if (error) throw new Error(error.message);
    chunks.push(...(data ?? []));
    if (chunks.length > MAX_ENRICHMENT_CHUNKS) {
      throw new Error(
        `Document ${documentId} exceeded maximum enrichment chunk limit of ${MAX_ENRICHMENT_CHUNKS}. Aborting enrichment to prevent memory exhaustion.`,
      );
    }
    if (!data || data.length < 1000) break;
  }

  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from("document_images")
      .select(
        "id,document_id,index_generation_id,page_number,caption,image_type,labels,source_kind,clinical_relevance_score,metadata",
      )
      .eq("document_id", documentId)
      .eq("index_generation_id", indexGenerationId)
      .eq("searchable", true)
      .order("clinical_relevance_score", { ascending: false })
      .range(start, start + 999);
    if (error) throw new Error(error.message);
    images.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  // #212 T4: these read-backs feed upsertDocumentEnrichment and upsertDocumentDeepMemory,
  // which previously received them through unchecked parameter casts. A contract throw is
  // contained by the inline-enrichment try in processJob: enrichment is marked failed, the
  // job still completes, and repair is queued â€” record-and-skip, never a retry loop.
  assertEnrichmentChunkRows(chunks, { documentId, indexGenerationId });
  assertEnrichmentImageRows(images, { documentId, indexGenerationId });
  return { chunks, images };
}

/**
 * Inline (WORKER_INLINE_ENRICHMENT) enrichment after the core generation commits. Moved from
 * processJob in worker/main.ts. A failed enrichment is recorded and contained here; the
 * returned state carries whatever the stage had set before it failed, exactly as the
 * processJob locals did.
 */
export async function runInlineEnrichmentStage(
  ctx: IngestionStageContext,
  args: {
    job: JobRow;
    attempt: IngestionAttempt;
    indexGenerationId: string;
    indexedChunkRows: Awaited<ReturnType<typeof insertEmbeddedChunks>>["indexedChunkRows"];
    metrics: ReturnType<typeof extractionMetrics>;
    chunks: Awaited<ReturnType<typeof insertEmbeddedChunks>>["chunks"];
    insertedImages: Awaited<ReturnType<typeof insertEmbeddedChunks>>["insertedImages"];
    optionalIndexWriteIssues: OptionalIndexWriteIssue[];
    initialQuality: ReturnType<typeof buildIndexQualityPayload>;
  },
) {
  const { supabase, mutation, providerContextForJob, updateJob, updateJobProgress } = ctx;
  const {
    job,
    attempt,
    indexGenerationId,
    indexedChunkRows,
    metrics,
    chunks,
    insertedImages,
    optionalIndexWriteIssues,
  } = args;
  const state: {
    enrichmentStatus: string;
    enrichmentErrorMessage: string | null;
    finalQuality: ReturnType<typeof buildIndexQualityPayload>;
    sectionCount: number;
    memoryCardCount: number;
    enrichmentUpdatedAt: string | null;
  } = {
    enrichmentStatus: env.WORKER_INLINE_ENRICHMENT ? "completed" : "pending",
    enrichmentErrorMessage: null,
    finalQuality: args.initialQuality,
    sectionCount: 0,
    memoryCardCount: 0,
    enrichmentUpdatedAt: null,
  };
  let documentEmbeddingFieldTypes: string[] = [];

  if (env.WORKER_INLINE_ENRICHMENT) {
    await updateJobProgress(job.id, { stage: "enriching indexed document", progress: 96 });
    const enrichmentOutcome = await runIngestionEnrichmentStage(attempt, async () => {
      const enrichmentRows = await loadEnrichmentRows(supabase, job.document_id, indexGenerationId);
      const { data: liveDocument, error: liveError } = await supabase
        .from("documents")
        .select("id,owner_id,title,file_name,source_path,metadata,index_generation_id")
        .eq("id", job.document_id)
        .single();
      attempt.check();
      if (liveError) throw new Error(liveError.message);
      if (!liveDocument || liveDocument.index_generation_id !== indexGenerationId) {
        attempt.cancel();
        throw new IngestionAttemptError("lease_lost");
      }
      // Callee mutations share the exact same serialization tail as heartbeat and handoff.
      const enrichmentClient: SupabaseClient = Object.create(supabase);
      enrichmentClient.rpc = ((name: string, payload: Record<string, unknown>) =>
        mutation(attempt, name, payload).then((data) => ({
          data,
          error: null,
        }))) as unknown as SupabaseClient["rpc"];
      const enrichment = await upsertDocumentEnrichment({
        indexGenerationId,
        supabase: enrichmentClient,
        fence: attempt.fence,
        signal: attempt.signal,
        ingestionEgress: providerContextForJob(job),
        document: liveDocument,
        chunks: enrichmentRows.chunks,
        images: enrichmentRows.images,
      });
      documentEmbeddingFieldTypes = await insertDocumentLevelEmbeddingFields(ctx, {
        job,
        chunkRows: indexedChunkRows,
        summary: enrichment.summary.summary,
      });
      await updateJobProgress(job.id, { stage: "building structured memory", progress: 98 });
      const deepMemory = await upsertDocumentDeepMemory({
        supabase: enrichmentClient,
        fence: attempt.fence,
        signal: attempt.signal,
        ingestionEgress: providerContextForJob(job),
        document: liveDocument,
        chunks: enrichmentRows.chunks,
        images: enrichmentRows.images,
        summary: enrichment.summary.summary,
      });
      state.sectionCount = deepMemory.sections.length;
      state.memoryCardCount = deepMemory.memoryCards.length;
      state.finalQuality = buildIndexQualityPayload({
        job,
        metrics,
        chunks,
        insertedImages,
        sectionCount: state.sectionCount,
        memoryCardCount: state.memoryCardCount,
        documentEmbeddingFieldTypes,
        optionalIndexWriteIssues,
      });
      await upsertIndexQuality(ctx, state.finalQuality);
      state.enrichmentUpdatedAt = new Date().toISOString();
    });
    if (enrichmentOutcome.status === "failed") {
      const enrichmentError = enrichmentOutcome.error;
      state.enrichmentStatus = "failed";
      state.enrichmentErrorMessage =
        enrichmentError instanceof Error ? enrichmentError.message : String(enrichmentError);
      console.warn("Optional document enrichment failed", safeErrorLogDetails(enrichmentError));
    }
  } else {
    await updateJob(job.id, { stage: "core index complete; enrichment deferred", progress: 98 });
  }

  return state;
}

async function upsertIndexQuality(ctx: IngestionStageContext, quality: ReturnType<typeof buildIndexQualityPayload>) {
  await ctx.mutation(ctx.attemptForDocument(quality.document_id), "persist_ingestion_index_quality", {
    p_quality: sanitizeJsonbRecord(quality),
  });
}
