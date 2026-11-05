import { createAnswerRequestWatchdog, searchRequestTimeoutMs } from "@/components/clinical-dashboard/search-utils";

/** Keep headers and body under one budget, even if a dependency ignores abort. */
export function createClientRequestBudget(
  controller: AbortController,
  { stallMs = searchRequestTimeoutMs, maxDurationMs = searchRequestTimeoutMs } = {},
) {
  const { signal } = controller;
  const watchdog = createAnswerRequestWatchdog(
    () => {
      controller.abort(new DOMException("Request timed out.", "TimeoutError"));
    },
    { stallMs, maxDurationMs },
  );
  const stopOnAbort = () => watchdog.cancel();
  if (signal.aborted) stopOnAbort();
  else signal.addEventListener("abort", stopOnAbort, { once: true });

  return {
    get timedOut() {
      return watchdog.timedOut;
    },
    touch: watchdog.touch,
    wait<T>(operation: Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        let settled = false;
        const settle = (commit: () => void) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", abort);
          commit();
        };
        const abort = () =>
          settle(() =>
            reject(
              signal.reason instanceof Error
                ? signal.reason
                : new DOMException("The operation was aborted.", "AbortError"),
            ),
          );
        signal.addEventListener("abort", abort, { once: true });
        // Always observe settlement, including after abort, so a late rejection
        // cannot become unhandled or write state through the waiting caller.
        operation.then(
          (value) => settle(() => resolve(value)),
          (error: unknown) => settle(() => reject(error)),
        );
        if (signal.aborted) abort();
      });
    },
    cancel() {
      watchdog.cancel();
      signal.removeEventListener("abort", stopOnAbort);
    },
  };
}
