import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeApiRateLimit, rateLimitJsonResponse } from "@/lib/api-rate-limit";
import { env, isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { ingestionJobRetryRejectionReason } from "@/lib/ingestion";
import {
  applyIngestionRecoveryActions,
  isFreshProcessingJob,
  type IngestionRecoveryJob,
} from "@/lib/ingestion-recovery";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseRouteParams } from "@/lib/validation/params";

export const runtime = "nodejs";

const ingestionRetryRouteParamsSchema = z.object({
  id: z.string().uuid(),
});
const RETRY_JOB_COLUMNS =
  "id,document_id,status,locked_at,lease_token,lease_expires_at,documents!inner(status,owner_id,chunk_count)";

const ACTIVE_JOB_MESSAGE =
  "This job is still being processed by a worker. Wait for it to finish or go stale before retrying.";

// Audit 2026-10-20 DB-01: Retry goes through recover_ingestion_job, the same hardened path the
// operator recovery scripts use (document authority lock, managed-evidence hold, sibling-job and
// live-lease checks), guarded on the row state read here. Each refusal is a 409 the panel shows.
const RECOVERY_REFUSALS: Record<string, { message: string; code: string }> = {
  active_lease: { message: ACTIVE_JOB_MESSAGE, code: "ingestion_job_active" },
  state_changed: {
    message: "This job or its document has changed since the list was loaded. Refresh and try again.",
    code: "ingestion_job_state_changed",
  },
  managed_recovery_required: {
    message: "This document has managed index evidence, so it needs operator recovery rather than Retry.",
    code: "ingestion_job_managed_recovery_required",
  },
  authority_unavailable: {
    message: "Another change to this document is in progress. Try again shortly.",
    code: "ingestion_job_authority_unavailable",
  },
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (isDemoMode())
      return publicErrorResponse("Retry is unavailable in demo mode.", 400, { code: "demo_mode_unavailable" });

    const { id: rawId } = await params;
    const { id } = parseRouteParams({ id: rawId }, ingestionRetryRouteParamsSchema, "Invalid ingestion job id.");
    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase, { administrator: true });

    // This is the only unlimited MUTATING admin ingestion endpoint before this
    // fix — it re-enqueues a job. Same sibling gap as /api/ingestion/quality
    // and /api/ingestion/jobs (#L43).
    const rateLimit = await consumeApiRateLimit({
      supabase,
      ownerId: user.id,
      bucket: "ingestion_admin",
      allowInMemoryFallbackOnUnavailable: true,
    });
    if (rateLimit.limited) {
      return rateLimitJsonResponse("Too many ingestion administration requests. Retry shortly.", rateLimit);
    }

    const { data: row, error: readError } = await supabase
      .from("ingestion_jobs")
      .select(RETRY_JOB_COLUMNS)
      .eq("id", id)
      .eq("documents.owner_id", user.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    const job = row as unknown as (IngestionRecoveryJob & { status: string | null }) | null;
    if (!job || job.documents?.owner_id !== user.id) {
      return publicErrorResponse("Ingestion job not found.", 404, { code: "ingestion_job_not_found" });
    }
    if (job.status === "completed") {
      return publicErrorResponse(
        ingestionJobRetryRejectionReason("completed") ?? "Completed ingestion jobs cannot be retried.",
        409,
        { code: "ingestion_job_completed" },
      );
    }
    if (job.status === "pending") {
      return publicErrorResponse("This job is already queued.", 409, { code: "ingestion_job_queued" });
    }
    if (isFreshProcessingJob(job, new Date(), env.WORKER_STALE_AFTER_MINUTES)) {
      return publicErrorResponse(ACTIVE_JOB_MESSAGE, 409, { code: "ingestion_job_active" });
    }
    if (job.documents?.status === "indexed" && Number(job.documents.chunk_count ?? 0) > 0) {
      return publicErrorResponse(
        "This document is already indexed, so its old job cannot be retried. Use Re-index to rebuild it.",
        409,
        { code: "ingestion_document_indexed" },
      );
    }

    const [result] = await applyIngestionRecoveryActions(supabase, [
      {
        action: { action: "retry", jobId: job.id, documentId: job.document_id, resetDocument: false },
        expected: {
          jobStatus: job.status ?? null,
          jobLockedAt: job.locked_at ?? null,
          jobLeaseToken: job.lease_token ?? null,
          jobLeaseExpiresAt: job.lease_expires_at ?? null,
          documentStatus: job.documents?.status ?? null,
          documentOwnerId: job.documents?.owner_id ?? null,
        },
      },
    ]);
    if (!result?.applied) {
      if (result?.reason === "job_closed") {
        return publicErrorResponse("Ingestion job not found.", 404, { code: "ingestion_job_not_found" });
      }
      const refusal = RECOVERY_REFUSALS[result?.reason ?? ""];
      if (refusal) return publicErrorResponse(refusal.message, 409, { code: refusal.code });
      throw new Error(`recover_ingestion_job refused the retry: ${result?.reason ?? "no result"}.`);
    }

    const { data: queued, error: queuedError } = await supabase
      .from("ingestion_jobs")
      .select("*")
      .eq("id", job.id)
      .maybeSingle();
    if (queuedError) throw new Error(queuedError.message);
    return NextResponse.json({ job: queued ?? { id: job.id, document_id: job.document_id, status: "pending" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
