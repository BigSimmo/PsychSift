import { loadEnvConfig } from "@next/env";
import { formatSupabaseUnavailableError, isSupabaseUnavailableError, probeSupabaseHealth } from "@/lib/supabase/health";

loadEnvConfig(process.cwd());

type CountResult = {
  count: number | null;
  error: { message?: string } | null;
};

function unavailableMessage(error: unknown) {
  return isSupabaseUnavailableError(error) ? formatSupabaseUnavailableError(error) : null;
}

async function safeCount(label: string, query: PromiseLike<CountResult>) {
  try {
    const result = await query;
    if (result.error) {
      return { label, count: null, error: result.error.message ?? "Supabase query failed." };
    }
    return { label, count: result.count ?? 0, error: null };
  } catch (error) {
    return { label, count: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function safeDerivedCount(label: string, load: () => Promise<unknown[]>) {
  try {
    return { label, count: (await load()).length, error: null };
  } catch (error) {
    return { label, count: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const [
    { requireServerEnv },
    { createAdminClient },
    { listStrandedQueuedDocuments, STRANDED_QUEUED_DEFAULT_LIMIT, STRANDED_QUEUED_DEFAULT_MIN_AGE_MINUTES },
  ] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/supabase/admin"),
    import("@/lib/stranded-queued-recovery"),
  ]);
  requireServerEnv();
  const supabase = createAdminClient();

  const health = await probeSupabaseHealth(supabase);
  if (!health.ok) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          status: "supabase_unavailable",
          error: health.message,
          recommendation: "Do not run migrations, workers, or evals. Retry after Supabase can answer a trivial query.",
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  // Exact count of pending jobs that were due more than N minutes ago. The open-jobs preview below
  // is capped at the 25 oldest jobs, so an overdue upload behind older not-yet-due retries would
  // otherwise go unseen by the ingestion autopilot (which passes its own threshold here).
  const overdueIndex = process.argv.indexOf("--pending-overdue-minutes");
  const overdueArg = overdueIndex >= 0 ? Number.parseInt(process.argv[overdueIndex + 1] ?? "", 10) : Number.NaN;
  const pendingOverdueMinutes = Number.isFinite(overdueArg) && overdueArg > 0 ? overdueArg : 30;
  const pendingOverdueBefore = new Date(Date.now() - pendingOverdueMinutes * 60_000).toISOString();

  const [
    indexed,
    queued,
    processingDocuments,
    failedDocuments,
    pendingJobs,
    processingJobs,
    failedJobs,
    pendingOverdueJobs,
    strandedQueued,
    chunksWithSynopsis,
  ] = await Promise.all([
    safeCount(
      "documents_indexed",
      supabase.from("documents").select("id", { count: "exact", head: true }).eq("status", "indexed"),
    ),
    safeCount(
      "documents_queued",
      supabase.from("documents").select("id", { count: "exact", head: true }).eq("status", "queued"),
    ),
    safeCount(
      "documents_processing",
      supabase.from("documents").select("id", { count: "exact", head: true }).eq("status", "processing"),
    ),
    safeCount(
      "documents_failed",
      supabase.from("documents").select("id", { count: "exact", head: true }).eq("status", "failed"),
    ),
    safeCount(
      "jobs_pending",
      supabase.from("ingestion_jobs").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ),
    safeCount(
      "jobs_processing",
      supabase.from("ingestion_jobs").select("id", { count: "exact", head: true }).eq("status", "processing"),
    ),
    safeCount(
      "jobs_failed",
      supabase.from("ingestion_jobs").select("id", { count: "exact", head: true }).eq("status", "failed"),
    ),
    safeCount(
      "jobs_pending_overdue",
      supabase
        .from("ingestion_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .lt("next_run_at", pendingOverdueBefore),
    ),
    safeDerivedCount("documents_stranded_queued", () =>
      listStrandedQueuedDocuments({
        supabase,
        minAgeMinutes: STRANDED_QUEUED_DEFAULT_MIN_AGE_MINUTES,
        limit: STRANDED_QUEUED_DEFAULT_LIMIT,
      }),
    ),
    safeCount(
      "chunks_with_retrieval_synopsis",
      supabase
        .from("document_chunks")
        .select("id", { count: "exact", head: true })
        .not("retrieval_synopsis", "is", null)
        .neq("retrieval_synopsis", ""),
    ),
  ]);

  const { data: openJobs, error: jobsError } = await supabase
    .from("ingestion_jobs")
    .select("id,document_id,status,stage,attempt_count,max_attempts,locked_at,next_run_at,created_at,error_message")
    .in("status", ["pending", "processing", "failed"])
    .order("created_at", { ascending: true })
    .limit(25);

  // Audit 2026-10-20 ING-A-02 / EVAL-09: the open-jobs preview above is the 25 oldest jobs, so a job
  // stranded on its final attempt can sit behind old failed jobs unseen. Count it directly, along
  // with indexed documents that have no searchable chunks. (Embeddings are NOT NULL, so no missing-embedding count.)
  const nowIso = new Date().toISOString();
  const integrityCounts = await Promise.all([
    safeDerivedCount("jobs_stranded_final_attempt", async () => {
      const { data, error } = await supabase
        .from("ingestion_jobs")
        .select("id,attempt_count,max_attempts")
        .eq("status", "processing")
        .lt("lease_expires_at", nowIso)
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []).filter((job) => Number(job.attempt_count ?? 0) >= Number(job.max_attempts ?? 0));
    }),
    safeCount(
      "documents_indexed_without_chunks",
      supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("status", "indexed")
        .eq("chunk_count", 0),
    ),
    // document_chunks.embedding is NOT NULL, so a missing-embedding count would always be 0; not checked.
  ]);
  const integrityProblems = integrityCounts
    .filter((item) => Number(item.count ?? 0) > 0)
    .map((item) => `${item.label}: ${item.count}`);

  const counts = [
    indexed,
    queued,
    processingDocuments,
    failedDocuments,
    pendingJobs,
    processingJobs,
    failedJobs,
    pendingOverdueJobs,
    strandedQueued,
    chunksWithSynopsis,
  ];
  const countErrors = [...counts, ...integrityCounts].filter((item) => item.error);
  const errors = [
    ...countErrors.map((item) => ({ label: item.label, error: unavailableMessage(item.error) ?? item.error })),
    ...(jobsError ? [{ label: "open_jobs", error: unavailableMessage(jobsError.message) ?? jobsError.message }] : []),
  ];

  console.log(
    JSON.stringify(
      {
        ok: countErrors.length === 0 && !jobsError,
        generatedAt: new Date().toISOString(),
        counts: Object.fromEntries([...counts, ...integrityCounts].map((item) => [item.label, item.count])),
        integrityProblems,
        errors,
        openJobs: openJobs ?? [],
        recommendation:
          countErrors.length === 0 && !jobsError
            ? "If no jobs are processing unexpectedly, run npm run recover:ingestion -- --include-stranded-queued --apply before resuming conservative worker:once."
            : "Fix the reported read errors before running workers or evals.",
      },
      null,
      2,
    ),
  );

  if (countErrors.length > 0 || jobsError) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
