"use client";

import { NotebookText } from "lucide-react";
import type { ReactNode } from "react";

import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { presenterPrep } from "@/components/teaching/teaching-presenter-prep";
import { withUnit } from "@/components/teaching/teaching-number";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { demoFeedbackOpen, demoTeach } from "@/lib/teaching/depth-demo";
import { type SessionRef, type TeachRead } from "@/lib/teaching/depth-model";

/*
 * Today's "Needs you": one row per thing the reader owes, and nothing at all
 * when they owe nothing (no empty module). Only counts cross the wire. A
 * failed read shows nothing rather than an error or a false zero: the module
 * is a nudge, and the page each row opens carries the same fact.
 *
 * Rows, in order: sessions to log to CPD, a talk the reader presents that is
 * not ready yet, feedback still open to give, and sessions in this week with
 * no check-in recorded whose materials can be caught up on.
 */
export function NeedsYou({
  live,
  today,
  catchUp = 0,
  extraRows,
}: {
  live: boolean;
  today?: string;
  catchUp?: number;
  extraRows?: ReactNode;
}) {
  const unlogged = useTeachingResource<{ count: number }>(live ? "/api/teaching?view=unlogged-count" : null);
  const teach = useTeachingResource<TeachRead>(live ? "/api/teaching/depth?view=teach" : null);
  const feedback = useTeachingResource<{ sessions: SessionRef[] }>(
    live ? "/api/teaching/depth?view=feedback-open" : null,
  );
  const count = unlogged.data?.count ?? 0;
  const teachRead = live ? teach.data : today ? demoTeach(today) : null;
  const openFeedback = live ? (feedback.data?.sessions.length ?? 0) : today ? demoFeedbackOpen(today).length : 0;
  const prep = teachRead ? presenterPrep(teachRead, today ?? null) : null;

  if (count === 0 && !prep && openFeedback === 0 && catchUp === 0 && !extraRows) return null;
  return (
    <ModeGroupedList eyebrow="Needs you" headerIcon={NotebookText} mode="teaching" testId="teaching-needs-you">
      {count > 0 ? (
        <>
          <ModeRow
            href="/teaching/review"
            title={`Review & log ${withUnit(count, count === 1 ? "session" : "sessions")}`}
            subtitle="Attended, not yet in your CPD log"
          />
          <ModeRow href="/teaching/logbook" title="Open logbook" subtitle="All attendance and CPD status" />
        </>
      ) : null}
      {prep ? <ModeRow href="/teaching/teach" title={prep.title} subtitle={prep.subtitle} /> : null}
      {openFeedback > 0 ? (
        <ModeRow
          href="/teaching/feedback"
          title={`Give feedback on ${withUnit(openFeedback, openFeedback === 1 ? "session" : "sessions")}`}
          subtitle="Taps only, open for 7 days"
        />
      ) : null}
      {catchUp > 0 ? (
        <ModeRow
          href="/teaching/resources#catch-up"
          title={`Catch up on ${withUnit(catchUp, catchUp === 1 ? "session" : "sessions")}`}
          subtitle="This week, no check-in recorded"
        />
      ) : null}
      {extraRows}
    </ModeGroupedList>
  );
}

export { presenterPrep };
