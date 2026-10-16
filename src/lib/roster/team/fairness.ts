import { isWaPublicHolidayDate } from "@/lib/on-call/wa-public-holidays";
import { perthDateOf } from "@/lib/roster/shifts/perth-time";
import type { RosterAssignment } from "./model";

export function fairnessCounts(assignments: readonly RosterAssignment[], window: { from: string; to: string }) {
  const rows = new Map<
    string,
    { userId: string; name: string; nights: number; weekendShifts: number; publicHolidayShifts: number; hours: number }
  >();
  for (const shift of assignments) {
    const date = perthDateOf(shift.startsAt);
    if (!shift.userId || date < window.from || date > window.to || shift.kind === "leave") continue;
    const row = rows.get(shift.userId) ?? {
      userId: shift.userId,
      name: shift.name ?? "Name not available",
      nights: 0,
      weekendShifts: 0,
      publicHolidayShifts: 0,
      hours: 0,
    };
    if (shift.kind === "night") row.nights++;
    if ([0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())) row.weekendShifts++;
    if (isWaPublicHolidayDate(date)) row.publicHolidayShifts++;
    if (shift.kind !== "on_call") row.hours += (Date.parse(shift.endsAt) - Date.parse(shift.startsAt)) / 3_600_000;
    rows.set(shift.userId, row);
  }
  return [...rows.values()]
    .map((row) => ({ ...row, hours: Math.round(row.hours * 100) / 100 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
