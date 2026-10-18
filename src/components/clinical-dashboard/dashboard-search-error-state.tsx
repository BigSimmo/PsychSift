"use client";

import { CircleAlert, FileText, RefreshCw, Search } from "lucide-react";

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
  lastFailedQuery,
  query,
  onRephrase,
  onRetry,
  onSearchDocuments,
}: {
  error: string | null;
  errorKind: AnswerErrorKind | null;
  activeModeResultKind: AppModeResultKind;
  documentsResultsOwnError: boolean;
  lastFailedQuery: string | null;
  query: string;
  onRephrase: () => void;
  onRetry: () => void;
  onSearchDocuments: () => void;
}) {
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
      title={activeModeResultKind === "answer" ? "Answer unavailable" : "Search unavailable"}
      body={error}
      live="assertive"
      tone="danger"
      testId="answer-error"
      actions={
        activeModeResultKind === "answer" && lastFailedQuery ? (
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
          </>
        ) : undefined
      }
    />
  ) : null;
}
