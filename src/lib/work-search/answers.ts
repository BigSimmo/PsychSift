import { evaluateYear } from "@/lib/cme/evaluate";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import { addDaysToDate, formatPerthDay, MONTHS, perthDateOf, perthTimeOf } from "@/lib/perth-time";
import type { ShiftKind } from "@/lib/roster/shift-kind";
import {
  TEACHING_LOOKAHEAD_DAYS,
  workSearchAreaLabels,
  type WorkAreaRead,
  type WorkItem,
  type WorkSearchArea,
} from "@/lib/work-search/model";

/**
 * Built-in answers to the common plain questions, worked out in the browser from
 * the reader's own records. No AI: a small fixed set of question shapes, each
 * answered by code that reads the records, in the same spirit as Roster's Ask
 * ("a strict, finite grammar; it never sends text"). Anything else falls back
 * to ordinary word matches.
 *
 * Every answer says what it understood (`understood`), where it came from
 * (`source`) and, when an area it needed could not load, says so instead of
 * answering — a failed read is never "nothing due". An answer built from
 * invented sample records says so in its source line.
 */

export interface WorkAnswerInput {
  readonly items: readonly WorkItem[];
  readonly areas: readonly WorkAreaRead[];
  readonly today: string;
  /** The current instant (ms). A shift that has already ended is never "next"; one under way is "on now". */
  readonly now?: number;
  /** The reader's confirmed CPD targets for the year their activities belong to, when read. */
  readonly cpd: { readonly set: CmeRequirementSet | null; readonly entries: readonly CmeEntry[] } | null;
}

export type WorkAnswerIcon =
  "night" | "evening" | "shift" | "on-call" | "due" | "leave" | "presenting" | "cpd" | "free";

export interface WorkAnswer {
  /** The area whose colour the card wears, or "all" for a cross-area answer. */
  readonly area: WorkSearchArea | "all";
  readonly icon: WorkAnswerIcon;
  /** Small label over the headline, e.g. "Your next night". */
  readonly label: string;
  readonly headline: string;
  readonly sub: string | null;
  readonly meta: readonly string[];
  /** Records the answer is built from, shown under it. */
  readonly items: readonly WorkItem[];
  /** One line on what the question was read as: "Showing your next night shift". */
  readonly understood: string;
  readonly source: string;
  /** Set instead of an answer when an area the question needs did not load. */
  readonly unavailable?: string;
  /** True while that area is still loading, so the card offers no Retry yet. */
  readonly loading?: boolean;
  /** A caution printed under the card, e.g. that dates are as the reader recorded them. */
  readonly footnote?: string;
  /** The primary action, when there is one. */
  readonly action?: { readonly label: string; readonly href: string };
  /** Progress rows (CPD targets), short ones first. */
  readonly progress?: readonly WorkAnswerProgress[];
  /** A plain explanation printed inside the card, under the headline. */
  readonly note?: string;
  /** A week strip for "free days" questions: each day of the week, and whether it has no rostered shift. */
  readonly week?: readonly WorkAnswerDay[];
  /** A timed shift the reader can add to their calendar from the card. */
  readonly calendar?: WorkItem;
  /** What a failed area may have left out, for the notice above the card: "Your talks". */
  readonly missing?: string;
}

export interface WorkAnswerDay {
  readonly date: string;
  readonly free: boolean;
  /** False for days of the week the question did not ask about (already past, say). */
  readonly inRange: boolean;
}

export interface WorkAnswerProgress {
  readonly label: string;
  readonly summary: string;
  readonly met: boolean;
  /** 0 to 1, or null for a done/not-done task. */
  readonly fraction: number | null;
}

const SHIFT_WORDS: ReadonlyArray<[RegExp, ShiftKind, string, string, WorkAnswerIcon]> = [
  [/\b(?:nights?|night shifts?|ns|nites?)\b/, "night", "night", "nights", "night"],
  [/\b(?:evenings?|lates)\b/, "evening", "evening", "evenings", "evening"],
  [/\bon[- ]?calls?\b/, "on_call", "on-call shift", "on-call shifts", "on-call"],
  [/\b(?:day shifts?|days)\b(?! off)/, "day", "day shift", "day shifts", "shift"],
];

/** Kinds that are work, for "next shift": leave rows imported into the roster are not. */
const WORK_FACETS = new Set<string>(["day", "evening", "night", "on_call", "other"]);

const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function utcDay(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function daysBetween(from: string, to: string): number {
  return Math.round((utcDay(to).getTime() - utcDay(from).getTime()) / 86_400_000);
}

function inDays(today: string, date: string): string {
  const days = daysBetween(today, date);
  if (days < 0) return days === -1 ? "Yesterday" : `${-days} days ago`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

/** "Tuesday 6 October", built by hand so every answer prints dates the same way. */
function longDay(date: string): string {
  const day = utcDay(date);
  return `${WEEKDAY_LONG[day.getUTCDay()]} ${day.getUTCDate()} ${MONTH_LONG[day.getUTCMonth()]}`;
}

function dayMonth(date: string): string {
  const day = utcDay(date);
  return `${day.getUTCDate()} ${MONTH_LONG[day.getUTCMonth()]}`;
}

function endOfMonth(date: string): string {
  const [year, month] = date.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

function nextMonthStart(date: string): string {
  return addDaysToDate(endOfMonth(date), 1);
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function areaRead(input: WorkAnswerInput, area: WorkSearchArea) {
  return input.areas.find((read) => read.area === area);
}

/** The question's needed areas that are not ready, named for an honest "couldn't check" line. */
function notReady(input: WorkAnswerInput, areas: readonly WorkSearchArea[]): { why: string; loading: boolean } | null {
  const missing = areas.filter((area) => areaRead(input, area)?.status !== "ready");
  if (missing.length === 0) return null;
  const loading = missing.every((area) => (areaRead(input, area)?.status ?? "loading") === "loading");
  const names = [...new Set(missing.map((area) => workSearchAreaLabels[area]))].join(" and ");
  return loading
    ? { why: `Still loading ${names}.`, loading: true }
    : { why: `${names} couldn't load, so this can't be answered yet.`, loading: false };
}

function unavailableAnswer(
  area: WorkSearchArea | "all",
  icon: WorkAnswerIcon,
  understood: string,
  gap: { why: string; loading: boolean },
): WorkAnswer {
  return {
    area,
    icon,
    label: "Can't check yet",
    headline: gap.why,
    sub: null,
    meta: [],
    items: [],
    understood,
    source: "",
    unavailable: gap.why,
    loading: gap.loading,
  };
}

function nowOf(input: WorkAnswerInput): number {
  // Without a clock, start of the Perth day: anything dated today still counts as ahead.
  return input.now ?? Date.parse(`${input.today}T00:00:00+08:00`);
}

/** An on-call shift that runs through midnight: people asking about their nights mean these too. */
function overnightOnCall(item: WorkItem): boolean {
  return (
    item.facet === "on_call" &&
    Boolean(item.startsAt && item.endsAt) &&
    perthDateOf(item.endsAt as string) !== perthDateOf(item.startsAt as string)
  );
}

function matchesKind(item: WorkItem, kind: ShiftKind | null): boolean {
  if (kind === null) return WORK_FACETS.has(item.facet ?? "other");
  return item.facet === kind || (kind === "night" && overnightOnCall(item));
}

/** The last day the roster holds, so "none" can say how far it looked. */
function rosterHorizon(input: WorkAnswerInput): string | null {
  const dates = input.items.filter((item) => item.kind === "shift" && item.date).map((item) => item.date as string);
  return dates.length > 0 ? dates.reduce((latest, date) => (date > latest ? date : latest)) : null;
}

/** Work shifts not yet over, soonest first. */
function shiftsAhead(input: WorkAnswerInput, kind: ShiftKind | null): WorkItem[] {
  const now = nowOf(input);
  return input.items
    .filter((item) => item.kind === "shift" && item.date !== null)
    .filter((item) => matchesKind(item, kind))
    .filter((item) => (item.endsAt ? Date.parse(item.endsAt) > now : (item.date ?? "") >= input.today))
    .sort((a, b) => (a.startsAt ?? a.date ?? "").localeCompare(b.startsAt ?? b.date ?? ""));
}

function underWay(item: WorkItem, now: number): boolean {
  return Boolean(item.startsAt && item.endsAt && Date.parse(item.startsAt) <= now && Date.parse(item.endsAt) > now);
}

function nextShift(
  input: WorkAnswerInput,
  kind: ShiftKind | null,
  one: string,
  many: string,
  icon: WorkAnswerIcon,
): WorkAnswer {
  const understood = `Showing your next ${one}`;
  const gap = notReady(input, ["roster"]);
  if (gap) return unavailableAnswer("roster", icon, understood, gap);
  const upcoming = shiftsAhead(input, kind);
  const first = upcoming[0];
  if (!first?.date) {
    const horizon = rosterHorizon(input);
    return {
      area: "roster",
      icon,
      label: `Your next ${one}`,
      headline: `No ${many} rostered`,
      sub:
        horizon && horizon >= input.today
          ? `None in your roster up to ${formatPerthDay(horizon)}, the last day it holds.`
          : "Your roster has nothing ahead yet.",
      meta: [],
      items: [],
      understood,
      source: "From your Roster",
      action: { label: "Open Roster", href: "/roster/shifts" },
    };
  }
  const now = nowOf(input);
  // A run: consecutive days of the same kind starting at the first, one per day.
  const days = [...new Set(upcoming.map((item) => item.date))];
  let run = 1;
  while (days[run] === addDaysToDate(first.date, run)) run += 1;
  const onNow = underWay(first, now);
  const after = onNow ? upcoming[1] : undefined;
  const parts = first.detail?.split(" · ") ?? [];
  return {
    area: "roster",
    icon,
    label: onNow ? `On now` : `Your next ${one}`,
    headline: onNow && first.endsAt ? `Until ${perthTimeOf(first.endsAt)}` : longDay(first.date),
    // On now: what and where, then what comes next. Otherwise the times and place under the day.
    sub: onNow
      ? [
          first.title,
          ...parts.slice(2),
          ...(after?.date
            ? [`then ${formatPerthDay(after.date)}${after.startsAt ? `, ${perthTimeOf(after.startsAt)}` : ""}`]
            : []),
        ].join(" · ")
      : parts.slice(1).join(" · ") || null,
    meta: onNow
      ? []
      : [
          ...(run > 1 ? [`First of ${run} ${many}`] : []),
          ...(overnightOnCall(first) && kind === "night" ? ["On call overnight"] : []),
          inDays(input.today, first.date),
        ],
    items: upcoming.slice(0, Math.max(run, 3)),
    understood,
    source: "From your Roster",
    action: { label: "Open shift", href: first.href },
    ...(!onNow && first.startsAt && first.endsAt ? { calendar: first } : {}),
  };
}

/** A date range named in the question, printed back in the answer. */
interface Range {
  readonly from: string;
  readonly to: string;
  readonly words: string;
}

const WEEKDAY_PATTERN = /\b(?:on )?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday)?\b/;
const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  sun: 0,
  mon: 1,
  tue: 2,
  tues: 2,
  wed: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  fri: 5,
  sat: 6,
};
const MONTH_PATTERN = new RegExp(
  `\\b(\\d{1,2})(?:st|nd|rd|th)? (${MONTHS.map((month) => month.toLowerCase()).join("|")})[a-z]*\\b|\\b(${MONTHS.map((month) => month.toLowerCase()).join("|")})[a-z]* (\\d{1,2})(?:st|nd|rd|th)?\\b`,
);

function rangeWords(from: string, to: string): string {
  return from === to ? longDay(from) : `${formatPerthDay(from)} to ${formatPerthDay(to)}`;
}

/** "tomorrow", "tonight", "this weekend", "next week", "on Friday", "12 Oct": the range they name. */
export function parseDateRange(text: string, today: string): Range | null {
  const weekday = utcDay(today).getUTCDay();
  const make = (from: string, to: string, words?: string): Range => ({
    from,
    to,
    words: words ?? rangeWords(from, to),
  });
  if (/\b(today|tonight)\b/.test(text)) return make(today, today, `today, ${longDay(today)}`);
  if (/\btomorrow\b/.test(text)) {
    const tomorrow = addDaysToDate(today, 1);
    return make(tomorrow, tomorrow, `tomorrow, ${longDay(tomorrow)}`);
  }
  if (/\bnext weekend\b/.test(text)) {
    const saturday = addDaysToDate(today, ((6 - weekday + 7) % 7 || 7) + 7);
    return make(saturday, addDaysToDate(saturday, 1));
  }
  if (/\b(this )?weekend\b/.test(text)) {
    const saturday = weekday === 0 ? addDaysToDate(today, -1) : addDaysToDate(today, (6 - weekday + 7) % 7);
    return make(saturday < today ? today : saturday, addDaysToDate(saturday, 1));
  }
  if (/\bnext week\b/.test(text)) {
    const monday = addDaysToDate(today, (1 - weekday + 7) % 7 || 7);
    return make(monday, addDaysToDate(monday, 6));
  }
  if (/\bthis week\b/.test(text)) {
    const sunday = addDaysToDate(today, (7 - weekday) % 7);
    return make(today, sunday);
  }
  if (/\bnext month\b/.test(text)) {
    const start = nextMonthStart(today);
    return make(start, endOfMonth(start), `in ${MONTH_LONG[utcDay(start).getUTCMonth()]}`);
  }
  if (/\bthis month\b/.test(text)) {
    return make(today, endOfMonth(today), `for the rest of ${MONTH_LONG[utcDay(today).getUTCMonth()]}`);
  }
  const monthMatch = MONTH_PATTERN.exec(text);
  if (monthMatch) {
    const dayText = monthMatch[1] ?? monthMatch[4];
    const monthText = (monthMatch[2] ?? monthMatch[3] ?? "").slice(0, 3);
    const month = MONTHS.findIndex((name) => name.toLowerCase() === monthText);
    const day = Number(dayText);
    if (month >= 0 && day >= 1 && day <= 31) {
      let year = Number(today.slice(0, 4));
      let date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      // A date already past this year means next year's ("12 Jan" asked in October).
      if (daysBetween(today, date) < -31) {
        year += 1;
        date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
      if (perthDateOf(`${date}T12:00:00Z`) === date) return make(date, date);
    }
  }
  const weekdayMatch = WEEKDAY_PATTERN.exec(text);
  if (weekdayMatch?.[1]) {
    const target = WEEKDAY_INDEX[weekdayMatch[1]];
    if (target !== undefined) {
      const date = addDaysToDate(today, (target - weekday + 7) % 7);
      return make(date, date);
    }
  }
  return null;
}

function shiftsInRange(input: WorkAnswerInput, range: Range): WorkAnswer {
  const understood = `Showing your shifts ${range.words}`;
  const gap = notReady(input, ["roster"]);
  if (gap) return unavailableAnswer("roster", "shift", understood, gap);
  const shifts = input.items
    .filter((item) => item.kind === "shift" && item.date !== null && item.date >= range.from && item.date <= range.to)
    .sort((a, b) => (a.startsAt ?? a.date ?? "").localeCompare(b.startsAt ?? b.date ?? ""));
  const work = shifts.filter((item) => WORK_FACETS.has(item.facet ?? "other"));
  const leave = input.items.filter(
    (item) =>
      item.kind === "leave" && item.date !== null && item.date <= range.to && (item.until ?? item.date) >= range.from,
  );
  const single = range.from === range.to;
  const first = work[0];
  const now = nowOf(input);
  // A night that started the day before and ends on this day: said, not counted as this day's shift.
  const carried = single
    ? input.items.find(
        (item) =>
          item.kind === "shift" &&
          WORK_FACETS.has(item.facet ?? "other") &&
          item.date === addDaysToDate(range.from, -1) &&
          item.endsAt &&
          perthDateOf(item.endsAt) === range.from,
      )
    : undefined;
  const ahead = work.find((item) => item.startsAt && item.endsAt && Date.parse(item.startsAt) > now);
  const headline =
    work.length === 0
      ? leave.length > 0
        ? "On leave"
        : single
          ? "Not rostered"
          : "No shifts rostered"
      : single && first
        ? (first.detail?.split(" · ")[1] ?? `${work.length} shift`)
        : plural(work.length, "shift");
  return {
    area: "roster",
    icon: work.length === 0 ? "free" : "shift",
    label: single ? longDay(range.from) : rangeWords(range.from, range.to),
    headline,
    sub: single && first ? [first.title, ...(first.detail?.split(" · ").slice(2) ?? [])].join(" · ") : null,
    meta: [
      ...(leave.length > 0 ? [`Leave: ${leave.map((item) => item.title).join(", ")}`] : []),
      ...(carried?.endsAt
        ? [`Night from ${shortDay(carried.date as string)} ends ${perthTimeOf(carried.endsAt)}`]
        : []),
      ...(single ? [inDays(input.today, range.from)] : []),
    ],
    items: [...work, ...leave].slice(0, 14),
    understood,
    source: "From your Roster",
    ...(first ? { action: { label: single ? "Open shift" : "Open Roster", href: first.href } } : {}),
    ...(single && ahead ? { calendar: ahead } : {}),
  };
}

/** "Wed 7, Fri 9, Sat 10": short enough to sit over a week strip that shows the month. */
function shortDay(date: string): string {
  return formatPerthDay(date).split(" ").slice(0, 2).join(" ");
}

/** Monday to Sunday of the week holding `date`. */
function weekOf(date: string): string[] {
  const back = (utcDay(date).getUTCDay() + 6) % 7;
  const monday = addDaysToDate(date, -back);
  return Array.from({ length: 7 }, (_, index) => addDaysToDate(monday, index));
}

function freeDays(input: WorkAnswerInput, range: Range, named: string | null): WorkAnswer {
  const understood = `Showing days with no shift ${range.words}`;
  const gap = notReady(input, ["roster"]);
  if (gap) return unavailableAnswer("roster", "free", understood, gap);
  const worked = new Set(
    input.items
      .filter((item) => item.kind === "shift" && WORK_FACETS.has(item.facet ?? "other") && item.date !== null)
      .map((item) => item.date as string),
  );
  // Days past the last rostered shift are not counted: an unpublished roster is not a day off.
  const horizon = rosterHorizon(input);
  const counted = (date: string) => horizon !== null && date <= horizon;
  const free: string[] = [];
  for (let date = range.from; date <= range.to; date = addDaysToDate(date, 1)) {
    if (counted(date) && !worked.has(date)) free.push(date);
  }
  const beyond =
    horizon === null || horizon < range.to
      ? horizon === null || horizon < range.from
        ? "Your roster has no shifts for these days yet, so they aren't counted."
        : `Your roster only holds shifts up to ${formatPerthDay(horizon)}. Later days aren't counted.`
      : null;
  // One calendar week fits a strip; anything longer is listed in words only.
  const week = weekOf(range.from);
  const strip = range.to <= (week[6] as string);
  const rule =
    "Teaching sessions don't count as shifts, and a night that ends in the morning doesn't count as a working day.";
  return {
    area: "roster",
    icon: "free",
    label: named ? `Days off ${named}` : "Days off",
    headline:
      free.length === 0
        ? horizon === null || horizon < range.from
          ? "Roster not out yet"
          : "No days without a rostered shift"
        : `${plural(free.length, "day")} with no rostered shift`,
    sub:
      free.length > 0
        ? strip
          ? free.map(shortDay).join(", ")
          : free.slice(0, 8).map(formatPerthDay).join(", ") + (free.length > 8 ? " …" : "")
        : null,
    meta: named ? [] : [rangeWords(range.from, range.to)],
    items: [],
    understood,
    source: "From your Roster",
    note: [strip ? `Shaded days have no rostered shift. ${rule}` : rule, beyond].filter(Boolean).join(" "),
    ...(strip
      ? {
          week: week.map((date) => ({
            date,
            free: counted(date) && !worked.has(date),
            inRange: date >= range.from && date <= range.to,
          })),
        }
      : {}),
    action: { label: "Open Roster", href: "/roster/shifts" },
  };
}

function countShifts(
  input: WorkAnswerInput,
  kind: ShiftKind | null,
  many: string,
  icon: WorkAnswerIcon,
  range: Range,
): WorkAnswer {
  const understood = `Counting your ${many} ${range.words}`;
  const gap = notReady(input, ["roster"]);
  if (gap) return unavailableAnswer("roster", icon, understood, gap);
  const shifts = input.items.filter(
    (item) =>
      item.kind === "shift" &&
      item.date !== null &&
      item.date >= range.from &&
      item.date <= range.to &&
      matchesKind(item, kind),
  );
  const overnightCalls = kind === "night" ? shifts.filter(overnightOnCall).length : 0;
  const hours = shifts.reduce(
    (sum, item) =>
      item.startsAt && item.endsAt ? sum + (Date.parse(item.endsAt) - Date.parse(item.startsAt)) / 3_600_000 : sum,
    0,
  );
  return {
    area: "roster",
    icon,
    label: `How many ${many}`,
    headline: shifts.length === 1 ? `1 ${many.replace(/s$/, "")}` : `${shifts.length} ${many}`,
    sub: rangeWords(range.from, range.to),
    meta: [
      ...(hours > 0 ? [`${Math.round(hours * 10) / 10} h rostered`] : []),
      ...(overnightCalls > 0 ? [`Includes ${overnightCalls} overnight on call`] : []),
    ],
    items: shifts.slice(0, 14),
    understood,
    source: "From your Roster",
    action: { label: "Open Roster", href: "/roster/shifts" },
  };
}

const LEAVE_STATUS = /\b(Planned|Applied for|Approved)\b/;

function nextLeave(input: WorkAnswerInput): WorkAnswer {
  const understood = "Showing your next leave";
  const gap = notReady(input, ["roster"]);
  if (gap) return unavailableAnswer("roster", "leave", understood, gap);
  const leave = input.items
    .filter((item) => item.kind === "leave" && (item.until ?? item.date ?? "") >= input.today)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const first = leave[0];
  if (!first?.date) {
    return {
      area: "roster",
      icon: "leave",
      label: "Your next leave",
      headline: "No leave booked ahead",
      sub: null,
      meta: [],
      items: [],
      understood,
      source: "From your Roster",
      action: { label: "Request leave", href: "/roster/requests" },
    };
  }
  const days = daysBetween(first.date, first.until ?? first.date) + 1;
  const status = LEAVE_STATUS.exec(first.detail ?? "")?.[1];
  return {
    area: "roster",
    icon: "leave",
    label: "Your next leave",
    headline:
      first.date <= input.today ? `On leave until ${formatPerthDay(first.until ?? first.date)}` : longDay(first.date),
    sub: first.title,
    meta: [
      ...(first.date <= input.today
        ? []
        : [first.until && first.until !== first.date ? `Until ${formatPerthDay(first.until)}` : plural(days, "day")]),
      ...(status ? [status] : []),
      first.date <= input.today ? "On leave now" : inDays(input.today, first.date),
    ],
    items: leave.slice(0, 3),
    understood,
    source: "From your Roster",
    action: { label: "Open leave", href: first.href },
  };
}

/** The window "due" covers, as the question names it. Printed in the answer, never implied. */
function dueWindow(query: string, today: string): { to: string; words: string; label: string } {
  if (/\bnext week\b/.test(query)) {
    const to = addDaysToDate(today, 13);
    return { to, words: `in the next 14 days (to ${formatPerthDay(to)})`, label: `Due by ${dayMonth(to)}` };
  }
  if (/\b(this )?week\b/.test(query)) {
    const to = addDaysToDate(today, 6);
    return { to, words: `in the next 7 days (to ${formatPerthDay(to)})`, label: `Due by ${dayMonth(to)}` };
  }
  if (/\bnext month\b/.test(query)) {
    const to = endOfMonth(nextMonthStart(today));
    return { to, words: `by ${longDay(to)}`, label: `Due by ${dayMonth(to)}` };
  }
  if (/\b(this )?month\b/.test(query)) {
    const to = endOfMonth(today);
    return { to, words: `by ${longDay(to)}`, label: `Due by ${dayMonth(to)}` };
  }
  const to = addDaysToDate(today, 30);
  return { to, words: `in the next 30 days (to ${formatPerthDay(to)})`, label: `Due by ${dayMonth(to)}` };
}

function due(input: WorkAnswerInput, query: string): WorkAnswer {
  const window = dueWindow(query, input.today);
  const understood = `Showing renewals and talks due ${window.words}, overdue first`;
  const gap =
    notReady(input, ["my-work"]) ??
    (areaRead(input, "teaching")?.status === "loading" ? notReady(input, ["teaching"]) : null);
  if (gap) return unavailableAnswer("all", "due", understood, gap);
  // Teaching failed but Admin read: answer from Admin, and say the count may be short ("at least").
  const partial = areaRead(input, "teaching")?.status !== "ready";
  // Talks are only read six weeks ahead; past that, say how far they were checked rather than imply "none".
  const talksTo = addDaysToDate(input.today, TEACHING_LOOKAHEAD_DAYS);
  const talksShort = !partial && window.to > talksTo;
  const read = partial
    ? `Showing renewals due ${window.words}, overdue first`
    : talksShort
      ? `Showing renewals due ${window.words}, and talks up to ${formatPerthDay(talksTo)}, overdue first`
      : understood;
  const overdue = input.items
    .filter((item) => item.kind === "renewal" && item.date !== null && item.date < input.today)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const upcoming = input.items
    .filter(
      (item) =>
        (item.kind === "renewal" || item.facet === "presenting") &&
        item.date !== null &&
        item.date >= input.today &&
        item.date <= window.to,
    )
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const undated = input.items.filter(
    (item) => item.kind === "renewal" && item.date === null && !item.detail?.includes("Not needed for this job"),
  ).length;
  const all = [...overdue, ...upcoming];
  return {
    area: "all",
    icon: "due",
    label: window.label,
    headline:
      all.length === 0
        ? partial
          ? "Nothing recorded as due in Admin"
          : "Nothing recorded as due"
        : [
            overdue.length > 0 ? `${overdue.length} overdue` : null,
            upcoming.length > 0 ? `${partial ? "at least " : ""}${upcoming.length} coming up` : null,
          ]
            .filter(Boolean)
            .join(", ")
            .replace(/^./, (letter) => letter.toUpperCase()),
    sub: null,
    meta: [],
    items: all,
    understood: read,
    source: partial
      ? "From your Admin records. Teaching couldn't be checked."
      : talksShort
        ? `From your Admin and Teaching records. Talks are checked up to ${formatPerthDay(talksTo)}.`
        : "From your Admin and Teaching records",
    footnote: `${undated > 0 ? `${plural(undated, "renewal")} ${undated === 1 ? "has" : "have"} no date recorded. ` : ""}Dates are shown as you recorded them.`,
    ...(partial ? { missing: "Your talks" } : {}),
  };
}

function presenting(input: WorkAnswerInput): WorkAnswer {
  const understood = "Showing sessions you're presenting in the next six weeks";
  const gap = notReady(input, ["teaching"]);
  if (gap) return unavailableAnswer("teaching", "presenting", understood, gap);
  const now = nowOf(input);
  const talks = input.items
    .filter(
      (item) =>
        item.facet === "presenting" &&
        item.date !== null &&
        (item.endsAt ? Date.parse(item.endsAt) > now : item.date >= input.today),
    )
    .sort((a, b) => (a.startsAt ?? a.date ?? "").localeCompare(b.startsAt ?? b.date ?? ""));
  const first = talks[0];
  return {
    area: "teaching",
    icon: "presenting",
    label: first ? "You're presenting" : "Your talks",
    headline: first?.date ? longDay(first.date) : "No talks in the next six weeks",
    sub: first ? first.title : null,
    meta: first?.date
      ? [inDays(input.today, first.date), ...(talks.length > 1 ? [plural(talks.length, "talk")] : [])]
      : [],
    items: talks,
    understood,
    source: "From your Teaching programme",
    action: first ? { label: "Open session", href: first.href } : { label: "Open Teaching", href: "/teaching/week" },
  };
}

function cpdHours(input: WorkAnswerInput): WorkAnswer {
  const understood = "Showing your CPD targets for this year";
  const gap = notReady(input, ["cme"]) ?? (input.cpd ? null : { why: "Still loading CPD.", loading: true });
  if (gap || !input.cpd)
    return unavailableAnswer("cme", "cpd", understood, gap ?? { why: "Still loading CPD.", loading: true });
  const { set, entries } = input.cpd;
  if (!set) {
    return {
      area: "cme",
      icon: "cpd",
      label: "CPD hours",
      headline: "No targets confirmed for this year",
      sub: "Confirm your year's targets in CPD to see what's still short.",
      meta: [],
      items: [],
      understood,
      source: "From your CPD log",
      action: { label: "Set up CPD", href: "/cme/setup" },
    };
  }
  const status = evaluateYear({ set, entries });
  const labels = new Map(set.requirements.map((requirement) => [requirement.id, requirement.label]));
  const progress = status.statuses
    .map((row) => ({
      label: labels.get(row.requirementId) ?? "Target",
      // Plainer words for the evaluator's activity-count summaries.
      summary: row.summary.replace(/ (?:has|have) nothing against (?:it|them) yet$/, " with nothing logged yet"),
      met: row.met,
      fraction: row.progress && row.progress.target > 0 ? Math.min(1, row.progress.value / row.progress.target) : null,
    }))
    // Short targets first, the furthest behind at the top; reached ones last.
    .sort((a, b) => Number(a.met) - Number(b.met) || (a.fraction ?? 0) - (b.fraction ?? 0));
  const reached = progress.filter((row) => row.met).length;
  const short = status.unmet.length;
  return {
    area: "cme",
    icon: "cpd",
    label: `CPD ${set.year}`,
    headline: short === 0 ? "Every target reached" : `${short} ${short === 1 ? "target" : "targets"} still short`,
    sub: `${reached} of ${status.statuses.length} targets met so far this year`,
    meta: [],
    progress,
    items: [],
    understood,
    // The confirmation is an instant; the reader confirmed it on a Perth day.
    source: `From your CPD log, against the targets you confirmed on ${longDay(perthDateOf(set.confirmedOn))} ${perthDateOf(set.confirmedOn).slice(0, 4)}`,
    action: { label: "Open CPD", href: "/cme" },
  };
}

/** Words that mean the question is about something other than shifts, even with "next" or "day" in it. */
const NOT_ABOUT_SHIFTS = /\b(teaching|session|meeting|form|cpd|cme|talk|presenting|renewal|course|exam|journal)\b/;

function route(text: string, input: WorkAnswerInput): WorkAnswer | null {
  const asksWhen = /\b(next|when|upcoming)\b/.test(text);
  if (/\b(presenting|my talks?|am i presenting|my presentations?)\b/.test(text)) return presenting(input);
  if (/\b(due|renewals?|renew|expir\w*|overdue)\b/.test(text)) return due(input, text);
  if (/\b(cpd|cme)\b/.test(text) && /\b(hours?|left|need|short|target|targets|on track)\b/.test(text)) {
    return cpdHours(input);
  }
  if (asksWhen && /\b(leave|holidays?|annual leave|vacation)\b/.test(text)) return nextLeave(input);
  if (NOT_ABOUT_SHIFTS.test(text)) return null;

  const range = parseDateRange(text, input.today);
  if (/\b(free days?|days? off|off days?|not rostered)\b/.test(text)) {
    const named =
      /\b(this week|next week|this month|next month|this weekend|next weekend)\b/.exec(text)?.[1] ??
      (range ? null : "this week");
    return freeDays(input, range ?? parseDateRange("this week", input.today)!, named);
  }
  const shiftWord = SHIFT_WORDS.find(([pattern]) => pattern.test(text));
  if (/\bhow many\b/.test(text) && (shiftWord || /\bshifts?\b/.test(text))) {
    const window = range ?? parseDateRange("this month", input.today)!;
    return shiftWord
      ? countShifts(input, shiftWord[1], shiftWord[3], shiftWord[4], window)
      : countShifts(input, null, "shifts", "shift", window);
  }
  if (asksWhen && shiftWord) return nextShift(input, shiftWord[1], shiftWord[2], shiftWord[3], shiftWord[4]);
  const aboutWork =
    /\b(am i (?:on|working|rostered|at work|in)|working|rostered|shifts?|my roster|what am i doing)\b/.test(text);
  if (range && (aboutWork || shiftWord)) return shiftsInRange(input, range);
  if (asksWhen && /\b(shifts?|working|rostered|my next work|am i next (?:on|in|at work))\b/.test(text)) {
    return nextShift(input, null, "shift", "shifts", "shift");
  }
  return null;
}

/** The built-in answer for `query`, or null when it is not one of the known question shapes. */
export function answerWorkQuestion(query: string, input: WorkAnswerInput): WorkAnswer | null {
  const text = query
    .trim()
    .toLowerCase()
    .replace(/[?!.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 3) return null;
  const answer = route(text, input);
  if (!answer || answer.unavailable) return answer;
  // Invented records are never presented as the reader's own.
  const sampleArea =
    answer.area === "all" ? input.areas.some((read) => read.sample) : areaRead(input, answer.area)?.sample;
  return sampleArea ? { ...answer, source: `${answer.source} (sample data, not your records)` } : answer;
}
