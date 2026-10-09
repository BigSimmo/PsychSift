import { kindOf } from "@/components/roster/roster-format";
import { perthTimeOf } from "@/lib/roster/shifts/perth-time";

type ClashShift = Parameters<typeof kindOf>[0];

/**
 * When a session sits awkwardly against on call or a night shift, the line
 * that says so: it starts as the shift ends, or runs across the shift's start
 * or end. Teaching inside an ordinary day, or wholly inside the shift, is not
 * a clash. Null when there is nothing to say.
 */
export function clashLine(shift: ClashShift | null, startsAt: string, endsAt: string): string | null {
  if (!shift) return null;
  const kind = kindOf(shift);
  if (kind !== "on_call" && kind !== "night") return null;
  const name = kind === "on_call" ? "on call" : "your night shift";
  const shiftStart = Date.parse(shift.startsAt);
  const shiftEnd = Date.parse(shift.endsAt);
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (![shiftStart, shiftEnd, start, end].every(Number.isFinite)) return null;
  if (Math.abs(start - shiftEnd) <= 60_000) return `Starts as ${name} ends.`;
  const across = (edge: number) => start < edge && end > edge;
  if (across(shiftEnd)) return `Runs past the end of ${name} at ${perthTimeOf(shift.endsAt)}.`;
  if (across(shiftStart)) return `Runs into ${name}, which starts ${perthTimeOf(shift.startsAt)}.`;
  return null;
}

/** The first clash a session has with any of the shifts given, or null. */
export function clashWithShifts(shifts: readonly ClashShift[], startsAt: string, endsAt: string): string | null {
  for (const shift of shifts) {
    const line = clashLine(shift, startsAt, endsAt);
    if (line) return line;
  }
  return null;
}
