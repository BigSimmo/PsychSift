"use client";

import { CalendarCheck, Video } from "lucide-react";
import Link from "next/link";

import { cardSurface, focusRing } from "@/components/card-recipes";
import { ON_CALL_SECTION_HREFS } from "@/components/on-call/on-call-section-identity";
import { ExternalTextLink } from "@/components/ui/link";
import { cn, textMuted } from "@/components/ui-primitives";
import { isOnCallHttpUrl } from "@/lib/on-call/entry-model";
import { onCallTeachingDateParts, type OnCallTeachingSession } from "@/lib/on-call/teaching-schedule";

/**
 * "Coming up": what is on, as a strip of date cards.
 *
 * A strip rather than a list of rows because a teaching calendar is read by
 * date first — the question is "is there anything before my Thursday clinic",
 * not "what is the third item". Giving the date a card of its own puts it where
 * the eye lands, and laying the cards out sideways keeps four of them inside
 * one screen-height on the home, where everything else is competing for the
 * same fold.
 *
 * Every card shows a DATE and never a countdown. "Thu 17 Sep" can be checked
 * against a roster on the wall; "in 3 days" cannot, and it is wrong the moment
 * the page has been open past midnight. The same reasoning is written over the
 * home's older "Coming up" rows and it does not change because the shape did.
 *
 * The component takes finished sessions and draws them. It does no date
 * arithmetic of its own — `src/lib/on-call/teaching-schedule.ts` has already
 * rolled each recurring session forward and handed over the owner's own wording
 * with it — so there is no second place where a date could come out different.
 */

export interface OnCallTeachingStripProps {
  /** Soonest first; the first card is the one marked as next. */
  sessions: readonly OnCallTeachingSession[];
  testId?: string;
}

function TeachingCard({ session, isNext }: { session: OnCallTeachingSession; isNext: boolean }) {
  const { weekday, day, month, year } = onCallTeachingDateParts(session.date);
  const detail = [session.when, session.presenter, session.location].filter(Boolean).join(" · ");

  return (
    // An <article> holding two links rather than one card-shaped anchor: the
    // recording leaves the app and the card does not, and an <a> inside an <a>
    // is invalid markup that hands a screen reader two targets for one row.
    <article
      className={cn(cardSurface, "flex w-44 shrink-0 flex-col sm:w-48")}
      data-testid={`on-call-home-teaching-${session.entry.slug}`}
    >
      <Link
        href={ON_CALL_SECTION_HREFS.education}
        className={cn(
          "grid min-h-tap gap-2 rounded-lg p-3 no-underline",
          "transition-colors motion-reduce:transition-none hover:bg-[color:var(--surface-subtle)]",
          focusRing,
        )}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="grid gap-0.5">
            <span className="text-3xs font-bold uppercase tracking-kicker text-[color:var(--text-muted)]">
              {weekday}
            </span>
            <span className="flex items-baseline gap-1">
              {/* Tabular figures: a column of day numbers that jitters by a
                  glyph width reads as a column of different sizes. */}
              <span className="nums text-2xl font-bold leading-none text-[color:var(--text-heading)]">{day}</span>
              <span className="text-sm font-semibold text-[color:var(--text)]">{month}</span>
            </span>
            <span className={cn(textMuted, "nums text-3xs font-semibold")}>{year}</span>
          </span>
          {/* "Next" is a word and a glyph, never a colour on its own — the
              soonest session has to be identifiable in greyscale, in forced
              colours, and by a reader who cannot see the difference between
              two borders. */}
          {isNext ? (
            <span
              data-testid="on-call-home-teaching-next-badge"
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full border border-[color:var(--border-strong)]",
                "bg-[color:var(--surface-subtle)] px-2 py-0.5 text-3xs font-bold uppercase tracking-kicker",
                "text-[color:var(--text-heading)]",
              )}
            >
              <CalendarCheck aria-hidden="true" className="size-icon-xs" />
              Next
            </span>
          ) : null}
        </span>

        <span className="grid gap-0.5">
          <span className="text-sm font-semibold leading-5 text-[color:var(--text-heading)]">
            {session.entry.title}
          </span>
          {detail ? <span className={cn(textMuted, "text-xs leading-4")}>{detail}</span> : null}
        </span>
      </Link>

      {isOnCallHttpUrl(session.recordingUrl) ? (
        <span className="border-t border-[color:var(--border)] px-3">
          <ExternalTextLink
            href={session.recordingUrl}
            className="inline-flex min-h-tap items-center text-xs font-semibold"
          >
            <Video aria-hidden="true" className="size-icon-xs shrink-0 self-center" />
            Recording
          </ExternalTextLink>
        </span>
      ) : null}
    </article>
  );
}

export function OnCallTeachingStrip({ sessions, testId = "on-call-home-teaching-strip" }: OnCallTeachingStripProps) {
  // Nothing on means nothing drawn. A "no teaching scheduled" card is furniture
  // on the most-looked-at screen of the mode, and the home already hides the
  // whole block when this returns null.
  if (sessions.length === 0) return null;

  return (
    // Scrolls inside its own container so the page body never scrolls
    // sideways — the same treatment `ModeHomeTemplate` gives its pill row.
    <div
      data-testid={testId}
      data-no-tab-swipe
      className="-mx-4 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 pb-1 [-webkit-overflow-scrolling:touch] sm:mx-0 sm:w-full sm:flex-wrap sm:px-0"
    >
      {sessions.map((session, index) => (
        <TeachingCard key={session.entry.id} session={session} isNext={index === 0} />
      ))}
    </div>
  );
}
