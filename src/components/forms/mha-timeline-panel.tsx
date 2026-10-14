"use client";

import { ExternalLink, Timer } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";

import { buttonFaceClass } from "@/components/ui/button-face";
import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { cn, textMuted } from "@/components/ui-primitives";
import { mhaActMetadata, mhaActSection } from "@/lib/mha-act-sections";
import { formatPerthDateTime, parsePerthDateTimeInput, timelineFor, type MhaTimelineItem } from "@/lib/mha-timeline";

/** Fixed wording, owner-approved. Do not paraphrase. */
export const MHA_TIMELINE_REFERENCE_NOTE = "Reference only — check against the Act and your service's procedure.";
export const MHA_TIMELINE_AWAITING_REVIEW = "Awaiting clinical review — time not calculated";
/** The opening words of MHA_TIMELINE_AWAITING_REVIEW, shown above MHA_TIMELINE_NOT_CALCULABLE. */
export const MHA_TIMELINE_AWAITING_REVIEW_SHORT = "Awaiting clinical review";
export const MHA_TIMELINE_NOT_CALCULABLE =
  "Time not calculated — this limit can also end earlier, as the quoted Act words below explain";

function DeadlineLine({ item }: { item: MhaTimelineItem }) {
  if (item.quoteOnly) {
    const lineClass = "text-sm font-semibold leading-6 text-[color:var(--text-muted)]";
    if (item.reason === "not-calculable") {
      return (
        <>
          {item.awaitingReview ? (
            <p className={lineClass} data-testid="mha-timeline-awaiting">
              {MHA_TIMELINE_AWAITING_REVIEW_SHORT}
            </p>
          ) : null}
          <p className={lineClass} data-testid="mha-timeline-not-calculable">
            {MHA_TIMELINE_NOT_CALCULABLE}
          </p>
        </>
      );
    }
    return (
      <p className={lineClass} data-testid="mha-timeline-awaiting">
        {MHA_TIMELINE_AWAITING_REVIEW}
      </p>
    );
  }
  if (!item.deadline) {
    return <p className={cn("text-sm leading-6", textMuted)}>Enter when this was made to see the Perth time.</p>;
  }
  return (
    <p className="text-sm leading-6 text-[color:var(--text)]">
      <span className="font-semibold text-[color:var(--text-heading)]">Ends: </span>
      <time dateTime={item.deadline.toISOString()} data-testid="mha-timeline-deadline">
        {formatPerthDateTime(item.deadline)}
      </time>
    </p>
  );
}

/**
 * The form page's Mental Health Act timeline.
 *
 * Each time limit is shown as the Act's own words, with a link to the Act. A Perth clock time is
 * calculated only for an entry the owner has signed off; every other entry says it is awaiting
 * clinical review and shows no time. See `src/lib/mha-timeline.ts` for the rule and its tests.
 */
export function MhaTimelinePanel({ formCode }: { formCode: string }) {
  const inputId = useId();
  const hintId = useId();
  const headingId = useId();
  const [startValue, setStartValue] = useState("");
  const start = useMemo(() => parsePerthDateTimeInput(startValue), [startValue]);
  const items = useMemo(() => timelineFor(formCode, start), [formCode, start]);

  if (items.length === 0) return null;
  const anyCalculated = items.some((item) => !item.quoteOnly);
  const allAwaitingReview = items.every((item) => item.quoteOnly && item.awaitingReview);
  const hint = anyCalculated
    ? "Perth time (AWST)."
    : allAwaitingReview
      ? "Perth time (AWST). No time is calculated yet: every limit below is awaiting clinical review."
      : "Perth time (AWST). No time is calculated for the limits below.";

  return (
    <section id="form-timeline" aria-labelledby={headingId} className={cn(inPageAnchor, "space-y-3")}>
      <h2
        id={headingId}
        className="text-base-minus font-semibold leading-5 text-[color:var(--text-heading)] sm:text-base"
      >
        Timeline
      </h2>
      <p className="text-sm font-semibold leading-6 text-[color:var(--text-heading)]">{MHA_TIMELINE_REFERENCE_NOTE}</p>

      <div className="space-y-1">
        <label htmlFor={inputId} className="block text-sm font-semibold text-[color:var(--text-heading)]">
          When was this made?
        </label>
        <input
          id={inputId}
          type="datetime-local"
          value={startValue}
          onChange={(event) => setStartValue(event.target.value)}
          aria-describedby={hintId}
          className="min-h-12 w-full max-w-sm rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        />
        <p id={hintId} className={cn("text-xs leading-5", textMuted)}>
          {hint}
        </p>
        {/* Design audit D01: a timed form starts its clock from here, with the form (and the
            time, once entered) carried across, so the clock list is one tap from the record. */}
        <Link
          href={`/forms/clock?${new URLSearchParams(start ? { form: formCode, made: startValue } : { form: formCode })}`}
          data-testid="mha-timeline-start-clock"
          className={cn(buttonFaceClass({ variant: "secondary" }), "mt-2 w-full max-w-sm")}
        >
          <Timer aria-hidden="true" className="size-icon-sm" />
          Start clock
        </Link>
      </div>

      <ol className="space-y-3">
        {items.map((item) => {
          const { entry } = item;
          const heading = mhaActSection(entry.section)?.title;
          return (
            <li
              key={entry.id}
              className="space-y-2 rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface-lux)] p-3 shadow-[var(--shadow-inset)]"
            >
              <h3 className="text-sm font-semibold leading-6 text-[color:var(--text-heading)]">{entry.trigger}</h3>
              {entry.condition ? (
                <p
                  className="rounded-md border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] px-3 py-2 text-sm font-semibold leading-6 text-[color:var(--text-heading)]"
                  data-testid="mha-timeline-condition"
                >
                  {entry.condition}
                </p>
              ) : null}
              <blockquote
                cite={mhaActMetadata.sourceUrl}
                className="border-l-2 border-[color:var(--clinical-accent-border)] pl-3 text-sm italic leading-6 text-[color:var(--text)]"
              >
                {entry.leadIn ? `“${entry.leadIn} … ${entry.quote}”` : `“${entry.quote}”`}
              </blockquote>
              {entry.caveat ? (
                <div
                  className="space-y-1 rounded-md border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] px-3 py-2"
                  data-testid="mha-timeline-caveat"
                >
                  <p className="text-xs font-semibold leading-5 text-[color:var(--text-heading)]">
                    {`The Act also says (s ${entry.caveat.section}):`}
                  </p>
                  <blockquote
                    cite={mhaActMetadata.sourceUrl}
                    className="text-sm italic leading-6 text-[color:var(--text)]"
                  >
                    {`“${entry.caveat.quote}”`}
                  </blockquote>
                </div>
              ) : null}
              <a
                href={mhaActMetadata.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-12 items-center gap-1.5 text-sm font-semibold text-[color:var(--clinical-accent)] underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
              >
                {`Mental Health Act 2014 (WA) s ${entry.section}${heading ? ` — ${heading}` : ""}`}
                <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
              </a>
              <p className={cn("text-xs leading-5", textMuted)}>{`Counted from: ${entry.anchor}.`}</p>
              <DeadlineLine item={item} />
            </li>
          );
        })}
      </ol>
      <p className={cn("text-xs leading-5", textMuted)}>
        {`Quoted from version ${mhaActMetadata.actVersion} of the Act, as at ${mhaActMetadata.actAsAt}.`}
      </p>
    </section>
  );
}
