/**
 * The end-of-shift card (Alerts mock-up, screen 16): shown only in the 30
 * minutes before a rostered shift ends, and only for a shift that has
 * started. It names the shift, never a patient.
 */
export const END_OF_SHIFT_LEAD_MINUTES = 30;

export type ShiftWindow = { readonly label: string; readonly startsAt: string; readonly endsAt: string };

export type EndOfShift = { readonly label: string; readonly endsAt: string; readonly minutesLeft: number };

export function endOfShiftCard(now: Date, shifts: readonly ShiftWindow[]): EndOfShift | null {
  const at = now.getTime();
  const ending = shifts
    .map((shift) => ({ shift, start: Date.parse(shift.startsAt), end: Date.parse(shift.endsAt) }))
    .filter(
      ({ start, end }) =>
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        start <= at &&
        end > at &&
        end - at <= END_OF_SHIFT_LEAD_MINUTES * 60_000,
    )
    .sort((a, b) => a.end - b.end)[0];
  if (!ending) return null;
  return {
    label: ending.shift.label,
    endsAt: ending.shift.endsAt,
    minutesLeft: Math.max(1, Math.ceil((ending.end - at) / 60_000)),
  };
}
