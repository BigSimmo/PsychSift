import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assessIngestionHealth, describeWorkerState, workerPausedFromEnv } from "../scripts/ingestion-autopilot";

const autopilotSource = readFileSync(new URL("../scripts/ingestion-autopilot.ts", import.meta.url), "utf8");
const healthSource = readFileSync(new URL("../scripts/reindex-health.ts", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/ingestion-autopilot.yml", import.meta.url), "utf8");

const NOW = Date.parse("2026-07-13T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

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
    expect(a.reasons[0]).toContain("3 failed job");
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
