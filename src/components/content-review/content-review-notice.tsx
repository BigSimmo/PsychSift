import {
  contentReviewSentence,
  isReviewDueNow,
  type ContentReviewSchedule,
  type ContentReviewState,
} from "@/lib/content-review-schedule";
import { cn } from "@/lib/cn";

/**
 * One line saying a record is due, or soon due, for clinical review, or that a
 * guideline it cites has changed. Renders nothing for a record inside its interval,
 * because a healthy date is not news.
 *
 * `hideStates` lets a page that already flags a state elsewhere avoid saying it twice
 * (medication pages carry their own "Source check due" chip).
 */
export function ContentReviewNotice({
  schedule,
  hideStates = [],
  className,
}: {
  schedule: ContentReviewSchedule;
  hideStates?: readonly ContentReviewState[];
  className?: string;
}) {
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
