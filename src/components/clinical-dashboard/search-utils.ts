import {
  normalizeAnswerProgressEvent,
  type AnswerProgressUpdate,
} from "@/components/clinical-dashboard/answer-progress";
import { isAnswerStreamEventName, type VerifiedEvidencePreviewUnit } from "@/lib/answer-stream-contract";
import { projectClientAnswerPayload, type ClientRagAnswerPayload } from "@/lib/answer-client-payload";
import type { RagAnswer } from "@/lib/types";
import { ANSWER_DAILY_LIMIT_CODE, answerBurstLimitMessage, answerDailyLimitMessage } from "@/lib/answer-limit-copy";
import type { ApiClientError } from "@/lib/api-client-error";

export { keywordQueryFromNaturalLanguage } from "@/lib/keyword-query";

export type AnswerPayload = ClientRagAnswerPayload &
  Pick<RagAnswer, "interactionId" | "feedbackToken"> & {
    demoMode?: boolean;
    fallbackMode?: "non_production_demo";
  };

export function evidencePreviewReconcilesWithFinal(preview: VerifiedEvidencePreviewUnit, finalPayload: AnswerPayload) {
  const finalSourcesByIdentity = new Map(
    finalPayload.sources.map((source) => [`${source.document_id}:${source.id}`, JSON.stringify(source)]),
  );
  return preview.sources.every(
    (source) => finalSourcesByIdentity.get(`${source.document_id}:${source.id}`) === JSON.stringify(source),
  );
}

function projectAnswerPayload(value: unknown): AnswerPayload | null {
  const projected = projectClientAnswerPayload(value, true);
  if (!projected || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const extensions = value as Record<string, unknown>;
  if (extensions.interactionId !== undefined && typeof extensions.interactionId !== "string") return null;
  if (extensions.feedbackToken !== undefined && typeof extensions.feedbackToken !== "string") return null;
  if (extensions.demoMode !== undefined && typeof extensions.demoMode !== "boolean") return null;
  if (extensions.fallbackMode !== undefined && extensions.fallbackMode !== "non_production_demo") return null;
  return {
    ...projected,
    ...(typeof extensions.interactionId === "string" ? { interactionId: extensions.interactionId } : {}),
    ...(typeof extensions.feedbackToken === "string" ? { feedbackToken: extensions.feedbackToken } : {}),
    ...(typeof extensions.demoMode === "boolean" ? { demoMode: extensions.demoMode } : {}),
    ...(extensions.fallbackMode === "non_production_demo" ? { fallbackMode: extensions.fallbackMode } : {}),
  };
}

export function isAnswerPayload(value: unknown): value is AnswerPayload {
  return projectAnswerPayload(value) !== null;
}

export type SearchError = Error & {
  status?: number;
  retryable?: boolean;
  code?: string;
  retryAfterMs?: number | null;
  /** The server's own words, kept behind "Show technical detail" rather than shown as the message. */
  detail?: string;
};

export const searchRetryDelaysMs = [500, 1000, 2000] as const;
export const searchRetryCount = 2;

export function makeSearchError(message: string, status?: number, retryable = false): SearchError {
  const error = new Error(message) as SearchError;
  error.status = status;
  error.retryable = retryable;
  return error;
}

function parseSseData(lines: string[]) {
  const data = lines.join("\n").trim();
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    throw makeSearchError("Answer stream returned malformed data.", 500, true);
  }
}

function findSseSeparator(buffer: string) {
  const match = /\r?\n\r?\n/.exec(buffer);
  return match ? { index: match.index, length: match[0].length } : null;
}

/** Consume the answer SSE contract shared by every browser answer surface. */
export async function readAnswerStream(
  response: Response,
  onProgress: (progress: AnswerProgressUpdate) => void,
  _onToken?: (delta: string) => void,
  onRevising?: () => void,
  onActivity?: () => void,
  onEvidencePreview?: (preview: VerifiedEvidencePreviewUnit | null) => void,
): Promise<AnswerPayload> {
  if (!response.body) throw makeSearchError("Answer stream could not be opened.", undefined, true);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pendingCompletion: AnswerProgressUpdate | null = null;
  let lastVerifiedUnitSequence: number | null = null;
  let evidencePreview: VerifiedEvidencePreviewUnit | null = null;

  function clearEvidencePreview() {
    if (evidencePreview === null) return;
    evidencePreview = null;
    onEvidencePreview?.(null);
  }

  function processEvent(block: string) {
    const lines = block.split(/\r?\n/);
    let event = "message";
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice("event:".length).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trimStart());
    }

    if (dataLines.length === 0) return null;
    const data = parseSseData(dataLines);
    if (data === null) return null;
    if (!isAnswerStreamEventName(event)) return null;
    if (event === "progress") {
      const verifiedUnitWasProvided =
        typeof data === "object" &&
        data !== null &&
        !Array.isArray(data) &&
        Object.prototype.hasOwnProperty.call(data, "verifiedUnit");
      const progress = normalizeAnswerProgressEvent(data, lastVerifiedUnitSequence);
      if (verifiedUnitWasProvided && !progress?.verifiedUnit) clearEvidencePreview();
      if (progress) {
        const { verifiedUnit, ...publicProgress } = progress;
        if (verifiedUnit) {
          lastVerifiedUnitSequence = verifiedUnit.sequence;
          if (verifiedUnit.kind === "evidence_preview") {
            evidencePreview = verifiedUnit;
            onEvidencePreview?.(verifiedUnit);
          }
        }
        if (progress.stage === "complete") {
          pendingCompletion = publicProgress;
        } else {
          onProgress(publicProgress);
          if (progress.stage === "fallback") onRevising?.();
        }
      }
      return null;
    }
    if (event === "error") {
      pendingCompletion = null;
      clearEvidencePreview();
      const message = data && typeof data === "object" ? (data as { error?: unknown }).error : null;
      const details =
        data && typeof data === "object" ? (data as { details?: { message?: unknown } | unknown }).details : null;
      const detailMessage =
        details && typeof details === "object" && "message" in details && typeof details.message === "string"
          ? details.message
          : null;
      const status = data && typeof data === "object" ? (data as { status?: unknown }).status : null;
      const statusCode = typeof status === "number" ? status : undefined;
      const errorMessage =
        typeof message === "string" && message.trim()
          ? message
          : typeof detailMessage === "string" && detailMessage.trim()
            ? detailMessage
            : "Answer generation failed due to a streaming error.";
      throw makeSearchError(
        errorMessage,
        statusCode,
        isRetryableStatus(statusCode ?? 0) || isRetryableMessage(errorMessage),
      );
    }
    if (event === "final") {
      const finalPayload = projectAnswerPayload(data);
      if (!finalPayload) {
        pendingCompletion = null;
        clearEvidencePreview();
        throw makeSearchError("Answer stream returned an invalid final payload.", 502, true);
      }
      if (evidencePreview) {
        // The final payload is authoritative in both outcomes. Reconciliation is
        // deliberately evaluated before the preview is discarded so client tests
        // guard the byte-identical subset contract without ever withholding final.
        evidencePreviewReconcilesWithFinal(evidencePreview, finalPayload);
      }
      clearEvidencePreview();
      if (pendingCompletion) {
        onProgress(pendingCompletion);
        pendingCompletion = null;
      }
      return finalPayload;
    }

    return null;
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value && value.length > 0) onActivity?.();
      buffer += decoder.decode(value, { stream: !done });

      let separator = findSseSeparator(buffer);
      while (separator) {
        const block = buffer.slice(0, separator.index).trim();
        buffer = buffer.slice(separator.index + separator.length);
        const finalPayload = block ? processEvent(block) : null;
        if (finalPayload) {
          await reader.cancel().catch(() => undefined);
          return finalPayload;
        }
        separator = findSseSeparator(buffer);
      }

      if (done) break;
    }

    const finalPayload = buffer.trim() ? processEvent(buffer.trim()) : null;
    if (finalPayload) return finalPayload;
    pendingCompletion = null;
    clearEvidencePreview();
    throw makeSearchError("Answer stream ended before a final answer was received.", undefined, true);
  } catch (error) {
    clearEvidencePreview();
    throw error;
  }
}

export function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

export function isRetryableMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("failed to fetch") ||
    normalized.includes("network") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("rate limit") ||
    normalized.includes("rate-limited") ||
    normalized.includes("temporar") ||
    normalized.includes("overload") ||
    normalized.includes("retry") ||
    normalized.includes("unavailable") ||
    normalized.includes("upstream") ||
    normalized.includes("service is currently")
  );
}

export function isRetryableError(error: unknown) {
  if (!(error instanceof Error)) return false;

  const searchError = error as SearchError;
  if (searchError.name === "TypeError") return true;
  if (searchError.retryable !== undefined) return searchError.retryable;
  if (searchError.status !== undefined) return isRetryableStatus(searchError.status);
  return isRetryableMessage(searchError.message);
}

// A request that took this long before failing is not retried. Retrying it would make the reader
// wait the same long time again, twice, before seeing the error: a slow server-side failure (for
// example a search that ran into its time limit) is not the brief blip retries exist for.
export const searchRetrySlowFailureMs = 8_000;

export function shouldRetryFailedAttempt(error: unknown, attemptDurationMs: number) {
  return attemptDurationMs < searchRetrySlowFailureMs && isRetryableError(error);
}

export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export function answerPayloadIsUsable(payload: AnswerPayload) {
  const answerText = payload.answer.trim();
  if (!answerText) return false;
  if (payload.confidence === "unsupported") {
    const hasGapContext = Boolean(payload.relevance || payload.sources?.length || payload.relatedDocuments?.length);
    return hasGapContext;
  }

  return true;
}

export function progressForRetry(attempt: number) {
  if (attempt <= 1) return "Retrying…";
  return `Retrying… (${Math.min(attempt, searchRetryCount)}/${searchRetryCount})`;
}

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

export type AnswerErrorKind = "no-results" | "session-expired" | "daily-limit" | "failure";

/** Shown when the server answers 401: retrying with the expired session cannot help (audit F-15). */
export const SEARCH_SESSION_EXPIRED_MESSAGE = "Your session expired. Sign in again, then try again.";

/**
 * Classify an answer/search failure so the UI can offer the right recovery.
 *
 * A `404` `SearchError` is the sentinel for "the query ran fine but nothing
 * usable came back" (see `makeSearchError("No usable results were found.", 404,
 * false)` in the search executor) — that deserves a calm, helpful panel rather
 * than an alarming error. Everything else (network, 5xx, generic) is a genuine
 * failure the user should be able to retry.
 */
export function classifyAnswerError(error: unknown): AnswerErrorKind {
  if (error instanceof Error && (error as SearchError).status === 404) {
    return "no-results";
  }
  if (error instanceof Error && (error as SearchError).status === 401) {
    return "session-expired";
  }
  if (
    error instanceof Error &&
    (error as SearchError).status === 429 &&
    (error as SearchError).code === ANSWER_DAILY_LIMIT_CODE
  ) {
    return "daily-limit";
  }
  return "failure";
}

/** Shown when the answer service itself fails; the server's words move behind a tap (D26-08). */
export const ANSWER_SERVICE_FAILED_MESSAGE =
  "This answer didn’t finish. Your question is kept. Try again, or search your documents for the same topic.";

/**
 * Turn a failed answer response into plain words. The daily cap gets its reset time and no Retry,
 * a burst limit gets its wait in minutes, and a server fault keeps its own text only as `detail`.
 * Other 4xx messages are already written for the reader and pass through unchanged.
 */
export function answerApiFailure(apiError: ApiClientError, now = Date.now()): SearchError {
  const daily = apiError.status === 429 && apiError.code === ANSWER_DAILY_LIMIT_CODE;
  const message = daily
    ? answerDailyLimitMessage(apiError.retryAfterMs, now)
    : apiError.status === 429
      ? answerBurstLimitMessage(apiError.retryAfterMs)
      : apiError.status >= 500
        ? ANSWER_SERVICE_FAILED_MESSAGE
        : apiError.message;
  const error = makeSearchError(message, apiError.status, daily ? false : apiError.retryable);
  error.code = apiError.code;
  error.retryAfterMs = apiError.retryAfterMs;
  if (message !== apiError.message && apiError.message) error.detail = apiError.message;
  return error;
}

/**
 * Generate intelligent query rephrasing suggestions for zero-result states.
 */
export function generateQuerySuggestions(query: string): string[] {
  if (!query || query.trim() === "") {
    return ["Check for spelling errors", "Try broader search terms", "Remove strict filters"];
  }

  const suggestions: string[] = [];
  const trimmed = query.trim();

  if (trimmed.split(/\s+/).length > 3) {
    suggestions.push("Use fewer words");
  }

  const hasQuotedPhrase = /"[^"]+"|(?:^|\s)'[^']+'(?=\s|$)/.test(trimmed);
  if (hasQuotedPhrase) {
    suggestions.push("Remove quotes for a broader search");
  }

  const booleanQuery = trimmed.replace(/"[^"]*"|(?:^|\s)'[^']+'(?=\s|$)/g, " ");
  if (/(^|[\s(])(AND|OR|NOT)(?=$|[\s),.;:!?])/i.test(booleanQuery)) {
    suggestions.push("Check boolean operators (AND, OR, NOT)");
  } else {
    suggestions.push("Try more general medical terms");
  }

  suggestions.push("Check for alternate spellings");

  return suggestions.slice(0, 3);
}

// Document and registry search is one request and one response, not a stream, so it has no
// heartbeat to reset an inactivity window the way createAnswerRequestWatchdog does. It gets a
// plain deadline instead.
//
// Until this existed, /api/search had no client-side give-up at all. A slow search held the
// "Searching…" band indefinitely with no notice and no error, so a slow search and a dead one
// were indistinguishable from the reader's side — the symptom recorded in
// docs/outstanding-issues.md #X42YJ1, where a documents search appeared to hang and later
// completed in about 20 seconds.
//
// The two thresholds do different jobs. `searchSlowNoticeMs` only says so, leaving the request
// running, because a search that is merely slow still returns something useful and cancelling it
// would throw that away. `searchRequestTimeoutMs` is the give-up, sized above the server's own
// federated ceiling (registry domains bail at 2.5 s, a focused documents domain at 6 s) plus
// retrieval and transfer, so it fires on a genuinely stuck request rather than a slow one.
export const searchSlowNoticeMs = 15_000;
export const searchRequestTimeoutMs = 45_000;

export type SearchRequestDeadline = {
  /** Pass to fetch. Aborts when the caller aborts, or when the timeout fires. */
  readonly signal: AbortSignal;
  /** True only when THIS deadline aborted the request, never for a caller abort. */
  readonly timedOut: boolean;
  /** Disarm both timers. Safe to call more than once, and required on every path. */
  cancel: () => void;
};

/**
 * Bound a single search request. The returned signal also follows `signal`, so a superseded or
 * user-stopped search still cancels immediately.
 *
 * `timedOut` is what lets the caller tell the two aborts apart: a caller abort is silent,
 * because the user asked for it or a newer query replaced this one, while a timeout must
 * surface as a visible failure.
 */
export function createSearchRequestDeadline({
  signal,
  onSlow,
  slowMs = searchSlowNoticeMs,
  timeoutMs = searchRequestTimeoutMs,
}: {
  signal?: AbortSignal;
  onSlow?: () => void;
  slowMs?: number;
  timeoutMs?: number;
} = {}): SearchRequestDeadline {
  const controller = new AbortController();
  let timedOut = false;
  let cancelled = false;

  const forwardCallerAbort = () => {
    controller.abort(signal?.reason);
  };

  const slowTimer = setTimeout(() => {
    if (!cancelled && !controller.signal.aborted) onSlow?.();
  }, slowMs);

  const timeoutTimer = setTimeout(() => {
    if (cancelled || controller.signal.aborted) return;
    timedOut = true;
    controller.abort(new DOMException("Search timed out.", "TimeoutError"));
  }, timeoutMs);

  if (signal?.aborted) forwardCallerAbort();
  else signal?.addEventListener("abort", forwardCallerAbort, { once: true });

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(slowTimer);
      clearTimeout(timeoutTimer);
      signal?.removeEventListener("abort", forwardCallerAbort);
    },
  };
}

/** The message a reader sees when a search is given up on, rather than an endless spinner. */
export function searchTimedOutMessage(label: string) {
  return `${label} took longer than ${Math.round(searchRequestTimeoutMs / 1000)} seconds and was stopped. The service may be busy. Try again, and if it keeps happening the search index may need attention.`;
}
