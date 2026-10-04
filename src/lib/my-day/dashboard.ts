/**
 * My Day dashboard: the cards, their names, and the pure rules each card reads
 * (what is "up next", how a countdown is worded, which "Needs you" rows show).
 *
 * Nothing here fetches or stores. The card sources are the modes' own reads
 * (`src/components/my-day/use-my-day-items.ts` and
 * `use-my-day-dashboard-sources.ts`); the only thing kept on the device is
 * which cards the reader hid and which items they moved to tomorrow, through
 * `src/components/my-day/my-day-device-state.ts`.
 */

import { duePerthDate } from "@/lib/my-day/merge";
import type { MyDayItem } from "@/lib/my-day/model";
import { addDaysToDate, perthDateOf } from "@/lib/roster/shifts/perth-time";

/**
 * The three pages (tabs) of My Day and their cards, in phone stacking order
 * (design review v13, concept D). "Up next" is the hero: the shift ring, the
 * day ribbon and the next timed session. A stored id from an earlier layout
 * ("shift", "renewal") is simply ignored.
 */
export const myDayPageIds = ["today", "work", "me"] as const;
export type MyDayPageId = (typeof myDayPageIds)[number];

export const MY_DAY_PAGE_LABELS: Readonly<Record<MyDayPageId, string>> = {
  today: "Today",
  work: "Work",
  me: "Me",
};

export const MY_DAY_PAGE_CARDS = {
  today: ["up-next", "next-up", "flag", "quick-actions", "this-week", "needs-you", "cpd", "renewals"],
  work: ["calls", "pinned-numbers", "whos-on", "next-talk"],
  me: [
    "cpd-hours",
    "renew-next",
    "renewals-timeline",
    "hours",
    "month-glance",
    "credentials",
    "cpd-month",
    "quick-note",
  ],
} as const satisfies Readonly<Record<MyDayPageId, readonly string[]>>;

export const myDayCardIds = [...MY_DAY_PAGE_CARDS.today, ...MY_DAY_PAGE_CARDS.work, ...MY_DAY_PAGE_CARDS.me] as const;
export type MyDayCardId = (typeof myDayCardIds)[number];

export const MY_DAY_CARD_LABELS: Readonly<Record<MyDayCardId, string>> = {
  "up-next": "Up next",
  "next-up": "Next teaching",
  flag: "Most important now",
  "quick-actions": "Quick actions",
  "this-week": "This week",
  "needs-you": "Needs you",
  cpd: "CPD this year",
  renewals: "Renewals, next 6 months",
  calls: "Tonight's calls",
  "pinned-numbers": "Pinned numbers",
  "whos-on": "Who's on now",
  "next-talk": "Next talk",
  "cpd-hours": "CPD hours",
  "renew-next": "Renew next",
  "renewals-timeline": "Renewals timeline",
  hours: "Hours worked",
  "month-glance": "Month at a glance",
  credentials: "Credentials wallet",
  "cpd-month": "CPD by month",
  "quick-note": "Quick note",
};

/** Which page a card lives on, for the edit list. */
export function myDayPageOfCard(id: MyDayCardId): MyDayPageId {
  return myDayPageIds.find((page) => (MY_DAY_PAGE_CARDS[page] as readonly string[]).includes(id)) ?? "today";
}

/** `?page=` to a page id; anything else is Today. */
export function parseMyDayPage(value: string | null | undefined): MyDayPageId {
  return value === "work" || value === "me" ? value : "today";
}

/** How many "Needs you" rows the card shows before "All N". */
export const MY_DAY_NEEDS_YOU_CAP = 3;

function isCardId(value: unknown): value is MyDayCardId {
  return typeof value === "string" && (myDayCardIds as readonly string[]).includes(value);
}

/** The hidden cards from their stored form. Anything unreadable is "nothing hidden". */
export function parseHiddenCards(raw: string | null): ReadonlySet<MyDayCardId> {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    return new Set(Array.isArray(value) ? value.filter(isCardId) : []);
  } catch {
    return new Set();
  }
}

/** Stored in the cards' own order, so the same choice always writes the same text. */
export function serialiseHiddenCards(hidden: ReadonlySet<MyDayCardId>): string {
  return JSON.stringify(myDayCardIds.filter((id) => hidden.has(id)));
}

/**
 * Items moved to later: item id to the Perth date it comes back. Only the id
 * and a date are kept (ids are `<mode>:<kind>:<record id>`, never a title or a
 * patient detail), and the record lives on this device only.
 */
export type MyDaySnoozes = Readonly<Record<string, string>>;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Stored snoozes, dropping any already due back on or before `today`. */
export function parseSnoozes(raw: string | null, today: string): MyDaySnoozes {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const kept: Record<string, string> = {};
    for (const [id, until] of Object.entries(value as Record<string, unknown>)) {
      if (typeof until === "string" && DATE_ONLY.test(until) && until > today) kept[id] = until;
    }
    return kept;
  } catch {
    return {};
  }
}

export function isSnoozed(snoozes: MyDaySnoozes, id: string, today: string): boolean {
  const until = snoozes[id];
  return until !== undefined && until > today;
}

/** "Later" means tomorrow, in Perth. */
export function snoozeUntil(now: Date): string {
  return addDaysToDate(perthDateOf(now), 1);
}

/**
 * The "Needs you" card: the merged items (already overdue first) less anything
 * moved to later, capped. `total` is every item, which "All N" opens.
 */
export function selectNeedsYou(
  items: readonly MyDayItem[],
  snoozes: MyDaySnoozes,
  today: string,
  cap: number = MY_DAY_NEEDS_YOU_CAP,
): { readonly shown: readonly MyDayItem[]; readonly waiting: number; readonly total: number } {
  const waiting = items.filter((item) => !isSnoozed(snoozes, item.id, today));
  return { shown: waiting.slice(0, cap), waiting: waiting.length, total: items.length };
}

/** One timed thing today, from any source, as the "Up next" card and the agenda show it. */
export interface MyDayTimedEvent {
  readonly id: string;
  readonly source: "shift" | "teaching";
  readonly startsAt: string;
  readonly endsAt: string;
  readonly title: string;
  /** Where, and the reader's role, e.g. "You're presenting · Seminar room 3". */
  readonly where: string;
  readonly href: string;
  readonly actionLabel: string;
}

export type MyDayUpNext =
  | { readonly state: "upcoming"; readonly event: MyDayTimedEvent }
  | { readonly state: "on-now"; readonly event: MyDayTimedEvent };

/**
 * The next timed thing today: the earliest event starting later today. When
 * nothing else starts today, a teaching session that is on now. A shift that
 * is already running is the hero's ring to show, not this line's.
 */
export function selectUpNext(events: readonly MyDayTimedEvent[], now: Date): MyDayUpNext | null {
  const at = now.getTime();
  const today = perthDateOf(now);
  const valid = events.filter(
    (event) => Number.isFinite(Date.parse(event.startsAt)) && Number.isFinite(Date.parse(event.endsAt)),
  );
  const upcoming = valid
    .filter((event) => Date.parse(event.startsAt) > at && perthDateOf(event.startsAt) === today)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
  if (upcoming[0]) return { state: "upcoming", event: upcoming[0] };
  const onNow = valid
    .filter((event) => event.source === "teaching" && Date.parse(event.startsAt) <= at && Date.parse(event.endsAt) > at)
    .sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt) || a.id.localeCompare(b.id));
  return onNow[0] ? { state: "on-now", event: onNow[0] } : null;
}

const MINUTE_MS = 60_000;

function unit(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * A countdown in two forms: `short` for the eye ("1 h 20 min") and `spoken`
 * for a screen reader ("1 hour 20 minutes"). Rounded up to the minute, never
 * below one minute, so "in 0 min" is never shown.
 */
export function formatCountdown(ms: number): { readonly short: string; readonly spoken: string } {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE_MS));
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

/** The ring's centre figure: "4:20" under a day, "2 d" from a day up. */
export function formatRingFigure(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / MINUTE_MS));
  if (minutes >= 24 * 60) return `${Math.floor(minutes / (24 * 60))} d`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The seven Perth dates, Monday first, of the week holding `today`. */
export function weekOf(today: string): readonly string[] {
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addDaysToDate(today, -weekday);
  return Array.from({ length: 7 }, (_, index) => addDaysToDate(monday, index));
}

/** How many items fall due on each Perth date. Undated items count nowhere. */
export function dueCountsByDate(items: readonly MyDayItem[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const date = duePerthDate(item.due);
    if (date) counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  return counts;
}

/** Whole Perth days from `today` to `date` (negative when it has passed). */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / (24 * 60 * MINUTE_MS));
}
