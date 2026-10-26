"use client";

import { CircleAlert, FileText, LogIn, RefreshCw, Search } from "lucide-react";

import { generateQuerySuggestions, type AnswerErrorKind } from "@/components/clinical-dashboard/search-utils";
import { cn, EmptyState, floatingControl, primaryControl } from "@/components/ui-primitives";
import type { AppModeResultKind } from "@/lib/app-modes";
import { answerRecovery } from "@/lib/ui-copy";

/**
 * The dashboard's failed-search empty states: the calm Answer no-results panel, or the
 * Answer/Search unavailable panel with retry. Renders nothing when there is no error, or when
 * the documents results panel reports the error itself.
 */
export function DashboardSearchErrorState({
  error,
  errorKind,
  activeModeResultKind,
  documentsResultsOwnError,
  errorDetail,
  lastFailedQuery,
  query,
  onRephrase,
  onRetry,
  onSearchDocuments,
  onSignInAndSend,
}: {
  error: string | null;
  errorKind: AnswerErrorKind | null;
  activeModeResultKind: AppModeResultKind;
  documentsResultsOwnError: boolean;
  /** The server's own words for this failure, shown only behind a tap (D26-08). */
  errorDetail?: string | null;
  lastFailedQuery: string | null;
  query: string;
  onRephrase: () => void;
  onRetry: () => void;
  onSearchDocuments: () => void;
  /** Opens sign-in and sends the held question once signed in (D26-05). */
  onSignInAndSend?: () => void;
}) {
  const answerMode = activeModeResultKind === "answer";
  if (error && answerMode && errorKind === "session-expired") {
    // The question was never sent, so say so and keep it: one button signs in and sends it,
    // instead of a dead end that left the reader to find Sign in and retype (D26-05).
    return (
      <EmptyState
        icon={LogIn}
        title="You were signed out, so this wasn’t sent"
        body="Your question is kept. Sign in and it will send straight away."
        live="assertive"
        tone="info"
        testId="answer-error"
        actions={
          onSignInAndSend && lastFailedQuery ? (
            <button
              type="button"
              data-testid="answer-error-sign-in-and-send"
              onClick={() => onSignInAndSend()}
              className={cn(primaryControl, "text-xs")}
            >
              <LogIn aria-hidden="true" className="h-4 w-4" />
              Sign in and send
            </button>
          ) : undefined
        }
      />
    );
  }
  if (error && answerMode && errorKind === "daily-limit") {
    // Retry cannot clear the daily cap, so it is not offered (D26-09).
    return (
      <EmptyState
        icon={CircleAlert}
        title="Today’s answers are used up"
        body={error}
        live="polite"
        tone="info"
        testId="answer-error"
        actions={
          <button
            type="button"
            data-testid="answer-error-search-documents"
            onClick={() => onSearchDocuments()}
            className={cn(floatingControl, "text-xs")}
          >
            <FileText aria-hidden="true" className="h-4 w-4" />
            {answerRecovery.searchDocuments}
          </button>
        }
      />
    );
  }
  return error && errorKind === "no-results" && activeModeResultKind === "answer" ? (
    <EmptyState
      icon={Search}
      title={answerRecovery.noResults.heading}
      body={`${answerRecovery.noResults.body} Suggestions: ${generateQuerySuggestions((lastFailedQuery ?? query).trim()).join("; ")}.`}
      live="polite"
      tone="info"
      testId="answer-no-results"
      actions={
        <>
          <button
            type="button"
            data-testid="answer-no-results-rephrase"
            onClick={() => onRephrase()}
            className={cn(primaryControl, "text-xs")}
          >
            {answerRecovery.rephrase}
          </button>
          <button
            type="button"
            data-testid="answer-no-results-search-documents"
            onClick={() => onSearchDocuments()}
            className={cn(floatingControl, "text-xs")}
          >
            <FileText aria-hidden="true" className="h-4 w-4" />
            {answerRecovery.searchDocuments}
          </button>
        </>
      }
    />
  ) : error && !documentsResultsOwnError ? (
    <EmptyState
      icon={CircleAlert}
      title={
        errorKind === "session-expired"
          ? "Sign in again"
          : activeModeResultKind === "answer"
            ? "Answer unavailable"
            : "Search unavailable"
      }
      body={error}
      live="assertive"
      tone="danger"
      testId="answer-error"
      actions={
        // Retry would resend the expired session, so the expired state offers only the sign-in copy.
        activeModeResultKind === "answer" && lastFailedQuery && errorKind !== "session-expired" ? (
          <>
            <button
              type="button"
              data-testid="answer-error-retry"
              onClick={() => onRetry()}
              className={cn(floatingControl, "text-xs")}
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              {answerRecovery.retry}
            </button>
            <button
              type="button"
              data-testid="answer-error-search-documents"
              onClick={() => onSearchDocuments()}
              className={cn(floatingControl, "text-xs")}
            >
              <FileText aria-hidden="true" className="h-4 w-4" />
              {answerRecovery.searchDocuments}
            </button>
            {errorDetail ? (
              <details className="w-full text-xs text-[color:var(--text-muted)]" data-testid="answer-error-detail">
                <summary className="inline-flex min-h-tap cursor-pointer items-center">Show technical detail</summary>
                <span className="break-words">{errorDetail}</span>
              </details>
            ) : null}
          </>
        ) : undefined
      }
    />
  ) : null;
}
