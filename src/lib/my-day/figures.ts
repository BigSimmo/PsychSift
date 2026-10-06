/**
 * My Day dashboard figures: the pure arithmetic behind the cards that draw
 * (the day ribbon, the month calendar, the hours bars and heat map, CPD by
 * type and by month, the renewals runway, the flag). Nothing here fetches or
 * stores, and nothing invents: every figure is computed from records a mode
 * already holds, and a card with nothing to draw gets `null` and hides.
 */

import { cmeCategories, type CmeCategory, type CmeEntry } from "@/lib/cme/types";
import type { MyDayItem } from "@/lib/my-day/model";
import { fortnightFor, summariseHours, type HoursShift } from "@/lib/roster/hours";
import type { ShiftKind } from "@/lib/roster/shift-kind";
import { addDaysToDate, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function utc(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** Monday-first weekday index (0 = Monday) of a Perth date. */
export function mondayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"] as const;

// ---------------------------------------------------------------- the flag

/**
 * The flag card's items: the items that are overdue or due soon and not
 * moved to later, overdue first (otherwise in the given order), at most
 * `cap`. Empty means no flag card.
 */
export function selectFlagItems(
  items: readonly MyDayItem[],
  isSnoozed: (id: string) => boolean,
  cap = 3,
): readonly MyDayItem[] {
  const open = items.filter((item) => item.severity !== "info" && !isSnoozed(item.id));
  return [
    ...open.filter((item) => item.severity === "overdue"),
    ...open.filter((item) => item.severity !== "overdue"),
  ].slice(0, cap);
}

/** The one verb on an item's action button. It opens the item's own page; it never acts by itself. */
export function myDayActionLabel(item: Pick<MyDayItem, "mode" | "title">): string {
  if (item.mode === "cme") return "Log";
  if (item.mode === "my-work" && /\b(course|module|training|life support|bls|als)\b/i.test(item.title)) return "Book";
  return "Open";
}

// ---------------------------------------------------------------- the day ribbon

export interface RibbonSegment {
  readonly key: string;
  /** 0 to 1 along the ribbon. */
  readonly from: number;
  readonly to: number;
  readonly tone: "shift" | "other";
}

export interface DayRibbon {
  readonly segments: readonly RibbonSegment[];
  /** Where "now" sits, 0 to 1; null when now is outside the ribbon. */
  readonly now: number | null;
  /** Up to four time labels, first and last at the ends. */
  readonly labels: readonly { readonly at: number; readonly text: string }[];
}

/**
 * Today's ribbon: from the earlier of now and the first thing today, to the
 * end of the last thing that starts today (an overnight shift runs past
 * midnight). Shifts are drawn pale, other timed things (teaching) warm.
 * Null when nothing timed starts today, or the span is over 36 hours.
 */
export function buildDayRibbon(
  events: readonly {
    readonly id: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly kind: "shift" | "other";
  }[],
  now: Date,
): DayRibbon | null {
  const today = perthDateOf(now);
  const valid = events.filter((event) => {
    const start = Date.parse(event.startsAt);
    const end = Date.parse(event.endsAt);
    return Number.isFinite(start) && Number.isFinite(end) && end > start && perthDateOf(event.startsAt) === today;
  });
  if (valid.length === 0) return null;
  const first = Math.min(...valid.map((event) => Date.parse(event.startsAt)));
  const last = Math.max(...valid.map((event) => Date.parse(event.endsAt)));
  // Start on the hour at or before the earlier of now and the first event.
  const at = now.getTime();
  const rawStart = Math.min(first, at);
  const start = rawStart - (rawStart % HOUR_MS);
  const end = Math.max(last, start + HOUR_MS);
  if (end - start > 36 * HOUR_MS) return null;
  const span = end - start;
  const pos = (ms: number) => Math.min(1, Math.max(0, (ms - start) / span));
  const segments = valid
    .map((event) => ({
      key: event.id,
      from: pos(Date.parse(event.startsAt)),
      to: pos(Date.parse(event.endsAt)),
      tone: event.kind,
    }))
    .sort((a, b) => a.from - b.from || a.key.localeCompare(b.key));
  const starts = [...new Set(valid.map((event) => Date.parse(event.startsAt)))]
    .filter((ms) => ms > start && ms < end)
    .sort((a, b) => a - b)
    .slice(0, 2);
  const labels = [start, ...starts, end].map((ms) => ({ at: pos(ms), text: perthTimeOf(new Date(ms)) }));
  return { segments, now: at >= start && at <= end ? pos(at) : null, labels };
}

// ---------------------------------------------------------------- the month

/** The Monday-first weeks of a month (`YYYY-MM`), padded with null. */
export function monthWeeks(month: string): readonly (readonly (string | null)[])[] {
  const first = `${month}-01`;
  const next = new Date(utc(first));
  next.setUTCMonth(next.getUTCMonth() + 1);
  const days = Math.round((next.getTime() - utc(first)) / DAY_MS);
  const cells: (string | null)[] = Array.from({ length: mondayIndex(first) }, () => null);
  for (let day = 0; day < days; day += 1) cells.push(addDaysToDate(first, day));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

/** `YYYY-MM` moved by `delta` months. */
export function addMonths(month: string, delta: number): string {
  const date = new Date(utc(`${month}-01`));
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}

const MONTH_NAMES = [
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

export function monthTitle(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** The kinds rostered on each Perth date (a shift belongs to the day it starts). */
export function kindsByDate(
  shifts: readonly { readonly startsAt: string; readonly kind: ShiftKind }[],
): ReadonlyMap<string, readonly ShiftKind[]> {
  const map = new Map<string, ShiftKind[]>();
  for (const shift of shifts) {
    const date = perthDateOf(shift.startsAt);
    const list = map.get(date) ?? [];
    if (!list.includes(shift.kind)) list.push(shift.kind);
    map.set(date, list);
  }
  return map;
}

// ---------------------------------------------------------------- hours

export interface HoursBars {
  readonly start: string;
  readonly end: string;
  readonly totalHours: number;
  readonly days: readonly { readonly date: string; readonly hours: number; readonly night: boolean }[];
  /** Mean hours on the days worked; null with none worked. */
  readonly averageWorkedDay: number | null;
}

/**
 * Hours per day for this week (Monday to Sunday) or the fortnight Roster
 * uses, from Roster's own `summariseHours`. Facts only, no limit or judgement.
 */
export function hoursBars(
  shifts: readonly HoursShift[],
  today: string,
  span: "week" | "fortnight",
  payFortnightAnchor: string | null = null,
): HoursBars {
  const window =
    span === "week"
      ? { start: addDaysToDate(today, -mondayIndex(today)), end: addDaysToDate(today, 6 - mondayIndex(today)) }
      : fortnightFor(today, payFortnightAnchor);
  const summary = summariseHours(shifts, [], window);
  const nightDates = new Set(
    shifts.filter((shift) => shift.kind === "night").map((shift) => perthDateOf(shift.startsAt)),
  );
  const worked = summary.days.filter((day) => day.hours > 0);
  return {
    start: summary.start,
    end: summary.end,
    totalHours: summary.totalHours,
    days: summary.days.map((day) => ({ date: day.date, hours: day.hours, night: nightDates.has(day.date) })),
    averageWorkedDay: worked.length ? Math.round((summary.totalHours / worked.length) * 10) / 10 : null,
  };
}

/** Four weeks of hours per day, Monday first, ending with this week. */
export function monthGlance(shifts: readonly HoursShift[], today: string): HoursBars {
  const end = addDaysToDate(today, 6 - mondayIndex(today));
  const start = addDaysToDate(end, -27);
  const summary = summariseHours(shifts, [], { start, end });
  const worked = summary.days.filter((day) => day.hours > 0);
  return {
    start,
    end,
    totalHours: summary.totalHours,
    days: summary.days.map((day) => ({ date: day.date, hours: day.hours, night: false })),
    averageWorkedDay: worked.length ? Math.round((summary.totalHours / worked.length) * 10) / 10 : null,
  };
}

/** Heat level for a day's hours: 0 none, 1 under 6, 2 under 10, 3 ten or more. */
export function heatLevel(hours: number): 0 | 1 | 2 | 3 {
  if (!(hours > 0)) return 0;
  if (hours < 6) return 1;
  if (hours < 10) return 2;
  return 3;
}

// ---------------------------------------------------------------- CPD

export type CpdByCategory = Readonly<Record<CmeCategory, number>>;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Hours per Medical Board CPD type, from the year's activities (archived ones left out). */
export function cpdHoursByCategory(entries: readonly CmeEntry[]): CpdByCategory {
  const totals: Record<CmeCategory, number> = { educational: 0, reviewing: 0, measuring: 0 };
  for (const entry of entries) {
    if (entry.archivedAt) continue;
    for (const allocation of entry.allocations) {
      if (cmeCategories.includes(allocation.category)) totals[allocation.category] += allocation.hours;
    }
  }
  return {
    educational: round1(totals.educational),
    reviewing: round1(totals.reviewing),
    measuring: round1(totals.measuring),
  };
}

/** Hours per month (index 0 = January) of `year`, from activity dates. */
export function cpdHoursByMonth(entries: readonly CmeEntry[], year: number): readonly number[] {
  const months = Array.from({ length: 12 }, () => 0);
  for (const entry of entries) {
    if (entry.archivedAt || entry.date.slice(0, 4) !== String(year)) continue;
    const month = Number(entry.date.slice(5, 7)) - 1;
    if (month < 0 || month > 11) continue;
    months[month] += entry.allocations.reduce((sum, allocation) => sum + allocation.hours, 0);
  }
  return months.map(round1);
}

/**
 * A straight-line projection to 31 December at the year's pace so far:
 * logged hours ÷ days elapsed × days in the year. Null before any hours.
 */
export function cpdProjectedHours(loggedHours: number, today: string): number | null {
  if (!(loggedHours > 0)) return null;
  const year = today.slice(0, 4);
  const elapsed = (utc(today) - utc(`${year}-01-01`)) / DAY_MS + 1;
  const total = (utc(`${Number(year) + 1}-01-01`) - utc(`${year}-01-01`)) / DAY_MS;
  return Math.round((loggedHours / elapsed) * total);
}

// ---------------------------------------------------------------- renewals

export interface RenewalRow {
  readonly entryId: string;
  readonly title: string;
  /** `YYYY-MM-DD`, the recorded date. */
  readonly date: string;
  readonly href: string;
}

export interface RunwayPoint extends RenewalRow {
  /** 0 (today or passed) to 1 (six months out). */
  readonly at: number;
  readonly passed: boolean;
}

export const RUNWAY_DAYS = 183;

/** The recorded dates from passed up to six months ahead, placed along the runway. */
export function renewalsRunway(rows: readonly RenewalRow[], today: string): readonly RunwayPoint[] {
  const horizon = addDaysToDate(today, RUNWAY_DAYS);
  return rows
    .filter((row) => row.date <= horizon)
    .map((row) => {
      const passed = row.date < today;
      const at = passed ? 0 : (utc(row.date) - utc(today)) / (RUNWAY_DAYS * DAY_MS);
      return { ...row, at: Math.min(1, Math.max(0, at)), passed };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

/**
 * Spread runway labels so neighbours do not overlap: each point keeps its
 * true dot position, and labels are nudged apart to at least `minGap`.
 */
export function spreadLabels(positions: readonly number[], minGap = 0.24): readonly number[] {
  if (positions.length === 0) return [];
  const gap = Math.min(minGap, 1 / Math.max(1, positions.length - 1));
  const out = [...positions];
  for (let index = 1; index < out.length; index += 1) out[index] = Math.max(out[index]!, out[index - 1]! + gap);
  const overflow = out[out.length - 1]! - 1;
  if (overflow > 0) for (let index = 0; index < out.length; index += 1) out[index] = out[index]! - overflow;
  for (let index = out.length - 2; index >= 0; index -= 1) out[index] = Math.min(out[index]!, out[index + 1]! - gap);
  return out.map((value) => Math.min(1, Math.max(0, value)));
}

/** Initials for a colleague's name ("Dr Demo A" → "DA"); titles are skipped. */
export function initialsOf(name: string): string {
  const words = name
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !/^(dr|prof|mr|mrs|ms|mx|a\/prof)\.?$/i.test(word));
  const letters = words.length > 1 ? [words[0]!, words[words.length - 1]!] : words;
  return letters
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "15 Sep" for a Perth date. */
export function shortDayMonth(date: string): string {
  return `${Number(date.slice(8, 10))} ${SHORT_MONTHS[Number(date.slice(5, 7)) - 1] ?? ""}`;
}

/**
 * The per-type CPD targets a requirement set states: a type's own minimum
 * ("hours in category") or the per-type floor of a combined requirement.
 * Null for a type the set gives no target.
 */
export function cpdCategoryTargets(
  requirements: readonly { readonly spec: { readonly shape: string } & Record<string, unknown> }[],
): Readonly<Record<CmeCategory, number | null>> {
  const targets: Record<CmeCategory, number | null> = { educational: null, reviewing: null, measuring: null };
  const raise = (category: CmeCategory, hours: unknown) => {
    if (typeof hours === "number" && hours > 0) targets[category] = Math.max(targets[category] ?? 0, hours);
  };
  for (const { spec } of requirements) {
    if (spec.shape === "hours-in-category" && typeof spec.category === "string") {
      if ((cmeCategories as readonly string[]).includes(spec.category))
        raise(spec.category as CmeCategory, spec.minimumHours);
    } else if (spec.shape === "hours-across-categories" && Array.isArray(spec.categories)) {
      for (const category of spec.categories) {
        if ((cmeCategories as readonly string[]).includes(category))
          raise(category as CmeCategory, spec.minimumEachHours);
      }
    }
  }
  return targets;
}
