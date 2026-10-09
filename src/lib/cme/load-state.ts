/** The two ways a CPD page can fail to open, as the state notice names them. */
export type CmeFailureState = "offline" | "error";

/** What each browser's `fetch` says when no request left the device (Chrome, Firefox, Safari, Node/undici). */
const NETWORK_FAILURE = /failed to fetch|networkerror|load failed|network request failed|fetch failed/i;

/**
 * One rule for every CPD page. "offline" when the phone says it has no
 * connection, or when the error is the TypeError `fetch` throws because
 * nothing reached the server. Anything else is "error", including a non-OK
 * response turned into an Error: a 503 reached the server, so the phone is
 * online. A programming TypeError is never read as offline, because its
 * message is not a network failure.
 */
export function cmeStateFromError(error: unknown): CmeFailureState {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  if (error instanceof TypeError && NETWORK_FAILURE.test(error.message)) return "offline";
  return "error";
}

/** The line a CPD form shows when a save throws. Offline gets its own words; anything else keeps the server's message. */
export function cmeSaveErrorText(error: unknown, fallback: string): string {
  if (cmeStateFromError(error) === "offline") {
    return "You’re offline, so nothing was saved. Your form is kept. Save again when you’re back online.";
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
