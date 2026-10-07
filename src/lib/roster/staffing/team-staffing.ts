import { ROSTER_MAX_WINDOW_DAYS, type RosterAssignment, type RosterAssignmentKind } from "@/lib/roster/team/model";
import { WEEKDAYS, addDaysToDate } from "@/lib/roster/shifts/perth-time";
import { perthDateOf } from "@/lib/roster/shifts/perth-time";

/**
 * Leave that protects minimum staffing (feature #7), the pure part.
 *
 * Built from ONE team `assignments` read (at most 62 days, the read's own
 * limit). It counts how many of the team are on each day: distinct people
 * with a Day or Evening shift (the spec's Day and Late) starting that Perth
 * day. Night, on call and other work are not counted as people on, and the
 * strip says so.
 *
 * PsychSift does not hold a team's safe number (how many doctors a day needs).
 * So nothing here judges a day as safe or unsafe. It shows who is on, which day
 * is lowest, and dates with more of the team on, and says plainly that no safe
 * number is set. A day the published roster does not reach yet is "not
 * checked", never shown as fine. Nothing is kept on the device.
 */

/** The shift kinds counted as people on: Day and Evening (the spec's "Day and Late by default"). */
export const STAFFING_COUNTED_KINDS: readonly RosterAssignmentKind[] = ["day", "evening"];

/** What the counts mean, shown with every strip. */
export const STAFFING_COUNTS_WORDS =
  "Counts Day and Evening (late) shifts only. Night, on call and other work aren't counted.";

const counted = (row: RosterAssignment) => STAFFING_COUNTED_KINDS.includes(row.kind);

export type StaffingDay = {
  readonly date: string;
  /** People on a counted shift, counting you if you work one that day. Null when the roster does not reach this day. */
  readonly on: number | null;
  /** You have a counted (Day or Evening) shift that day, so leave takes you off the count. */
  readonly youWork: boolean;
  /** You have any working shift that day, counted or not (a night or on call too). */
  readonly youRostered?: boolean;
  /** People whose roster row that day is leave. */
  readonly onLeave: number;
};

export type StaffingWindow = { readonly from: string; readonly to: string };

const personKey = (row: RosterAssignment) => row.userId ?? (row.name ? `name:${row.name}` : `row:${row.id}`);

export function dayCount(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Monday of the week holding `date`. */
export function mondayOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDaysToDate(date, -((weekday + 6) % 7));
}

/** Sunday of the week holding `date`. */
export function sundayOf(date: string): string {
  return addDaysToDate(mondayOf(date), 6);
}

/**
 * The days to read and draw. With no leave picked: the next three weeks from
 * this Monday. With leave picked: whole weeks around it, plus a week either
 * side for other dates (never before this Monday, and never less than the
 * three-week view, so picking dates near today does not read again), cut to
 * the read's 62-day limit.
 */
export function staffingWindow(today: string, leave: StaffingWindow | null): StaffingWindow & { capped: boolean } {
  const thisWeek = mondayOf(today);
  const threeWeeks = addDaysToDate(thisWeek, 20);
  if (!leave) return { from: thisWeek, to: threeWeeks, capped: false };
  const before = mondayOf(addDaysToDate(leave.from, -7));
  const from = before > thisWeek ? before : thisWeek;
  const after = sundayOf(addDaysToDate(leave.to, 7));
  const wanted = after > threeWeeks ? after : threeWeeks;
  const limit = addDaysToDate(from, ROSTER_MAX_WINDOW_DAYS - 1);
  return wanted > limit ? { from, to: limit, capped: leave.to > limit } : { from, to: wanted, capped: false };
}

/**
 * Count each day. `knownThrough` is the last day the published roster covers
 * (the latest publication's end); later days are not checked. With no
 * publication at all, only days that hold any roster row are counted.
 */
export function staffingDays(
  assignments: readonly RosterAssignment[],
  window: StaffingWindow,
  options: { readonly actorId: string | null; readonly knownThrough: string | null },
): StaffingDay[] {
  const days: StaffingDay[] = [];
  const byDay = new Map<string, RosterAssignment[]>();
  for (const row of assignments) {
    const day = perthDateOf(row.startsAt);
    const list = byDay.get(day);
    if (list) list.push(row);
    else byDay.set(day, [row]);
  }
  for (let date = window.from; date <= window.to; date = addDaysToDate(date, 1)) {
    const rows = byDay.get(date) ?? [];
    const known = options.knownThrough ? date <= options.knownThrough : rows.length > 0;
    const working = new Set(rows.filter((row) => row.kind !== "leave").map(personKey));
    const on = new Set(rows.filter(counted).map(personKey));
    const leave = new Set(rows.filter((row) => row.kind === "leave").map(personKey));
    for (const person of working) leave.delete(person);
    const youWork = !!options.actorId && on.has(options.actorId);
    const youRostered = !!options.actorId && working.has(options.actorId);
    days.push({
      date,
      on: known ? on.size : null,
      youWork: known && youWork,
      youRostered: known && youRostered,
      onLeave: known ? leave.size : 0,
    });
  }
  return days;
}

/** On that day if you take leave: you come off when you work it. */
export function onIfAway(day: StaffingDay): number | null {
  if (day.on === null) return null;
  return day.youWork ? day.on - 1 : day.on;
}

export const inRange = (date: string, range: StaffingWindow | null) =>
  !!range && date >= range.from && date <= range.to;

export type LeaveStaffing =
  | { readonly kind: "unchecked"; readonly days: number }
  | { readonly kind: "partial"; readonly lowest: number; readonly lowestDays: string[]; readonly unchecked: number }
  | { readonly kind: "checked"; readonly lowest: number; readonly lowestDays: string[]; readonly yourShifts: number };

/** The leave days' result: the lowest number on (with you away) and on which days. */
export function leaveStaffing(days: readonly StaffingDay[], leave: StaffingWindow): LeaveStaffing {
  const inLeave = days.filter((day) => inRange(day.date, leave));
  const known = inLeave.filter((day) => day.on !== null);
  const unchecked = dayCount(leave.from, leave.to) - known.length;
  if (known.length === 0) return { kind: "unchecked", days: dayCount(leave.from, leave.to) };
  const counts = known.map((day) => onIfAway(day)!);
  const lowest = Math.min(...counts);
  const lowestDays = known.filter((day) => onIfAway(day) === lowest).map((day) => day.date);
  if (unchecked > 0) return { kind: "partial", lowest, lowestDays, unchecked };
  return {
    kind: "checked",
    lowest,
    lowestDays,
    yourShifts: known.filter((day) => day.youRostered ?? day.youWork).length,
  };
}

export type AlternativeDates = StaffingWindow & { readonly lowest: number; readonly counts: number[] };

/**
 * Up to `limit` other runs of the same length, inside the read window and all
 * checked, starting after today, whose lowest day has MORE people on than the
 * picked dates. Nearest to the picked start first. A fact about counts only,
 * never a claim that they are safe.
 */
export function alternativeDates(
  days: readonly StaffingDay[],
  leave: StaffingWindow,
  today: string,
  limit = 2,
): AlternativeDates[] {
  const length = dayCount(leave.from, leave.to);
  const picked = leaveStaffing(days, leave);
  if (picked.kind !== "checked" || length > 14) return [];
  const found: AlternativeDates[] = [];
  for (let start = 0; start + length <= days.length; start += 1) {
    const run = days.slice(start, start + length);
    const first = run[0]!.date;
    if (first <= today || first === leave.from) continue;
    if (run.some((day) => day.on === null)) continue;
    const counts = run.map((day) => onIfAway(day)!);
    const lowest = Math.min(...counts);
    if (lowest > picked.lowest) found.push({ from: first, to: run[run.length - 1]!.date, lowest, counts });
  }
  const distance = (option: AlternativeDates) =>
    Math.abs(Date.parse(`${option.from}T00:00:00Z`) - Date.parse(`${leave.from}T00:00:00Z`));
  return found.sort((a, b) => distance(a) - distance(b) || b.lowest - a.lowest).slice(0, limit);
}

/** `Fri 23`. */
export function shortDay(date: string): string {
  return `${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${Number(date.slice(8, 10))}`;
}

const MONTH_WORDS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const monthOf = (date: string) => MONTH_WORDS[Number(date.slice(5, 7)) - 1]!;

/** `Thu 22 Oct`, `Wed 21 to Thu 22 Oct`, or `Mon 30 Nov to Tue 1 Dec`. */
export function spanWords(span: StaffingWindow): string {
  if (span.from === span.to) return `${shortDay(span.from)} ${monthOf(span.from)}`;
  if (span.from.slice(0, 7) === span.to.slice(0, 7))
    return `${shortDay(span.from)} to ${shortDay(span.to)} ${monthOf(span.to)}`;
  return `${shortDay(span.from)} ${monthOf(span.from)} to ${shortDay(span.to)} ${monthOf(span.to)}`;
}

/** `Fri 23 and Sat 24`, `Mon 19, Tue 20 and Wed 21`, or `4 days` beyond three. */
export function dayList(dates: readonly string[]): string {
  if (dates.length > 3) return `${dates.length} days`;
  const words = dates.map(shortDay);
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** What a screen reader hears for one day's column. */
export function staffingDayLabel(day: StaffingDay, leave: StaffingWindow | null): string {
  const name = shortDay(day.date);
  if (day.on === null) return `${name}: not checked, roster not published`;
  const away = inRange(day.date, leave);
  const count = away ? onIfAway(day)! : day.on;
  const parts = [`${name}: ${count} on`];
  if (away && day.youWork) parts.push("you off on leave");
  else if (day.youWork) parts.push("including you");
  if (day.onLeave) parts.push(`${day.onLeave} on leave`);
  return parts.join(", ");
}

/** The one-line result for the picked dates. */
export function leaveStaffingWords(result: LeaveStaffing): { readonly lead: string; readonly rest: string } {
  if (result.kind === "unchecked")
    return { lead: "Can't check yet.", rest: "The roster isn't published for these dates." };
  const plural = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
  if (result.kind === "partial")
    return {
      lead: `Fewest on: ${plural(result.lowest)}, ${dayList(result.lowestDays)}.`,
      rest: `${result.unchecked} ${result.unchecked === 1 ? "day isn't" : "days aren't"} published yet, so not checked.`,
    };
  return {
    lead: `Fewest on: ${plural(result.lowest)}, ${dayList(result.lowestDays)}.`,
    rest:
      result.yourShifts === 0
        ? "You have no shifts on these days."
        : `You come off ${result.yourShifts} ${result.yourShifts === 1 ? "shift" : "shifts"}.`,
  };
}

/**
 * A note the doctor copies to their roster manager, since PsychSift holds no
 * safe number. It names the dates, never a figure and never anyone else.
 */
export function staffingAskText(leave: StaffingWindow | null, teamName: string | null): string {
  const team = teamName ? `${teamName} needs` : "our team needs";
  const ask = `What is the fewest doctors ${team} on each day?`;
  return leave
    ? `Hi, I am thinking of leave ${spanWords(leave)}. ${ask} I would like to pick dates that suit the team.\n\nThanks`
    : `Hi, w${ask.slice(1)} I would like to plan my leave around it.\n\nThanks`;
}
