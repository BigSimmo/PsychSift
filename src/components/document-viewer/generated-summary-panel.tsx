"use client";

import type { RefObject } from "react";
import { CircleAlert, Sparkles, TriangleAlert } from "lucide-react";
import type { TimedAnswerProgressUpdate } from "@/components/clinical-dashboard/answer-progress";
import type { AnswerPayload } from "@/components/clinical-dashboard/search-utils";
import { AnswerProgress } from "@/components/clinical-dashboard/answer-status";
import { SafeBoldText } from "@/components/SafeBoldText";
import { cn, floatingControl, panel, PanelHeading } from "@/components/ui-primitives";
import {
  answerStateFromRetrieval,
  answerUsesDegradedMode,
  answerUsesSourceOnlyProvenance,
} from "@/components/ui/answer-state";
import { VerificationNotice } from "@/components/ui/verification-notice";
import { demoAnswerDisclosure } from "@/lib/answer-client-payload";
import { frontendSourceGovernanceWarnings, groupSourceGovernanceWarnings } from "@/lib/source-governance";
import type { SourceGovernanceWarning } from "@/lib/types";

export type GeneratedSummaryPanelProps = {
  loadingSummary: boolean;
  summary: AnswerPayload | null;
  summaryError: string | null;
  summaryProgressStartedAt: number | null;
  summaryProgressEvents: TimedAnswerProgressUpdate[];
  stopSummary: () => void;
  generatedSummaryRef: RefObject<HTMLElement | null>;
  generatedAnswerIsSummary: boolean;
  generatedSummaryText: string;
  /** The open document; citations to any other document get no page link here. */
  documentId?: string;
  /** Moves the reader to a cited page so the answer can be checked against the source. */
  onOpenPage?: (page: number) => void;
};

function citesThisDocument(documentId: string | undefined, citedDocumentId: string | null | undefined) {
  return !documentId || !citedDocumentId || citedDocumentId === documentId;
}

function validPage(page: number | null | undefined): page is number {
  return typeof page === "number" && Number.isFinite(page) && page >= 1;
}

function citedPagesFor(summary: AnswerPayload, documentId: string | undefined): number[] {
  const pages = new Set<number>();
  for (const citation of summary.citations) {
    if (validPage(citation.page_number) && citesThisDocument(documentId, citation.document_id)) {
      pages.add(Math.trunc(citation.page_number));
    }
  }
  return [...pages].sort((left, right) => left - right);
}

/**
 * The document-scoped answer reads the same grounding signals as the main
 * answer surface. It used to show only `summary.answer` under a fixed "From
 * indexed passages" line, so an answer the pipeline marked ungrounded, a
 * degraded or demo reply, and its safety and governance warnings all reached
 * the reader looking like a checked summary, with no cited page to check it by.
 */
export function GeneratedSummaryPanel({
  loadingSummary,
  summary,
  summaryError,
  summaryProgressStartedAt,
  summaryProgressEvents,
  stopSummary,
  generatedSummaryRef,
  generatedAnswerIsSummary,
  generatedSummaryText,
  documentId,
  onOpenPage,
}: GeneratedSummaryPanelProps) {
  if (!loadingSummary && !summary && !summaryError) return null;

  const answerState = summary
    ? answerStateFromRetrieval({
        sources: summary.sources,
        citations: summary.citations,
        answerQualityTier: summary.answerQualityTier,
        routingMode: summary.routingMode,
        fallbackReasonCode: summary.fallbackReasonCode,
        degradedMode: summary.degradedMode,
        grounded: summary.grounded,
        confidence: summary.confidence,
        unverifiedNumericTokens: summary.unverifiedNumericTokens,
      })
    : null;
  const demoAnswer = summary?.demoMode === true || summary?.fallbackMode === "non_production_demo";
  // Any signal that the prose is not a plain grounded answer takes away the
  // "from indexed passages" claim and puts the governed verification wording in
  // its place.
  const qualifiedAnswer = Boolean(
    summary && answerState && (demoAnswer || answerState.kind !== "ready" || answerUsesDegradedMode(summary)),
  );
  const safetyWarnings = summary?.safetyWarnings ?? [];
  const governanceWarnings = summary
    ? groupSourceGovernanceWarnings(
        frontendSourceGovernanceWarnings((summary.sourceGovernanceWarnings ?? []) as SourceGovernanceWarning[]),
      )
    : [];
  const citedPages = summary ? citedPagesFor(summary, documentId) : [];

  return (
    <div className="min-w-0 space-y-3 lg:col-span-2">
      {summaryProgressStartedAt && summaryProgressEvents.length > 0 ? (
        <AnswerProgress
          events={summaryProgressEvents}
          startedAt={summaryProgressStartedAt}
          active={loadingSummary}
          onStop={stopSummary}
        />
      ) : null}
      {summary && (
        <section
          ref={generatedSummaryRef}
          data-testid="generated-clinical-summary"
          data-answer-state={answerState?.kind}
          className={cn(panel, "p-4 source-print")}
        >
          <PanelHeading
            icon={Sparkles}
            title={generatedAnswerIsSummary ? "Clinical summary" : "Answer from this document"}
            description={
              qualifiedAnswer
                ? undefined
                : generatedAnswerIsSummary
                  ? "From indexed passages, cleaned for practical use."
                  : "Grounded in indexed passages from this source."
            }
          />
          {demoAnswer ? (
            <p role="note" className="mt-3 text-sm text-[color:var(--warning)]">
              {demoAnswerDisclosure}
            </p>
          ) : null}
          {qualifiedAnswer && answerState ? (
            <VerificationNotice
              className="mt-3"
              state={answerState.kind}
              attribution={answerUsesSourceOnlyProvenance(summary) ? "extractive" : "model"}
              sourceCount={"sourceCount" in answerState ? answerState.sourceCount : undefined}
            />
          ) : null}
          <p className="mt-3 whitespace-pre-wrap text-base-minus leading-6 text-[color:var(--text-muted)]">
            <SafeBoldText text={generatedSummaryText} />
          </p>
          {safetyWarnings.length > 0 || governanceWarnings.length > 0 ? (
            <ul data-testid="generated-summary-warnings" className="mt-3 space-y-2">
              {governanceWarnings.map((warning) => (
                <li
                  key={`governance:${warning.code}:${warning.message}`}
                  className="flex items-start gap-2 text-sm text-[color:var(--warning)]"
                >
                  <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{warning.message}</span>
                </li>
              ))}
              {safetyWarnings.map((warning) => {
                const warningPage =
                  validPage(warning.citation.page_number) && citesThisDocument(documentId, warning.citation.document_id)
                    ? Math.trunc(warning.citation.page_number)
                    : null;
                return (
                  <li key={`safety:${warning.id}`} className="flex items-start gap-2 text-sm text-[color:var(--text)]">
                    <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--warning)]" />
                    <span className="min-w-0">
                      <span className="font-semibold">{warning.label}: </span>
                      <SafeBoldText text={warning.text} />
                      {onOpenPage && warningPage !== null ? (
                        <>
                          {" "}
                          <button
                            type="button"
                            aria-label={`Open page ${warningPage}`}
                            onClick={() => onOpenPage(warningPage)}
                            className="inline-flex min-h-tap items-center font-semibold text-[color:var(--clinical-accent)] underline underline-offset-2"
                          >
                            {`p. ${warningPage}`}
                          </button>
                        </>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {onOpenPage && citedPages.length > 0 ? (
            <nav aria-label="Cited pages" className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-[color:var(--text-muted)]">Cited pages</span>
              {citedPages.map((page) => (
                <button
                  key={page}
                  type="button"
                  aria-label={`Open page ${page}`}
                  onClick={() => onOpenPage(page)}
                  className={floatingControl}
                >
                  {`p. ${page}`}
                </button>
              ))}
            </nav>
          ) : null}
        </section>
      )}
      {summaryError && (
        <section className="rounded-lg border border-[color:var(--danger)]/30 bg-[color:var(--danger-soft)] p-4 text-sm font-medium text-[color:var(--danger)]">
          <CircleAlert aria-hidden="true" className="mr-2 inline h-4 w-4" />
          {summaryError}
        </section>
      )}
    </div>
  );
}
