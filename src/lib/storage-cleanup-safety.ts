export type StorageCleanupCandidate = {
  id: string;
  document_id: string | null;
};

// Audit R11: the DELETE route creates a storage_cleanup_jobs row (carrying the
// live document's source-PDF + image paths) BEFORE its final guards; if the
// delete then aborts, the row is left behind still pointing at a document that
// was never deleted. The janitor removes those paths, permanently destroying a
// live document's storage. The precise signal is the ledger FK
// (storage_cleanup_jobs.document_id -> documents, ON DELETE SET NULL): a
// genuinely-deleted document has its ledger document_id nulled, so a non-null
// document_id that STILL resolves to a live document proves the delete did not
// complete. Skip those rows instead of executing them.
export function partitionStorageCleanupJobs<T extends StorageCleanupCandidate>(
  jobs: T[],
  liveDocumentIds: ReadonlySet<string>,
): { safe: T[]; skipped: T[] } {
  const safe: T[] = [];
  const skipped: T[] = [];
  for (const job of jobs) {
    if (job.document_id && liveDocumentIds.has(job.document_id)) {
      skipped.push(job);
    } else {
      safe.push(job);
    }
  }
  return { safe, skipped };
}

// Audit F-09: superseded index generations queue their image objects with a null
// document_id (the document itself is still live), so the R11 guard above cannot protect
// them. The database checks references when it queues a path; re-check when draining, and
// never remove an image object that a document_images row still points at.
export function withoutReferencedPaths(paths: readonly string[], referencedPaths: ReadonlySet<string>): string[] {
  return Array.from(new Set(paths.filter((path) => Boolean(path) && !referencedPaths.has(path))));
}

export function nonNullDocumentIds(jobs: StorageCleanupCandidate[]): string[] {
  return Array.from(new Set(jobs.map((job) => job.document_id).filter((id): id is string => Boolean(id))));
}

// A drain run records its own outcome without erasing why the job was queued: a prune job's
// source document and pruned generations stay, and the queuing operation moves to queued_operation.
export function cleanupJobMetadata(
  previous: unknown,
  operation: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const base =
    previous && typeof previous === "object" && !Array.isArray(previous)
      ? { ...(previous as Record<string, unknown>) }
      : {};
  const queuedOperation = base.queued_operation ?? base.operation;
  return {
    ...base,
    ...(queuedOperation === undefined ? {} : { queued_operation: queuedOperation }),
    ...extra,
    operation,
  };
}
