import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  assessIngestionHealth,
  describeAbandonedJobs,
  describeWorkerState,
  workerPausedFromEnv,
  type IngestionHealth,
} from "../scripts/ingestion-autopilot";

const autopilotSource = readFileSync(new URL("../scripts/ingestion-autopilot.ts", import.meta.url), "utf8");
const healthSource = readFileSync(new URL("../scripts/reindex-health.ts", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/ingestion-autopilot.yml", import.meta.url), "utf8");

const NOW = Date.parse("2026-07-13T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

describe("assessIngestionHealth", () => {
  it("reports unavailable (and not stuck) when Supabase is down", () => {
    const a = assessIngestionHealth({ ok: false, status: "supabase_unavailable" }, { now: NOW });
    expect(a.available).toBe(false);
    expect(a.stuck).toBe(false);
    expect(a.reasons).toContain("supabase unavailable");
  });

  it("is healthy when there are no failed or stale jobs", () => {
    const a = assessIngestionHealth(
      { ok: true, counts: { jobs_failed: 0 }, openJobs: [{ status: "pending" }] },
      { now: NOW },
    );
    expect(a.available).toBe(true);
    expect(a.stuck).toBe(false);
    expect(a.reasons).toHaveLength(0);
  });

  it("flags failed jobs as stuck", () => {
    const a = assessIngestionHealth({ ok: true, counts: { jobs_failed: 3 }, openJobs: [] }, { now: NOW });
    expect(a.stuck).toBe(true);
    expect(a.failedJobs).toBe(3);
    expect(a.recoveryNeeded).toBe(true);
    expect(a.reasons[0]).toContain("3 failed job");
  });

  it.each([
    ["jobs_stranded_final_attempt", "strandedFinalAttemptJobs", "stranded final-attempt job(s)"],
    ["documents_indexed_without_chunks", "indexedDocumentsWithoutChunks", "indexed document(s) without chunks"],
  ])("alerts on %s without authorizing queue recovery", (countName, assessmentName, label) => {
    const a = assessIngestionHealth({ ok: true, counts: { [countName]: 2 } }, { now: NOW });
    expect(a).toMatchObject({ available: true, stuck: true, recoveryNeeded: false, [assessmentName]: 2 });
    expect(a.integrityProblems).toEqual([`2 ${label}`]);
    expect(a.reasons).toEqual(a.integrityProblems);
  });

  it("keeps missing old-build and valid zero integrity counts compatible", () => {
    const cases: IngestionHealth["counts"][] = [
      undefined,
      {},
      { jobs_stranded_final_attempt: 0, documents_indexed_without_chunks: 0 },
    ];
    for (const counts of cases) {
      expect(assessIngestionHealth({ ok: true, counts }, { now: NOW })).toMatchObject({
        stuck: false,
        recoveryNeeded: false,
        integrityProblems: [],
      });
    }
  });

  it.each([null, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "reports present invalid integrity telemetry %s without queue recovery",
    (value) => {
      const a = assessIngestionHealth(
        { ok: true, counts: { jobs_stranded_final_attempt: value, documents_indexed_without_chunks: value } },
        { now: NOW },
      );
      expect(a).toMatchObject({ available: true, stuck: true, recoveryNeeded: false });
      expect(a.integrityProblems).toEqual([
        "stranded final-attempt job(s) count unavailable",
        "indexed document(s) without chunks count unavailable",
      ]);
    },
  );

  it("preserves queue recovery eligibility alongside an independent integrity fault", () => {
    const a = assessIngestionHealth(
      { ok: true, counts: { jobs_failed: 1, documents_indexed_without_chunks: 1 } },
      { now: NOW },
    );
    expect(a).toMatchObject({ stuck: true, recoveryNeeded: true, failedJobs: 1 });
    expect(a.reasons).toEqual(["1 failed job(s)", "1 indexed document(s) without chunks"]);
  });

  it("flags a processing job whose lock is older than the stale threshold", () => {
    const a = assessIngestionHealth(
      {
        ok: true,
        counts: { jobs_failed: 0 },
        openJobs: [{ status: "processing", locked_at: minutesAgo(45) }],
      },
      { now: NOW, staleAfterMinutes: 30 },
    );
    expect(a.stuck).toBe(true);
    expect(a.staleProcessingJobs).toBe(1);
  });

  it("does not flag a recently-locked processing job", () => {
    const a = assessIngestionHealth(
      {
        ok: true,
        counts: { jobs_failed: 0 },
        openJobs: [{ status: "processing", locked_at: minutesAgo(5) }],
      },
      { now: NOW, staleAfterMinutes: 30 },
    );
    expect(a.stuck).toBe(false);
    expect(a.staleProcessingJobs).toBe(0);
  });

  it("flags aged queued documents without open jobs as stuck", () => {
    const a = assessIngestionHealth(
      { ok: true, counts: { jobs_failed: 0, documents_stranded_queued: 2 }, openJobs: [] },
      { now: NOW },
    );
    expect(a.stuck).toBe(true);
    expect(a.strandedQueuedDocuments).toBe(2);
    expect(a.reasons).toContain("2 stranded queued document(s)");
  });

  // Audit EVAL-03 (2026-10-20): a stopped, paused or wedged worker left uploads pending forever
  // with no alert, because pending jobs of any age counted as healthy.
  it("flags a pending job that has waited past the stale threshold to be claimed", () => {
    const a = assessIngestionHealth(
      {
        ok: true,
        counts: { jobs_failed: 0 },
        openJobs: [{ status: "pending", next_run_at: minutesAgo(45), created_at: minutesAgo(50) }],
      },
      { now: NOW, staleAfterMinutes: 30 },
    );
    expect(a.stuck).toBe(true);
    expect(a.agedPendingJobs).toBe(1);
    expect(a.reasons).toContain("1 pending job(s) unclaimed > 30m (worker stopped, paused or wedged)");
  });

  it("does not flag a fresh pending job or one scheduled for a later retry", () => {
    const a = assessIngestionHealth(
      {
        ok: true,
        counts: { jobs_failed: 0 },
        openJobs: [
          { status: "pending", next_run_at: minutesAgo(5), created_at: minutesAgo(5) },
          // Created long ago but backing off: next_run_at, not created_at, says when it is due.
          { status: "pending", next_run_at: minutesAgo(-20), created_at: minutesAgo(600) },
        ],
      },
      { now: NOW, staleAfterMinutes: 30 },
    );
    expect(a.stuck).toBe(false);
    expect(a.agedPendingJobs).toBe(0);
  });

  it("counts overdue pending jobs beyond the 25-job open-jobs preview", () => {
    // reindex-health returns only the 25 oldest open jobs. Fill them with pending retries that
    // are not yet due, so the overdue upload sits outside the preview and only the exact count
    // can see it.
    const notYetDue = Array.from({ length: 25 }, () => ({
      status: "pending",
      next_run_at: new Date(NOW + 60 * 60_000).toISOString(),
      created_at: minutesAgo(600),
    }));
    const a = assessIngestionHealth(
      { ok: true, counts: { jobs_failed: 0, jobs_pending_overdue: 1 }, openJobs: notYetDue },
      { now: NOW, staleAfterMinutes: 30 },
    );
    expect(a.agedPendingJobs).toBe(1);
    expect(a.stuck).toBe(true);
  });

  // Audit 26 Oct 2026 LS-07: four September enrichment-backfill jobs sat pending at 3 of 3
  // attempts. The claim RPC never takes them again, yet they were read as uploads waiting for the
  // paused worker, so the daily summary was amber every day and the advice (resume the worker)
  // would not have cleared them.
  const abandoned = (minutes: number) => ({
    status: "pending",
    stage: "indexed + enrichment backfill v3",
    attempt_count: 3,
    max_attempts: 3,
    next_run_at: minutesAgo(minutes),
    created_at: minutesAgo(minutes + 60),
  });

  it("does not read exhausted pending jobs on searchable documents as waiting uploads", () => {
    const a = assessIngestionHealth(
      {
        ok: true,
        counts: {
          jobs_failed: 0,
          jobs_pending_overdue: 4,
          jobs_pending_exhausted: 4,
          jobs_pending_exhausted_unindexed: 0,
          jobs_pending_exhausted_overdue: 4,
        },
        openJobs: [abandoned(50_000), abandoned(50_000), abandoned(50_000), abandoned(50_000)],
      },
      { now: NOW, staleAfterMinutes: 30, workerPaused: true },
    );
    expect(a).toMatchObject({ stuck: false, recoveryNeeded: false, agedPendingJobs: 0, abandonedSearchableJobs: 4 });
    expect(describeAbandonedJobs(a)).toContain("4 pending job(s) on documents that are already searchable");
    expect(describeAbandonedJobs(a)).toContain("does not alert");
  });

  it("still alerts on a real upload waiting beside abandoned jobs", () => {
    const a = assessIngestionHealth(
      {
        ok: true,
        counts: {
          jobs_failed: 0,
          jobs_pending_overdue: 5,
          jobs_pending_exhausted: 4,
          jobs_pending_exhausted_unindexed: 0,
          jobs_pending_exhausted_overdue: 4,
        },
        openJobs: [
          abandoned(50_000),
          { status: "pending", attempt_count: 0, max_attempts: 3, created_at: minutesAgo(90) },
        ],
      },
      { now: NOW, staleAfterMinutes: 30, workerPaused: true },
    );
    expect(a.stuck).toBe(true);
    expect(a.agedPendingJobs).toBe(1);
    expect(a.abandonedSearchableJobs).toBe(4);
  });

  it("alerts, without queue recovery, on an exhausted job whose document never became searchable", () => {
    const a = assessIngestionHealth(
      {
        ok: true,
        counts: {
          jobs_failed: 0,
          jobs_pending_overdue: 1,
          jobs_pending_exhausted: 1,
          jobs_pending_exhausted_unindexed: 1,
          jobs_pending_exhausted_overdue: 1,
        },
        openJobs: [abandoned(500)],
      },
      { now: NOW, staleAfterMinutes: 30 },
    );
    expect(a).toMatchObject({ stuck: true, recoveryNeeded: false, agedPendingJobs: 0, abandonedSearchableJobs: 0 });
    expect(a.integrityProblems).toEqual([
      "1 pending job(s) on unsearchable document(s) used every attempt and will never run",
    ]);
    expect(describeAbandonedJobs(a)).toBeNull();
  });

  it("keeps the old behaviour when the probe does not report exhausted counts", () => {
    const a = assessIngestionHealth(
      { ok: true, counts: { jobs_failed: 0, jobs_pending_overdue: 4 }, openJobs: [abandoned(500)] },
      { now: NOW, staleAfterMinutes: 30 },
    );
    // Conservative: without the split, the overdue count still alerts.
    expect(a.agedPendingJobs).toBe(4);
    expect(a.abandonedSearchableJobs).toBe(0);
  });

  it("asks reindex-health for the exhausted pending counts", () => {
    expect(healthSource).toContain('"jobs_pending_exhausted"');
    expect(healthSource).toContain('"jobs_pending_exhausted_unindexed"');
    expect(healthSource).toContain('"jobs_pending_exhausted_overdue"');
    // These counts are subtracted from an exact whole-queue count, so the read must not truncate.
    expect(healthSource).toMatch(/\.order\("id", \{ ascending: true \}\)\s*\.range\(page \* pageSize/);
  });

  it("asks reindex-health for an exact overdue-pending count at the autopilot's threshold", () => {
    expect(healthSource).toContain('"jobs_pending_overdue"');
    expect(healthSource).toMatch(/\.eq\("status", "pending"\)\s*\.lt\("next_run_at", /);
    expect(autopilotSource).toContain('"--pending-overdue-minutes"');
  });

  it("falls back to created_at when a pending job has no next_run_at", () => {
    const a = assessIngestionHealth(
      { ok: true, counts: { jobs_failed: 0 }, openJobs: [{ status: "pending", created_at: minutesAgo(90) }] },
      { now: NOW, staleAfterMinutes: 30 },
    );
    expect(a.agedPendingJobs).toBe(1);
  });

  it("reports a deliberate pause as paused, not healthy and not an outage", () => {
    const idle = assessIngestionHealth(
      { ok: true, counts: { jobs_failed: 0 }, openJobs: [] },
      { now: NOW, workerPaused: true },
    );
    expect(idle).toMatchObject({ available: true, stuck: false, workerState: "paused" });
    expect(describeWorkerState(idle, 30)).toBe(
      "worker paused (deliberate, repository variable INGESTION_WORKER_PAUSED=true): uploads are not processed until it is resumed; no pending job has waited > 30m, so no alert",
    );

    // An upload waiting behind the pause still alerts, and says the pause is the cause.
    const waiting = assessIngestionHealth(
      { ok: true, counts: { jobs_failed: 0 }, openJobs: [{ status: "pending", created_at: minutesAgo(120) }] },
      { now: NOW, workerPaused: true },
    );
    expect(waiting.stuck).toBe(true);
    expect(waiting.reasons).toContain(
      "1 pending job(s) unclaimed > 30m (the worker is paused on purpose: resume it to process them)",
    );
  });

  it("reads the pause flag from the workflow and keeps the running and unrecorded states distinct", () => {
    expect(workerPausedFromEnv({ INGESTION_WORKER_PAUSED: "true" })).toBe(true);
    expect(workerPausedFromEnv({ INGESTION_WORKER_PAUSED: "false" })).toBe(false);
    expect(workerPausedFromEnv({})).toBeUndefined();
    expect(assessIngestionHealth({ ok: true, openJobs: [] }, { now: NOW, workerPaused: false }).workerState).toBe(
      "running",
    );
    expect(assessIngestionHealth({ ok: true, openJobs: [] }, { now: NOW }).workerState).toBe("unknown");
    expect(healthSource).toContain("next_run_at");
    expect(healthSource).toContain("created_at");
    expect(workflow).toContain("INGESTION_WORKER_PAUSED: ${{ vars.INGESTION_WORKER_PAUSED }}");
  });

  it("wires scheduled detection to a durable alert and the existing bounded recovery path", () => {
    expect(healthSource).toContain('"documents_stranded_queued"');
    expect(autopilotSource).toContain('"--include-stranded-queued"');
    expect(autopilotSource).toContain('process.argv.includes("--alert-on-stuck")');
    expect(workflow).toContain("npm run ingestion:autopilot -- --alert-on-stuck");
    expect(workflow).toContain("--include-stranded-queued");
  });
});

describe("ingestion-autopilot CLI integrity safeguards", () => {
  async function runCli(counts: Record<string, unknown>, args: string[]) {
    const previousArgv = process.argv;
    const previousExitCode = process.exitCode;
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    vi.resetModules();
    const run = vi.mocked(spawnSync);
    run.mockReset();
    run.mockReturnValue({
      pid: 0,
      output: [],
      stdout: JSON.stringify({ ok: true, counts }),
      stderr: "",
      status: 0,
      signal: null,
    });
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.argv = [process.execPath, "/synthetic/ingestion-autopilot.ts", ...args];
    process.exitCode = 0;
    delete process.env.GITHUB_STEP_SUMMARY;
    try {
      await import("../scripts/ingestion-autopilot");
      return { exitCode: process.exitCode, calls: run.mock.calls.map((call) => call[1]) };
    } finally {
      process.argv = previousArgv;
      process.exitCode = previousExitCode;
      if (summaryPath === undefined) delete process.env.GITHUB_STEP_SUMMARY;
      else process.env.GITHUB_STEP_SUMMARY = summaryPath;
      vi.restoreAllMocks();
    }
  }

  it.each([{ args: [] }, { args: ["--alert-on-stuck"] }, { args: ["--apply"] }])(
    "alerts on integrity-only faults without running recovery with flags $args",
    async ({ args }) => {
      const result = await runCli({ jobs_stranded_final_attempt: 1, documents_indexed_without_chunks: 1 }, args);
      expect(result.exitCode).toBe(2);
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0]).toContain("scripts/reindex-health.ts");
    },
  );

  it.each([null, "1", { unsafe: "synthetic provider error text" }])(
    "does not run recovery for invalid integrity telemetry %j under apply",
    async (value) => {
      const result = await runCli({ jobs_stranded_final_attempt: value }, ["--apply"]);
      expect(result.exitCode).toBe(2);
      expect(result.calls).toHaveLength(1);
    },
  );

  it("retains the integrity alert after bounded recovery of separate queue faults", async () => {
    const result = await runCli({ jobs_failed: 1, documents_indexed_without_chunks: 1 }, ["--apply"]);
    expect(result.exitCode).toBe(2);
    expect(result.calls).toHaveLength(2);
    expect(result.calls[1]).toEqual([
      "scripts/run-tsx.mjs",
      "scripts/recover-ingestion-queue.ts",
      "--apply",
      "--yes",
      "--include-stranded-queued",
      "--stale-after-minutes",
      "30",
      "--limit",
      "20",
    ]);
  });
});
