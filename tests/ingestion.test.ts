import { describe, expect, it } from "vitest";
import {
  buildStorageCleanupJobUpdate,
  ingestionJobRetryRejectionReason,
  isPartialIndexWriteConflict,
  isRetryableIngestionError,
  nextRetryAt,
  retryDelayMs,
  retryDocumentQueueUpdate,
  shouldPersistJobProgress,
  terminalBatchStatus,
} from "../src/lib/ingestion";

describe("ingestion retry helpers", () => {
  it("classifies transient failures as retryable", () => {
    expect(isRetryableIngestionError(new Error("429 rate limit"))).toBe(true);
    expect(isRetryableIngestionError(new Error("network timeout"))).toBe(true);
    expect(isRetryableIngestionError(new Error('duplicate key value violates unique constraint "other_key"'))).toBe(
      false,
    );
    expect(isRetryableIngestionError(new Error("invalid pdf password"))).toBe(false);
  });

  it("classifies duplicate unique-key failures as partial-write conflicts", () => {
    const error = new Error(
      'duplicate key value violates unique constraint "document_chunks_document_id_chunk_index_key"',
    );
    expect(isPartialIndexWriteConflict(error)).toBe(true);
    expect(isRetryableIngestionError(error)).toBe(false);
  });

  it("backs off retry delays with a cap", () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(240_000);
    expect(retryDelayMs(20)).toBe(30 * 60_000);
  });

  it("produces terminal batch status from job counts", () => {
    expect(terminalBatchStatus({ queued: 1, processing: 0, failed: 0 })).toBe("processing");
    expect(terminalBatchStatus({ queued: 0, processing: 0, failed: 1 })).toBe("completed_with_errors");
    expect(terminalBatchStatus({ queued: 0, processing: 0, failed: 0 })).toBe("completed");
  });

  it("computes a future retry timestamp", () => {
    expect(Date.parse(nextRetryAt(1, new Date("2026-05-27T00:00:00.000Z")))).toBe(
      Date.parse("2026-05-27T00:01:00.000Z"),
    );
  });
});

describe("job progress lease heartbeat (R1)", () => {
  const opts = { minIntervalMs: 5_000, minDelta: 4, heartbeatMs: 900_000 };
  const prev = { updatedAt: 1_000_000, progress: 50, stage: "embedding chunks 1-8/40" };

  it("always writes the first progress update", () => {
    expect(shouldPersistJobProgress({ next: { progress: 5, stage: "downloading" }, now: 0, ...opts })).toBe(true);
  });

  it("skips a throttled update with no meaningful change", () => {
    expect(
      shouldPersistJobProgress({
        previous: prev,
        next: { progress: 51, stage: prev.stage },
        now: prev.updatedAt + 1_000,
        ...opts,
      }),
    ).toBe(false);
  });

  it("writes once the progress delta is large enough", () => {
    expect(
      shouldPersistJobProgress({
        previous: prev,
        next: { progress: 55, stage: prev.stage },
        now: prev.updatedAt + 1_000,
        ...opts,
      }),
    ).toBe(true);
  });

  it("writes on a stage-prefix change even when throttled", () => {
    expect(
      shouldPersistJobProgress({
        previous: prev,
        next: { progress: 50, stage: "captioning images 1-8/20" },
        now: prev.updatedAt + 1,
        ...opts,
      }),
    ).toBe(true);
  });

  it("forces a heartbeat write during a long silent phase with no progress change", () => {
    // Same stage/progress, but the heartbeat ceiling has elapsed — must write so
    // locked_at stays fresh and the live job is not reclaimed as stale.
    expect(
      shouldPersistJobProgress({
        previous: prev,
        next: { progress: 50, stage: prev.stage },
        now: prev.updatedAt + opts.heartbeatMs,
        ...opts,
      }),
    ).toBe(true);
  });
});

describe("ingestion job retry guards (R15/R16)", () => {
  it("rejects retrying a completed job (zombie re-ingest)", () => {
    expect(ingestionJobRetryRejectionReason("completed")).toMatch(/already completed/i);
  });

  it("allows retrying non-completed jobs", () => {
    for (const status of ["failed", "pending", "processing", null, undefined]) {
      expect(ingestionJobRetryRejectionReason(status)).toBeNull();
    }
  });

  it("never demotes an indexed document to queued (keeps its live index)", () => {
    const update = retryDocumentQueueUpdate({ documentStatus: "indexed", fenceStamp: "2026-07-07T00:00:00.123Z" });
    expect(update).not.toHaveProperty("status");
    expect(update.error_message).toBeNull();
    expect(update.updated_at).toBe("2026-07-07T00:00:00.123Z");
  });

  it("re-queues non-indexed documents so the worker rebuilds them", () => {
    for (const status of ["failed", "queued", "processing", null]) {
      const update = retryDocumentQueueUpdate({ documentStatus: status, fenceStamp: "2026-07-07T00:00:00.500Z" });
      expect(update.status).toBe("queued");
      expect(update.error_message).toBeNull();
      expect(update.updated_at).toBe("2026-07-07T00:00:00.500Z");
    }
  });
});

describe("storage cleanup ledger update (R11)", () => {
  it("clears storage paths when the delete aborts so the janitor cannot remove a live document's storage", () => {
    const update = buildStorageCleanupJobUpdate({
      status: "failed",
      storageRemoved: 0,
      warnings: ["Document gained pending indexing work during delete."],
      aborted: true,
    });
    expect(update.status).toBe("failed");
    expect(update.document_paths).toEqual([]);
    expect(update.image_paths).toEqual([]);
    expect(update.completed_at).toBeNull();
    expect(update.last_error).toContain("gained pending");
  });

  it("preserves storage paths on a genuine post-delete failure so the janitor can finish removal", () => {
    const update = buildStorageCleanupJobUpdate({
      status: "failed",
      storageRemoved: 2,
      warnings: ["Extracted images: transient network error"],
    });
    // The document row is already gone; the janitor must still remove its
    // orphaned storage, so paths are left untouched (undefined = not written).
    expect(update.document_paths).toBeUndefined();
    expect(update.image_paths).toBeUndefined();
    expect(update.storage_removed).toBe(2);
  });

  it("stamps completed_at only on success and never clears paths there", () => {
    const now = new Date("2026-07-07T00:00:00.000Z");
    const update = buildStorageCleanupJobUpdate({ status: "completed", storageRemoved: 3, warnings: [], now });
    expect(update.completed_at).toBe(now.toISOString());
    expect(update.last_error).toBeNull();
    expect(update.document_paths).toBeUndefined();
  });
});
