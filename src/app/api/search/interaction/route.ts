import { NextResponse } from "next/server";
import { z } from "zod";
import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { normalizedClinicalSearchTokens } from "@/lib/clinical-search";
import { isDemoMode } from "@/lib/env";
import { jsonError } from "@/lib/http";
import {
  normalizedQueryTextForStorage,
  queryDerivedTokensForStorage,
  queryPrivacyMetadata,
  queryTextForStorage,
} from "@/lib/query-privacy";
import { createAdminClient } from "@/lib/supabase/admin";
import * as serverAuth from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

const crossModeTargetSchema = z.object({
  mode: z.enum(["prescribing", "services", "forms", "differentials"]),
  slug: z.string().trim().min(1).max(160),
  title: z.string().trim().max(240).optional(),
});

const interactionSchema = z
  .object({
    query: z.string().trim().min(1).max(2000),
    documentId: z.string().uuid().optional(),
    chunkId: z.string().uuid().optional(),
    fileName: z.string().trim().max(240).optional(),
    title: z.string().trim().max(240).optional(),
    queryClass: z.string().trim().max(80).optional(),
    crossMode: crossModeTargetSchema.optional(),
    citationTelemetry: z
      .object({
        provenance: z
          .enum([
            "model_selected",
            "section_selected",
            "exact_quote",
            "deterministic_support",
            "review_only",
            "retrieval_only",
          ])
          .optional(),
        source_strength: z.enum(["strong", "moderate", "limited"]).optional(),
        similarity: z.number().min(0).max(1).optional(),
        document_status: z.string().trim().max(80).optional(),
      })
      .strict()
      .optional(),
  })
  .refine((body) => Boolean(body.documentId || body.crossMode), {
    message: "Either documentId or a crossMode target is required.",
  });

function safeTelemetryText(value: string | undefined) {
  const cleaned = value
    ?.replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

async function ownedDocumentExists(args: {
  supabase: ReturnType<typeof createAdminClient>;
  ownerId: string;
  documentId: string;
}) {
  const { data, error } = await args.supabase
    .from("documents")
    .select("id")
    .eq("id", args.documentId)
    .eq("owner_id", args.ownerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.id);
}

async function ownedChunkExists(args: {
  supabase: ReturnType<typeof createAdminClient>;
  documentId: string;
  chunkId: string | undefined;
}) {
  if (!args.chunkId) return false;
  const { data, error } = await args.supabase
    .from("document_chunks")
    .select("id")
    .eq("id", args.chunkId)
    .eq("document_id", args.documentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.id);
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request, interactionSchema, "Invalid interaction request.");
    if (isDemoMode()) {
      return NextResponse.json({ ok: true });
    }

    const supabase = createAdminClient();
    // Carry the authenticated owner through so the miss row is attributable and
    // owner-cleanable instead of being orphaned with owner_id: null (RET-H4).
    const user = await serverAuth.requireAuthenticatedUser(request, supabase);
    const shouldRateLimit =
      typeof (supabase as { rpc?: unknown })?.rpc === "function" ||
      Boolean((consumeSubjectApiRateLimit as unknown as { mock?: unknown })?.mock);
    if (shouldRateLimit) {
      const rateLimit = await consumeSubjectApiRateLimit({
        supabase,
        subject: { kind: "owner", ownerId: user.id },
        bucket: "search",
        allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
      });
      if (rateLimit.limited) {
        return rateLimitJsonResponse("Search interaction requests are rate limited. Try again shortly.", rateLimit);
      }
    }

    // Cross-mode link clicks reference registry/medication slugs, not owned
    // documents; store the same privacy-hardened miss row with the target in
    // metadata so retrieval-quality reviews can see which modes get used.
    if (!body.documentId) {
      const target = body.crossMode!;
      const { error: insertError } = await supabase.from("rag_query_misses").insert({
        owner_id: user.id,
        query: queryTextForStorage(body.query),
        normalized_query: normalizedQueryTextForStorage(body.query),
        query_class: body.queryClass ?? null,
        clicked_document_id: null,
        clicked_chunk_id: null,
        top_files: [],
        top_chunk_ids: [],
        miss_reason: "clicked_result",
        candidate_aliases: queryDerivedTokensForStorage(
          normalizedClinicalSearchTokens(body.query).slice(0, 10),
          body.query,
        ),
        candidate_labels: [
          {
            label: safeTelemetryText(target.title) ?? target.slug,
            label_type: "cross_mode_target",
            document_id: null,
            confidence: 1,
          },
        ],
        metadata: {
          interaction: "cross_mode_link_open",
          cross_mode_target: target.mode,
          cross_mode_slug: target.slug,
          ...queryPrivacyMetadata(body.query),
        },
      });
      if (insertError) throw new Error(insertError.message);
      return NextResponse.json({ ok: true });
    }

    const hasOwnedDocument = await ownedDocumentExists({ supabase, ownerId: user.id, documentId: body.documentId });
    const hasOwnedChunk = hasOwnedDocument
      ? await ownedChunkExists({ supabase, documentId: body.documentId, chunkId: body.chunkId })
      : false;
    const clickedDocumentId = hasOwnedDocument ? body.documentId : null;
    const clickedChunkId = hasOwnedChunk ? body.chunkId! : null;
    const safeFileName = clickedDocumentId ? safeTelemetryText(body.fileName) : null;
    const safeTitle = clickedDocumentId ? safeTelemetryText(body.title) : null;

    const { error: insertError } = await supabase.from("rag_query_misses").insert({
      owner_id: user.id,
      query: queryTextForStorage(body.query),
      normalized_query: normalizedQueryTextForStorage(body.query),
      query_class: body.queryClass ?? null,
      clicked_document_id: clickedDocumentId,
      clicked_chunk_id: clickedChunkId,
      top_files: safeFileName ? [safeFileName] : [],
      top_chunk_ids: clickedChunkId ? [clickedChunkId] : [],
      miss_reason: "clicked_result",
      candidate_aliases: queryDerivedTokensForStorage(
        normalizedClinicalSearchTokens(body.query).slice(0, 10),
        body.query,
      ),
      candidate_labels: safeTitle
        ? [
            {
              label: safeTitle,
              label_type: "document_type",
              document_id: clickedDocumentId,
              confidence: 0.6,
            },
          ]
        : [],
      metadata: {
        interaction: "source_open",
        ...queryPrivacyMetadata(body.query),
        ...(body.citationTelemetry && { citation_telemetry: body.citationTelemetry }),
      },
    });
    if (insertError) throw new Error(insertError.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof serverAuth.AuthenticationError) {
      return serverAuth.unauthorizedResponse(error);
    }
    return jsonError(error);
  }
}
