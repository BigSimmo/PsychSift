import { describe, expect, it } from "vitest";
import {
  buildIngestionRecoveryPlan,
  applyIngestionRecoveryActions,
  reconcileIngestionRecoveryPlan,
  INGESTION_RECOVERY_JOB_STATUSES,
  isFreshProcessingJob,
  isRecoverableProcessingJob,
  isStaleProcessingJob,
} from "../src/lib/ingestion-recovery";

describe("ingestion queue recovery planning", () => {
  const now = new Date("2026-06-15T00:00:00.000Z");

  it("keeps a current lease even when the legacy lock timestamp is old", () => {
    const plan = buildIngestionRecoveryPlan({
      now,
      staleAfterMinutes: 45,
      jobs: [
        {
          id: "current",
          document_id: "doc",
          status: "processing",
          locked_at: "2026-06-14T20:00:00Z",
          lease_expires_at: "2026-06-15T00:10:00Z",
          documents: { status: "processing" },
        },
      ],
    });
    expect(plan.actions).toEqual([]);
  });

  it("recovers an expired final attempt even with a recent legacy timestamp", () => {
    const plan = buildIngestionRecoveryPlan({
      now,
      staleAfterMinutes: 45,
      jobs: [
        {
          id: "expired",
          document_id: "doc",
          status: "processing",
          locked_at: "2026-06-14T23:59:00Z",
          lease_expires_at: "2026-06-14T23:59:59Z",
          documents: { status: "processing" },
        },
      ],
    });
    expect(plan.actions).toEqual([{ action: "retry", jobId: "expired", documentId: "doc", resetDocument: false }]);
  });

  it("loads pending jobs alongside failed and processing siblings", () => {
    expect(INGESTION_RECOVERY_JOB_STATUSES).toEqual(["pending", "processing", "failed"]);
  });

  it("selects stale processing and failed jobs for retry", () => {
    const plan = buildIngestionRecoveryPlan({
      now,
      staleAfterMinutes: 45,
      jobs: [
        {
          id: "stale",
          document_id: "doc-a",
          status: "processing",
          locked_at: "2026-06-14T22:00:00.000Z",
          documents: { status: "processing", chunk_count: 0 },
        },
        {
          id: "failed",
          document_id: "doc-b",
          status: "failed",
          documents: { status: "failed", chunk_count: 0 },
        },
      ],
    });

    expect(plan.retryCount).toBe(2);
    expect(plan.resetDocumentIds).toEqual([]);
  });

  it("supersedes obsolete failed jobs for already indexed documents", () => {
    const plan = buildIngestionRecoveryPlan({
      now,
      staleAfterMinutes: 45,
      jobs: [
        {
          id: "old-failure",
          document_id: "doc-indexed",
          status: "failed",
          documents: { status: "indexed", chunk_count: 42 },
        },
      ],
    });

    expect(plan.supersedeCount).toBe(1);
    expect(plan.retryCount).toBe(0);
    expect(plan.actions[0]).toMatchObject({ action: "supersede", jobId: "old-failure" });
  });

  it("leaves a queued (pending) reindex of an indexed document alone (R22)", () => {
    const plan = buildIngestionRecoveryPlan({
      now,
      staleAfterMinutes: 45,
      jobs: [
        {
          id: "queued-reindex",
          document_id: "doc-indexed",
          status: "pending",
          documents: { status: "indexed", chunk_count: 42 },
        },
      ],
    });

    // Must neither supersede (cancels the reindex) nor retry (resets the live
    // index). The worker's atomic reindex path handles the pending job.
    expect(plan.supersedeCount).toBe(0);
    expect(plan.retryCount).toBe(0);
    expect(plan.actions).toHaveLength(0);
    expect(plan.resetDocumentIds).toHaveLength(0);
  });

  it("still supersedes a failed job on an indexed document (R22 scope guard)", () => {
    const plan = buildIngestionRecoveryPlan({
      now,
      staleAfterMinutes: 45,
      jobs: [
        {
          id: "failed-on-indexed",
          document_id: "doc-indexed",
          status: "failed",
          documents: { status: "indexed", chunk_count: 42 },
        },
      ],
    });
    expect(plan.supersedeCount).toBe(1);
    expect(plan.retryCount).toBe(0);
  });

  it("preserves a pending job and supersedes its failed sibling regardless of fetch order (I2)", () => {
    const plan = buildIngestionRecoveryPlan({
      now,
      staleAfterMinutes: 45,
      jobs: [
        // The older `failed` row is iterated first; recovery must still prefer the legitimate
        // open `pending` sibling rather than replacing it based on fetch order.
        {
          id: "failed-first",
          document_id: "doc-double",
          status: "failed",
          documents: { status: "failed", chunk_count: 0 },
        },
        {
          id: "pending-second",
          document_id: "doc-double",
          status: "pending",
          documents: { status: "queued", chunk_count: 0 },
        },
      ],
    });

    expect(plan.retryCount).toBe(0);
    expect(plan.supersedeCount).toBe(1);
    expect(plan.resetDocumentIds).toEqual([]);
    expect(plan.actions).toEqual([{ action: "supersede", jobId: "failed-first", documentId: "doc-double" }]);
  });

  it("preserves a fresh processing job and supersedes its failed sibling", () => {
    const plan = buildIngestionRecoveryPlan({
      now,
      staleAfterMinutes: 45,
      jobs: [
        {
          id: "failed-first",
          document_id: "doc-active",
          status: "failed",
          documents: { status: "processing", chunk_count: 0 },
        },
        {
          id: "processing-second",
          document_id: "doc-active",
          status: "processing",
          locked_at: "2026-06-14T23:30:00.000Z",
          documents: { status: "processing", chunk_count: 0 },
        },
      ],
    });

    expect(plan.retryCount).toBe(0);
    expect(plan.resetDocumentIds).toEqual([]);
    expect(plan.actions).toEqual([{ action: "supersede", jobId: "failed-first", documentId: "doc-active" }]);
  });

  it("does not reclaim fresh processing jobs", () => {
    expect(
      isStaleProcessingJob(
        {
          id: "fresh",
          document_id: "doc",
          status: "processing",
          locked_at: "2026-06-14T23:30:00.000Z",
        },
        now,
        45,
      ),
    ).toBe(false);
  });

  it("retries processing jobs with no lock timestamp", () => {
    const plan = buildIngestionRecoveryPlan({
      now,
      staleAfterMinutes: 45,
      jobs: [
        {
          id: "null-lock",
          document_id: "doc-null",
          status: "processing",
          locked_at: null,
          documents: { status: "processing", chunk_count: 0 },
        },
      ],
    });

    expect(plan.retryCount).toBe(1);
    expect(plan.actions[0]).toMatchObject({ action: "retry", jobId: "null-lock", documentId: "doc-null" });
  });

  it("treats fresh processing jobs as active but not recoverable", () => {
    const job = {
      id: "fresh",
      document_id: "doc",
      status: "processing" as const,
      locked_at: "2026-06-14T23:30:00.000Z",
    };

    expect(isRecoverableProcessingJob(job, now, 45)).toBe(false);
    expect(isFreshProcessingJob(job, now, 45)).toBe(true);
  });
});

// The plan is computed against a point-in-time snapshot and then sits at an interactive
// confirmation prompt for an unbounded time. Applying it unguarded runs `reset_document_index`,
// which deletes every chunk, page, image and section for the document with no guard of its own.
// These pin the re-validation that stands between the stale plan and that destructive write.
describe("ingestion recovery plan reconciliation (R20/R21)", () => {
  const now = new Date("2026-06-15T00:00:00.000Z");
  const staleAfterMinutes = 45;

  const staleJob = {
    id: "job-stale",
    document_id: "doc-a",
    status: "processing",
    locked_at: "2026-06-14T22:00:00.000Z",
    documents: { status: "processing", chunk_count: 0, owner_id: "owner-1" },
  };

  it("keeps an action whose rows have not moved, and carries the observed state for the write guard", () => {
    const planned = buildIngestionRecoveryPlan({ now, staleAfterMinutes, jobs: [staleJob] }).actions;
    expect(planned).toHaveLength(1);

    const { applicable, skipped } = reconcileIngestionRecoveryPlan({
      planned,
      jobs: [staleJob],
      now,
      staleAfterMinutes,
    });

    expect(skipped).toEqual([]);
    expect(applicable).toHaveLength(1);
    expect(applicable[0]).toMatchObject({
      action: { action: "retry", jobId: "job-stale", documentId: "doc-a" },
      expected: {
        jobStatus: "processing",
        jobLockedAt: "2026-06-14T22:00:00.000Z",
        jobLeaseToken: null,
        jobLeaseExpiresAt: null,
        documentStatus: "processing",
        documentOwnerId: "owner-1",
      },
    });
  });

  it("drops a retry whose document finished indexing while the plan awaited confirmation", () => {
    const planned = buildIngestionRecoveryPlan({ now, staleAfterMinutes, jobs: [staleJob] }).actions;
    expect(planned[0]).toMatchObject({ action: "retry", documentId: "doc-a" });

    // The worker committed a generation during the prompt: the document is indexed with chunks.
    const { applicable, skipped } = reconcileIngestionRecoveryPlan({
      planned,
      jobs: [{ ...staleJob, status: "failed", documents: { status: "indexed", chunk_count: 42, owner_id: "owner-1" } }],
      now,
      staleAfterMinutes,
    });

    expect(applicable.filter((entry) => entry.action.action === "retry")).toEqual([]);
    expect(skipped).toEqual([{ action: planned[0], reason: "state_changed" }]);
  });

  it("drops an action whose job was re-claimed by a live worker", () => {
    const planned = buildIngestionRecoveryPlan({ now, staleAfterMinutes, jobs: [staleJob] }).actions;

    // A worker reclaimed the stale lock; the job is now freshly processing and must be left alone.
    const { applicable, skipped } = reconcileIngestionRecoveryPlan({
      planned,
      jobs: [{ ...staleJob, locked_at: "2026-06-14T23:58:00.000Z" }],
      now,
      staleAfterMinutes,
    });

    expect(applicable).toEqual([]);
    expect(skipped).toEqual([{ action: planned[0], reason: "state_changed" }]);
  });

  it("drops an action whose job left the open statuses entirely", () => {
    const planned = buildIngestionRecoveryPlan({ now, staleAfterMinutes, jobs: [staleJob] }).actions;

    const { applicable, skipped } = reconcileIngestionRecoveryPlan({
      planned,
      jobs: [],
      now,
      staleAfterMinutes,
    });

    expect(applicable).toEqual([]);
    expect(skipped).toEqual([{ action: planned[0], reason: "job_closed" }]);
  });

  it("preserves supersede-before-retry ordering across reconciliation", () => {
    const jobs = [
      staleJob,
      {
        id: "job-sibling",
        document_id: "doc-a",
        status: "failed",
        locked_at: null,
        documents: { status: "processing", chunk_count: 0, owner_id: "owner-1" },
      },
    ];
    const planned = buildIngestionRecoveryPlan({ now, staleAfterMinutes, jobs }).actions;

    const { applicable } = reconcileIngestionRecoveryPlan({ planned, jobs, now, staleAfterMinutes });

    expect(applicable.map((entry) => entry.action.action)).toEqual(["supersede", "retry"]);
  });
});

describe("shared operator recovery application", () => {
  const expected = {
    jobStatus: "failed",
    jobLockedAt: null,
    jobLeaseToken: "lease",
    jobLeaseExpiresAt: null,
    documentStatus: "failed",
    documentOwnerId: "owner",
  };
  const action = { action: "retry" as const, jobId: "job", documentId: "doc", resetDocument: false };
  it("passes the complete observed authority snapshot to SQL and respects ownership loss", async () => {
    const calls: unknown[] = [];
    const client = {
      rpc: async (...args: unknown[]) => {
        calls.push(args);
        return { data: { ok: false, reason: "active_lease" }, error: null };
      },
    };
    expect(await applyIngestionRecoveryActions(client, [{ action, expected }])).toEqual([
      { action, applied: false, reason: "active_lease" },
    ]);
    expect(calls).toEqual([["recover_ingestion_job", { p_job_id: "job", p_action: "retry", p_expected: expected }]]);
  });
  it("stops before any follow-up operation when required recovery SQL is unavailable", async () => {
    let calls = 0;
    const client = {
      rpc: async () => {
        calls += 1;
        return { data: null, error: { message: "Missing recovery RPC" } };
      },
    };
    await expect(
      applyIngestionRecoveryActions(client, [
        { action, expected },
        { action, expected },
      ]),
    ).rejects.toThrow("Missing recovery RPC");
    expect(calls).toBe(1);
  });
});
