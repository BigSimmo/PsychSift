"use client";

import { useSyncExternalStore } from "react";

import { statusDotMuted, statusDotReview } from "@/components/ui-primitives";
import { DateDisplay } from "@/components/ui/date-display";
import {
  contentReviewNoticeCopy,
  contentReviewSchedule,
  isReviewDueNow,
  type ContentReviewScheduleInput,
  type ContentReviewState,
} from "@/lib/content-review-schedule";
import { cn } from "@/lib/cn";

const noSubscription = () => () => {};
// The reader's local calendar date, not UTC: in Perth the UTC date is still yesterday
// until 8 am, which would hold a due date back for a morning.
const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const serverToday = () => null;

/**
 * One line saying a record is due, or soon due, for clinical review, or that a
 * guideline it cites has changed. Renders nothing for a record inside its interval,
 * because a healthy date is not news.
 *
 * It wears the app's existing review vocabulary: the amber diamond (`statusDotReview`)
 * when review is due now, the muted dot when it is only coming up, and the date through
 * `DateDisplay` like every other clinician-facing date.
 *
 * The schedule is worked out in the browser with the reader's own date. These pages are
 * prerendered, so a schedule worked out at build time would stop ageing until the next
 * deploy; the server and the first client render therefore show nothing, and the line
 * appears once the page knows today's date.
 *
 * `hideStates` lets a page that already flags a state elsewhere avoid saying it twice
 * (medication pages carry their own "Source check due" chip).
 */
export function ContentReviewNotice({
  review,
  hideStates = [],
  className,
}: {
  review: ContentReviewScheduleInput;
  hideStates?: readonly ContentReviewState[];
  className?: string;
}) {
  const today = useSyncExternalStore(noSubscription, todayIso, serverToday);
  if (!today) return null;
  const schedule = contentReviewSchedule({ ...review, referenceDate: new Date(`${today}T00:00:00.000Z`) });
  if (hideStates.includes(schedule.state)) return null;
  const copy = contentReviewNoticeCopy(schedule);
  if (!copy) return null;
  const urgent = isReviewDueNow(schedule);
  return (
    <p
      className={cn("m-0 flex items-start gap-2 text-xs leading-5 text-[color:var(--text-muted)]", className)}
      data-testid="content-review-notice"
      data-review-state={schedule.state}
    >
      {/* mt-1.5 centres the 8px marker on the first 20px line, so it stays put when the line wraps. */}
      {/* The review recipe's 6px radius rounds an 8px square into a dot; square corners keep it a diamond. */}
      <span
        className={cn(urgent ? cn(statusDotReview, "rounded-none") : statusDotMuted, "mt-1.5")}
        aria-hidden="true"
      />
      <span className="min-w-0 text-pretty">
        <span
          className={cn("font-semibold", urgent ? "text-[color:var(--warning)]" : "text-[color:var(--text-heading)]")}
        >
          {copy.lead}.
        </span>
        {copy.detail ? (
          <>
            {" "}
            {copy.detail}
            {copy.dateIso ? (
              <>
                {" "}
                <DateDisplay value={copy.dateIso} kind="review" />.
              </>
            ) : null}
          </>
        ) : null}
      </span>
    </p>
  );
}
