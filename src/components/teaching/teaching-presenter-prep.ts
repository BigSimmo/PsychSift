import { perthDateKey, shortDayLabel } from "@/components/teaching/teaching-dates";
import { withUnit } from "@/components/teaching/teaching-number";
import { readinessItems, type TeachRead } from "@/lib/teaching/depth-model";

/**
 * The next talk the reader presents that still has prep outstanding: its day,
 * how many readiness items are done, and whether de-identification is still to
 * confirm. Null when nothing upcoming needs anything.
 */
export function nextPresentedSession(read: TeachRead, today: string | null) {
  return [...read.upcoming]
    .filter((session) => session.status !== "cancelled" && (!today || perthDateKey(session.startsAt) >= today))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
}

export function presenterPrep(read: TeachRead, today: string | null): { title: string; subtitle: string } | null {
  const next = nextPresentedSession(read, today);
  if (!next) return null;
  const done = next.items.length;
  const total = readinessItems.length;
  const deidOpen = next.deidConfirmedAt === null;
  if (done >= total && !deidOpen) return null;
  const parts = [`${withUnit(done, "of")} ${total} prep items done`];
  if (deidOpen) parts.push("de-identification not confirmed");
  return { title: `You present ${shortDayLabel(perthDateKey(next.startsAt))}`, subtitle: parts.join(" · ") };
}
