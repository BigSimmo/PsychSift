import { NextResponse } from "next/server";
import { z } from "zod";
import { env, isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { logger } from "@/lib/logger";
import { enqueueDocumentReindexJob, type EnqueueableDocument } from "@/lib/ingestion-enqueue";
import { checkIngestionMutationSafety } from "@/lib/ingestion-mutation-safety";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWebhookSecret } from "@/lib/webhooks/secret-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Receiver for a Supabase Database Webhook on public.documents. It turns the
// polling ingestion-autopilot into an event-driven path: when a document is
// inserted outside the app upload flow, or an existing row is explicitly flagged
// for reindex, this enqueues a single (re)index job the worker then claims.
//
// Idempotency + loop-safety (see docs/webhooks.md):
//   - INSERT of a not-yet-indexed document -> enqueue. The app upload route also
//     enqueues, but the one-open-job-per-document unique index makes the second
//     insert a benign no-op, so double delivery is harmless.
//   - UPDATE only acts when record.metadata.reindex_requested === true, and the
//     flag is CLEARED after acting. The worker's own completion writes (which are
//     UPDATEs) never carry the flag, so they cannot retrigger an endless loop.
//   - checkIngestionMutationSafety refuses while a job is already active, and the
//     enqueue reports "already_active" instead of erroring on a lost race.

const documentRecordSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid().nullable().optional(),
  status: z.string().max(200).nullable().optional(),
  error_message: z.string().max(200).nullable().optional(),
  page_count: z.number().nullable().optional(),
  chunk_count: z.number().nullable().optional(),
  image_count: z.number().nullable().optional(),
  import_batch_id: z.string().max(200).nullable().optional(),
  metadata: z.record(z.string().max(200), z.unknown()).nullable().optional(),
});

const supabaseWebhookSchema = z.object({
  type: z.enum(["INSERT", "UPDATE", "DELETE"]),
  table: z.string().max(200),
  schema: z.string().max(200).optional(),
  record: documentRecordSchema.nullable().optional(),
  old_record: z.record(z.string().max(200), z.unknown()).nullable().optional(),
});

function skip(reason: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ skipped: true, reason, ...extra });
}

// A requested reindex-flag clear failed. Return 500 (not 2xx) so Supabase retries
// delivery — leaving the flag set would let every later UPDATE re-trigger enqueue,
// defeating the loop-safety guarantee documented above.
function reindexFlagClearFailed() {
  return publicErrorResponse("Failed to clear reindex flag; retry.", 500, {
    code: "reindex_flag_clear_failed",
  });
}

export async function POST(request: Request) {
  try {
    // Supabase webhooks can send custom headers, so require the secret in an
    // Authorization: Bearer / x-webhook-secret header (no query-token fallback).
    const auth = verifyWebhookSecret(request, env.SUPABASE_INGESTION_WEBHOOK_SECRET);
    if (!auth.ok) {
      if (auth.reason === "misconfigured") {
        return publicErrorResponse("Supabase ingestion webhook receiver is not configured.", 503, {
          code: "webhook_not_configured",
        });
      }
      return publicErrorResponse("Unauthorized.", 401);
    }

    // No live database in demo mode — accept and no-op so retries stop.
    if (isDemoMode()) return skip("demo_mode");

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return publicErrorResponse("Invalid JSON body.", 400, { code: "invalid_json" });
    }

    const parsed = supabaseWebhookSchema.safeParse(rawBody);
    if (!parsed.success) return skip("unrecognized_payload");

    const event = parsed.data;
    if (event.table !== "documents") return skip("not_documents_table", { table: event.table });
    if (event.type === "DELETE") return skip("delete_event");

    const record = event.record;
    if (!record) return skip("missing_record");

    const reindexRequested = record.metadata?.["reindex_requested"] === true;
    const alreadyIndexed = record.status === "indexed";
    // INSERT of a fresh (not-yet-indexed) document, or an explicit reindex flag on
    // any event, are the only actionable transitions.
    const shouldEnqueue = (event.type === "INSERT" && !alreadyIndexed) || reindexRequested;
    if (!shouldEnqueue) return skip("no_actionable_transition", { type: event.type, status: record.status ?? null });

    const ownerId = record.owner_id ?? null;
    // Owner scope is the app's tenancy layer; without an owner we cannot scope the
    // enqueue write safely, so decline rather than touch an unscoped row.
    if (!ownerId) return skip("missing_owner");

    const supabase = createAdminClient();

    const safety = await checkIngestionMutationSafety({
      supabase,
      documentIds: [record.id],
      action: "Reindex",
      checkActiveJobs: true,
      staleAfterMinutes: env.WORKER_STALE_AFTER_MINUTES,
    });
    if (!safety.ok) {
      // Supabase unavailable -> 503 so the webhook is retried; an active/stale job
      // already covers this document -> idempotent skip.
      if (safety.reason === "supabase_unavailable") {
        return publicErrorResponse(safety.message, 503, { code: "supabase_unavailable" });
      }
      const cleared = await clearReindexFlagIfRequested(supabase, record.id, ownerId, reindexRequested);
      if (reindexRequested && !cleared) return reindexFlagClearFailed();
      return skip("already_active", { safetyReason: safety.reason });
    }

    // Load the authoritative row (owner-scoped) rather than trusting the webhook
    // payload for the mutation inputs.
    const { data: document, error: documentError } = await supabase
      .from("documents")
      .select("id,owner_id,status,error_message,page_count,chunk_count,image_count,import_batch_id")
      .eq("id", record.id)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (documentError) throw new Error(documentError.message);
    if (!document) return skip("document_not_found");

    const result = await enqueueDocumentReindexJob({ supabase, document: document as EnqueueableDocument });
    // Clear the reindex flag once handled so a later UPDATE (including the worker's
    // own completion write) cannot retrigger this endlessly. If the clear fails we
    // must NOT return 2xx: the flag is still set, so respond 500 to make Supabase
    // retry the delivery until the flag is actually cleared. The enqueue is
    // idempotent (one-open-job-per-document unique index), so a retry cannot
    // double-enqueue — it will take the already_active path and retry the clear.
    const cleared = await clearReindexFlagIfRequested(supabase, record.id, ownerId, reindexRequested);
    if (reindexRequested && !cleared) return reindexFlagClearFailed();

    if (result.outcome === "document_deleted") return skip("document_deleted");
    if (result.outcome === "already_active") return skip("already_active");

    logger.info("Enqueued reindex job from Supabase webhook", { event: event.type });
    return NextResponse.json({ enqueued: true }, { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}

// Returns true when there was nothing to clear or the clear succeeded, false when
// a requested clear failed (the caller then fails the request so Supabase retries).
async function clearReindexFlagIfRequested(
  supabase: ReturnType<typeof createAdminClient>,
  documentId: string,
  ownerId: string,
  reindexRequested: boolean,
): Promise<boolean> {
  if (!reindexRequested) return true;
  // Deep-merge {reindex_requested:false} onto documents.metadata. The RPC bumps
  // updated_at (firing another UPDATE webhook), but with the flag now false that
  // delivery hits "no_actionable_transition" — breaking the loop.
  const { error } = await supabase.rpc("apply_document_metadata_patch", {
    p_document_id: documentId,
    p_metadata_patch: { reindex_requested: false },
  });
  if (error) {
    logger.warn("Failed to clear reindex_requested flag", { ownerScoped: Boolean(ownerId), documentId });
    return false;
  }
  return true;
}
