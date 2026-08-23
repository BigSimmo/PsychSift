import "server-only";
import { env } from "@/lib/env";
import { ingestionRollbackFenceStamp } from "@/lib/ingestion-mutation-safety";
import { isAtomicReindexCandidate } from "@/lib/reindex-pipeline";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { publicSourcePolicyViolation } from "../../supabase/functions/_shared/public-source-policy";

type AdminClient = ReturnType<typeof createAdminClient>;

// The subset of a `documents` row needed to enqueue a (re)index job and to build
// a rollback payload if the insert loses a race.
export type EnqueueableDocument = {
  id: string;
  owner_id: string | null;
  status?: string | null;
  error_message?: string | null;
  page_count?: number | null;
  chunk_count?: number | null;
  image_count?: number | null;
  import_batch_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type EnqueueReindexResult =
  | { outcome: "enqueued"; job: Record<string, unknown> }
  | { outcome: "already_active" }
  | { outcome: "document_deleted" };

// Enqueue a full (re)index job for a single document, mirroring the queue-state
// write in src/app/api/documents/[id]/reindex/route.ts (rollback fence +
// one-open-job-per-document unique index). Kept as a shared primitive so the
// Supabase document-change webhook can reuse the exact concurrency semantics
// without re-deriving them. The reindex ROUTE keeps its own inline copy because
// it also owns HTTP status shaping, rate limiting, and mutation-safety payloads;
// this helper is the machine-webhook path where "already queued" is a benign
// idempotent no-op rather than a 409.
export async function enqueueDocumentReindexJob(args: {
  supabase: AdminClient;
  document: EnqueueableDocument;
}): Promise<EnqueueReindexResult> {
  const { supabase, document } = args;
  const publicSourceViolation = publicSourcePolicyViolation(document.metadata);
  if (publicSourceViolation) throw new Error(`Public source policy blocked enqueue (${publicSourceViolation}).`);
  const ownerId = document.owner_id;
  const atomicReindex = isAtomicReindexCandidate(document);

  // Rollback fence: stamp updated_at with a per-request value so a stale rollback
  // matches zero rows once an overlapping request re-stamps the row.
  const rollbackFence = ingestionRollbackFenceStamp();
  const rollbackDocumentPayload: TablesUpdate<"documents"> = atomicReindex
    ? { error_message: document.error_message ?? null }
    : {
        // documents.status is non-nullable; undefined leaves it unchanged if the
        // prior value is somehow absent (real rows always carry a status string).
        status: document.status ?? undefined,
        error_message: document.error_message ?? null,
        page_count: document.page_count ?? 0,
        chunk_count: document.chunk_count ?? 0,
        image_count: document.image_count ?? 0,
      };

  const queueUpdate = supabase
    .from("documents")
    .update(
      atomicReindex
        ? { error_message: null, updated_at: rollbackFence }
        : {
            status: "queued",
            error_message: null,
            page_count: 0,
            chunk_count: 0,
            image_count: 0,
            updated_at: rollbackFence,
          },
    )
    .eq("id", document.id);
  // Owner scope is the app's single tenancy layer (RLS is bypassed by the
  // service-role client); scope the write to the owning row when we have it.
  const { error: updateError } = await (ownerId ? queueUpdate.eq("owner_id", ownerId) : queueUpdate);
  if (updateError) throw new Error(updateError.message);

  const { data: job, error: jobError } = await supabase
    .from("ingestion_jobs")
    .insert({
      document_id: document.id,
      batch_id: document.import_batch_id ?? null,
      status: "pending",
      stage: "queued",
      progress: 0,
      max_attempts: env.WORKER_MAX_ATTEMPTS,
    })
    .select()
    .single();

  if (!jobError) return { outcome: "enqueued", job: job as Record<string, unknown> };

  // A concurrent transactional delete removed the document; the FK check fails
  // with 23503. Normal lifecycle conflict — no surviving state to roll back.
  if (jobError.code === "23503") return { outcome: "document_deleted" };

  // 23505 from the one-open-job-per-document unique index: another path already
  // has a pending/processing job for this document. If that job still exists it
  // owns the queue state (leave it as-is); only roll back when no competing open
  // job remains, matching the reindex route so we never orphan a "queued" row.
  if (jobError.code === "23505") {
    const { data: competingJobs, error: competingJobsError } = await supabase
      .from("ingestion_jobs")
      .select("id")
      .eq("document_id", document.id)
      .in("status", ["pending", "processing"])
      .limit(1);
    if (!competingJobsError && (competingJobs?.length ?? 0) === 0) {
      const rollback = supabase
        .from("documents")
        .update(rollbackDocumentPayload)
        .eq("id", document.id)
        .eq("updated_at", rollbackFence);
      await (ownerId ? rollback.eq("owner_id", ownerId) : rollback);
    }
    return { outcome: "already_active" };
  }

  throw new Error(jobError.message);
}
