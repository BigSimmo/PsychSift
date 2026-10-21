import { isPdfExtractionResourceError, isPdfUnreadableError } from "@/lib/extractors/pdf-extraction-budget";

export function isRetryableIngestionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (isPdfExtractionResourceError(error)) return false;
  if (isPdfUnreadableError(error)) return false;
  // Duplicate-key conflicts — including document_pages page-number duplicates —
  // are partial index-write conflicts that the worker routes to manual queue
  // recovery, never auto-retry. (Audit L17: removed an unreachable retry
  // special-case for the page-number constraint that this short-circuit made
  // dead code; recovery is the deliberate path for those conflicts.)
  if (isPartialIndexWriteConflict(error)) return false;
  return /\b(429|rate limit|timeout|temporar|network|fetch failed|ECONNRESET|ETIMEDOUT|5\d\d|502|503|504|bad gateway|gateway timeout|service unavailable)\b/i.test(
    message,
  );
}

export function isPartialIndexWriteConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate key value violates unique constraint/i.test(message);
}

export function retryDelayMs(attemptCount: number) {
  const attempt = Math.max(1, attemptCount);
  return Math.min(30 * 60_000, 60_000 * 2 ** (attempt - 1));
}

export function nextRetryAt(attemptCount: number, now = new Date()) {
  return new Date(now.getTime() + retryDelayMs(attemptCount)).toISOString();
}

export function terminalBatchStatus(args: { queued: number; processing: number; failed: number }) {
  if (args.queued > 0 || args.processing > 0) return "processing";
  return args.failed > 0 ? "completed_with_errors" : "completed";
}

// Audit R16: retrying a `completed` ingestion job resurrects a terminal row
// into a zombie re-ingest — a worker can re-claim it and interleave a fresh
// build against the live committed index. Completed work is re-run via the
// reindex route (which enqueues a NEW job); retry is only for jobs that have
// not completed. Returns a rejection message, or null when the retry may run.
export function ingestionJobRetryRejectionReason(status: string | null | undefined): string | null {
  if (status === "completed") {
    return "This ingestion job already completed. Reindex the document to rebuild it instead of retrying a completed job.";
  }
  return null;
}

// Audit R15/R16: the retry route must NOT demote an already-indexed document to
// `queued`. A queued document takes the worker's non-atomic path, which runs
// reset_document_index at job start and deletes the entire live committed index
// hours before any replacement commit — so a transient failure of a healthy
// indexed document would otherwise destroy its clinical index. Indexed
// documents keep their status (atomic reindex: the old index stays live until
// the new commit swaps the generation); only non-indexed documents are
// re-queued. Either way we clear error_message and stamp the rollback fence.
export function retryDocumentQueueUpdate(args: { documentStatus: string | null | undefined; fenceStamp: string }): {
  status?: "queued";
  error_message: null;
  updated_at: string;
} {
  const base = { error_message: null as null, updated_at: args.fenceStamp };
  if (args.documentStatus === "indexed") {
    return base;
  }
  return { status: "queued", ...base };
}

export type StorageCleanupJobUpdate = {
  status: "completed" | "failed";
  attempts: number;
  storage_removed: number;
  last_error: string | null;
  completed_at: string | null;
  metadata: { operation: string; storage_warnings: string[] };
  document_paths?: string[];
  image_paths?: string[];
};

// Audit R11: the DELETE route creates the storage_cleanup_jobs ledger row (with
// the LIVE document's source-PDF + image paths) before the point of no return.
// If the delete then aborts — late re-check 409, trace-cleanup failure, or the
// DB delete failing — the document is still alive, but the ledger row keeps its
// populated paths and only its status flips to `failed`. The storage janitor
// (scripts/cleanup-storage.ts) drains rows in status ('pending','failed') and
// never checks the document still exists, so one routine janitor run then
// permanently deletes a live document's PDF and images. Clearing the paths on
// every abort path defuses the ledger row: the janitor may still pick it up but
// has nothing to remove. Successful cleanup keeps its paths for auditability.
export function buildStorageCleanupJobUpdate(args: {
  status: "completed" | "failed";
  storageRemoved: number;
  warnings: string[];
  aborted?: boolean;
  now?: Date;
}): StorageCleanupJobUpdate {
  const update: StorageCleanupJobUpdate = {
    status: args.status,
    attempts: 1,
    storage_removed: args.storageRemoved,
    last_error: args.warnings.length ? args.warnings.join("; ") : null,
    completed_at: args.status === "completed" ? (args.now ?? new Date()).toISOString() : null,
    metadata: {
      operation: "permanent_document_delete",
      storage_warnings: args.warnings,
    },
  };
  if (args.aborted) {
    update.document_paths = [];
    update.image_paths = [];
  }
  return update;
}

// Audit R1: the worker never refreshes ingestion_jobs.locked_at during a job,
// so any build longer than WORKER_STALE_AFTER_MINUTES is reclaimed by
// claim_ingestion_jobs while the original worker is still alive → two workers
// process one document (the enabler for the R2-R8 write-clobber class). Making
// the periodic progress write double as a lease heartbeat keeps a healthy
// worker's lease fresh. This decides WHEN that write happens: the existing
// throttle (minIntervalMs / minDelta / stage-prefix change) plus a heartbeat
// ceiling that forces a write during long silent phases (e.g. a single slow
// OpenAI call) so the lease cannot age out mid-job. The worker scopes the write
// itself to `locked_by = workerId`, so a worker that has already lost its lease
// no-ops instead of stealing it back.
export function shouldPersistJobProgress(args: {
  previous?: { updatedAt: number; progress: number; stage: string };
  next: { progress: number; stage: string };
  now: number;
  minIntervalMs: number;
  minDelta: number;
  heartbeatMs: number;
}): boolean {
  const { previous, next, now, minIntervalMs, minDelta, heartbeatMs } = args;
  if (!previous) return true;
  const elapsed = now - previous.updatedAt;
  if (elapsed >= heartbeatMs) return true;
  if (elapsed >= minIntervalMs) return true;
  if (Math.abs(next.progress - previous.progress) >= minDelta) return true;
  return next.stage.split(" ")[0] !== previous.stage.split(" ")[0];
}
