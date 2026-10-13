import { currentWorkTimeZone } from "@/lib/work-time/current-zone";
import { formatZonedDay, zonedDateOf, zonedTimeOf, zonedToday } from "@/lib/work-time/format";

/**
 * The one line for a page showing what it saved earlier (site recommendations,
 * 12 Oct 2026, item 10): "Offline, showing what was saved at 19:02". Used by
 * the app-wide offline notice and by On Call's saved-copy banner, so the
 * wording is the same in Work and Clinical.
 *
 * Times are on the work clock (Perth unless the doctor chose another zone). A
 * copy from an earlier day names the day, because a bare "19:02" would read as
 * today. A server that could not be reached is not the doctor's lost signal, so
 * that case says "Couldn't refresh" rather than "Offline".
 */
export type SavedLineReason = "offline" | "failed";

export function savedLine({
  reason = "offline",
  savedAt,
  now = Date.now(),
  zone = currentWorkTimeZone(),
}: {
  readonly reason?: SavedLineReason | null;
  /** When the shown copy was saved (ISO string or epoch ms), or null when unknown. */
  readonly savedAt: string | number | null;
  readonly now?: number;
  readonly zone?: string;
}): string {
  const lead = reason === "failed" ? "Couldn't refresh" : "Offline";
  const at = typeof savedAt === "string" ? Date.parse(savedAt) : savedAt;
  if (at === null || !Number.isFinite(at)) return `${lead}, showing what was saved earlier`;
  const time = zonedTimeOf(at, zone);
  const today = zonedToday(zone, now);
  const day = zonedDateOf(at, zone);
  if (day === today) return `${lead}, showing what was saved at ${time}`;
  return `${lead}, showing what was saved on ${formatZonedDay(day, today)} at ${time}`;
}
