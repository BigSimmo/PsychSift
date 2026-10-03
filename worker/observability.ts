import * as Sentry from "@sentry/node";

import {
  privacySafeErrorEvent,
  privacySafeTransactionEvent,
  resolveTracesSampleRate,
} from "../src/lib/observability/error-tracking";
import { resolveSentryRelease } from "../src/lib/observability/sentry-release";

/**
 * Ingestion-worker error tracking.
 *
 * The worker is a plain Node process, not a Next runtime, so it initializes
 * `@sentry/node` directly rather than reusing `src/sentry.server.config.ts`.
 * It shares the app's privacy scrubbers: an exported worker event carries an
 * error type, scrubbed stack-frame locations, and a fixed stage label — never
 * a document id, owner id, storage path, filename, or extracted clinical text.
 * See docs/error-tracking.md.
 */

/** Fixed, non-clinical stage labels. Never build these from job data. */
export type WorkerErrorStage = "claim" | "process" | "fatal";

let initialized = false;

/** Inert unless SENTRY_DSN is configured, matching the app's provider gate. */
export function initWorkerErrorTracking(): boolean {
  if (initialized) return true;

  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return false;

  try {
    Sentry.init({
      dsn,
      release: resolveSentryRelease(),
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
      tracesSampleRate: resolveTracesSampleRate(),
      // v11 streams spans by default, bypassing beforeSendTransaction.
      // Keep all worker traces behind the shared privacy scrubber.
      traceLifecycle: "static",
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: { request: false, response: false },
        httpBodies: [],
        urlQueryParams: false,
        databaseQueryData: false,
        genAI: { inputs: false, outputs: false },
        queues: false,
        graphQL: { document: false, variables: false },
        stackFrameVariables: false,
        frameContextLines: 0,
      },
      includeLocalVariables: false,
      attachStacktrace: true,
      maxBreadcrumbs: 0,
      beforeSend(event) {
        return privacySafeErrorEvent(event);
      },
      beforeSendTransaction(event) {
        // Local scrubber shape is structural; cast back to the SDK type.
        return privacySafeTransactionEvent(event as never) as typeof event;
      },
      // v11 removed enableLogs; fail closed even if a logging integration is added.
      beforeSendLog() {
        return null;
      },
    });
    initialized = true;
    return true;
  } catch {
    // Optional observability must never stop ingestion from starting.
    return false;
  }
}

/**
 * Report a worker failure. Ingestion errors routinely quote storage paths,
 * filenames, and extracted document text, so the message itself is discarded
 * by `privacySafeErrorEvent`; the stage tag plus scrubbed stack is what makes
 * the event actionable.
 */
export function captureWorkerException(error: unknown, stage: WorkerErrorStage): void {
  if (!initialized) return;

  try {
    Sentry.withScope((scope) => {
      scope.setTag("service", "worker");
      scope.setTag("worker_stage", stage);
      scope.setFingerprint(["worker", stage, error instanceof Error ? error.name : typeof error]);
      Sentry.captureException(error);
    });
  } catch {
    // Never let telemetry failures mask the ingestion error being reported.
  }
}

/** Flush before the process exits, so a fatal crash still reports. */
export async function flushWorkerErrorTracking(timeoutMs = 2_000): Promise<void> {
  if (!initialized) return;

  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // Shutdown must proceed regardless.
  }
}
