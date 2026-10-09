/**
 * My Day mock-up v2 (5 October 2026): the words and figures the quiet cards
 * show, worked out once here so they can be tested. Perth time is UTC+8 with
 * no daylight saving, so dates are plain `YYYY-MM-DD` arithmetic.
 */

import { duePerthDate } from "@/lib/my-day/merge";
import type { MyDayItem, MyDaySourceMode } from "@/lib/my-day/model";
import type { MyDayNeedsYouItem, MyDayNeedsYouMode } from "@/lib/my-day/needs-you-feed";
import { SHIFT_KIND_LABEL, type ShiftKind } from "@/lib/roster/shift-kind";
import { addDaysToDate, formatPerthDay, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";

const DAY_MS = 86_400_000;

const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export const MY_DAY_AREA_NAME: Readonly<Record<MyDaySourceMode, string>> = {
  cme: "CPD",
  "my-work": "Admin",
  "on-call": "On Call",
  teaching: "Teaching",
  roster: "Roster",
};

/** The area words on a Needs you row, which also lists the reader's own reminders. */
const NEEDS_YOU_AREA_NAME: Readonly<Record<MyDayNeedsYouMode, string>> = { ...MY_DAY_AREA_NAME, "my-day": "Reminders" };

function utc(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

/** Whole Perth days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/** "Sun" for a Perth date or an instant. */
export function perthWeekday(dateOrInstant: string | Date): string {
  const date =
    typeof dateOrInstant === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateOrInstant)
      ? dateOrInstant
      : perthDateOf(dateOrInstant);
  return SHORT_WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? "";
}

/** "NOV" style month word for a date block. */
export function shortMonth(date: string): string {
  return SHORT_MONTHS[Number(date.slice(5, 7)) - 1] ?? "";
}

/** "Sat 14 Nov 2026". */
export function fullDate(date: string): string {
  return `${formatPerthDay(date)} ${date.slice(0, 4)}`;
}

/** "today", "tomorrow", "in 41 days", "yesterday", "19 days ago". */
export function relativeDays(date: string, today: string): string {
  const days = daysBetween(today, date);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** "Sun 21:00": the weekday and time of an instant. */
export function weekdayTime(instant: string): string {
  return `${perthWeekday(instant)} ${perthTimeOf(instant)}`;
}

/** "On call" or "Day shift". */
export function shiftTitle(kind: ShiftKind): string {
  return kind === "on_call" ? "On call" : `${SHIFT_KIND_LABEL[kind]} shift`;
}

/** The plural for grouped rows: "Day shifts", "On call shifts". */
function shiftTitlePlural(kind: ShiftKind): string {
  return kind === "on_call" ? "On call shifts" : `${SHIFT_KIND_LABEL[kind]} shifts`;
}

/** "Tue, Wed and Thu". */
export function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

// ---------------------------------------------------------------- the blue card

export interface HeroShift {
  readonly kind: ShiftKind;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly place: string | null;
}

export interface HeroTrackTick {
  /** 0 to 100 along the line. */
  readonly at: number;
  readonly label: string;
}

export interface HeroTrack {
  /** The shift's part of the line, 0 to 100. */
  readonly fillFrom: number;
  readonly fillTo: number;
  /** Where now sits, 0 to 100. */
  readonly now: number;
  readonly ticks: readonly HeroTrackTick[];
}

export interface HeroWords {
  /** "On call tonight", "On call now", "Day shift · Tue 6 Oct". */
  readonly eyebrow: string;
  /** "Starts in 2 h 10 min", "4 h 50 min left". */
  readonly big: string;
  /** "Sun 21:00 to Mon 08:00 · Example Hospital". */
  readonly sub: string;
  /** For a screen reader, in one sentence. */
  readonly spoken: string;
}

const MINUTE_MS = 60_000;

/** "2 h 10 min", "45 min", "1 d 3 h". Never below one minute. */
export function durationWords(ms: number): { readonly short: string; readonly spoken: string } {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE_MS));
  const unit = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;
  const days = Math.floor(minutes / (24 * 60));
  if (days >= 1) {
    const hours = Math.floor((minutes % (24 * 60)) / 60);
    return {
      short: hours ? `${days} d ${hours} h` : `${days} d`,
      spoken: hours ? `${unit(days, "day", "days")} ${unit(hours, "hour", "hours")}` : unit(days, "day", "days"),
    };
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return { short: `${rest} min`, spoken: unit(rest, "minute", "minutes") };
  return {
    short: rest ? `${hours} h ${rest} min` : `${hours} h`,
    spoken: rest ? `${unit(hours, "hour", "hours")} ${unit(rest, "minute", "minutes")}` : unit(hours, "hour", "hours"),
  };
}

/** The time of an instant, with its weekday when it is not on `onDate`. */
function timeOn(instant: string, onDate: string): string {
  return perthDateOf(instant) === onDate ? perthTimeOf(instant) : weekdayTime(instant);
}

/** The Perth day a shift's end belongs to: one ending exactly at midnight ends the day before, as in summariseToday. */
function endDateOf(endsAt: string): string {
  return perthDateOf(new Date(Date.parse(endsAt) - 1).toISOString());
}

/** The end time of a shift, with its weekday when it ends on another day than `onDate`. */
function endOn(endsAt: string, onDate: string): string {
  return endDateOf(endsAt) === onDate ? perthTimeOf(endsAt) : weekdayTime(endsAt);
}

/** The words for a shift that is on now or still to start. */
export function heroWords(shift: HeroShift, running: boolean, now: Date): HeroWords {
  const name = shiftTitle(shift.kind);
  const today = perthDateOf(now);
  const placeText = shift.place ? ` · ${shift.place}` : "";
  if (running) {
    const left = durationWords(Date.parse(shift.endsAt) - now.getTime());
    const until = endOn(shift.endsAt, today);
    const handover = shift.kind === "on_call" ? " handover" : "";
    return {
      eyebrow: `${name} now`,
      big: `${left.short} left`,
      sub: `Until ${until}${handover} · started ${timeOn(shift.startsAt, today)}`,
      spoken: `${name} now, ${left.spoken} left, until ${until}.`,
    };
  }
  const starts = durationWords(Date.parse(shift.startsAt) - now.getTime());
  const startDate = perthDateOf(shift.startsAt);
  let when: string;
  if (startDate === today) when = Number(perthTimeOf(shift.startsAt).slice(0, 2)) >= 17 ? "tonight" : "today";
  else if (startDate === addDaysToDate(today, 1)) when = "tomorrow";
  else when = `· ${formatPerthDay(startDate)}`;
  const range = `${weekdayTime(shift.startsAt)} to ${endOn(shift.endsAt, startDate)}`;
  return {
    eyebrow: `${name} ${when}`,
    big: `Starts in ${starts.short}`,
    sub: `${range}${placeText}`,
    spoken: `${name} ${when.replace("· ", "on ")}, starts in ${starts.spoken}, ${range}${shift.place ? `, ${shift.place}` : ""}.`,
  };
}

/**
 * The line under the blue card's words, drawn to scale. Before a shift it runs
 * from the start of the current hour to the shift's end, with the shift filled
 * in; during a shift it runs from start to end, filled up to now. Labels that
 * would sit on top of each other are dropped, keeping the ends.
 */
export function heroTrack(shift: HeroShift, running: boolean, now: Date): HeroTrack {
  const start = Date.parse(shift.startsAt);
  const end = Date.parse(shift.endsAt);
  const at = now.getTime();
  const today = perthDateOf(now);
  const from = running ? start : Math.min(start, at - (at % (60 * MINUTE_MS)));
  const span = Math.max(1, end - from);
  const place = (instant: number) => Math.min(100, Math.max(0, ((instant - from) / span) * 100));
  const label = (instant: number) => timeOn(new Date(instant).toISOString(), today);
  const nowAt = place(at);
  const ticks: HeroTrackTick[] = running
    ? [
        { at: 0, label: timeOn(shift.startsAt, today) },
        { at: nowAt, label: perthTimeOf(now) },
        { at: 100, label: timeOn(shift.endsAt, today) },
      ]
    : [
        { at: 0, label: label(from) },
        { at: place(start), label: perthTimeOf(shift.startsAt) },
        { at: 100, label: timeOn(shift.endsAt, today) },
      ];
  const [first, middle, last] = ticks as [HeroTrackTick, HeroTrackTick, HeroTrackTick];
  // The middle label is dropped when it would sit on top of an end label.
  const kept = middle.at - first.at >= 16 && last.at - middle.at >= 16 ? [first, middle, last] : [first, last];
  return {
    fillFrom: running ? 0 : place(start),
    fillTo: running ? nowAt : 100,
    now: nowAt,
    ticks: kept,
  };
}

// ---------------------------------------------------------------- items

export interface ItemLine {
  /** The amber part, when the date has passed ("Overdue 14 days"). */
  readonly late: string | null;
  /** The rest of the line ("was due Fri 2 Oct · Teaching", "Due 14 Nov · in 41 days · Admin"). */
  readonly rest: string;
}

/**
 * The line under a Needs you row. A passed date says how long ago, in amber;
 * an Admin date says "Date passed" rather than "Overdue" (Admin records dates,
 * it does not judge them).
 */
export function itemLine(item: MyDayNeedsYouItem, today: string): ItemLine {
  const area = NEEDS_YOU_AREA_NAME[item.mode];
  const date = duePerthDate(item.due);
  const detail = item.detail ? `${item.detail} · ` : "";
  if (item.severity === "overdue" && date) {
    const days = Math.max(0, daysBetween(date, today));
    const word = item.mode === "my-work" ? "Date passed" : "Overdue";
    return {
      late: days === 0 ? `${word} today` : `${word} ${days} ${days === 1 ? "day" : "days"}`,
      rest: `was due ${formatPerthDay(date)} · ${area}`,
    };
  }
  if (item.severity === "overdue") return { late: item.mode === "my-work" ? "Date passed" : "Overdue", rest: area };
  if (date) {
    const timed = typeof item.due === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(item.due) && date === today;
    const when = timed
      ? `Due ${perthTimeOf(item.due!)} today`
      : `Due ${shortDayLabel(date)} · ${relativeDays(date, today)}`;
    return { late: null, rest: `${detail}${when} · ${area}` };
  }
  return { late: null, rest: `${detail}${area}` };
}

/** "14 Nov". */
function shortDayLabel(date: string): string {
  return `${Number(date.slice(8, 10))} ${shortMonth(date)}`;
}

/** The reminder note's line: "CPD · 19 days ago · 1 of 3 reminders". */
export function reminderLine(item: MyDayItem, today: string, position: number, count: number): string {
  const date = duePerthDate(item.due);
  const parts = [MY_DAY_AREA_NAME[item.mode]];
  if (date) parts.push(date < today ? relativeDays(date, today) : `due ${relativeDays(date, today)}`);
  if (count > 1) parts.push(`${position} of ${count} reminders`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------- this week

export interface WeekShiftInput {
  readonly id: string;
  readonly kind: ShiftKind;
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface WeekSessionInput {
  readonly id: string;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly venue: string | null;
  readonly isPresenter: boolean;
  readonly allDay?: boolean;
  readonly href: string;
}

export interface WeekRow {
  readonly key: string;
  readonly mode: Extract<MyDaySourceMode, "roster" | "teaching">;
  readonly kind: ShiftKind | "teaching";
  readonly title: string;
  readonly subtitle: string;
  readonly at: number;
  readonly href: string;
}

/** "Tonight", "Today", "Tomorrow", "Tue". */
function dayWord(instant: string, today: string): string {
  const date = perthDateOf(instant);
  if (date === today) return Number(perthTimeOf(instant).slice(0, 2)) >= 17 ? "Tonight" : "Today";
  if (date === addDaysToDate(today, 1)) return "Tomorrow";
  return perthWeekday(date);
}

/**
 * The few lines under the week strip: what is still ahead in the seven days
 * from today. Shifts of the same kind and hours fold into one line ("Day
 * shifts · Tue, Wed and Thu · 08:00 to 17:00"); teaching sessions are their
 * own lines. Soonest first, at most `cap`.
 */
export function weekRows(
  shifts: readonly WeekShiftInput[],
  sessions: readonly WeekSessionInput[],
  today: string,
  now: Date,
  cap = 3,
): readonly WeekRow[] {
  const last = addDaysToDate(today, 6);
  const at = now.getTime();
  const inWeek = (instant: string) => {
    const date = perthDateOf(instant);
    return date >= today && date <= last;
  };
  const rows: WeekRow[] = [];
  const groups = new Map<string, WeekShiftInput[]>();
  for (const shift of [...shifts].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))) {
    if (shift.kind === "leave" || Date.parse(shift.endsAt) <= at) continue;
    if (!inWeek(shift.startsAt) && !(Date.parse(shift.startsAt) <= at)) continue;
    const key = `${shift.kind}|${perthTimeOf(shift.startsAt)}|${perthTimeOf(shift.endsAt)}`;
    groups.set(key, [...(groups.get(key) ?? []), shift]);
  }
  for (const [key, group] of groups) {
    const first = group[0]!;
    const running = Date.parse(first.startsAt) <= at;
    // A shift on now, or one overnight, reads alone; same-hours day shifts fold together.
    const overnight = endDateOf(first.endsAt) !== perthDateOf(first.startsAt);
    if (group.length === 1 || running || overnight) {
      for (const shift of group) {
        const isRunning = Date.parse(shift.startsAt) <= at;
        // A running shift that ends today needs no weekday; one that ends on a later day does.
        const sameDay = isRunning
          ? endDateOf(shift.endsAt) === today
          : endDateOf(shift.endsAt) === perthDateOf(shift.startsAt);
        const end = sameDay ? perthTimeOf(shift.endsAt) : weekdayTime(shift.endsAt);
        rows.push({
          key: `shift:${shift.id}`,
          mode: "roster",
          kind: shift.kind,
          title: shiftTitle(shift.kind),
          subtitle: isRunning
            ? `Now, until ${end} · Roster`
            : `${dayWord(shift.startsAt, today)} ${perthTimeOf(shift.startsAt)} to ${end} · Roster`,
          at: Date.parse(shift.startsAt),
          href: "/roster",
        });
      }
      continue;
    }
    const days = group.map((shift, index) => {
      const word = dayWord(shift.startsAt, today);
      return index > 0 && /^To/.test(word) ? word.toLowerCase() : word;
    });
    rows.push({
      key: `shifts:${key}`,
      mode: "roster",
      kind: first.kind,
      title: shiftTitlePlural(first.kind),
      subtitle: `${listWords(days)} · ${perthTimeOf(first.startsAt)} to ${perthTimeOf(first.endsAt)} · Roster`,
      at: Date.parse(first.startsAt),
      href: "/roster",
    });
  }
  for (const session of sessions) {
    if (Date.parse(session.endsAt) <= at || !inWeek(session.startsAt)) continue;
    const time = session.allDay ? "" : ` ${perthTimeOf(session.startsAt)}`;
    rows.push({
      key: `teaching:${session.id}`,
      mode: "teaching",
      kind: "teaching",
      title: session.title,
      subtitle: [
        `${dayWord(session.startsAt, today)}${time}`,
        session.venue,
        session.isPresenter ? "you lead" : null,
        "Teaching",
      ]
        .filter(Boolean)
        .join(" · "),
      at: Date.parse(session.startsAt),
      href: session.href,
    });
  }
  return rows.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key)).slice(0, cap);
}

/** The roster codes under the strip's dates, and the words for the key. */
export const SHIFT_CODE: Readonly<Record<ShiftKind, string>> = {
  day: "D",
  evening: "E",
  night: "N",
  on_call: "OC",
  leave: "L",
  other: "W",
};

const CODE_WORDS: Readonly<Record<ShiftKind, string>> = {
  day: "day shift",
  evening: "evening shift",
  night: "night shift",
  on_call: "on call",
  leave: "leave",
  other: "other work",
};

/** The day's one code: on call first, then night, then any worked shift, then leave. */
export function dayCode(kinds: readonly ShiftKind[]): ShiftKind | null {
  if (kinds.includes("on_call")) return "on_call";
  if (kinds.includes("night")) return "night";
  const worked = kinds.find((kind) => kind !== "leave");
  if (worked) return worked;
  return kinds.includes("leave") ? "leave" : null;
}

/** "D day shift · OC on call", for the codes that appear this week only. */
export function codeKey(kinds: readonly (ShiftKind | null)[]): string {
  const order: readonly ShiftKind[] = ["day", "evening", "night", "on_call", "other", "leave"];
  const present = new Set(kinds.filter((kind): kind is ShiftKind => kind !== null));
  return order
    .filter((kind) => present.has(kind))
    .map((kind) => `${SHIFT_CODE[kind]} ${CODE_WORDS[kind]}`)
    .join(" · ");
}
