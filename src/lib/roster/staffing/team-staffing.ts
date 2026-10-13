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
 * The team's safe number is the cover its roster manager set (the
 * `roster_staffing_needs` the Cover tab uses), read through the member-safe
 * staffing-needs route: counts only, never a name. Only the whole-team need for
 * Day and Evening is judged here. A need for one grade or one site is not
 * judged, and the note says so. A day is "below safe number" when fewer are on
 * than it needs (with you taken off when the day is in your leave). With no
 * need set, nothing is judged and the note says your roster manager hasn't set
 * one. A day the published roster does not reach yet is "not checked", never
 * shown as fine. Nothing is kept on the device.
 */

/** The shift kinds counted as people on: Day and Evening (the spec's "Day and Late by default"). */
export const STAFFING_COUNTED_KINDS: readonly RosterAssignmentKind[] = ["day", "evening"];

/** What the counts mean, shown with every strip. */
export const STAFFING_COUNTS_WORDS =
  "Counts Day and Evening (late) shifts only. Night, on call and other work aren't counted.";

const counted = (row: RosterAssignment) => STAFFING_COUNTED_KINDS.includes(row.kind);

/** A shift kind counted as people on. */
export type CountedKind = "day" | "evening";
const COUNTED: readonly CountedKind[] = ["day", "evening"];
const KIND_WORDS: Readonly<Record<CountedKind, string>> = { day: "Day", evening: "Evening" };

/**
 * One cover need as the member-safe staffing-needs route returns it: a weekday
 * (1 Monday to 7 Sunday) or one date, a kind, an optional grade and site, and
 * how many it needs. No id and no names.
 */
export type StaffingNeed = {
  readonly weekday: number | null;
  readonly date: string | null;
  readonly kind: string;
  readonly grade: string | null;
  readonly siteId: string | null;
  readonly needed: number;
};

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
  /** People on each counted kind. Absent when the roster does not reach this day. */
  readonly byKind?: Readonly<Record<CountedKind, number>>;
  /** The counted kinds you work that day. */
  readonly yourKinds?: readonly CountedKind[];
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
  options: { readonly actorId: string | null; readonly knownThrough: string | null; readonly zone?: string },
): StaffingDay[] {
  const days: StaffingDay[] = [];
  const byDay = new Map<string, RosterAssignment[]>();
  for (const row of assignments) {
    // Group by the caller's work zone when given, so a shift lands on the same day as the window.
    const day = perthDateOf(row.startsAt, options.zone);
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
    const ofKind = (kind: CountedKind) => new Set(rows.filter((row) => row.kind === kind).map(personKey));
    const day = ofKind("day");
    const evening = ofKind("evening");
    days.push({
      date,
      on: known ? on.size : null,
      youWork: known && youWork,
      youRostered: known && youRostered,
      onLeave: known ? leave.size : 0,
      ...(known
        ? {
            byKind: { day: day.size, evening: evening.size },
            yourKinds: options.actorId
              ? COUNTED.filter((kind) => (kind === "day" ? day : evening).has(options.actorId!))
              : [],
          }
        : {}),
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

/** ISO weekday of a date: 1 Monday to 7 Sunday, as the needs table stores it. */
function isoWeekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
}

const wholeTeam = (need: StaffingNeed) => need.grade === null && need.siteId === null;
const countedNeed = (need: StaffingNeed) => (COUNTED as readonly string[]).includes(need.kind);

/** The team has a safe number: at least one whole-team Day or Evening need. */
export function hasSafeNumber(needs: readonly StaffingNeed[] | null | undefined): boolean {
  return !!needs?.some((need) => countedNeed(need) && wholeTeam(need));
}

/** Some Day or Evening need is for one grade or one site, which this check does not judge. */
export function hasGradeOrSiteNeeds(needs: readonly StaffingNeed[] | null | undefined): boolean {
  return !!needs?.some((need) => countedNeed(need) && !wholeTeam(need));
}

/**
 * The safe number for each counted kind on `date`: the sum of its whole-team
 * needs (no grade, no site). A need set for that exact date replaces the
 * weekday need by the Cover tab's rule (`needsOn` in `team/cover.ts`): a dated
 * need for any grade replaces every weekday need of its kind, and a dated need
 * for one grade leaves the whole-team weekday need in place. A kind with no
 * whole-team need has no safe number that day and is not judged.
 */
export function safeNumberOn(date: string, needs: readonly StaffingNeed[]): Partial<Record<CountedKind, number>> {
  const weekday = isoWeekdayOf(date);
  const result: Partial<Record<CountedKind, number>> = {};
  for (const kind of COUNTED) {
    const ofKind = needs.filter((need) => need.kind === kind);
    const dated = ofKind.filter((need) => need.date === date);
    const applies = dated.some((need) => need.grade === null)
      ? dated
      : ofKind.filter((need) => need.date === null && need.weekday === weekday);
    const general = applies.filter(wholeTeam);
    if (general.length) result[kind] = general.reduce((sum, need) => sum + need.needed, 0);
  }
  return result;
}

export type SafeShort = { readonly kind: CountedKind; readonly on: number; readonly needed: number };

export type SafeJudgement = {
  /** People on (Day or Evening), with you off when `away`. */
  readonly on: number;
  /** The day's safe number: the whole-team needs of the kinds that have one. */
  readonly needed: number;
  readonly below: boolean;
  /** Each kind with fewer on than it needs. */
  readonly short: readonly SafeShort[];
};

/**
 * Judge one day against the safe number. Null when the roster does not reach
 * the day or no whole-team need applies to it. Below when fewer are on than the
 * day needs, or when any one kind is short, so a full Day never hides an empty
 * Evening. With `away`, you come off each kind you work that day.
 */
export function judgeDay(day: StaffingDay, needs: readonly StaffingNeed[], away: boolean): SafeJudgement | null {
  if (day.on === null || !day.byKind) return null;
  const safe = safeNumberOn(day.date, needs);
  const kinds = COUNTED.filter((kind) => safe[kind] !== undefined);
  if (!kinds.length) return null;
  const byKind = day.byKind;
  const off = (kind: CountedKind) => (away && day.yourKinds?.includes(kind) ? 1 : 0);
  const short = kinds
    .map((kind) => ({ kind, on: byKind[kind] - off(kind), needed: safe[kind]! }))
    .filter((row) => row.on < row.needed);
  const on = away ? onIfAway(day)! : day.on;
  const needed = kinds.reduce((sum, kind) => sum + safe[kind]!, 0);
  return { on, needed, below: on < needed || short.length > 0, short };
}

/** The days shown below the safe number, each judged with you off when it is in your leave. */
export function belowSafeDays(
  days: readonly StaffingDay[],
  leave: StaffingWindow | null,
  needs: readonly StaffingNeed[] | null | undefined,
): string[] {
  if (!needs) return [];
  return days.filter((day) => judgeDay(day, needs, inRange(day.date, leave))?.below).map((day) => day.date);
}

/** `3 on, needs 4`, or per kind when one kind is short: `3 on Day shifts, needs 4 and 0 on Evening shifts, needs 1`. */
export function safeWords(judgement: SafeJudgement): string {
  const { short, on, needed } = judgement;
  const plain = short.length === 0 || (short.length === 1 && short[0]!.on === on && short[0]!.needed === needed);
  if (plain) return `${on} on, needs ${needed}`;
  return short.map((row) => `${row.on} on ${KIND_WORDS[row.kind]} shifts, needs ${row.needed}`).join(" and ");
}

/** The leave days judged against the safe number, present only when the needs could be read. */
export type LeaveSafety = {
  /** The team has a whole-team Day or Evening need at all. */
  readonly set: boolean;
  /** Leave days a need applied to. */
  readonly judged: number;
  /** Leave days below the safe number with you away, worst first. */
  readonly below: readonly { readonly date: string; readonly judgement: SafeJudgement }[];
};

export type LeaveStaffing =
  | { readonly kind: "unchecked"; readonly days: number }
  | {
      readonly kind: "partial";
      readonly lowest: number;
      readonly lowestDays: string[];
      readonly unchecked: number;
      readonly safe?: LeaveSafety;
    }
  | {
      readonly kind: "checked";
      readonly lowest: number;
      readonly lowestDays: string[];
      readonly yourShifts: number;
      readonly safe?: LeaveSafety;
    };

function leaveSafety(known: readonly StaffingDay[], needs: readonly StaffingNeed[]): LeaveSafety {
  const judged = known
    .map((day) => ({ date: day.date, judgement: judgeDay(day, needs, true) }))
    .filter((row): row is { date: string; judgement: SafeJudgement } => row.judgement !== null);
  const gap = (judgement: SafeJudgement) =>
    Math.max(judgement.needed - judgement.on, ...judgement.short.map((row) => row.needed - row.on));
  const below = judged
    .filter((row) => row.judgement.below)
    .sort((a, b) => gap(b.judgement) - gap(a.judgement) || a.date.localeCompare(b.date));
  return { set: hasSafeNumber(needs), judged: judged.length, below };
}

/**
 * The leave days' result: the lowest number on (with you away) and on which
 * days. With `needs` (the team's cover needs, read), each known day is also
 * judged against the safe number.
 */
export function leaveStaffing(
  days: readonly StaffingDay[],
  leave: StaffingWindow,
  needs?: readonly StaffingNeed[] | null,
): LeaveStaffing {
  const inLeave = days.filter((day) => inRange(day.date, leave));
  const known = inLeave.filter((day) => day.on !== null);
  const unchecked = dayCount(leave.from, leave.to) - known.length;
  if (known.length === 0) return { kind: "unchecked", days: dayCount(leave.from, leave.to) };
  const counts = known.map((day) => onIfAway(day)!);
  const lowest = Math.min(...counts);
  const lowestDays = known.filter((day) => onIfAway(day) === lowest).map((day) => day.date);
  const safe = needs ? { safe: leaveSafety(known, needs) } : {};
  if (unchecked > 0) return { kind: "partial", lowest, lowestDays, unchecked, ...safe };
  return {
    kind: "checked",
    lowest,
    lowestDays,
    yourShifts: known.filter((day) => day.youRostered ?? day.youWork).length,
    ...safe,
  };
}

export type AlternativeDates = StaffingWindow & { readonly lowest: number; readonly counts: number[] };

/**
 * Up to `limit` other runs of the same length, inside the read window and all
 * checked, starting after today, whose lowest day has MORE people on than the
 * picked dates and, with `needs`, no day below the safe number. Nearest to the
 * picked start first.
 */
export function alternativeDates(
  days: readonly StaffingDay[],
  leave: StaffingWindow,
  today: string,
  limit = 2,
  needs?: readonly StaffingNeed[] | null,
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
    // Never offer dates that would take the team below its safe number.
    if (needs && run.some((day) => judgeDay(day, needs, true)?.below)) continue;
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
export function staffingDayLabel(
  day: StaffingDay,
  leave: StaffingWindow | null,
  needs?: readonly StaffingNeed[] | null,
): string {
  const name = shortDay(day.date);
  if (day.on === null) return `${name}: not checked, roster not published`;
  const away = inRange(day.date, leave);
  const count = away ? onIfAway(day)! : day.on;
  const judgement = needs ? judgeDay(day, needs, away) : null;
  const parts = [`${name}: ${count} on`];
  if (judgement?.below) parts.splice(0, 1, `${name}: ${safeWords(judgement)}`, "below safe number");
  else if (judgement) parts.push(`needs ${judgement.needed}`);
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
  const tail =
    result.kind === "partial"
      ? `${result.unchecked} ${result.unchecked === 1 ? "day isn't" : "days aren't"} published yet, so not checked.`
      : result.yourShifts === 0
        ? "You have no shifts on these days."
        : // Days, not shifts: the leave sheet's clash line above also counts a night that starts the day before.
          `You're rostered on ${result.yourShifts} of these days.`;
  const safe = result.safe;
  const worst = safe?.below[0];
  if (safe && worst)
    return {
      lead: `Below safe number: ${dayList(safe.below.map((row) => row.date).sort())}.`,
      rest: `With you away, ${shortDay(worst.date)} has ${safeWords(worst.judgement)}. ${tail}`,
    };
  const lead = `Fewest on: ${plural(result.lowest)}, ${dayList(result.lowestDays)}.`;
  if (safe && safe.judged > 0) return { lead, rest: `No day is below the safe number. ${tail}` };
  return { lead, rest: tail };
}

/**
 * The note under every staffing check. `needs` is undefined while the needs
 * are being read and null when they couldn't be read.
 */
export function safeNumberNote(needs: readonly StaffingNeed[] | null | undefined): string {
  if (needs === undefined) return "Checking your team's safe number.";
  if (needs === null)
    return "Your team's safe number couldn't be checked, so this shows how many are on, not whether that is enough. Your roster manager decides.";
  if (!hasSafeNumber(needs) && hasGradeOrSiteNeeds(needs))
    return "Your roster manager set cover for one grade or one site only, which this check doesn't judge. This shows how many are on, not whether that is enough. Your roster manager decides.";
  if (!hasSafeNumber(needs))
    return "Your roster manager hasn't set a safe number for this team yet. This shows how many are on, not whether that is enough.";
  const specific = hasGradeOrSiteNeeds(needs) ? " Needs for one grade or one site aren't judged here." : "";
  return `The safe number is the Day and Evening cover your roster manager set for the whole team.${specific} Your roster manager decides.`;
}

/**
 * A note the doctor copies to their roster manager when the team has no safe
 * number set yet. It names the dates, never a figure and never anyone else.
 */
export function staffingAskText(leave: StaffingWindow | null, teamName: string | null): string {
  const team = teamName ? `${teamName} needs` : "our team needs";
  const ask = `What is the fewest doctors ${team} on each day?`;
  return leave
    ? `Hi, I am thinking of leave ${spanWords(leave)}. ${ask} I would like to pick dates that suit the team.\n\nThanks`
    : `Hi, w${ask.slice(1)} I would like to plan my leave around it.\n\nThanks`;
}
