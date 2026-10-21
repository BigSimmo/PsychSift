"use client";

import { useSyncExternalStore } from "react";

import {
  contentReviewSchedule,
  contentReviewSentence,
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
  const sentence = contentReviewSentence(schedule);
  if (!sentence) return null;
  const urgent = isReviewDueNow(schedule);
  return (
    <p
      className={cn(
        "m-0 text-xs leading-5",
        urgent ? "font-semibold text-[color:var(--warning-text)]" : "text-[color:var(--text-muted)]",
        className,
      )}
      data-testid="content-review-notice"
      data-review-state={schedule.state}
    >
      {sentence}
    </p>
  );
}
