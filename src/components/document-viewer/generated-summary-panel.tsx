"use client";

import type { RefObject } from "react";
import { CircleAlert, Sparkles } from "lucide-react";
import type { TimedAnswerProgressUpdate } from "@/components/clinical-dashboard/answer-progress";
import type { AnswerPayload } from "@/components/clinical-dashboard/search-utils";
import { AnswerProgress } from "@/components/clinical-dashboard/answer-status";
import { SafeBoldText } from "@/components/SafeBoldText";
import { cn, panel, PanelHeading } from "@/components/ui-primitives";

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
};

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
}: GeneratedSummaryPanelProps) {
  if (!loadingSummary && !summary && !summaryError) return null;

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
          className={cn(panel, "p-4 source-print")}
        >
          <PanelHeading
            icon={Sparkles}
            title={generatedAnswerIsSummary ? "Clinical summary" : "Answer from this document"}
            description={
              generatedAnswerIsSummary
                ? "From indexed passages, cleaned for practical use."
                : "Grounded in indexed passages from this source."
            }
          />
          <p className="mt-3 whitespace-pre-wrap text-base-minus leading-6 text-[color:var(--text-muted)]">
            <SafeBoldText text={generatedSummaryText} />
          </p>
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
