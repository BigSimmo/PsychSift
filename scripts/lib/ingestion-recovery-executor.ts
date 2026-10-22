import { randomUUID } from "node:crypto";
import {
  reconcileIngestionRecoveryPlan,
  type IngestionRecoveryAction,
  type IngestionRecoveryJob,
} from "@/lib/ingestion-recovery";
import type { createAdminClient } from "@/lib/supabase/admin";

export function supabaseStageError(stage: string, error: unknown) {
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const message =
    typeof record.message === "string" && record.message.trim().length > 0
      ? record.message
      : `Supabase operation failed during ${stage}`;
  const wrapped = new Error(message);
  wrapped.name = "SupabaseRecoveryError";
  Object.assign(wrapped, {
    stage,
    code: record.code,
    details: record.details,
    hint: record.hint,
  });
  return wrapped;
}

/** Shared apply path for both queue-recovery CLIs. Re-read only after confirmation. */
export async function applyIngestionRecoveryPlan({
  supabase,
  actions,
  staleAfterMinutes,
  readJobs,
}: {
  supabase: ReturnType<typeof createAdminClient>;
  actions: IngestionRecoveryAction[];
  staleAfterMinutes: number;
  readJobs: () => Promise<IngestionRecoveryJob[]>;
}) {
  // The plan above is a point-in-time snapshot and the operator may have spent minutes reading it
  // at the confirmation prompt. In that window a job can complete, a worker can re-claim it, or a
  // document can reach `indexed` — and the retry branch is destructive, because
  // `reset_document_index` deletes every chunk, page, image and section for the document with no
  // guard of its own. Re-derive the plan against current rows, then guard every write on the state
  // just observed so a row that moved again is left alone rather than overwritten. (Audit R20/R21)
  console.log("\nRe-reading the queue before applying...");
  const jobs = await readJobs();

  const { applicable, skipped } = reconcileIngestionRecoveryPlan({
    planned: actions,
    jobs,
    staleAfterMinutes,
  });

  for (const entry of skipped) {
    const because = entry.reason === "job_closed" ? "job closed before apply" : "queue state changed before apply";
    console.log(
      `  skipped ${entry.action.action} job ${entry.action.jobId} (document ${entry.action.documentId}): ${because}`,
    );
  }

  if (applicable.length === 0) {
    console.log("\nNothing left to apply. The queue moved on while the plan awaited confirmation.");
  } else {
    console.log(`\nApplying job recovery (${applicable.length} of ${actions.length} planned action(s))...`);

    // This operator claim changes locked_by and locked_at, but does not mint or renew the
    // fenced worker lease. claim_ingestion_jobs uses lease_expires_at, so a row whose old
    // lease has expired can be reclaimed during reset. The reset is not atomically fenced.
    const recoveryWorkerId = `recovery:${randomUUID()}`;

    // Release only while this run still owns locked_by. A fresh locked_at makes the
    // recovery planner treat the row as active; it does not exclude worker reclamation,
    // which uses lease_expires_at.
    const releaseRecoveryClaim = async (jobId: string, stage: string, patch: Record<string, unknown>) => {
      const { data: released, error } = await supabase
        .from("ingestion_jobs")
        .update({ ...patch, stage, locked_by: null })
        .eq("id", jobId)
        .eq("locked_by", recoveryWorkerId)
        .select("id");
      return { released: (released ?? []).length > 0, error };
    };
    const lostRace = (action: { action: string; jobId: string; documentId: string }, what: string) =>
      console.log(`  skipped ${action.action} job ${action.jobId} (document ${action.documentId}): ${what}`);

    let supersededCount = 0;
    let retriedCount = 0;

    // Supersedes first: a retry flips its row to an open status, which would collide with a still-open
    // sibling on ingestion_jobs_one_open_per_document_uidx. (Audit I2/E2, preserved.)
    for (const { action, expected } of applicable) {
      if (action.action !== "supersede") continue;
      if (!expected.jobStatus) {
        lostRace(action, "job status was unreadable at re-read");
        continue;
      }

      const supersede = supabase
        .from("ingestion_jobs")
        .update({
          status: "completed",
          stage: "superseded by successful index",
          progress: 100,
          error_message: null,
          locked_at: null,
          locked_by: null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", action.jobId)
        .eq("status", expected.jobStatus);
      const guarded =
        expected.jobLockedAt === null
          ? supersede.is("locked_at", null)
          : supersede.eq("locked_at", expected.jobLockedAt);

      const { data: rows, error: supersedeError } = await guarded.select("id");
      if (supersedeError) throw supabaseStageError("supersede sibling ingestion job", supersedeError);
      if ((rows ?? []).length === 0) {
        lostRace(action, "job changed state before the write");
        continue;
      }
      supersededCount += 1;
    }

    for (const { action, expected } of applicable) {
      if (action.action !== "retry") continue;
      if (!expected.jobStatus) {
        lostRace(action, "job status was unreadable at re-read");
        continue;
      }

      // Phase 1 — take the recovery lock, guarded on the exact row state observed at re-read.
      const claim = supabase
        .from("ingestion_jobs")
        .update({
          status: "processing",
          stage: "recovery: resetting index",
          error_message: null,
          locked_by: recoveryWorkerId,
          locked_at: new Date().toISOString(),
        })
        .eq("id", action.jobId)
        .eq("status", expected.jobStatus);
      const guardedClaim =
        expected.jobLockedAt === null ? claim.is("locked_at", null) : claim.eq("locked_at", expected.jobLockedAt);

      const { data: claimed, error: claimError } = await guardedClaim.select("id");
      if (claimError) {
        // 23505 = another open job for this document appeared after the re-read. Leave it to that job.
        if ((claimError as { code?: string }).code === "23505") {
          lostRace(action, "another open job for this document appeared before the write");
          continue;
        }
        throw supabaseStageError("claim ingestion job for recovery", claimError);
      }
      if ((claimed ?? []).length === 0) {
        lostRace(action, "job changed state before the write");
        continue;
      }

      // Everything from here is compensated on failure, because the recovery lock is now held.
      let indexWasCleared = false;
      try {
        // Phase 2 — reset the document, guarded on the document status observed at re-read, so a
        // document that reached `indexed` in the meantime keeps its committed index.
        const documentUpdate = supabase
          .from("documents")
          .update({ status: "queued", error_message: null, page_count: 0, chunk_count: 0, image_count: 0 })
          .eq("id", action.documentId);
        const scopedDocument = expected.documentOwnerId
          ? documentUpdate.eq("owner_id", expected.documentOwnerId)
          : documentUpdate.is("owner_id", null);
        const guardedDocument =
          expected.documentStatus === null
            ? scopedDocument.is("status", null)
            : scopedDocument.eq("status", expected.documentStatus);

        const { data: documentRows, error: documentError } = await guardedDocument.select("id");
        if (documentError) throw supabaseStageError("reset document status", documentError);

        if ((documentRows ?? []).length === 0) {
          // The document moved on. Release the lock back to the state we found it in and touch nothing.
          const release = await releaseRecoveryClaim(action.jobId, "recovery: released, document changed state", {
            status: expected.jobStatus,
            locked_at: expected.jobLockedAt,
          });
          if (release.error) throw supabaseStageError("release recovery lock", release.error);
          lostRace(
            action,
            release.released
              ? "document changed state before the write; index left intact"
              : "document changed state before the write; recovery claim changed before release; index left intact",
          );
          continue;
        }

        // Past this point the document row is already zeroed, so a failure cannot be rolled back to
        // the pre-recovery state — the compensation below carries it forward to a retryable one.
        indexWasCleared = true;

        const { error: resetError } = await supabase.rpc("reset_document_index", {
          p_document_id: action.documentId,
        });
        if (resetError) throw supabaseStageError("reset document index", resetError);

        // Phase 3 — release the recovery lock back into the queue for the worker to claim.
        const retry = await releaseRecoveryClaim(action.jobId, "queued after recovery", {
          status: "pending",
          progress: 0,
          attempt_count: 0,
          error_message: null,
          locked_at: null,
          next_run_at: new Date().toISOString(),
          completed_at: null,
        });
        if (retry.error) throw supabaseStageError("requeue ingestion job", retry.error);
        if (!retry.released) {
          lostRace(action, "recovery claim changed before requeue; job left with its current owner");
          continue;
        }
        retriedCount += 1;
      } catch (error) {
        // Attempt to release our lock before rethrowing. If the document was not touched, put the job
        // back exactly as it was found. If its index was already cleared, the document genuinely
        // needs a rebuild now, so mark the job `failed` — which the planner treats as recoverable —
        // rather than restoring a status that no longer describes the document.
        const compensation = indexWasCleared
          ? await releaseRecoveryClaim(action.jobId, "recovery: interrupted after index reset", {
              status: "failed",
              locked_at: null,
              error_message:
                "Ingestion queue recovery was interrupted after the document index was cleared. Re-run recovery to rebuild.",
            })
          : await releaseRecoveryClaim(action.jobId, "recovery: released after failure", {
              status: expected.jobStatus,
              locked_at: expected.jobLockedAt,
            });

        if (compensation.error) {
          // Retain the original failure. Lease expiry alone does not guarantee recovery:
          // exhausted-attempt jobs can require an explicit operator recovery decision.
          console.error(
            `  failed to release the recovery lock on job ${action.jobId}; inspect its lease and attempt budget before operator recovery.`,
          );
        } else if (!compensation.released) {
          lostRace(action, "recovery claim changed before failure cleanup; job left with its current owner");
        }
        throw error;
      }
    }

    console.log(`Ingestion queue recovery applied (superseded ${supersededCount}, requeued ${retriedCount}).`);
  }

  return { jobs };
}
