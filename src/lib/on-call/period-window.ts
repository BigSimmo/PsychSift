import { onCallHospitalPeriod, type OnCallHospitalHours } from "@/lib/on-call/now-rows";
import { perthTimeOf } from "@/lib/roster/shifts/perth-time";

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesOf(time: string): number | null {
  const match = HH_MM.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export type OnCallCoverWindow = {
  /** Where this period began, Perth wall clock ("17:00"). */
  readonly from: string;
  /** Where it ends ("08:00"). */
  readonly until: string;
  /** "21:40", Perth wall clock. */
  readonly nowTime: string;
  /** How far through the period now is, 0 to 100. */
  readonly progress: number;
  /** Whole minutes until the period ends. */
  readonly minutesLeft: number;
};

/**
 * The hospital's current period as a window, for Right now's thin track
 * ("17:00 · Now 21:40 · 08:00") and its "10 h 20 min to go". Only from the
 * hospital's own recorded after-hours times; null when it has not set them, so
 * nothing is drawn rather than a guess.
 */
export function onCallCoverWindow(hours: OnCallHospitalHours | null, now: Date): OnCallCoverWindow | null {
  const period = onCallHospitalPeriod(hours, now);
  if (!hours || !period) return null;
  const afterFrom = minutesOf(hours.afterHoursFrom);
  const afterUntil = minutesOf(hours.afterHoursUntil);
  const nowTime = perthTimeOf(now);
  const at = minutesOf(nowTime);
  if (afterFrom === null || afterUntil === null || at === null) return null;
  const [start, end, from, until] =
    period === "after-hours"
      ? [afterFrom, afterUntil, hours.afterHoursFrom, hours.afterHoursUntil]
      : [afterUntil, afterFrom, hours.afterHoursUntil, hours.afterHoursFrom];
  const day = 24 * 60;
  const length = (end - start + day) % day || day;
  const elapsed = (at - start + day) % day;
  return {
    from,
    until,
    nowTime,
    progress: Math.min(100, Math.max(0, Math.round((elapsed / length) * 1000) / 10)),
    minutesLeft: Math.max(0, length - elapsed),
  };
}

/** "10 h 20 min", "45 min", "2 h". */
export function onCallDurationWords(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
