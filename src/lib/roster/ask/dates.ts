import { addDaysToDate } from "@/lib/roster/shifts/perth-time";

export type DateSpan = { readonly from: string; readonly to: string };
export type DateReading =
  | { readonly dates: DateSpan[] }
  | { readonly ask: string; readonly options: DateSpan[] }
  | { readonly blocked: "past" | "weekday_mismatch" };

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};
const WEEKDAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

function iso(year: number, month: number, day: number): string | null {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null;
  return value.toISOString().slice(0, 10);
}

function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function nextWeekday(today: string, target: number, skipThisWeek = false): string {
  const delta = (target - weekday(today) + 7) % 7;
  return addDaysToDate(today, delta + (skipThisWeek ? 7 : 0));
}

function resolveDay(day: number, month: number, year: number | undefined, today: string): string | null {
  if (year !== undefined) return iso(year, month, day);
  const thisYear = Number(today.slice(0, 4));
  const first = iso(thisYear, month, day);
  return first && first >= today ? first : iso(thisYear + 1, month, day);
}

/** Reads calendar expressions as Perth date keys; no local Date getters are used. */
export function readDates(text: string, today: string): DateReading {
  const lower = text.toLowerCase();
  if (/\btomorrow\b/.test(lower)) {
    const date = addDaysToDate(today, 1);
    return { dates: [{ from: date, to: date }] };
  }
  if (/\btoday\b/.test(lower)) return { dates: [{ from: today, to: today }] };

  const monthNames = Object.keys(MONTHS).join("|");
  const monthRange = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*[-–]\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})(?:\\s+(\\d{4}))?\\b`,
    "i",
  ).exec(text);
  const named = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})(?:\\s+(\\d{4}))?\\b`, "i").exec(text);
  const numeric = /\b(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{4}))?\b/.exec(text);
  const isoMatch = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  let from: string | null = null;
  let to: string | null = null;
  if (monthRange) {
    const month = MONTHS[monthRange[3]!.toLowerCase()]!;
    const year = monthRange[4] ? Number(monthRange[4]) : undefined;
    from = resolveDay(Number(monthRange[1]), month, year, today);
    to = from ? iso(Number(from.slice(0, 4)), month, Number(monthRange[2])) : null;
  } else if (named) {
    from = resolveDay(
      Number(named[1]),
      MONTHS[named[2]!.toLowerCase()]!,
      named[3] ? Number(named[3]) : undefined,
      today,
    );
    to = from;
  } else if (numeric) {
    from = resolveDay(Number(numeric[1]), Number(numeric[2]), numeric[3] ? Number(numeric[3]) : undefined, today);
    to = from;
  } else if (isoMatch) {
    from = iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    to = from;
  }
  if (!from) {
    const weekdayDay =
      /\b(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(
        text,
      );
    if (weekdayDay) {
      const currentMonth = Number(today.slice(5, 7));
      from = iso(Number(today.slice(0, 4)), currentMonth, Number(weekdayDay[2]));
      if (from && from < today) return { ask: "Which month did you mean?", options: [] };
      to = from;
    }
  }
  if (from !== null) {
    if (!to || from < today) return { blocked: "past" };
    // "28-3 Nov" reads as 28 Nov to 3 Nov. Both may be ahead, so ask rather than say it has passed.
    if (to < from) return { ask: "Which dates do you mean?", options: [] };
    const dayWord =
      /\b(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/i.exec(
        text,
      );
    if (dayWord && weekday(from) !== WEEKDAYS[dayWord[1]!.toLowerCase()]) return { blocked: "weekday_mismatch" };
    return { dates: [{ from, to }] };
  }
  const relative =
    /\b(?:(this|next)\s+)?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/i.exec(
      text,
    );
  if (relative) {
    const first = nextWeekday(today, WEEKDAYS[relative[2]!.toLowerCase()]!);
    const firstSpan = { from: first, to: first };
    if (relative[1]?.toLowerCase() === "next") {
      const second = addDaysToDate(first, 7);
      return { ask: "Which date did you mean?", options: [firstSpan, { from: second, to: second }] };
    }
    return { dates: [firstSpan] };
  }
  return { dates: [] };
}
