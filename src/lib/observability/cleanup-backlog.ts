// Storage cleanup backlog snapshot for the deep /api/health probe (audit F-10).
//
// When deleting a document cannot remove its stored files, the delete still succeeds and the
// leftover paths are queued as a `storage_cleanup_jobs` row (status `pending` while the delete
// handler runs, `failed` when a storage removal failed). Nothing drains that queue on a schedule:
// `npm run cleanup:storage` (scripts/cleanup-storage.ts) is a manual operator drain. Without a
// count somewhere, a growing backlog of orphaned files is invisible. This reports how many rows
// are outstanding so the daily ops digest can show it.
//
// Like `slo`/`spend`, it runs only behind the secret-gated deep probe, reads head-only counts and
// one `created_at` (never paths, titles or owners), and never flips liveness.

export type StorageCleanupBacklogSnapshot = {
  pending: number;
  failed: number;
  outstanding: number;
  // created_at of the oldest pending or failed row; null when the queue is empty.
  oldestOutstandingAt: string | null;
};

type CountResult = { count: number | null; error: unknown };
type OldestResult = { data: Array<{ created_at: string | null }> | null; error: unknown };

// Minimal structural view of the PostgREST calls used here. The Supabase admin client is
// assignable to it, and tests pass a small fake (same approach as spend-metrics.ts).
type CountQuery = PromiseLike<CountResult> & {
  eq(column: string, value: string): CountQuery;
};
type OldestQuery = PromiseLike<OldestResult> & {
  in(column: string, values: string[]): OldestQuery;
  order(column: string, options: { ascending: boolean }): OldestQuery;
  limit(count: number): OldestQuery;
};

export type CleanupBacklogProbeClient = {
  from(table: "storage_cleanup_jobs"): {
    select(columns: "id", options: { count: "exact"; head: true }): CountQuery;
    select(columns: "created_at"): OldestQuery;
  };
};

function countOrThrow(result: CountResult) {
  if (result.error) throw new Error("Storage cleanup backlog count failed.");
  return typeof result.count === "number" && Number.isFinite(result.count) && result.count >= 0 ? result.count : 0;
}

/**
 * Count outstanding storage cleanup jobs. Throws on a query error so the caller can drop the
 * block rather than report a falsely empty queue.
 */
export async function storageCleanupBacklogSnapshot(
  client: CleanupBacklogProbeClient,
): Promise<StorageCleanupBacklogSnapshot> {
  const [pendingResult, failedResult, oldestResult] = await Promise.all([
    client.from("storage_cleanup_jobs").select("id", { count: "exact", head: true }).eq("status", "pending"),
    client.from("storage_cleanup_jobs").select("id", { count: "exact", head: true }).eq("status", "failed"),
    client
      .from("storage_cleanup_jobs")
      .select("created_at")
      .in("status", ["pending", "failed"])
      .order("created_at", { ascending: true })
      .limit(1),
  ]);
  const pending = countOrThrow(pendingResult);
  const failed = countOrThrow(failedResult);
  if (oldestResult.error) throw new Error("Storage cleanup backlog age lookup failed.");
  const oldest = oldestResult.data?.[0]?.created_at;
  return {
    pending,
    failed,
    outstanding: pending + failed,
    oldestOutstandingAt: typeof oldest === "string" && Number.isFinite(Date.parse(oldest)) ? oldest : null,
  };
}
