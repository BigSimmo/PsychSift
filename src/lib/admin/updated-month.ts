import { perthCalendarDate } from "@/lib/perth-time";

// Kept apart from renewal-dates.ts so the crisis lines card (eager on `/`) does not pull the
// on-call / CPD / calendar helpers into the home page's module graph.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Aug 2026" for the neutral "Updated <month year>" line (spec review 7). Instants use the Perth day, not UTC. */
export function formatUpdatedMonth(value: string): string {
  const key = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : Number.isNaN(Date.parse(value))
      ? ""
      : perthCalendarDate(new Date(value));
  const match = /^(\d{4})-(\d{2})/.exec(key);
  return match ? `${MONTHS[Number(match[2]) - 1]} ${match[1]}` : "";
}
