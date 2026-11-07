"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { TimedAnswerProgressUpdate } from "@/components/clinical-dashboard/answer-progress";
import {
  answerRequestMaxDurationMs,
  answerStallTimeoutMs,
  readAnswerStream,
} from "@/components/clinical-dashboard/search-utils";
import { createClientRequestBudget } from "@/components/clinical-dashboard/client-request-budget";
import { documentSummaryQuestion } from "@/lib/answer-contract";
import { resolveScrollBehavior } from "@/lib/scroll-behavior";
import type { AnswerPayload } from "@/components/clinical-dashboard/search-utils";

type AuthRequestHandle = {
  epoch: number;
  release: () => void;
};

/**
 * Document-scoped summarize stream: posts to `/api/answer/stream` with
 * `summaryMode: true` and keeps progress / abort semantics identical to the
 * previous DocumentViewer inline implementation.
 */
export function useDocumentSummarize({
  documentId,
  canUsePrivateApis,
  clientDemoMode,
  viewerReady,
  authorizationHeader,
  registerAuthRequest,
  isAuthEpochCurrent,
  markSessionExpired,
  generatedSummaryRef,
}: {
  documentId: string;
  canUsePrivateApis: boolean;
  clientDemoMode: boolean;
  viewerReady: boolean;
  authorizationHeader: HeadersInit | undefined;
  registerAuthRequest: (controller: AbortController) => AuthRequestHandle;
  isAuthEpochCurrent: (epoch: number) => boolean;
  markSessionExpired: () => void;
  generatedSummaryRef: RefObject<HTMLElement | null>;
}) {
  const [summary, setSummary] = useState<AnswerPayload | null>(null);
  const [summaryQuery, setSummaryQuery] = useState(documentSummaryQuestion);
  const [summaryProgressEvents, setSummaryProgressEvents] = useState<TimedAnswerProgressUpdate[]>([]);
  const [summaryProgressStartedAt, setSummaryProgressStartedAt] = useState<number | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const summaryAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => summaryAbortRef.current?.abort(), []);

  const resetSummary = useCallback(() => {
    summaryAbortRef.current?.abort();
    summaryAbortRef.current = null;
    setSummary(null);
    setSummaryError(null);
    setLoadingSummary(false);
    setSummaryProgressEvents([]);
    setSummaryProgressStartedAt(null);
  }, []);

  const stopSummary = useCallback(() => {
    summaryAbortRef.current?.abort();
    summaryAbortRef.current = null;
    setLoadingSummary(false);
    setSummaryProgressEvents([]);
    setSummaryProgressStartedAt(null);
  }, []);

  const summarize = useCallback(async () => {
    if (!canUsePrivateApis) {
      setSummaryError("Sign in before summarising private documents.");
      return;
    }
    if (!viewerReady || loadingSummary) {
      setSummaryError("Load a source document before summarising.");
      return;
    }
    const query = documentSummaryQuestion;
    const controller = new AbortController();
    const budget = createClientRequestBudget(controller, {
      stallMs: answerStallTimeoutMs,
      maxDurationMs: answerRequestMaxDurationMs,
    });
    summaryAbortRef.current?.abort();
    summaryAbortRef.current = controller;
    const authRequest = registerAuthRequest(controller);
    const startedAt = Date.now();
    setLoadingSummary(true);
    setSummary(null);
    setSummaryQuery(query);
    setSummaryError(null);
    setSummaryProgressStartedAt(startedAt);
    setSummaryProgressEvents([
      {
        stage: "scoping",
        message: "Preparing the clinical search scope.",
        receivedAt: startedAt,
      },
    ]);
    try {
      if (!isAuthEpochCurrent(authRequest.epoch)) {
        throw new DOMException("Stale authentication epoch", "AbortError");
      }
      const response = await budget.wait(
        fetch("/api/answer/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(clientDemoMode ? {} : authorizationHeader),
          },
          body: JSON.stringify({ query, documentId, summaryMode: true }),
          signal: controller.signal,
        }),
      );
      if (response.status === 401) markSessionExpired();
      if (!response.ok) {
        const payload = (await budget.wait(response.json().catch(() => null))) as { error?: unknown } | null;
        throw new Error(
          typeof payload?.error === "string" && payload.error.trim()
            ? payload.error
            : "Answer could not be generated from this document.",
        );
      }
      const payload = await budget.wait(
        readAnswerStream(
          response,
          (progress) => {
            if (
              controller.signal.aborted ||
              summaryAbortRef.current !== controller ||
              !isAuthEpochCurrent(authRequest.epoch)
            )
              return;
            setSummaryProgressEvents((events) => [...events, { ...progress, receivedAt: Date.now() }].slice(-20));
          },
          undefined,
          undefined,
          budget.touch,
          undefined,
          controller.signal,
        ),
      );
      if (controller.signal.aborted || summaryAbortRef.current !== controller || !isAuthEpochCurrent(authRequest.epoch))
        return;
      setSummary(payload);
      window.requestAnimationFrame(() => {
        generatedSummaryRef.current?.scrollIntoView({ block: "start", behavior: resolveScrollBehavior() });
      });
    } catch (error) {
      if (summaryAbortRef.current !== controller || !isAuthEpochCurrent(authRequest.epoch)) return;
      if (
        !budget.timedOut &&
        (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError"))
      )
        return;
      setSummaryProgressEvents([]);
      setSummaryProgressStartedAt(null);
      setSummaryError(
        budget.timedOut
          ? "Answer generation timed out. Please try again."
          : error instanceof Error
            ? error.message
            : "Answer could not be generated from this document.",
      );
    } finally {
      budget.cancel();
      authRequest.release();
      if (summaryAbortRef.current === controller) {
        summaryAbortRef.current = null;
        setLoadingSummary(false);
      }
    }
  }, [
    authorizationHeader,
    canUsePrivateApis,
    clientDemoMode,
    documentId,
    generatedSummaryRef,
    isAuthEpochCurrent,
    loadingSummary,
    markSessionExpired,
    registerAuthRequest,
    viewerReady,
  ]);

  return {
    summary,
    summaryQuery,
    summaryProgressEvents,
    summaryProgressStartedAt,
    loadingSummary,
    summaryError,
    summarize,
    stopSummary,
    resetSummary,
    setSummary,
    setSummaryError,
  };
}
