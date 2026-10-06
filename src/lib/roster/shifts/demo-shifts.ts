import type { OnCallShift } from "@/lib/roster/shifts/model";
import { addDaysToDate, perthDateOf, perthWallToIso } from "@/lib/roster/shifts/perth-time";

/**
 * Obviously invented shifts for demo mode, dated from today so the demo home
 * always has a next shift to show. No real site, role or person.
 *
 * One falls on today itself: the week view shows Monday to Sunday, so on a
 * Sunday the two future shifts both landed in next week and the demo's
 * current week read "No shifts this week" under an "Example only" banner.
 */
export function demoOnCallShifts(now: Date): OnCallShift[] {
  const today = perthDateOf(now);
  const shift = (id: string, day: string, start: string, end: string, endDay = day): OnCallShift => ({
    id,
    startsAt: perthWallToIso(day, start)!,
    endsAt: perthWallToIso(endDay, end)!,
    title: "Registrar on call",
    location: "Example Hospital",
    sourceUid: null,
    kind: null,
    source: "import",
    seriesId: null,
    workplace: "Example Hospital",
  });
  const tomorrow = addDaysToDate(today, 1);
  return [
    shift("demo-shift-0", today, "08:00", "17:00"),
    shift("demo-shift-1", tomorrow, "08:00", "17:00"),
    shift("demo-shift-2", addDaysToDate(today, 3), "21:00", "08:00", addDaysToDate(today, 4)),
  ];
}
