// Dependency-free request timers. Kept apart from search-utils.ts on purpose:
// search-utils pulls in the answer-stream contract (Zod schemas) and answer
// payload projection, and client-request-budget.ts is imported by the universal
// search hook on `/`. Importing these helpers through search-utils put ~30 KiB
// gzip of answer code on the home route and failed its bundle budget (PR #3901).
// search-utils.ts re-exports everything here, so existing imports keep working.

// Inactivity window for an in-flight search/answer request. The answer stream
// keeps delivering progress events, token deltas, and periodic server
// heartbeats while generation is running, so a healthy request — even one that
// escalates fast -> strong and runs well past a minute — keeps resetting this
// window. Only a stream with no bytes for this long is treated as a stall.
export const answerStallTimeoutMs = 60_000;

// Hard ceiling on a single request regardless of stream activity, sized above
// the server's worst-case pipeline (retrieval + fast generation + strong
// escalation + strong quality repair, each generation capped at
// OPENAI_ANSWER_TIMEOUT_MS) so it only fires on a genuinely runaway stream.
export const answerRequestMaxDurationMs = 180_000;

export type AnswerRequestWatchdog = {
  /** Reset the inactivity window — the stream showed signs of life. */
  touch: () => void;
  /** True once the watchdog fired (stall or max-duration). */
  readonly timedOut: boolean;
  /** Disarm both timers; safe to call more than once. */
  cancel: () => void;
};

/**
 * Watchdog for a streaming answer request. Fires `onTimeout` once when either
 * the stream goes silent for `stallMs` or the request exceeds `maxDurationMs`
 * in total. `touch()` on every received chunk keeps a live-but-slow generation
 * (fast -> strong escalation) from being aborted mid-stream, which previously
 * surfaced as "Answer generation timed out" while tokens were still arriving.
 */
export function createAnswerRequestWatchdog(
  onTimeout: () => void,
  { stallMs = answerStallTimeoutMs, maxDurationMs = answerRequestMaxDurationMs } = {},
): AnswerRequestWatchdog {
  let cancelled = false;
  let fired = false;
  const fire = () => {
    if (cancelled || fired) return;
    fired = true;
    onTimeout();
  };
  let stallTimer = setTimeout(fire, stallMs);
  const maxDurationTimer = setTimeout(fire, maxDurationMs);
  return {
    touch() {
      if (cancelled || fired) return;
      clearTimeout(stallTimer);
      stallTimer = setTimeout(fire, stallMs);
    },
    get timedOut() {
      return fired;
    },
    cancel() {
      cancelled = true;
      clearTimeout(stallTimer);
      clearTimeout(maxDurationTimer);
    },
  };
}

// Give-up for a single document/registry search request (see createSearchRequestDeadline in
// search-utils.ts for why it is sized above the server's federated ceiling).
export const searchRequestTimeoutMs = 45_000;
