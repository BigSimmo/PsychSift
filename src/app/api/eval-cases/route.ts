import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeApiRateLimit, rateLimitJsonResponse } from "@/lib/api-rate-limit";
import { normalizedClinicalSearchTokens } from "@/lib/clinical-search";
import { clinicalQueryModeSchema } from "@/lib/clinical-query-mode";
import { env, isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse, PublicApiError } from "@/lib/http";
import {
  answerPrivacyMetadata,
  answerTextForStorage,
  normalizedQueryTextForStorage,
  queryDerivedTokensForStorage,
  queryPrivacyMetadata,
  queryTextForStorage,
} from "@/lib/query-privacy";
import { searchScopeFiltersSchema } from "@/lib/search-scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { withOwnerReadScope } from "@/lib/public-api-access";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

const evalCaptureSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  rating: z.enum(["good", "needs_fixing"]).optional(),
  feedbackType: z
    .enum([
      "verified",
      "needs_correction",
      "source_insufficient",
      "wrong_source",
      "missing_source",
      "unsupported_answer",
      "numeric_error",
      "outdated_guidance",
    ])
    .optional(),
  note: z.string().trim().max(1000).optional().default(""),
  answer: z.string().trim().max(12000).optional().default(""),
  queryMode: clinicalQueryModeSchema.optional().default("auto"),
  queryClass: z
    .enum([
      "document_lookup",
      "table_threshold",
      "medication_dose_risk",
      "comparison",
      "broad_summary",
      "unsupported_or_general",
    ])
    .optional(),
  filters: searchScopeFiltersSchema.optional(),
  sourceChunkIds: z.array(z.string().trim().min(1)).max(80).optional().default([]),
  citedChunkIds: z.array(z.string().trim().min(1)).max(80).optional().default([]),
  sourceFiles: z.array(z.string().trim().min(1).max(512)).max(20).optional().default([]),
  sourceGovernanceWarnings: z.array(z.string().trim().min(1).max(300)).max(20).optional().default([]),
  unverifiedNumericTokens: z.array(z.string().trim().min(1).max(80)).max(40).optional().default([]),
  expectedDocumentId: z.string().uuid().optional(),
  expectedChunkId: z.string().uuid().optional(),
});

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function uniqueUuidValues(values: string[]) {
  return uniqueValues(values).filter((value) => uuidPattern.test(value));
}

function feedbackRating(data: z.infer<typeof evalCaptureSchema>) {
  if (data.rating) return data.rating;
  return data.feedbackType === "verified" ? "good" : "needs_fixing";
}

function missReasonFor(data: z.infer<typeof evalCaptureSchema>, rating: "good" | "needs_fixing") {
  if (data.feedbackType === "verified" || rating === "good") return "answer_good_eval";
  if (data.feedbackType) return data.feedbackType;
  return "answer_needs_fixing";
}

/**
 * Document checks here use the caller's read scope (owned rows plus the published public corpus),
 * not ownership alone: published documents carry `owner_id` null and most answers cite them, so
 * an ownership-only check dropped the ground truth from nearly every captured case.
 */
async function readableDocumentId(args: {
  supabase: ReturnType<typeof createAdminClient>;
  ownerId: string;
  documentId: string | undefined;
}) {
  if (!args.documentId) return null;
  const { data, error } = await withOwnerReadScope(
    args.supabase.from("documents").select("id").eq("id", args.documentId),
    args.ownerId,
  ).maybeSingle();
  if (error) throw new Error(error.message);
  return typeof data?.id === "string" ? data.id : null;
}

async function readableChunkReference(args: {
  supabase: ReturnType<typeof createAdminClient>;
  ownerId: string;
  chunkId: string | null | undefined;
}) {
  if (!args.chunkId) return null;
  const { data: chunk, error: chunkError } = await args.supabase
    .from("document_chunks")
    .select("id,document_id")
    .eq("id", args.chunkId)
    .maybeSingle();
  if (chunkError) throw new Error(chunkError.message);
  const documentId = typeof chunk?.document_id === "string" ? chunk.document_id : null;
  if (!documentId) return null;
  const validatedDocumentId = await readableDocumentId({
    supabase: args.supabase,
    ownerId: args.ownerId,
    documentId,
  });
  return validatedDocumentId ? { id: args.chunkId, documentId: validatedDocumentId } : null;
}

/**
 * Keeps only the chunk ids whose parent document the caller can read (owned or public corpus).
 *
 * `top_chunk_ids` / `cited_chunk_ids` were previously stored on shape alone, so a promoted eval
 * case could point at chunks the owner cannot read, or at nothing at all — input the offline eval
 * loader then treats as ground truth. Two batched reads (chunks, then their documents) rather than
 * one lookup per id, so an 80-id capture stays two round trips.
 */
async function readableChunkIdSet(args: {
  supabase: ReturnType<typeof createAdminClient>;
  ownerId: string;
  chunkIds: string[];
}): Promise<Set<string>> {
  if (args.chunkIds.length === 0) return new Set();
  const { data: chunks, error: chunkError } = await args.supabase
    .from("document_chunks")
    .select("id,document_id")
    .in("id", args.chunkIds);
  if (chunkError) throw new Error(chunkError.message);

  const chunkRows = (chunks ?? []) as Array<{ id?: unknown; document_id?: unknown }>;
  const documentIds = Array.from(
    new Set(chunkRows.map((row) => row.document_id).filter((id): id is string => typeof id === "string" && id !== "")),
  );
  if (documentIds.length === 0) return new Set();

  const { data: documents, error: documentError } = await withOwnerReadScope(
    args.supabase.from("documents").select("id").in("id", documentIds),
    args.ownerId,
  );
  if (documentError) throw new Error(documentError.message);

  const readableDocumentIds = new Set(
    ((documents ?? []) as Array<{ id?: unknown }>)
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string"),
  );
  return new Set(
    chunkRows
      .filter((row) => typeof row.document_id === "string" && readableDocumentIds.has(row.document_id))
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string"),
  );
}

/** Keeps only the file names carried by a document the caller can read (same rule, one batched read). */
async function readableFileNameSet(args: {
  supabase: ReturnType<typeof createAdminClient>;
  ownerId: string;
  fileNames: string[];
}): Promise<Set<string>> {
  if (args.fileNames.length === 0) return new Set();
  const { data, error } = await withOwnerReadScope(
    args.supabase.from("documents").select("file_name").in("file_name", args.fileNames),
    args.ownerId,
  );
  if (error) throw new Error(error.message);
  return new Set(
    ((data ?? []) as Array<{ file_name?: unknown }>)
      .map((row) => row.file_name)
      .filter((name): name is string => typeof name === "string"),
  );
}

export async function POST(request: Request) {
  try {
    if (isDemoMode())
      return publicErrorResponse("Eval capture is unavailable in demo mode.", 400, { code: "demo_mode_unavailable" });

    const parsed = await parseJsonBody(request, evalCaptureSchema, "Eval capture payload is invalid.");

    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase, { administrator: true });

    const rateLimit = await consumeApiRateLimit({
      supabase,
      ownerId: user.id,
      bucket: "ingestion_admin",
      allowInMemoryFallbackOnUnavailable: true,
    });
    if (rateLimit.limited) {
      return rateLimitJsonResponse("Too many ingestion administration requests. Retry shortly.", rateLimit);
    }

    const normalizedQuery = normalizedQueryTextForStorage(parsed.query);
    // Shape first, then read access: an id the caller cannot read is rejected exactly like a
    // malformed one, and both are counted in the same rejected tallies below.
    const wellFormedSourceChunkIds = uniqueUuidValues(parsed.sourceChunkIds);
    const wellFormedCitedChunkIds = uniqueUuidValues(parsed.citedChunkIds);
    const wellFormedSourceFiles = uniqueValues(parsed.sourceFiles);
    const readableChunkIds = await readableChunkIdSet({
      supabase,
      ownerId: user.id,
      chunkIds: Array.from(new Set([...wellFormedSourceChunkIds, ...wellFormedCitedChunkIds])),
    });
    const readableFileNames = await readableFileNameSet({
      supabase,
      ownerId: user.id,
      fileNames: wellFormedSourceFiles,
    });
    const sourceChunkIds = wellFormedSourceChunkIds.filter((id) => readableChunkIds.has(id));
    const citedChunkIds = wellFormedCitedChunkIds.filter((id) => readableChunkIds.has(id));
    const sourceFiles = wellFormedSourceFiles.filter((fileName) => readableFileNames.has(fileName));
    const rating = feedbackRating(parsed);
    const missReason = missReasonFor(parsed, rating);
    const expectedDocumentId = await readableDocumentId({
      supabase,
      ownerId: user.id,
      documentId: parsed.expectedDocumentId,
    });
    const expectedChunkCandidate = parsed.expectedChunkId ?? citedChunkIds[0] ?? sourceChunkIds[0] ?? null;
    const expectedChunk = await readableChunkReference({
      supabase,
      ownerId: user.id,
      chunkId: expectedChunkCandidate,
    });
    const expectedChunkId =
      expectedChunk && (!expectedDocumentId || expectedChunk.documentId === expectedDocumentId)
        ? expectedChunk.id
        : null;
    const { data, error } = await supabase
      .from("rag_query_misses")
      .insert({
        owner_id: user.id,
        query: queryTextForStorage(parsed.query),
        normalized_query: normalizedQuery,
        query_class: parsed.queryClass ?? parsed.queryMode,
        top_files: sourceFiles,
        top_chunk_ids: sourceChunkIds,
        cited_chunk_ids: citedChunkIds,
        miss_reason: missReason,
        expected_document_id: expectedDocumentId,
        expected_chunk_id: expectedChunkId,
        candidate_aliases: queryDerivedTokensForStorage(
          normalizedClinicalSearchTokens(parsed.query).slice(0, 12),
          parsed.query,
        ),
        promoted_eval_case: true,
        promoted_at: new Date().toISOString(),
        metadata: {
          interaction: "answer_eval_capture",
          rating,
          feedback_type: parsed.feedbackType ?? null,
          note: env.RAG_PERSIST_RAW_QUERY_TEXT ? parsed.note : null,
          // PIA-3: the promoted answer is generated clinical text — gate it on the
          // dedicated answer-retention flag, not the raw-query flag, so one switch
          // governs answer-text persistence everywhere.
          answer: answerTextForStorage(parsed.answer),
          query_class: parsed.queryClass ?? null,
          query_mode: parsed.queryMode,
          filters: parsed.filters ?? {},
          source_governance_warnings: parsed.sourceGovernanceWarnings,
          unverified_numeric_tokens: parsed.unverifiedNumericTokens,
          source_chunk_ids_rejected: parsed.sourceChunkIds.length - sourceChunkIds.length,
          cited_chunk_ids_rejected: parsed.citedChunkIds.length - citedChunkIds.length,
          top_files_rejected: parsed.sourceFiles.length - sourceFiles.length,
          captured_at: new Date().toISOString(),
          ...queryPrivacyMetadata(parsed.query),
          ...answerPrivacyMetadata(),
        },
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    if (error instanceof PublicApiError) return jsonError(error, error.status);
    return jsonError(error, 500);
  }
}
