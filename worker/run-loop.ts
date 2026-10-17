import { safeErrorLogDetails, safeIngestionJobLog } from "../src/lib/privacy";
import { isWorkerClaimLoopPaused } from "./health";
import type { JobRow } from "./types";
import type { WorkerErrorStage } from "./observability";
import { WorkerRuntimeControl, WorkerAbortError } from "./runtime-control";

export { isWorkerClaimLoopPaused };

export type WorkerRunLoopDeps = {
  once: boolean;
  pollMs: number;
  healthBackoffMs: number;
  maxClaimFailures: number;
  claim: () => Promise<JobRow[]>;
  process: (job: JobRow) => Promise<void>;
  probe: () => Promise<{ ok: boolean; message?: string }>;
  backoff: (consecutiveFailures: number) => number;
  controller: WorkerRuntimeControl;
  log: (message: string, level: "info" | "warn" | "error", extra?: Record<string, unknown>) => void;
  /**
   * Optional pause check (defaults to WORKER_PAUSED=true or WORKER_CLAIM_LOOP_ENABLED=false).
   * When true, the worker keeps /healthz live and skips claiming new jobs.
   */
  isPaused?: () => boolean;
  /**
   * Optional Sentry/privacy-safe capture. Restores the pre-extraction
   * threshold-transition claim report and per-job process report.
   */
  captureException?: (error: unknown, stage: WorkerErrorStage) => void;
};

export async function runWorkerLoop(deps: WorkerRunLoopDeps): Promise<void> {
  const {
    once,
    pollMs,
    healthBackoffMs,
    maxClaimFailures,
    claim,
    process,
    probe,
    backoff,
    controller,
    log,
    isPaused = () => isWorkerClaimLoopPaused(globalThis.process?.env),
    captureException,
  } = deps;
  let consecutiveClaimFailures = 0;
  let loggedPauseState = false;

  // Stop exits via explicit breaks after probe/claim/sleep checks. An in-flight
  // batch always drains before the next loop condition, so an `active` counter
  // in the while predicate would always be 0 when evaluated.
  while (!controller.isStopped) {
    let jobs: JobRow[] = [];
    try {
      const health = await probe();
      if (!health.ok) {
        log("Supabase health check failed; worker is backing off", "warn", { message: health.message });
        if (once) {
          throw new WorkerAbortError("Supabase health check failed in --once mode", 1, {
            cause: health.message ? new Error(health.message) : undefined,
          });
        }
        if (controller.isStopped) break;
        await controller.sleep(healthBackoffMs);
        continue;
      }
      // Do not lease new work after SIGTERM/SIGINT — drain only.
      if (controller.isStopped) break;
      if (isPaused()) {
        if (!loggedPauseState) {
          log("Worker claim loop is paused; skipping job claim", "info", { claimLoopPaused: true });
          loggedPauseState = true;
        }
        consecutiveClaimFailures = 0;
        if (once) break;
        if (controller.isStopped) break;
        await controller.sleep(pollMs);
        continue;
      }
      loggedPauseState = false;
      jobs = await claim();
      consecutiveClaimFailures = 0;
    } catch (error) {
      if (error instanceof WorkerAbortError) throw error;

      consecutiveClaimFailures += 1;
      log("Ingestion job claim failed", "warn", safeErrorLogDetails(error));
      // Report only on the threshold transition: a single transient claim
      // failure is normal, and a sustained outage must not spam Sentry on
      // every subsequent poll after the retry budget is spent.
      if (consecutiveClaimFailures === maxClaimFailures) {
        captureException?.(error, "claim");
      }
      if (once) {
        throw new WorkerAbortError("Ingestion job claim failed in --once mode", 1, { cause: error });
      }
      if (consecutiveClaimFailures >= maxClaimFailures) {
        if (controller.isStopped) break;
        await controller.sleep(healthBackoffMs);
        continue;
      }
      if (controller.isStopped) break;
      await controller.sleep(backoff(consecutiveClaimFailures));
      continue;
    }

    if (jobs.length > 0) {
      await Promise.all(
        jobs.map(async (job) => {
          log(safeIngestionJobLog(job.id), "info");
          try {
            await process(job);
          } catch (error) {
            log("Ingestion job processing failed", "error", safeErrorLogDetails(error));
            captureException?.(error, "process");
            // Do not rethrow: processJob already applies the configured
            // retry/fail decision; rethrowing would short-circuit the batch
            // and does not honour the per-job semantics.
          }
        }),
      );

      if (once) break;
      // If stop was requested while the batch ran, we drain first, then exit.
      continue;
    }

    if (once) break;
    if (controller.isStopped) break;
    await controller.sleep(pollMs);
  }
}
