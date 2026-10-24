export type IngestionRecoveryJob = {
  id: string;
  document_id: string;
  status: string | null;
  locked_at?: string | null;
  lease_token?: string | null;
  lease_expires_at?: string | null;
  documents?: {
    status?: string | null;
    page_count?: number | null;
    chunk_count?: number | null;
    owner_id?: string | null;
  } | null;
};

export type IngestionRecoveryAction =
  | { action: "supersede"; jobId: string; documentId: string }
  | { action: "retry"; jobId: string; documentId: string; resetDocument: boolean };

export const INGESTION_RECOVERY_JOB_STATUSES = ["pending", "processing", "failed"] as const;

function parseLockedAt(value: string | null | undefined) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function isStaleProcessingJob(job: IngestionRecoveryJob, now: Date, staleAfterMinutes: number) {
  if (job.status !== "processing") return false;
  if (job.lease_expires_at != null) {
    const expiry = parseLockedAt(job.lease_expires_at);
    return expiry !== null && expiry <= now.getTime();
  }
  const lockedAt = parseLockedAt(job.locked_at);
  if (lockedAt === null) return false;
  return lockedAt < now.getTime() - staleAfterMinutes * 60_000;
}

export function isRecoverableProcessingJob(job: IngestionRecoveryJob, now: Date, staleAfterMinutes: number) {
  if (job.status !== "processing") return false;
  if (job.lease_expires_at != null) {
    const expiry = parseLockedAt(job.lease_expires_at);
    return expiry !== null && expiry <= now.getTime();
  }
  const lockedAt = parseLockedAt(job.locked_at);
  if (lockedAt === null) return true;
  return lockedAt < now.getTime() - staleAfterMinutes * 60_000;
}

export function isFreshProcessingJob(job: IngestionRecoveryJob, now: Date, staleAfterMinutes: number) {
  if (job.status !== "processing") return false;
  if (job.lease_expires_at != null) {
    const expiry = parseLockedAt(job.lease_expires_at);
    return expiry === null || expiry > now.getTime();
  }
  const lockedAt = parseLockedAt(job.locked_at);
  if (lockedAt === null) return false;
  return lockedAt >= now.getTime() - staleAfterMinutes * 60_000;
}

export function buildIngestionRecoveryPlan(args: {
  jobs: IngestionRecoveryJob[];
  now?: Date;
  staleAfterMinutes: number;
}) {
  const now = args.now ?? new Date();
  const actions: IngestionRecoveryAction[] = [];

  const jobsByDocument = new Map<string, IngestionRecoveryJob[]>();
  for (const job of args.jobs) {
    const siblings = jobsByDocument.get(job.document_id) ?? [];
    siblings.push(job);
    jobsByDocument.set(job.document_id, siblings);
  }

  for (const [documentId, jobs] of jobsByDocument) {
    const document = jobs[0]?.documents;
    const isIndexedDocument = document?.status === "indexed" && Number(document.chunk_count ?? 0) > 0;
    const activeJob =
      jobs.find((job) => job.status === "pending") ??
      jobs.find((job) => isFreshProcessingJob(job, now, args.staleAfterMinutes));

    if (activeJob) {
      // A pending or freshly processing job is already the legitimate queue owner. Keep it intact
      // and close only failed/stale siblings; retrying an older sibling would either collide with
      // the open-job unique index or silently supersede valid work depending on fetch order.
      for (const job of jobs) {
        if (job.id === activeJob.id || job.status === "completed") continue;
        actions.push({ action: "supersede", jobId: job.id, documentId });
      }
      continue;
    }

    const recoverableJobs = jobs.filter(
      (job) => job.status === "failed" || isRecoverableProcessingJob(job, now, args.staleAfterMinutes),
    );

    if (isIndexedDocument) {
      for (const job of recoverableJobs) {
        actions.push({ action: "supersede", jobId: job.id, documentId });
      }
      continue;
    }

    const retryJob = recoverableJobs.find((job) => job.status === "processing") ?? recoverableJobs[0];
    if (!retryJob) continue;

    for (const job of recoverableJobs) {
      if (job.id !== retryJob.id) actions.push({ action: "supersede", jobId: job.id, documentId });
    }
    // Recovery preserves all generations; the next claim mints a fresh write generation.
    actions.push({ action: "retry", jobId: retryJob.id, documentId, resetDocument: false });
  }

  // Apply supersedes before retries. A retry flips a row to `pending`; if a redundant sibling for
  // the same document is still open when that happens, the two rows collide on the partial unique
  // index. Both consumers apply `actions` in array order, so closing the siblings first here keeps
  // recovery crash-safe regardless of the order jobs were fetched in. (Audit I2/E2)
  const orderedActions = [
    ...actions.filter((action) => action.action === "supersede"),
    ...actions.filter((action) => action.action === "retry"),
  ];

  return {
    actions: orderedActions,
    // Kept for callers that display the preview; recovery never deletes index artifacts.
    resetDocumentIds: [] as string[],
    supersedeCount: orderedActions.filter((action) => action.action === "supersede").length,
    retryCount: orderedActions.filter((action) => action.action === "retry").length,
  };
}

export type IngestionRecoverySkipReason =
  /** The job left the open-recovery statuses entirely (completed, or the row was deleted). */
  | "job_closed"
  /** The job is still open, but the re-derived plan no longer prescribes this action for it. */
  | "state_changed";

export type IngestionRecoveryRowState = {
  jobStatus: string | null;
  jobLockedAt: string | null;
  jobLeaseToken: string | null;
  jobLeaseExpiresAt: string | null;
  documentStatus: string | null;
  documentOwnerId: string | null;
};

export type ReconciledIngestionRecoveryAction = {
  action: IngestionRecoveryAction;
  /**
   * Row state observed in the re-read. Every write is guarded on these values so a row that
   * moved again between the re-read and the write is left alone instead of being overwritten.
   */
  expected: IngestionRecoveryRowState;
};

export type IngestionRecoveryReconciliation = {
  applicable: ReconciledIngestionRecoveryAction[];
  skipped: Array<{ action: IngestionRecoveryAction; reason: IngestionRecoverySkipReason }>;
};

function recoveryActionKey(action: IngestionRecoveryAction) {
  return `${action.action}:${action.jobId}`;
}

/**
 * Re-validate a previously computed recovery plan against a fresh read of the queue.
 *
 * `buildIngestionRecoveryPlan` runs against a point-in-time snapshot, and the operator then
 * spends unbounded wall-clock time reading the preview before confirming. In that window a job
 * can finish normally, a worker can re-claim it, or a document can become `indexed` — and the
 * retrying a stale plan can steal a current worker's authority. The RPC revalidates this
 * snapshot under the same authority/job locks as worker claims and preserves index artifacts.
 *
 * This re-derives the plan from the fresh rows and keeps only actions the queue still asks for,
 * carrying the observed row state forward so the caller can guard each write on it.
 */
export function reconcileIngestionRecoveryPlan(args: {
  planned: IngestionRecoveryAction[];
  jobs: IngestionRecoveryJob[];
  now?: Date;
  staleAfterMinutes: number;
}): IngestionRecoveryReconciliation {
  const fresh = buildIngestionRecoveryPlan({
    jobs: args.jobs,
    now: args.now,
    staleAfterMinutes: args.staleAfterMinutes,
  });
  const freshKeys = new Set(fresh.actions.map(recoveryActionKey));
  const jobsById = new Map(args.jobs.map((job) => [job.id, job] as const));

  const applicable: ReconciledIngestionRecoveryAction[] = [];
  const skipped: IngestionRecoveryReconciliation["skipped"] = [];

  for (const action of args.planned) {
    const job = jobsById.get(action.jobId);
    if (!job) {
      skipped.push({ action, reason: "job_closed" });
      continue;
    }
    if (!freshKeys.has(recoveryActionKey(action))) {
      skipped.push({ action, reason: "state_changed" });
      continue;
    }
    applicable.push({
      action,
      expected: {
        jobStatus: job.status ?? null,
        jobLockedAt: job.locked_at ?? null,
        jobLeaseToken: job.lease_token ?? null,
        jobLeaseExpiresAt: job.lease_expires_at ?? null,
        documentStatus: job.documents?.status ?? null,
        documentOwnerId: job.documents?.owner_id ?? null,
      },
    });
  }

  return { applicable, skipped };
}

/** Shared by both operator entry points: every mutation uses the atomic SQL contract. */
export async function applyIngestionRecoveryActions(
  client: {
    rpc(
      name: "recover_ingestion_job",
      args: {
        p_job_id: string;
        p_action: string;
        p_expected: IngestionRecoveryRowState;
      },
    ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  },
  applicable: ReconciledIngestionRecoveryAction[],
) {
  const results: Array<{ action: IngestionRecoveryAction; applied: boolean; reason: string | null }> = [];
  for (const { action, expected } of applicable) {
    const { data, error } = await client.rpc("recover_ingestion_job", {
      p_job_id: action.jobId,
      p_action: action.action,
      p_expected: expected,
    });
    if (error) throw new Error(error.message);
    const outcome = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
    const applied = outcome?.ok === true;
    results.push({
      action,
      applied,
      reason: applied ? null : typeof outcome?.reason === "string" ? outcome.reason : "invalid_recovery_response",
    });
  }
  return results;
}

/**
 * PostgREST filter, applied to the joined `documents` table, for the ingestion jobs an
 * administrator may see and retry: their own documents and the shared public library (no owner).
 * Public-library jobs used to be invisible in the admin panel (audit ING-S-N7, 24 Oct 2026).
 */
export function administeredJobDocumentsFilter(ownerId: string) {
  return `owner_id.eq.${ownerId},owner_id.is.null`;
}
