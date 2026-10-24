import { z } from "zod";
import {
  ACTIVE_INDEXING_POLL_MS,
  emptyPagination,
  indexingListResponse,
  offsetPagination,
  parseStatusRows,
  type StatusRow,
} from "@/lib/api-list-response";
import { consumeApiRateLimit, rateLimitJsonResponse } from "@/lib/api-rate-limit";
import { isDemoMode } from "@/lib/env";
import { jsonError } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { optionalUuidQuery, parseRequestQuery, queryInteger } from "@/lib/validation/query";

export const runtime = "nodejs";

const ACTIVE_JOB_STATUSES = ["pending", "processing"];

const ingestionJobsQuerySchema = z.object({
  batchId: optionalUuidQuery(),
  limit: queryInteger({ fallback: 100, min: 1, max: 200 }),
  offset: queryInteger({ fallback: 0, min: 0, max: 10_000 }),
});

type JobRow = StatusRow;

function jobsResponse(
  jobs: JobRow[],
  activeJobCount: number,
  failedJobCount: number,
  extra: Record<string, unknown> = {},
) {
  const hasActiveJobs = activeJobCount > 0;
  const pollAfterMs = hasActiveJobs ? ACTIVE_INDEXING_POLL_MS : null;
  return indexingListResponse(
    {
      jobs,
      activeJobCount,
      // #L15: the hub's "failed jobs" tile used to derive from
      // `bucketJobs(state.jobs)`, i.e. only the current page (default 100,
      // newest first), so a corpus with more than 100 jobs could hide older
      // failures from the number the page exists to answer. This is a
      // pre-pagination head count, matching activeJobCount's own shape.
      failedJobCount,
      hasActiveJobs,
      pollAfterMs,
      ...extra,
    },
    { active: hasActiveJobs, pollAfterMs },
  );
}

export async function GET(request: Request) {
  try {
    const { batchId, limit, offset } = parseRequestQuery(
      request,
      ingestionJobsQuerySchema,
      "Invalid ingestion jobs query.",
    );
    if (isDemoMode()) {
      return jobsResponse([], 0, 0, {
        demoMode: true,
        pagination: emptyPagination(limit, offset),
      });
    }

    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase, { administrator: true });

    // The hub polls this route every ACTIVE_INDEXING_POLL_MS while a job is
    // active, so it shares the ingestion-quality route's limiter bucket
    // rather than going unlimited (#L32).
    const rateLimit = await consumeApiRateLimit({
      supabase,
      ownerId: user.id,
      bucket: "ingestion_admin",
      allowInMemoryFallbackOnUnavailable: true,
    });
    if (rateLimit.limited) {
      return rateLimitJsonResponse("Too many ingestion administration requests. Retry shortly.", rateLimit);
    }

    let query = supabase
      .from("ingestion_jobs")
      .select("*, documents!inner(title,file_name,status,owner_id)", { count: "exact" })
      .eq("documents.owner_id", user.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    let activeCountQuery = supabase
      .from("ingestion_jobs")
      .select("id, documents!inner(owner_id)", { count: "exact", head: true })
      .eq("documents.owner_id", user.id)
      .in("status", ACTIVE_JOB_STATUSES);
    // #L15: a pre-pagination full count, same shape as activeCountQuery, so
    // the failed-jobs tile stops under-reporting once a corpus has more jobs
    // than one page holds.
    let failedCountQuery = supabase
      .from("ingestion_jobs")
      .select("id, documents!inner(owner_id)", { count: "exact", head: true })
      .eq("documents.owner_id", user.id)
      .eq("status", "failed");

    if (batchId) {
      query = query.eq("batch_id", batchId);
      activeCountQuery = activeCountQuery.eq("batch_id", batchId);
      failedCountQuery = failedCountQuery.eq("batch_id", batchId);
    }

    const [
      { data, error, count },
      { error: activeCountError, count: activeJobCount },
      { error: failedCountError, count: failedJobCount },
    ] = await Promise.all([query, activeCountQuery, failedCountQuery]);
    if (error) throw new Error(error.message);
    if (activeCountError) throw new Error(activeCountError.message);
    if (typeof activeJobCount !== "number" || !Number.isInteger(activeJobCount) || activeJobCount < 0) {
      throw new Error("The active ingestion job count was unavailable.");
    }
    if (failedCountError) throw new Error(failedCountError.message);
    if (typeof failedJobCount !== "number" || !Number.isInteger(failedJobCount) || failedJobCount < 0) {
      throw new Error("The failed ingestion job count was unavailable.");
    }
    const jobs = parseStatusRows(data);
    return jobsResponse(jobs, activeJobCount, failedJobCount, {
      pagination: offsetPagination({ limit, offset, pageLength: jobs.length, count }),
    });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
