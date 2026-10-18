/**
 * Consolidated reindex pipeline.
 *
 * Runs the full safe reindex sequence from the runbook in a single command:
 *   1. Confirm target Supabase project
 *   2. Probe Supabase health
 *   3. Snapshot reindex health
 *   4. Apply ingestion queue recovery if stale/failed jobs are present
 *   5. Run worker:once
 *   6. Repeat steps 3–5 until the queue is clear or --max-rounds is reached
 *
 * Usage:
 *   npm run reindex                      # interactive – prompts before each recovery
 *   npm run reindex -- --yes             # non-interactive – auto-confirm every prompt
 *   npm run reindex -- --max-rounds 5    # limit worker iterations (default: 10)
 *   npm run reindex -- --limit 50        # recovery action limit per round (default: 20)
 */

import { spawn } from "node:child_process";
import { loadEnvConfig } from "@next/env";
import { confirm } from "./cli-utils";

loadEnvConfig(process.cwd());

function parseArgs(argv: string[]) {
  const valueFor = (name: string) => {
    const inline = argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
    if (inline) return inline;
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    yes: argv.includes("--yes"),
    maxRounds: Number.parseInt(valueFor("max-rounds") ?? "10", 10),
    limit: Number.parseInt(valueFor("limit") ?? "20", 10),
  };
}

function runWorkerOnce(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", "worker/index.ts", "--once"], {
      stdio: "inherit",
      shell: false,
    });
    child.on("close", (code: number | null) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`worker:once exited with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

type CountResult = {
  count: number | null;
  error: { message?: string } | null;
};

async function safeCount(label: string, countPromise: PromiseLike<CountResult>) {
  try {
    const result = await countPromise;
    if (result.error) {
      return { label, count: null, error: result.error.message ?? "Supabase query failed." };
    }
    return { label, count: result.count ?? 0, error: null };
  } catch (error) {
    return { label, count: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const [
    { env, requireServerEnv },
    {
      buildIngestionRecoveryPlan,
      reconcileIngestionRecoveryPlan,
      applyIngestionRecoveryActions,
      INGESTION_RECOVERY_JOB_STATUSES,
      isFreshProcessingJob,
    },
    { hasIncompleteDocumentsWithoutOpenJobs, isReindexQueueClear },
    { createAdminClient },
    { assertSupabaseHealthy, probeSupabaseHealth },
  ] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/ingestion-recovery"),
    import("@/lib/reindex-pipeline"),
    import("@/lib/supabase/admin"),
    import("@/lib/supabase/health"),
  ]);
  requireServerEnv();

  const args = parseArgs(process.argv.slice(2));
  const staleAfterMinutes = env.WORKER_STALE_AFTER_MINUTES;
  const limit = args.limit;

  console.log("=== Reindex Pipeline ===\n");

  // Step 1 – Confirm target project
  const { checkSupabaseProjectConfig, expectedSupabaseProject, formatSupabaseProjectCheck } =
    await import("@/lib/supabase/project");
  const projectCheck = checkSupabaseProjectConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_PROJECT_REF: process.env.SUPABASE_PROJECT_REF,
    SUPABASE_PROJECT_NAME: process.env.SUPABASE_PROJECT_NAME,
  });
  if (projectCheck.status === "missing" || projectCheck.status === "mismatch") {
    console.error(`Project check failed: ${formatSupabaseProjectCheck(projectCheck)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Project   : ${expectedSupabaseProject.name} (${expectedSupabaseProject.ref})`);

  // Step 2 – Supabase health
  console.log("\n[Step 1] Supabase health check...");
  const supabase = createAdminClient();
  assertSupabaseHealthy(await probeSupabaseHealth(supabase), "Reindex pipeline");
  console.log("  Supabase is healthy.");

  // Steps 3–5 – Iterative health snapshot → recovery → worker
  for (let round = 1; round <= args.maxRounds; round++) {
    console.log(`\n[Step 2] Reindex health snapshot (round ${round}/${args.maxRounds})...`);

    const snapshotNow = new Date();
    const staleCutoff = new Date(snapshotNow.getTime() - staleAfterMinutes * 60_000).toISOString();
    const [
      pendingJobs,
      processingJobs,
      failedJobs,
      staleJobs,
      queuedDocuments,
      processingDocuments,
      failedDocuments,
      indexedDocuments,
    ] = await Promise.all([
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
        "jobs_stale",
        supabase
          .from("ingestion_jobs")
          .select("id", { count: "exact", head: true })
          .eq("status", "processing")
          .or(
            `lease_expires_at.lte.${snapshotNow.toISOString()},and(lease_expires_at.is.null,or(locked_at.is.null,locked_at.lt.${staleCutoff}))`,
          ),
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
        "documents_indexed",
        supabase.from("documents").select("id", { count: "exact", head: true }).eq("status", "indexed"),
      ),
    ]);

    const countItems = [
      pendingJobs,
      processingJobs,
      failedJobs,
      staleJobs,
      queuedDocuments,
      processingDocuments,
      failedDocuments,
      indexedDocuments,
    ];
    const countErrors = countItems.filter((item) => item.error);

    console.log(`  Documents indexed   : ${indexedDocuments.count ?? "-"}`);
    console.log(`  Documents queued    : ${queuedDocuments.count ?? "-"}`);
    console.log(`  Documents processing: ${processingDocuments.count ?? "-"}`);
    console.log(`  Documents failed    : ${failedDocuments.count ?? "-"}`);
    console.log(`  Jobs pending        : ${pendingJobs.count ?? "-"}`);
    console.log(`  Jobs processing     : ${processingJobs.count ?? "-"}`);
    console.log(`  Jobs failed         : ${failedJobs.count ?? "-"}`);
    console.log(`  Jobs stale          : ${staleJobs.count ?? "-"}`);

    if (countErrors.length > 0) {
      console.error("\n  Read errors:");
      for (const item of countErrors) {
        console.error(`    ${item.label}: ${item.error}`);
      }
      console.error("\n  Fix the reported read errors before running workers or evals.");
      process.exitCode = 1;
      return;
    }

    const openJobs = (pendingJobs.count ?? 0) + (processingJobs.count ?? 0) + (failedJobs.count ?? 0);
    const needsRecovery = (staleJobs.count ?? 0) > 0 || (failedJobs.count ?? 0) > 0;
    let skipWorkerRun = false;
    let hasActiveProcessingJobs = !needsRecovery && (processingJobs.count ?? 0) > 0;
    const queueSnapshot = {
      openJobs,
      queuedDocuments: queuedDocuments.count ?? 0,
      processingDocuments: processingDocuments.count ?? 0,
      failedDocuments: failedDocuments.count ?? 0,
    };

    if (isReindexQueueClear(queueSnapshot)) {
      console.log("\nQueue is clear. Reindex pipeline complete.");
      return;
    }

    if (hasIncompleteDocumentsWithoutOpenJobs(queueSnapshot)) {
      console.error(
        "\nNo open ingestion jobs remain, but some documents are still processing or failed. Run targeted recovery or manual inspection before declaring the corpus reindexed.",
      );
      process.exitCode = 1;
      return;
    }

    // Step 3 – Recovery (only if stale/failed jobs present)
    if (needsRecovery) {
      console.log(`\n[Step 3] Queue recovery (stale: ${staleJobs.count}, failed: ${failedJobs.count})...`);

      const recoveryJobsQuery = () =>
        supabase
          .from("ingestion_jobs")
          .select(
            "id,document_id,status,locked_at,lease_token,lease_expires_at,documents(status,page_count,chunk_count,owner_id)",
          )
          .in("status", [...INGESTION_RECOVERY_JOB_STATUSES])
          .order("created_at", { ascending: true });
      const { data, error } = await recoveryJobsQuery();

      if (error) {
        console.error(`  Failed to load jobs for recovery: ${error.message}`);
        process.exitCode = 1;
        return;
      }

      type RecoveryDocument = {
        status?: string | null;
        page_count?: number | null;
        chunk_count?: number | null;
        owner_id?: string | null;
      };
      type RawJobRow = {
        id: string;
        document_id: string;
        status: string | null;
        locked_at: string | null;
        lease_token: string | null;
        lease_expires_at: string | null;
        documents: RecoveryDocument | RecoveryDocument[] | null;
      };
      // Pass every queried job (pending/processing/failed) to the planner and let its
      // active-vs-recoverable classification decide. Filtering out fresh `processing` jobs here
      // hid legitimate in-flight owners from the planner: a document with a failed row plus a
      // fresh processing retry would then requeue the failed row and collide with the still-open
      // processing sibling on ingestion_jobs_one_open_per_document_uidx (Audit I2/E2 follow-up).
      const jobs = (data ?? []).map((job: RawJobRow) => ({
        ...job,
        documents: Array.isArray(job.documents)
          ? (job.documents[0] as RecoveryDocument | undefined)
          : (job.documents as RecoveryDocument | undefined),
      }));
      hasActiveProcessingJobs = (data ?? [])
        .map((job: RawJobRow) => ({
          ...job,
          documents: Array.isArray(job.documents)
            ? (job.documents[0] as RecoveryDocument | undefined)
            : (job.documents as RecoveryDocument | undefined),
        }))
        .some((job) => isFreshProcessingJob(job, snapshotNow, staleAfterMinutes));
      const plan = buildIngestionRecoveryPlan({ jobs, staleAfterMinutes });
      const actions = plan.actions.slice(0, limit);
      const resetDocumentIds = plan.resetDocumentIds;
      const supersedeCount = actions.filter((a) => a.action === "supersede").length;
      const retryCount = actions.filter((a) => a.action === "retry").length;

      console.log(`  Documents to reset: ${resetDocumentIds.length} (all artifacts preserved)`);
      console.log(`  Jobs to supersede : ${supersedeCount}`);
      console.log(`  Jobs to retry     : ${retryCount}`);

      if (actions.length === 0) {
        console.log("  Nothing to recover in this round.");
        skipWorkerRun = true;
      } else {
        let shouldApply = args.yes;
        if (!shouldApply) {
          console.log("");
          shouldApply = await confirm("  Apply recovery changes?");
        }

        if (!shouldApply) {
          console.log("  Recovery skipped. Re-checking queue before worker run.");
          skipWorkerRun = true;
        } else {
          const { data: freshData, error: freshError } = await recoveryJobsQuery();
          if (freshError) throw new Error(freshError.message);
          const freshJobs = (freshData ?? []).map((job: RawJobRow) => ({
            ...job,
            documents: Array.isArray(job.documents) ? job.documents[0] : job.documents,
          }));
          const { applicable, skipped } = reconcileIngestionRecoveryPlan({
            planned: actions,
            jobs: freshJobs,
            staleAfterMinutes,
          });
          const results = await applyIngestionRecoveryActions(supabase, applicable);
          for (const { action, applied, reason } of results) {
            if (!applied) console.log(`  Skipped ${action.action} job ${action.jobId}: ${reason}`);
          }
          // Re-snapshot before launching another worker when authority moved or a managed hold refused.
          if (skipped.length > 0 || results.some((result) => !result.applied)) skipWorkerRun = true;

          console.log("  Recovery applied.");
        }
      }
    }

    // Step 4 – Worker run
    if (skipWorkerRun) {
      continue;
    }

    if (hasActiveProcessingJobs) {
      console.log("\n  Active processing jobs detected; skipping worker run to avoid concurrency spikes.");
      continue;
    }

    console.log("\n[Step 4] Running worker:once...");
    try {
      await runWorkerOnce();
      console.log("  Worker run complete.");
    } catch (err) {
      console.error(`  Worker run failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(
    `\nReached maximum rounds (${args.maxRounds}). Queue did not clear; re-run with a higher --max-rounds or inspect stale jobs first.`,
  );
  process.exitCode = 1;
}

main().catch((error) => {
  import("@/lib/privacy")
    .then(({ safeErrorLogDetails }) => {
      console.error("Reindex pipeline failed", safeErrorLogDetails(error));
      process.exitCode = 1;
    })
    .catch(() => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
});
