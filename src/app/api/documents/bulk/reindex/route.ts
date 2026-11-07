import { NextResponse } from "next/server";
import { z } from "zod";
import { env, isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse, PublicApiError } from "@/lib/http";
import {
  checkIngestionMutationSafety,
  ingestionMutationSafetyPayload,
  listDocumentsWithActiveAgentEnrichment,
} from "@/lib/ingestion-mutation-safety";
import { consumeApiRateLimit, rateLimitJsonResponse } from "@/lib/api-rate-limit";
import { invalidateRagCachesForOwner } from "@/lib/rag/rag";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

const bulkReindexSchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1).max(10),
  mode: z.enum(["enrichment", "full", "retry_failed"]).default("enrichment"),
});
const reindexRequestResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("not_found") }),
  z.object({ outcome: z.literal("agent_enrichment_active") }),
  z.object({ outcome: z.literal("ingestion_active") }),
  z.object({ outcome: z.literal("queued"), job: z.object({ id: z.string() }).passthrough() }),
]);

export async function POST(request: Request) {
  try {
    if (isDemoMode())
      return publicErrorResponse("Bulk reindex is unavailable in demo mode.", 400, { code: "demo_mode_unavailable" });

    const parsed = await parseJsonBody(request, bulkReindexSchema, "Bulk reindex payload is invalid.");

    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase, { administrator: true });
    const rateLimit = await consumeApiRateLimit({ supabase, ownerId: user.id, bucket: "bulk_reindex" });
    if (rateLimit.limited) return rateLimitJsonResponse("Too many bulk reindex requests. Retry shortly.", rateLimit);

    const documentIds = Array.from(new Set(parsed.documentIds));
    const { data: documents, error: documentError } = await supabase
      .from("documents")
      .select(
        "id,owner_id,title,file_name,file_type,source_path,import_batch_id,status,error_message,page_count,chunk_count,image_count,metadata",
      )
      .eq("owner_id", user.id)
      .in("id", documentIds);
    if (documentError) throw new Error(documentError.message);
    if (!documents?.length)
      return publicErrorResponse("No selected documents were found.", 404, { code: "documents_not_found" });

    const safety = await checkIngestionMutationSafety({
      supabase,
      documentIds: documents.map((document) => document.id),
      action: "Bulk reindex",
      checkActiveJobs: true,
      // Agent-enrichment conflicts are filtered per document below so one
      // blocked document does not reject an otherwise processable batch.
      checkActiveAgentEnrichmentJobs: false,
      staleAfterMinutes: env.WORKER_STALE_AFTER_MINUTES,
    });
    if (!safety.ok) return NextResponse.json(ingestionMutationSafetyPayload(safety), { status: safety.status });

    const results: Array<{
      documentId: string;
      mode: string;
      ok: boolean;
      jobId?: string;
      error?: string;
      status?: number;
      code?: string;
    }> = [];

    let processableDocuments = documents;

    if (parsed.mode !== "enrichment") {
      const enrichmentCheckIds =
        parsed.mode === "retry_failed"
          ? documents.filter((document) => document.status === "failed").map((document) => document.id)
          : documents.map((document) => document.id);
      if (enrichmentCheckIds.length > 0) {
        const blockedDocumentIds = await listDocumentsWithActiveAgentEnrichment({
          supabase,
          documentIds: enrichmentCheckIds,
          staleAfterMinutes: env.WORKER_STALE_AFTER_MINUTES,
        });
        if (blockedDocumentIds.length > 0) {
          const blockedSet = new Set(blockedDocumentIds);
          for (const documentId of blockedDocumentIds) {
            results.push({
              documentId,
              mode: parsed.mode,
              ok: false,
              error: "Reindex paused while enrichment is active.",
            });
          }
          processableDocuments = documents.filter((document) => !blockedSet.has(document.id));
        }
      }
    }

    for (const document of processableDocuments) {
      try {
        if (parsed.mode === "retry_failed" && document.status !== "failed") {
          results.push({
            documentId: document.id,
            mode: parsed.mode,
            ok: false,
            error: "Document is not failed.",
          });
          continue;
        }

        if (parsed.mode === "enrichment") {
          const { data: queued, error: queueError } = await supabase.rpc("request_indexing_v3_enrichment", {
            p_document_id: document.id,
            p_owner_id: user.id,
          });
          if (queueError) throw new Error("Enrichment is already active or could not be queued safely.");
          results.push({
            documentId: document.id,
            mode: parsed.mode,
            ok: true,
            jobId: queued && typeof queued === "object" && "job_id" in queued ? String(queued.job_id ?? "") : undefined,
          });
          continue;
        }

        if (document.file_type === "application/pdf") {
          results.push({
            documentId: document.id,
            mode: parsed.mode,
            ok: false,
            status: 409,
            code: "readmission_required",
            error:
              "PDF reindexing requires authenticated per-document current-administrator readmission. No job was queued.",
          });
          continue;
        }

        const staleBefore = new Date(Date.now() - env.WORKER_STALE_AFTER_MINUTES * 60_000).toISOString();
        const { data: reindexResult, error: reindexError } = await supabase.rpc(
          "request_ingestion_reindex_if_agent_idle",
          {
            p_document_id: document.id,
            p_owner_id: user.id,
            p_stale_before: staleBefore,
            p_max_attempts: env.WORKER_MAX_ATTEMPTS,
          },
        );
        if (reindexError) throw new Error(reindexError.message);

        const parsedResult = reindexRequestResultSchema.safeParse(reindexResult);
        if (!parsedResult.success) {
          throw new Error("request_ingestion_reindex_if_agent_idle returned an invalid result.");
        }
        if (parsedResult.data.outcome === "not_found") {
          throw new Error("Document was deleted while reindexing. Refresh the document list and retry.");
        }
        if (parsedResult.data.outcome === "agent_enrichment_active") {
          throw new Error("Document has active agent enrichment work. Wait for it to finish before reindexing.");
        }
        if (parsedResult.data.outcome === "ingestion_active") {
          throw new Error("Document already has pending or processing indexing work.");
        }
        results.push({ documentId: document.id, mode: parsed.mode, ok: true, jobId: parsedResult.data.job.id });
      } catch (error) {
        results.push({
          documentId: document.id,
          mode: parsed.mode,
          ok: false,
          error: error instanceof Error ? error.message : "Reindex failed.",
        });
      }
    }

    invalidateRagCachesForOwner(user.id);
    const missingDocumentIds = documentIds.filter((id) => !documents.some((document) => document.id === id));
    return NextResponse.json(
      {
        ok: missingDocumentIds.length === 0 && results.every((result) => result.ok),
        results,
        missingDocumentIds,
      },
      { status: results.length > 0 && results.every((result) => result.code === "readmission_required") ? 409 : 200 },
    );
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    if (error instanceof PublicApiError) return jsonError(error, error.status);
    return jsonError(error, 500);
  }
}
