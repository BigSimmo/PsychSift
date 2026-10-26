import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANSWER_SERVICE_FAILED_MESSAGE,
  answerApiFailure,
  answerPayloadIsUsable,
  answerRequestMaxDurationMs,
  answerStallTimeoutMs,
  classifyAnswerError,
  createAnswerRequestWatchdog,
  isAnswerPayload,
  isRetryableError,
  keywordQueryFromNaturalLanguage,
  makeSearchError,
  progressForRetry,
  searchRetrySlowFailureMs,
  shouldRetryFailedAttempt,
  SEARCH_SESSION_EXPIRED_MESSAGE,
} from "@/components/clinical-dashboard/search-utils";
import { ApiClientError } from "@/lib/api-client-error";
import type { RagAnswer } from "@/lib/types";

function answer(overrides: Partial<RagAnswer> = {}): RagAnswer {
  return {
    answer: "Use linked sources to verify the clinical point.",
    grounded: true,
    confidence: "medium",
    citations: [],
    sources: [],
    ...overrides,
  };
}

describe("clinical dashboard search utilities", () => {
  it("converts natural-language fallback queries into deduplicated keywords", () => {
    expect(
      keywordQueryFromNaturalLanguage("What clozapine monitoring items are shown in the clozapine table image?"),
    ).toBe("what clozapine monitoring items shown table image");
  });

  it("keeps unsupported answers usable only when they carry gap context", () => {
    expect(answerPayloadIsUsable(answer({ confidence: "unsupported" }))).toBe(false);
    expect(
      answerPayloadIsUsable(
        answer({
          confidence: "unsupported",
          relatedDocuments: [
            {
              document_id: "doc-1",
              title: "Synthetic guideline",
              file_name: "synthetic.pdf",
              labels: [],
              summary: null,
              best_pages: [1],
              best_chunk_ids: ["chunk-1"],
              image_count: 0,
              match_reason: "Closest related source for an unsupported query.",
              score: 0.7,
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("accepts only structurally valid answer payloads at the stream boundary", () => {
    expect(isAnswerPayload(answer())).toBe(true);
    expect(isAnswerPayload({ ...answer(), confidence: "certain" })).toBe(false);
    expect(isAnswerPayload({ ...answer(), citations: null })).toBe(false);
    expect(isAnswerPayload({ ...answer(), sources: "not-an-array" })).toBe(false);
    expect(isAnswerPayload({ ...answer(), demoMode: "true" })).toBe(false);
  });

  it("classifies retryable search errors", () => {
    expect(isRetryableError(makeSearchError("Service is currently unavailable.", 503, true))).toBe(true);
    expect(isRetryableError(makeSearchError(SEARCH_SESSION_EXPIRED_MESSAGE, 401))).toBe(false);
  });

  it("retries a quick retryable failure but not one that already took a long time", () => {
    const blip = makeSearchError("Service is currently unavailable.", 503, true);
    expect(shouldRetryFailedAttempt(blip, 1_200)).toBe(true);
    expect(shouldRetryFailedAttempt(blip, searchRetrySlowFailureMs)).toBe(false);
    expect(shouldRetryFailedAttempt(blip, 15_000)).toBe(false);
    expect(shouldRetryFailedAttempt(makeSearchError("Not authorized.", 401), 100)).toBe(false);
  });

  it("formats retry progress without exposing impossible counts", () => {
    expect(progressForRetry(1)).toBe("Retrying…");
    expect(progressForRetry(10)).toBe("Retrying… (2/2)");
  });

  it("classifies a 404 as a calm no-results outcome and everything else as a retryable failure", () => {
    // The executor uses makeSearchError("No usable results were found.", 404, false) as the empty-result sentinel.
    expect(classifyAnswerError(makeSearchError("No usable results were found.", 404, false))).toBe("no-results");
    expect(classifyAnswerError(makeSearchError("Answer generation failed.", 500, true))).toBe("failure");
    // A 401 means the session expired, so the panel asks the reader to sign in again instead of retrying.
    expect(classifyAnswerError(makeSearchError(SEARCH_SESSION_EXPIRED_MESSAGE, 401))).toBe("session-expired");
    // Bare network TypeError and unknown non-error values must never masquerade as no-results.
    expect(classifyAnswerError(new TypeError("Failed to fetch"))).toBe("failure");
    expect(classifyAnswerError(new Error("Search failed"))).toBe("failure");
    expect(classifyAnswerError(null)).toBe("failure");
    expect(classifyAnswerError("boom")).toBe("failure");
  });
});

describe("answer request watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once after the stall window when the stream shows no activity", () => {
    const onTimeout = vi.fn();
    const watchdog = createAnswerRequestWatchdog(onTimeout);

    vi.advanceTimersByTime(answerStallTimeoutMs - 1);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(watchdog.timedOut).toBe(false);

    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(watchdog.timedOut).toBe(true);

    // Neither timer fires a second time.
    vi.advanceTimersByTime(answerRequestMaxDurationMs);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("does not fire while the stream keeps showing activity, even past the old flat timeout", () => {
    const onTimeout = vi.fn();
    const watchdog = createAnswerRequestWatchdog(onTimeout);

    // Simulate a slow fast->strong escalation: activity every 15s for 2 minutes.
    for (let elapsed = 0; elapsed < 120_000; elapsed += 15_000) {
      vi.advanceTimersByTime(15_000);
      watchdog.touch();
    }
    expect(onTimeout).not.toHaveBeenCalled();
    watchdog.cancel();
  });

  it("enforces the absolute ceiling even when activity never stops", () => {
    const onTimeout = vi.fn();
    const watchdog = createAnswerRequestWatchdog(onTimeout);

    for (let elapsed = 0; elapsed < answerRequestMaxDurationMs; elapsed += 10_000) {
      vi.advanceTimersByTime(10_000);
      watchdog.touch();
    }
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(watchdog.timedOut).toBe(true);
  });

  it("never fires after cancel, and touch after cancel stays inert", () => {
    const onTimeout = vi.fn();
    const watchdog = createAnswerRequestWatchdog(onTimeout);

    watchdog.cancel();
    watchdog.touch();
    vi.advanceTimersByTime(answerRequestMaxDurationMs * 2);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(watchdog.timedOut).toBe(false);
  });

  it("respects custom stall and ceiling budgets", () => {
    const onTimeout = vi.fn();
    const watchdog = createAnswerRequestWatchdog(onTimeout, { stallMs: 100, maxDurationMs: 250 });

    vi.advanceTimersByTime(90);
    watchdog.touch();
    vi.advanceTimersByTime(90);
    watchdog.touch();
    expect(onTimeout).not.toHaveBeenCalled();

    // 180ms elapsed; ceiling at 250ms fires before the next stall window ends.
    vi.advanceTimersByTime(70);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(watchdog.timedOut).toBe(true);
  });
});

// D26-08 to D26-10: a failed answer reads in plain words, the daily cap offers no Retry and
// gives a clock time, and the server's own words are kept only as detail.
describe("answerApiFailure", () => {
  const now = new Date(2026, 9, 26, 9, 0, 0).getTime();

  it("turns the daily cap into a non-retryable daily-limit with a reset time", () => {
    const error = answerApiFailure(
      new ApiClientError("This account has reached its daily limit.", 429, "generation_daily_cap", true, 38_400_000),
      now,
    );
    expect(error.retryable).toBe(false);
    expect(classifyAnswerError(error)).toBe("daily-limit");
    expect(error.message).toMatch(/You can ask again from 7:40\s?pm\./);
    expect(error.message).not.toMatch(/seconds/);
  });

  it("gives a burst limit its wait in minutes and keeps it retryable", () => {
    const error = answerApiFailure(new ApiClientError("Too many requests.", 429, "rate_limited", true, 42_000), now);
    expect(error.retryable).toBe(true);
    expect(classifyAnswerError(error)).toBe("failure");
    expect(error.message).toBe("Too many questions in a short time. Wait a minute, then try again.");
  });

  it("keeps a server fault's words as detail, not as the message", () => {
    const error = answerApiFailure(new ApiClientError("upstream_timeout: stream closed", 502, "http_502", true), now);
    expect(error.message).toBe(ANSWER_SERVICE_FAILED_MESSAGE);
    expect(error.detail).toBe("upstream_timeout: stream closed");
    expect(error.retryable).toBe(true);
  });

  it("passes a written 4xx message through unchanged", () => {
    const error = answerApiFailure(new ApiClientError("Question is too long.", 400, "invalid_request", false), now);
    expect(error.message).toBe("Question is too long.");
    expect(error.detail).toBeUndefined();
  });
});
