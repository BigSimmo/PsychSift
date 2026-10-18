import "server-only";
import { env } from "@/lib/env";
import { ingestionRollbackFenceStamp } from "@/lib/ingestion-mutation-safety";
import { isAtomicReindexCandidate } from "@/lib/reindex-pipeline";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { TablesUpdate } from "@/lib/supabase/database.types";

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
  const ownerId = document.owner_id;
  const atomicReindex = isAtomicReindexCandidate(document);

  // Read the stored timestamp back: the database trigger replaces caller stamps.
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
  const applyOwnerFilter = <T extends { eq: (col: string, val: string) => T; is?: (col: string, val: null) => T }>(
    query: T,
  ) => (ownerId ? query.eq("owner_id", ownerId) : typeof query.is === "function" ? query.is("owner_id", null) : query);
  const { data: queuedDocument, error: updateError } = await applyOwnerFilter(queueUpdate)
    .select("updated_at,mutation_id")
    .maybeSingle();
  if (updateError) throw new Error(updateError.message);
  if (!queuedDocument) return { outcome: "document_deleted" };
  const storedFence = queuedDocument.updated_at;
  const storedMutationId = queuedDocument.mutation_id;
  if (!storedFence || !storedMutationId) throw new Error("Queue update returned no database mutation fence.");

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
      .select("id,status")
      .eq("document_id", document.id)
      .in("status", ["pending", "processing"])
      .limit(1);
    const hasCompetingProcessingJob =
      !atomicReindex &&
      Boolean(document.status) &&
      (competingJobs ?? []).some((row) => (row as { status?: unknown }).status === "processing");
    if (!competingJobsError && ((competingJobs?.length ?? 0) === 0 || hasCompetingProcessingJob)) {
      const payloadToRestore = hasCompetingProcessingJob
        ? { ...rollbackDocumentPayload, status: "processing", error_message: null }
        : rollbackDocumentPayload;
      const rollback = supabase
        .from("documents")
        .update(payloadToRestore)
        .eq("id", document.id)
        .eq("mutation_id", storedMutationId);
      await applyOwnerFilter(rollback);
    }
    return { outcome: "already_active" };
  }

  throw new Error(jobError.message);
}
erFilter(rollback);
    }
    return { outcome: "already_active" };
  }

  throw new Error(jobError.message);
}
