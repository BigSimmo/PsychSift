import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

// ingestion-autopilot — self-healing loop for a stuck ingestion queue.
//
// Silent ingestion stalls are invisible product damage: documents just quietly
// stop becoming searchable. This chains the existing read-only probe
// (reindex-health) to a decision, and — only when a stuck-queue signal is present
// and --apply is passed — runs the existing recovery path (recover-ingestion-queue
// --apply). It ALERTS (non-zero exit) only when Supabase is unreachable or recovery
// fails, or (scheduled, --alert-on-stuck) when recoverable work or a pending upload that
// nothing has claimed is detected; a healthy, idle or deliberately paused queue exits 0.
//
// Decision is based purely on reindex-health's JSON (a clean read-only probe).
// check-indexing is intentionally NOT chained here: it additionally requires the
// OpenAI + Python/PDF stack and is a strict corpus-readiness gate, so folding it in
// would make the autopilot fragile and noisy. It remains the operator's separate
// readiness check.
//
// Dry-run by default (reports what it WOULD recover). Provider-touching, so it runs
// only in the disabled scheduled workflow or a manual operator run — never in PR CI.

export type IngestionHealth = {
  ok?: boolean;
  status?: string;
  counts?: Record<string, number | null>;
  openJobs?: Array<{
    id?: string;
    status?: string;
    stage?: string | null;
    attempt_count?: number | null;
    max_attempts?: number | null;
    locked_at?: string | null;
    next_run_at?: string | null;
    created_at?: string | null;
    error_message?: string | null;
  }>;
};

/**
 * Whether the ingestion worker is meant to be running. The worker has no public address, so
 * this cannot be probed; the operator records a deliberate pause in the repository variable
 * INGESTION_WORKER_PAUSED ("true" or "false"), which the autopilot and ops-digest workflows
 * read. "unknown" means the variable is not set.
 */
export type WorkerState = "running" | "paused" | "unknown";

export type IngestionAssessment = {
  available: boolean;
  stuck: boolean;
  reasons: string[];
  failedJobs: number;
  staleProcessingJobs: number;
  agedPendingJobs: number;
  strandedQueuedDocuments: number;
  workerState: WorkerState;
};

/** Reads INGESTION_WORKER_PAUSED; anything other than "true" or "false" is unrecorded. */
export function workerPausedFromEnv(env: Record<string, string | undefined> = process.env): boolean | undefined {
  const raw = env.INGESTION_WORKER_PAUSED?.trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

/** One plain line for the run log and job summary describing the worker state. */
export function describeWorkerState(assessment: IngestionAssessment, staleAfterMinutes = 30): string {
  if (assessment.workerState === "paused") {
    return (
      "worker paused (deliberate, repository variable INGESTION_WORKER_PAUSED=true): uploads are not processed " +
      `until it is resumed; ${
        assessment.agedPendingJobs > 0
          ? `${assessment.agedPendingJobs} pending job(s) have waited > ${staleAfterMinutes}m, so this alerts`
          : `no pending job has waited > ${staleAfterMinutes}m, so no alert`
      }`
    );
  }
  if (assessment.workerState === "running") return "worker expected to be running (INGESTION_WORKER_PAUSED=false)";
  return "worker state not recorded (repository variable INGESTION_WORKER_PAUSED is unset)";
}

/**
 * Pure assessment of a reindex-health JSON payload. `stuck` is true when there are
 * failed jobs, any open job already in the `failed` state, a `processing` job
 * whose lock is older than staleAfterMinutes (a worker died mid-job), or a
 * `pending` job that has been due for longer than staleAfterMinutes without being
 * claimed (the worker is stopped, paused or wedged; audit EVAL-03). A pending job is
 * due at `next_run_at` (a retry backs off into the future), or at `created_at` when
 * it has none. A deliberate pause is reported as `workerState: "paused"`, never as
 * stuck by itself; only a pending job left waiting behind it alerts. Env-free and
 * unit-tested.
 */
export function assessIngestionHealth(
  health: IngestionHealth,
  options: { staleAfterMinutes?: number; now?: number; workerPaused?: boolean } = {},
): IngestionAssessment {
  const staleAfterMinutes = options.staleAfterMinutes ?? 30;
  const now = options.now ?? Date.now();
  const workerState: WorkerState =
    options.workerPaused === true ? "paused" : options.workerPaused === false ? "running" : "unknown";

  if (health.ok === false || health.status === "supabase_unavailable") {
    return {
      available: false,
      stuck: false,
      reasons: ["supabase unavailable"],
      failedJobs: 0,
      staleProcessingJobs: 0,
      agedPendingJobs: 0,
      strandedQueuedDocuments: 0,
      workerState,
    };
  }

  const reasons: string[] = [];
  const failedJobs = Number(health.counts?.jobs_failed ?? 0) || 0;
  if (failedJobs > 0) reasons.push(`${failedJobs} failed job(s)`);

  const openJobs = health.openJobs ?? [];
  const staleThresholdMs = staleAfterMinutes * 60_000;
  let staleProcessingJobs = 0;
  let agedPendingJobs = 0;
  for (const job of openJobs) {
    if (job.status === "failed") continue; // already counted via jobs_failed
    if (job.status === "processing" && job.locked_at) {
      const lockedAt = Date.parse(job.locked_at);
      if (Number.isFinite(lockedAt) && now - lockedAt > staleThresholdMs) staleProcessingJobs += 1;
    }
    if (job.status === "pending") {
      const dueAt = Date.parse(job.next_run_at ?? job.created_at ?? "");
      if (Number.isFinite(dueAt) && now - dueAt > staleThresholdMs) agedPendingJobs += 1;
    }
  }
  if (staleProcessingJobs > 0) {
    reasons.push(`${staleProcessingJobs} processing job(s) locked > ${staleAfterMinutes}m (stale worker)`);
  }
  if (agedPendingJobs > 0) {
    reasons.push(
      `${agedPendingJobs} pending job(s) unclaimed > ${staleAfterMinutes}m (${
        workerState === "paused"
          ? "the worker is paused on purpose: resume it to process them"
          : "worker stopped, paused or wedged"
      })`,
    );
  }
  const strandedQueuedDocuments = Number(health.counts?.documents_stranded_queued ?? 0) || 0;
  if (strandedQueuedDocuments > 0) {
    reasons.push(`${strandedQueuedDocuments} stranded queued document(s)`);
  }

  return {
    available: true,
    stuck: reasons.length > 0,
    reasons,
    failedJobs,
    staleProcessingJobs,
    agedPendingJobs,
    strandedQueuedDocuments,
    workerState,
  };
}

function parseIntFlag(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number.parseInt(process.argv[index + 1] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function runTsxScript(script: string, args: string[] = []) {
  return spawnSync(process.execPath, ["scripts/run-tsx.mjs", script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function main() {
  const apply = process.argv.includes("--apply");
  const alertOnStuck = process.argv.includes("--alert-on-stuck");
  const staleAfterMinutes = parseIntFlag("--stale-after-minutes", 30);
  const limit = parseIntFlag("--limit", 20);

  const probe = runTsxScript("scripts/reindex-health.ts");
  const stdout = probe.stdout ?? "";
  process.stdout.write(stdout);

  let health: IngestionHealth;
  try {
    health = JSON.parse(stdout);
  } catch {
    console.error("[autopilot] could not parse reindex-health output — aborting");
    process.exitCode = 1;
    return;
  }

  const assessment = assessIngestionHealth(health, { staleAfterMinutes, workerPaused: workerPausedFromEnv() });
  if (!assessment.available) {
    console.error("[autopilot] Supabase unavailable — not attempting recovery. Alerting.");
    process.exitCode = 1;
    return;
  }

  // Always say what state the worker is meant to be in, so a deliberate pause reads as "paused"
  // in the run log and job summary rather than as a healthy queue.
  const workerLine = `[autopilot] ${describeWorkerState(assessment, staleAfterMinutes)}`;
  console.log(workerLine);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${workerLine}\n`);
    } catch {
      // The summary is a convenience; the run log above carries the same line.
    }
  }

  if (!assessment.stuck) {
    console.log("[autopilot] queue healthy — nothing to recover.");
    return;
  }

  console.log(`[autopilot] stuck-queue signal: ${assessment.reasons.join("; ")}`);

  if (!apply) {
    console.log(
      `[autopilot] DRY RUN — would run: npm run recover:ingestion -- --apply --yes ` +
        `--include-stranded-queued --stale-after-minutes ${staleAfterMinutes} --limit ${limit}\n` +
        `[autopilot] pass --apply to recover.`,
    );
    if (alertOnStuck) {
      console.error("[autopilot] scheduled probe detected recoverable ingestion work — alerting.");
      process.exitCode = 2;
    }
    return;
  }

  console.log("[autopilot] applying recovery…");
  const recover = runTsxScript("scripts/recover-ingestion-queue.ts", [
    "--apply",
    "--yes",
    "--include-stranded-queued",
    "--stale-after-minutes",
    String(staleAfterMinutes),
    "--limit",
    String(limit),
  ]);
  if (recover.stdout) process.stdout.write(recover.stdout);
  if (recover.stderr) process.stderr.write(recover.stderr);
  if ((recover.status ?? 1) !== 0) {
    console.error("[autopilot] recovery FAILED — alerting.");
    process.exitCode = 1;
    return;
  }
  console.log("[autopilot] recovery applied. Re-probe with npm run reindex:health to confirm.");
}

// Only run as a CLI when invoked directly — importing (tests) must not execute.
const invokedDirectly = process.argv[1]?.endsWith("ingestion-autopilot.ts");
if (invokedDirectly) {
  main();
}
