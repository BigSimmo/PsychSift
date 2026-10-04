import type { SessionSummary } from "@/lib/teaching/model";

/** The next teaching session that has not finished, soonest first; cancelled sessions never lead. */
export function nextTeachingSession(sessions: readonly SessionSummary[], now: Date): SessionSummary | null {
  const at = now.getTime();
  const seen = new Set<string>();
  let next: SessionSummary | null = null;
  for (const session of sessions) {
    if (seen.has(session.occurrenceId)) continue;
    seen.add(session.occurrenceId);
    if (session.status === "cancelled" || session.allDay || Date.parse(session.endsAt) <= at) continue;
    if (!next || session.startsAt.localeCompare(next.startsAt) < 0) next = session;
  }
  return next;
}
