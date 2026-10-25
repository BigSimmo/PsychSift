"use client";

import { useId, useState } from "react";
import { ChevronDown, FileWarning, Info, TriangleAlert } from "lucide-react";

import { cn, toneInfo, toneWarning } from "@/components/ui-primitives";
import type { DegradedAnswerState, OverdueSource, SourceRef, UngroundedReason } from "@/components/ui/answer-state";
import { DateDisplay } from "@/components/ui/date-display";
import { createBoundedDiagnosticRecorder } from "@/components/ui/design-system-diagnostics";
import { StatusMark } from "@/components/ui/status-mark";

/**
 * COMPONENTS §2. The banner that sits above the prose whenever the answer is
 * anything other than `ready`.
 *
 * It is caution, never a gate (DECISIONS §Q1): the answer stays readable and
 * every affected source keeps a one-click route to the cited page, because the
 * clinician's next act after "this might be stale" is re-verification, not
 * abandonment.
 *
 * It is deliberately NOT a live region — announcements go through
 * `LiveAnnouncer` once on settle, so a screen-reader user hears the caveat with
 * the answer rather than as a second interruption.
 */

export type RetrievalStateBannerProps = {
  state: DegradedAnswerState;
  /** Q1: the clinician's next act is re-verification — one click to the cited page. */
  onOpenSource: (sourceId: string, locator?: string) => void;
  className?: string;
};

const recordEmptyState = createBoundedDiagnosticRecorder();

function noteEmptyState(kind: string, message: string, field: string, key: string) {
  const dedupeKey = `${kind}:${key}`;
  recordEmptyState(dedupeKey, JSON.stringify({ level: "warn", message, field, value: key }));
}

function OpenSourceButton({
  sourceId,
  title,
  locator,
  onOpenSource,
}: SourceRef & { onOpenSource: RetrievalStateBannerProps["onOpenSource"] }) {
  const destination = locator ? `${title}, ${locator}` : title;
  return (
    <button
      type="button"
      data-testid="retrieval-state-open-source"
      onClick={() => onOpenSource(sourceId, locator)}
      aria-label={`Open ${destination}`}
      className="inline-flex min-h-tap items-center rounded-md px-2 text-sm font-semibold underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
    >
      Open source
    </button>
  );
}

function StaleEvidenceBody({
  overdue,
  sourceCount,
  onOpenSource,
}: {
  overdue: OverdueSource[];
  sourceCount: number;
  onOpenSource: RetrievalStateBannerProps["onOpenSource"];
}) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  // Totality is its own sentence. "3 sources are past review" reads very
  // differently when 3 is also the total. Treat sourceCount below the overdue
  // count (including 0) as totality so we never print "2 of 0 sources…".
  const everySourceOverdue = overdue.length > 0 && overdue.length >= sourceCount;
  const scope = everySourceOverdue
    ? "Every source for this answer"
    : `${overdue.length} of ${sourceCount} sources for this answer`;
  // A superseded document is not "due for review" — it has been replaced, and
  // saying the softer thing is the error that matters here.
  const superseded = overdue.filter((source) => source.status === "outdated").length;
  const headline =
    // Production fallback for the guarded defect above: state the caution
    // without a count rather than announcing "0 of 3".
    overdue.length === 0
      ? "Some sources for this answer are past their review date."
      : superseded === overdue.length
        ? `${scope} ${everySourceOverdue ? "has" : "have"} been superseded.`
        : superseded > 0
          ? `${scope} ${everySourceOverdue ? "is" : "are"} past ${everySourceOverdue ? "its" : "their"} review date, including ${superseded} that ${superseded === 1 ? "has" : "have"} been superseded.`
          : `${scope} ${everySourceOverdue ? "is" : "are"} past ${everySourceOverdue ? "its" : "their"} review date.`;
  // The collapsed chip is often the only text a clinician reads, so it carries the
  // same distinction: never "Review due" alone when a cited source was superseded.
  const collapsedLabel =
    superseded === 0 ? "Review due" : superseded === overdue.length ? "Superseded" : "Superseded / review due";

  return (
    <div
      className={cn(
        "w-fit max-w-full overflow-hidden border text-2xs",
        open ? "rounded-lg" : "rounded-full",
        toneWarning,
      )}
    >
      <button
        type="button"
        data-testid="retrieval-state-stale-toggle"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={detailId}
        className="flex min-h-compact-meta max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-left transition hover:bg-[color:var(--warning-soft)]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--focus)]"
      >
        <span data-testid="retrieval-state-headline" className="min-w-0 truncate font-semibold">
          {collapsedLabel}
        </span>
        <span className="shrink-0 text-2xs text-[color:var(--text-muted)]">
          · {overdue.length} {overdue.length === 1 ? "source" : "sources"}
        </span>
        <ChevronDown
          className={cn(
            "ml-auto size-icon-xs shrink-0 text-[color:var(--text-muted)] transition-transform",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      <div id={detailId} hidden={!open} className="mt-1 border-t border-[color:var(--warning)]/15 px-2.5 pb-2 pt-2">
        <p className="font-semibold">{headline}</p>
        <ul className="mt-2 space-y-1">
          {overdue.map((source) => (
            <li
              key={source.sourceId}
              data-testid="retrieval-state-overdue-row"
              data-status={source.status}
              className="flex flex-wrap items-center gap-x-2 gap-y-1"
            >
              <StatusMark status={source.status} className="mt-1.5 self-start" />
              <span className="min-w-0 font-medium">{source.title}</span>
              {source.locator ? <span className="text-[color:var(--text-muted)]">{source.locator}</span> : null}
              <span className="text-[color:var(--text-muted)]">
                {source.status === "outdated" ? "Superseded — was due " : "Review due "}
                <DateDisplay value={source.reviewDueOn} kind="review" missingReason="not_recorded" />
              </span>
              {source.sourceId.startsWith("__unidentified_") ? null : (
                <OpenSourceButton
                  sourceId={source.sourceId}
                  title={source.title}
                  locator={source.locator}
                  onOpenSource={onOpenSource}
                />
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PartialRetrievalBody({
  requested,
  missing,
  onOpenSource,
}: {
  /** Kept on the props shape for call-site parity with `partial_retrieval`; the headline uses `missing.length`. */
  retrieved: number;
  requested: number;
  missing: SourceRef[];
  onOpenSource: RetrievalStateBannerProps["onOpenSource"];
}) {
  return (
    <>
      <p data-testid="retrieval-state-headline" className="font-semibold">
        {missing.length > 0
          ? `${missing.length} of ${requested} sources unavailable.`
          : "Some sources for this answer were unavailable."}
      </p>
      {missing.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {missing.map((source) => (
            <li
              key={source.sourceId}
              data-testid="retrieval-state-missing-row"
              className="flex flex-wrap items-center gap-x-2 gap-y-1"
            >
              <span className="min-w-0 font-medium">{source.title}</span>
              {source.locator ? <span className="text-[color:var(--text-muted)]">{source.locator}</span> : null}
              <span className="text-[color:var(--text-muted)]">Unavailable</span>
              <OpenSourceButton
                sourceId={source.sourceId}
                title={source.title}
                locator={source.locator}
                onOpenSource={onOpenSource}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/**
 * The DS carrier for the live product's "Review source match" caution
 * (`evidence-panels.tsx`, `answer-thread-turn.tsx`). Each headline names the
 * signal that fired; the instruction below is constant, because the clinician's
 * act is the same in all four cases — read the passages, do not read the prose.
 *
 * It never says the answer is wrong. The pipeline established that support could
 * not be shown, which is a different and honest claim.
 */
function UngroundedBody({ reason }: { reason: UngroundedReason }) {
  const headline =
    reason === "grounded_false"
      ? "This answer could not be matched to the sources it cites."
      : reason === "confidence_unsupported"
        ? "This answer is reported as unsupported by the sources it cites."
        : reason === "unverified_numeric"
          ? "Some clinical values in this answer were not found in the cited sources."
          : "The evidence supporting this answer is weak.";

  return (
    <>
      <p data-testid="retrieval-state-headline" className="font-semibold">
        {headline}
      </p>
      <p className="mt-1">
        Read the cited passages and confirm every clinical number, dose, route, timing, threshold and monitoring
        instruction there before acting on this answer.
      </p>
    </>
  );
}

function SourceOnlyBody({ reason }: { reason: "generation_failed" | "quality_gate" }) {
  return (
    <>
      <p data-testid="retrieval-state-headline" className="font-semibold">
        {reason === "generation_failed"
          ? "Answer assembled from the sources directly — summarisation was unavailable."
          : "Answer assembled from the sources directly — the summary did not meet the quality checks."}
      </p>
      {/* Expected product behaviour, not an apology: state why the fallback is
          the safe outcome rather than hedging about it. */}
      {/* Deliberately not "nothing has been paraphrased": the tier is inferred
          from the routing mode, and the extractive builder composes sections.
          Claim only what this surface can stand behind. */}
      <p className="mt-1">
        The passages below are drawn directly from the cited sources rather than summarised by a model, so read the
        passages rather than a summary of them.
      </p>
    </>
  );
}

export function RetrievalStateBanner({ state, onOpenSource, className }: RetrievalStateBannerProps) {
  if (state.kind === "partial_retrieval" && state.missing.length === 0) {
    // A named gap with no named sources is a data defect upstream. Failing loudly
    // in development is how it gets fixed; in production the banner still tells
    // the truth about the gap rather than inventing "0 sources unavailable".
    if (process.env.NODE_ENV !== "production") {
      throw new Error(
        "RetrievalStateBanner: partial_retrieval requires a non-empty `missing` list. An unnamed gap is a data defect, not a render state.",
      );
    }
    noteEmptyState(
      "partial_retrieval",
      "retrieval-state-banner: partial_retrieval carried no named missing sources",
      "missing",
      `${state.retrieved}/${state.requested}`,
    );
  }

  if (state.kind === "stale_evidence" && state.overdue.length === 0) {
    // Same defect, sharper: this state HAS a producer, so an empty list means an
    // answer was flagged stale and would then announce "0 of 3 sources are past
    // their review date" — a caution that argues against itself.
    if (process.env.NODE_ENV !== "production") {
      throw new Error(
        "RetrievalStateBanner: stale_evidence requires a non-empty `overdue` list. Rendering an empty one states that nothing is stale on an answer flagged stale.",
      );
    }
    noteEmptyState(
      "stale_evidence",
      "retrieval-state-banner: stale_evidence carried no overdue sources",
      "overdue",
      String(state.sourceCount),
    );
  }

  // `ungrounded` is caution for the same reason the verification notice makes it
  // caution: the live product paints "Review source match" amber today, and
  // adoption must not demote it to an informational note.
  const caution = state.kind === "stale_evidence" || state.kind === "ungrounded";
  const Icon = caution ? TriangleAlert : state.kind === "partial_retrieval" ? FileWarning : Info;
  const label =
    state.kind === "stale_evidence"
      ? "Source review status"
      : state.kind === "partial_retrieval"
        ? "Source availability"
        : state.kind === "ungrounded"
          ? "Source match status"
          : "How this answer was produced";

  if (state.kind === "stale_evidence") {
    return (
      <div
        role="group"
        aria-label={label}
        data-testid="retrieval-state-banner"
        data-state={state.kind}
        className={cn("w-fit min-w-0 max-w-full text-2xs", className)}
      >
        <StaleEvidenceBody overdue={state.overdue} sourceCount={state.sourceCount} onOpenSource={onOpenSource} />
      </div>
    );
  }

  return (
    <div
      // `group`, not `region`: a labelled region would add a landmark to every
      // degraded answer and clutter the landmark list on a page that already has
      // main, navigation and search.
      role="group"
      aria-label={label}
      data-testid="retrieval-state-banner"
      data-state={state.kind}
      className={cn(
        "flex items-start gap-2 text-sm",
        "rounded-[var(--radius-md)] border p-[var(--pad-card)]",
        // Source currency is the amber channel (SPEC §11). Operational severity
        // is not: a fallback answer is not a clinical hazard.
        caution ? toneWarning : toneInfo,
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0" />
      <div className="min-w-0 flex-1">
        {state.kind === "partial_retrieval" ? (
          <PartialRetrievalBody
            retrieved={state.retrieved}
            requested={state.requested}
            missing={state.missing}
            onOpenSource={onOpenSource}
          />
        ) : state.kind === "ungrounded" ? (
          <UngroundedBody reason={state.reason} />
        ) : (
          <SourceOnlyBody reason={state.reason} />
        )}
      </div>
    </div>
  );
}
