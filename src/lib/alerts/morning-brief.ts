import { applyQuietHours, type MorningBriefSettings, type ReminderQuietHours } from "@/lib/reminders/settings";
import { addDaysToDate, perthDateOf, perthTimeOf, perthWallToIso } from "@/lib/roster/shifts/perth-time";

/**
 * When the morning brief goes out on one Perth day (owner decisions 2 and 3,
 * 5 Oct 2026): the workday time on a day with a shift, the day-off time
 * otherwise, never before 14:00 after a night shift, and moved to the end of
 * quiet hours, which the brief never breaks through.
 */
export const AFTER_NIGHT_TIME = "14:00";

/** A brief more than this late (the server was down, say) is skipped, not sent mid-afternoon. */
export const BRIEF_LATE_LIMIT_MS = 3 * 60 * 60 * 1000;

export type BriefShift = { readonly startsAt: string; readonly endsAt: string; readonly kind: string | null };

const HOUR_MS = 60 * 60 * 1000;

/** A night by its kind, or, for an imported shift with no kind, one that runs from evening into the next day. */
function isNight(shift: BriefShift): boolean {
  if (shift.kind) return shift.kind === "night";
  const long = Date.parse(shift.endsAt) - Date.parse(shift.startsAt) >= 6 * HOUR_MS;
  return perthDateOf(shift.startsAt) !== perthDateOf(shift.endsAt) && perthTimeOf(shift.startsAt) >= "18:00" && long;
}

export type BriefTime = { readonly at: Date; readonly kind: "workday" | "day-off" | "after-night" };

export function morningBriefTime(
  brief: MorningBriefSettings,
  quiet: ReminderQuietHours,
  perthDate: string,
  shifts: readonly BriefShift[],
): BriefTime | null {
  const workday = shifts.some((shift) => shift.kind !== "leave" && perthDateOf(shift.startsAt) === perthDate);
  const afterNight = shifts.some(
    (shift) =>
      isNight(shift) &&
      perthDateOf(shift.endsAt) === perthDate &&
      perthDateOf(shift.startsAt) === addDaysToDate(perthDate, -1),
  );
  const chosen = workday ? brief.workday : brief.dayOff;
  const time = afterNight && chosen < AFTER_NIGHT_TIME ? AFTER_NIGHT_TIME : chosen;
  const iso = perthWallToIso(perthDate, time);
  if (!iso) return null;
  const at = new Date(applyQuietHours(Date.parse(iso), quiet));
  return { at, kind: afterNight && time === AFTER_NIGHT_TIME ? "after-night" : workday ? "workday" : "day-off" };
}

/** Whether the brief for `perthDate` should go out at `now`: due, and not too late. */
export function briefIsDue(time: BriefTime, now: Date): boolean {
  const late = now.getTime() - time.at.getTime();
  return late >= 0 && late < BRIEF_LATE_LIMIT_MS;
}
