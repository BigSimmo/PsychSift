import { compactDate, compactUtc, escapeIcsText, foldIcsLine } from "@/lib/calendar/ics";
import { pinnedEmergencyEntries, type HandbookItem } from "@/lib/on-call/handbook-items";
import { addDaysToDate, perthCalendarDate } from "@/lib/roster/shifts/perth-time";

/**
 * "Your first week" (round 2 feature 20, rotation-start pack): one pack built
 * from what the hospital already publishes in its handbook (orientation items,
 * roles, escalation ladders) and the doctor's own New job logins, moved to the
 * top of On Call from a week before the job starts.
 *
 * Pure: no React, no storage, no network. The department writes nothing new
 * here; the hospital side (writing and scheduling a pack) needs server roles
 * and is deferred. Nothing in this module is clinical advice.
 */

export const FIRST_WEEK_HREF = "/on-call/first-week";

/** How many days before the start date the pack is highlighted, and how long it stays after. */
export const FIRST_WEEK_LEAD_DAYS = 7;
export const FIRST_WEEK_LENGTH_DAYS = 7;

/** The pack's five sections, in the mockup's reading order. */
export const FIRST_WEEK_SECTION_IDS = ["who", "expect", "escalate", "logins", "first-day"] as const;
export type FirstWeekSectionId = (typeof FIRST_WEEK_SECTION_IDS)[number];

export const FIRST_WEEK_SECTION_TITLES: Readonly<Record<FirstWeekSectionId, string>> = {
  who: "Who is who",
  expect: "What we expect",
  escalate: "How to escalate",
  logins: "Logins",
  "first-day": "Your first day",
};

/** The short name on the "Next" button. */
export const FIRST_WEEK_SECTION_SHORT: Readonly<Record<FirstWeekSectionId, string>> = {
  who: "Who is who",
  expect: "Expect",
  escalate: "Escalate",
  logins: "Logins",
  "first-day": "First day",
};

export function isFirstWeekSectionId(value: unknown): value is FirstWeekSectionId {
  return typeof value === "string" && (FIRST_WEEK_SECTION_IDS as readonly string[]).includes(value);
}

export function firstWeekSectionHref(id: FirstWeekSectionId): string {
  return `${FIRST_WEEK_HREF}?section=${id}`;
}

export function nextFirstWeekSection(id: FirstWeekSectionId): FirstWeekSectionId | null {
  const index = FIRST_WEEK_SECTION_IDS.indexOf(id);
  return FIRST_WEEK_SECTION_IDS[index + 1] ?? null;
}

// ------------------------------------------------------------------ phase

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function dayNumber(date: string): number | null {
  if (!DATE_KEY.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== date) return null;
  return Math.round(ms / DAY_MS);
}

export type FirstWeekPhase =
  | { readonly kind: "no-date" }
  /** More than a week away: the pack is there to read, not yet highlighted. */
  | { readonly kind: "ahead"; readonly startsOn: string; readonly daysAway: number; readonly highlightFrom: string }
  /** One to seven days away. */
  | { readonly kind: "soon"; readonly startsOn: string; readonly daysAway: number }
  | { readonly kind: "today"; readonly startsOn: string }
  /** Days two to seven of the job. */
  | { readonly kind: "first-week"; readonly startsOn: string; readonly day: number }
  | { readonly kind: "past"; readonly startsOn: string; readonly daysSince: number };

/** Where today's Perth date sits against the start date. A date that is not a real day reads as no date. */
export function firstWeekPhase(startsOn: string | null, now: Date): FirstWeekPhase {
  if (!startsOn) return { kind: "no-date" };
  const start = dayNumber(startsOn);
  const today = dayNumber(perthCalendarDate(now));
  if (start === null || today === null) return { kind: "no-date" };
  const daysAway = start - today;
  if (daysAway > FIRST_WEEK_LEAD_DAYS)
    return { kind: "ahead", startsOn, daysAway, highlightFrom: addDaysToDate(startsOn, -FIRST_WEEK_LEAD_DAYS) };
  if (daysAway > 0) return { kind: "soon", startsOn, daysAway };
  if (daysAway === 0) return { kind: "today", startsOn };
  const day = 1 - daysAway;
  if (day <= FIRST_WEEK_LENGTH_DAYS) return { kind: "first-week", startsOn, day };
  return { kind: "past", startsOn, daysSince: -daysAway };
}

/** From a week before the start until the end of the first week. */
export function isFirstWeekHighlighted(phase: FirstWeekPhase): boolean {
  return phase.kind === "soon" || phase.kind === "today" || phase.kind === "first-week";
}

/** The pack's eyebrow line: "Starts in 7 days", "Starts tomorrow", "Day 3 of your first week". */
export function firstWeekEyebrow(phase: FirstWeekPhase): string {
  switch (phase.kind) {
    case "no-date":
      return "No start date yet";
    case "ahead":
      return phase.daysAway >= 21
        ? `Starts in ${Math.round(phase.daysAway / 7)} weeks`
        : `Starts in ${phase.daysAway} days`;
    case "soon":
      return phase.daysAway === 1 ? "Starts tomorrow" : `Starts in ${phase.daysAway} days`;
    case "today":
      return "Starts today";
    case "first-week":
      return `Day ${phase.day} of your first week`;
    case "past":
      return "Your first week has passed";
  }
}

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

/** The start-date tile: "NOV", "2", "MON". Null for a date that is not a real day. */
export function firstWeekDateTile(
  startsOn: string,
): { readonly month: string; readonly day: string; readonly weekday: string } | null {
  const day = dayNumber(startsOn);
  if (day === null) return null;
  const date = new Date(day * DAY_MS);
  return {
    month: MONTHS[date.getUTCMonth()],
    day: String(date.getUTCDate()),
    weekday: WEEKDAYS[date.getUTCDay()],
  };
}

/** "Mon 2 Nov 2026" for a start date. */
export function formatFirstWeekDate(date: string): string {
  const day = dayNumber(date);
  if (day === null) return date;
  const value = new Date(day * DAY_MS);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][value.getUTCDay()];
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    value.getUTCMonth()
  ];
  return `${weekday} ${value.getUTCDate()} ${month} ${value.getUTCFullYear()}`;
}

// ------------------------------------------------------------------ sections

/** One New job login, status only: the doctor's own tick, or nothing for a shared guide row. */
export type FirstWeekLogin = {
  readonly id: string;
  readonly title: string;
  /** The doctor's own saved tick; null for a shared row nobody can tick. */
  readonly ready: boolean | null;
  readonly source: "you" | "shared";
};

export type FirstWeekLoginsState = "ready" | "loading" | "failed" | "signed-out";

export type FirstWeekSection = {
  readonly id: FirstWeekSectionId;
  readonly title: string;
  /** One short line under the title. */
  readonly summary: string;
  /** How many things the section holds. Zero means it is not written yet. */
  readonly count: number;
  /** The newest published time among the section's handbook items, for "Changed since you read it". */
  readonly updatedAt: string | null;
};

function isEmergency(item: HandbookItem): boolean {
  return item.parsed.prefix === "Emergency";
}

/**
 * The handbook items each section draws, in the handbook's own order.
 * "What we expect" is the hospital's first-week and ongoing orientation; "Your
 * first day" is what to do before you start and on the first shift. Items for
 * leaving a job never appear here.
 */
export function firstWeekItems(
  items: readonly HandbookItem[],
  id: Exclude<FirstWeekSectionId, "logins">,
  siteId: string | null,
): HandbookItem[] {
  switch (id) {
    case "first-day":
      return items.filter(
        (item) =>
          item.section === "orientation" &&
          (item.orientationPhase === "before_start" || item.orientationPhase === "first_shift"),
      );
    case "expect":
      return items.filter(
        (item) =>
          item.section === "orientation" &&
          (item.orientationPhase === "first_week" || item.orientationPhase === "ongoing"),
      );
    case "who":
      return items.filter((item) => (item.section === "contacts" && !isEmergency(item)) || item.section === "cover");
    case "escalate": {
      const emergency = pinnedEmergencyEntries(items, siteId);
      const ladders = items.filter((item) => item.section === "playbook" && (item.steps?.length ?? 0) > 0);
      return [...emergency, ...ladders];
    }
  }
}

function newest(items: readonly HandbookItem[]): string | null {
  let latest: string | null = null;
  for (const item of items) {
    if (item.updatedAt && Number.isFinite(Date.parse(item.updatedAt))) {
      if (latest === null || Date.parse(item.updatedAt) > Date.parse(latest)) latest = item.updatedAt;
    }
  }
  return latest;
}

function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function firstWeekLoginCounts(logins: readonly FirstWeekLogin[]): {
  readonly ready: number;
  readonly own: number;
} {
  const own = logins.filter((login) => login.source === "you");
  return { ready: own.filter((login) => login.ready === true).length, own: own.length };
}

function loginsSummary(logins: readonly FirstWeekLogin[], state: FirstWeekLoginsState): string {
  if (state === "loading") return "Loading your New job list";
  if (state === "failed") return "Could not load your New job list";
  if (state === "signed-out") return "Sign in to see your New job list";
  if (logins.length === 0) return "None listed in New job yet";
  const { ready, own } = firstWeekLoginCounts(logins);
  if (own === 0) return plural(logins.length, "item") + " from your service";
  return `${ready} of ${own} ready`;
}

/** The pack's five sections, each with its count and newest update. */
export function buildFirstWeekSections(input: {
  readonly items: readonly HandbookItem[];
  readonly siteId: string | null;
  readonly logins: readonly FirstWeekLogin[];
  readonly loginsState: FirstWeekLoginsState;
  /** The doctor's start date, named on "Your first day" ("Mon 2 Nov · 3 items"). */
  readonly startsOn?: string | null;
}): FirstWeekSection[] {
  const { items, siteId, logins, loginsState, startsOn = null } = input;
  return FIRST_WEEK_SECTION_IDS.map((id): FirstWeekSection => {
    if (id === "logins") {
      return {
        id,
        title: FIRST_WEEK_SECTION_TITLES[id],
        summary: loginsSummary(logins, loginsState),
        count: loginsState === "ready" ? logins.length : 0,
        updatedAt: null,
      };
    }
    const rows = firstWeekItems(items, id, siteId);
    const count = rows.length;
    let summary: string;
    if (count === 0) summary = "Not written by your hospital yet";
    else if (id === "who") summary = plural(count, "role");
    else if (id === "escalate") {
      const ladders = rows.filter((item) => item.section === "playbook").length;
      const emergency = count - ladders;
      summary = [ladders ? plural(ladders, "ladder") : null, emergency ? plural(emergency, "emergency line") : null]
        .filter(Boolean)
        .join(", ");
    } else if (id === "first-day" && startsOn && dayNumber(startsOn) !== null) {
      summary = `${formatFirstWeekDate(startsOn).replace(/ \d{4}$/, "")} · ${plural(count, "item")}`;
    } else summary = plural(count, "item");
    return { id, title: FIRST_WEEK_SECTION_TITLES[id], summary, count, updatedAt: newest(rows) };
  });
}

// ------------------------------------------------------------------ read marks

/**
 * What this device remembers: per hospital, when each section was marked read.
 * Section ids and ISO times only, never a title, a name or a number.
 */
export type FirstWeekReadState = {
  readonly version: 1;
  readonly hospitals: Readonly<Record<string, Readonly<Partial<Record<FirstWeekSectionId, string>>>>>;
  /**
   * "Tell me when it lands", off. Absent means on: one Needs you item the day
   * the pack is highlighted. A yes or no, nothing else.
   */
  readonly landAlertOff?: true;
};

/** At most this many hospitals are remembered; the oldest marks go first. */
export const FIRST_WEEK_MAX_HOSPITALS = 8;

export const EMPTY_FIRST_WEEK_READ: FirstWeekReadState = { version: 1, hospitals: {} };

const HOSPITAL_KEY = /^[A-Za-z0-9:_-]{1,120}$/;

function isTime(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

export function isValidFirstWeekRead(state: unknown): state is FirstWeekReadState {
  if (!state || typeof state !== "object") return false;
  const { version, hospitals, landAlertOff, ...rest } = state as Record<string, unknown>;
  if (version !== 1 || !hospitals || typeof hospitals !== "object" || Array.isArray(hospitals)) return false;
  if (Object.keys(rest).length > 0 || (landAlertOff !== undefined && landAlertOff !== true)) return false;
  const entries = Object.entries(hospitals as Record<string, unknown>);
  if (entries.length > FIRST_WEEK_MAX_HOSPITALS) return false;
  return entries.every(
    ([key, marks]) =>
      HOSPITAL_KEY.test(key) &&
      Boolean(marks) &&
      typeof marks === "object" &&
      !Array.isArray(marks) &&
      Object.entries(marks as Record<string, unknown>).every(([id, at]) => isFirstWeekSectionId(id) && isTime(at)),
  );
}

/**
 * Drops marks for sections the pack no longer has (an earlier layout of the
 * pack), keeping the rest. Anything else not in the expected shape (another
 * writer, a hand edit) reads as nothing read.
 */
function withoutRetiredSections(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  const { hospitals } = parsed as Record<string, unknown>;
  if (!hospitals || typeof hospitals !== "object" || Array.isArray(hospitals)) return parsed;
  const kept: Record<string, unknown> = {};
  for (const [key, marks] of Object.entries(hospitals as Record<string, unknown>)) {
    if (!marks || typeof marks !== "object" || Array.isArray(marks)) {
      kept[key] = marks;
      continue;
    }
    const current = Object.fromEntries(
      Object.entries(marks as Record<string, unknown>).filter(([id]) => isFirstWeekSectionId(id)),
    );
    if (Object.keys(current).length > 0) kept[key] = current;
  }
  return { ...(parsed as Record<string, unknown>), hospitals: kept };
}

export function parseFirstWeekRead(raw: string | null): FirstWeekReadState {
  if (!raw) return EMPTY_FIRST_WEEK_READ;
  try {
    const parsed = withoutRetiredSections(JSON.parse(raw) as unknown);
    return isValidFirstWeekRead(parsed) ? parsed : EMPTY_FIRST_WEEK_READ;
  } catch {
    return EMPTY_FIRST_WEEK_READ;
  }
}

/** Whether "Tell me when it lands" is on (the default). */
export function firstWeekLandAlertOn(state: FirstWeekReadState): boolean {
  return state.landAlertOff !== true;
}

/** Turn "Tell me when it lands" on or off, keeping every mark. */
export function setFirstWeekLandAlert(state: FirstWeekReadState, on: boolean): FirstWeekReadState {
  return on
    ? { version: 1, hospitals: state.hospitals }
    : { version: 1, hospitals: state.hospitals, landAlertOff: true };
}

function newestMark(marks: Readonly<Partial<Record<FirstWeekSectionId, string>>>): number {
  return Math.max(
    0,
    ...Object.values(marks)
      .map((at) => Date.parse(at ?? ""))
      .filter(Number.isFinite),
  );
}

/** Set (or with `at` null, clear) one section's mark, keeping at most FIRST_WEEK_MAX_HOSPITALS hospitals. */
export function setFirstWeekSectionRead(
  state: FirstWeekReadState,
  hospitalKey: string,
  id: FirstWeekSectionId,
  at: string | null,
): FirstWeekReadState {
  if (!HOSPITAL_KEY.test(hospitalKey)) return state;
  const current = { ...(state.hospitals[hospitalKey] ?? {}) };
  if (at === null) delete current[id];
  else current[id] = at;
  const hospitals: Record<string, Partial<Record<FirstWeekSectionId, string>>> = { ...state.hospitals };
  if (Object.keys(current).length === 0) delete hospitals[hospitalKey];
  else hospitals[hospitalKey] = current;
  const keys = Object.keys(hospitals);
  if (keys.length > FIRST_WEEK_MAX_HOSPITALS) {
    const oldest = keys
      .filter((key) => key !== hospitalKey)
      .sort((a, b) => newestMark(hospitals[a]) - newestMark(hospitals[b]));
    for (const key of oldest.slice(0, keys.length - FIRST_WEEK_MAX_HOSPITALS)) delete hospitals[key];
  }
  return state.landAlertOff ? { version: 1, hospitals, landAlertOff: true } : { version: 1, hospitals };
}

/** Replace one hospital's marks wholesale: Undo after "Mark all as read" or "Start again". */
export function restoreFirstWeekMarks(
  state: FirstWeekReadState,
  hospitalKey: string,
  marks: Readonly<Partial<Record<FirstWeekSectionId, string>>>,
): FirstWeekReadState {
  let next: FirstWeekReadState = state;
  for (const id of FIRST_WEEK_SECTION_IDS) next = setFirstWeekSectionRead(next, hospitalKey, id, marks[id] ?? null);
  return next;
}

export type FirstWeekReadStatus = "unread" | "read" | "changed";

/** Read, unread, or changed since it was read (the hospital published a newer version after the mark). */
export function firstWeekSectionStatus(section: FirstWeekSection, readAt: string | undefined): FirstWeekReadStatus {
  if (!readAt || !Number.isFinite(Date.parse(readAt))) return "unread";
  if (section.updatedAt && Date.parse(section.updatedAt) > Date.parse(readAt)) return "changed";
  return "read";
}

/** The progress strip: sections read out of the sections that hold anything. */
export function firstWeekProgress(
  sections: readonly FirstWeekSection[],
  marks: Readonly<Partial<Record<FirstWeekSectionId, string>>>,
): { readonly read: number; readonly total: number; readonly changed: number } {
  const counted = sections.filter((section) => section.count > 0);
  const statuses = counted.map((section) => firstWeekSectionStatus(section, marks[section.id]));
  return {
    read: statuses.filter((status) => status === "read").length,
    total: counted.length,
    changed: statuses.filter((status) => status === "changed").length,
  };
}

/** The screen-reader text for the strip: "2 of 5 sections read, 1 changed since you read it". */
export function firstWeekProgressLabel(progress: { read: number; total: number; changed: number }): string {
  if (progress.total === 0) return "Nothing to read yet";
  const base = `${progress.read} of ${progress.total} ${progress.total === 1 ? "section" : "sections"} read`;
  return progress.changed > 0 ? `${base}, ${progress.changed} changed since you read it` : base;
}

/** A published item changed after the section was marked read. */
export function firstWeekItemChanged(item: Pick<HandbookItem, "updatedAt">, readAt: string | undefined): boolean {
  if (!readAt || !item.updatedAt) return false;
  const read = Date.parse(readAt);
  const updated = Date.parse(item.updatedAt);
  return Number.isFinite(read) && Number.isFinite(updated) && updated > read;
}

/** "1 thing changed since you read it", with the newest change, for the section banner. */
export function firstWeekChangeSummary(
  items: readonly Pick<HandbookItem, "updatedAt">[],
  readAt: string | undefined,
): { readonly count: number; readonly latest: string | null } {
  const changed = items.filter((item) => firstWeekItemChanged(item, readAt));
  let latest: string | null = null;
  for (const item of changed) {
    if (item.updatedAt && (latest === null || Date.parse(item.updatedAt) > Date.parse(latest))) latest = item.updatedAt;
  }
  return { count: changed.length, latest };
}

/**
 * A short note asking the department for a pack, for the doctor to copy and
 * send themselves. PsychSift sends nothing. The hospital's name and the start
 * date are the only details in it.
 */
export function firstWeekAskForPackText(input: {
  readonly hospitalName: string | null;
  readonly startsOn: string | null;
}): string {
  const where = input.hospitalName?.trim() ? ` at ${input.hospitalName.trim()}` : "";
  const when = input.startsOn && dayNumber(input.startsOn) !== null ? ` on ${formatFirstWeekDate(input.startsOn)}` : "";
  return [
    "Hello,",
    "",
    `I am starting${where}${when}. Is there a first week pack or orientation guide for new doctors? Who is who, what you expect on a normal day, how to escalate, and the logins I will need would all help.`,
    "",
    "Thank you.",
  ].join("\n");
}

// ------------------------------------------------------------------ hand-offs to the shared frame

/**
 * A Needs you item (title, due date, area, page), for the main build's
 * Notification centre. Shown only while the pack is highlighted and something
 * is unread or has changed.
 */
export type FirstWeekNeedsYouItem = {
  readonly id: string;
  readonly title: string;
  readonly dueOn: string;
  readonly area: "call";
  readonly href: string;
  readonly kind: "action" | "update";
};

export function selectFirstWeekNeedsYou(input: {
  readonly startsOn: string | null;
  readonly now: Date;
  readonly progress: { readonly read: number; readonly total: number; readonly changed: number };
  /** "Tell me when it lands"; when off, only a change since reading raises an item. Defaults to on. */
  readonly landAlert?: boolean;
}): FirstWeekNeedsYouItem[] {
  const phase = firstWeekPhase(input.startsOn, input.now);
  if (!isFirstWeekHighlighted(phase) || phase.kind === "no-date") return [];
  const { read, total, changed } = input.progress;
  const items: FirstWeekNeedsYouItem[] = [];
  const unread = total - read - changed;
  if (unread > 0 && input.landAlert !== false) {
    items.push({
      id: "on-call:first-week:unread",
      title: unread === total ? "Read your first week pack" : `Your first week pack: ${unread} left to read`,
      dueOn: phase.startsOn,
      area: "call",
      href: FIRST_WEEK_HREF,
      kind: "action",
    });
  }
  if (changed > 0) {
    items.push({
      id: "on-call:first-week:changed",
      title: `Your first week pack changed: ${plural(changed, "section")}`,
      dueOn: perthCalendarDate(input.now),
      area: "call",
      href: FIRST_WEEK_HREF,
      kind: "update",
    });
  }
  return items;
}

/** Work-search records for the pack and each section. No hospital content: titles and keywords only. */
export type FirstWeekSearchRecord = {
  readonly title: string;
  readonly area: "On Call";
  readonly keywords: readonly string[];
  readonly href: string;
};

export function firstWeekSearchRecords(): FirstWeekSearchRecord[] {
  const base = ["first week", "new job", "rotation", "orientation", "induction", "starting", "start date", "pack"];
  return [
    { title: "Your first week", area: "On Call", keywords: base, href: FIRST_WEEK_HREF },
    {
      title: "Your first week: Who is who",
      area: "On Call",
      keywords: [...base, "who is who", "roles", "contacts"],
      href: firstWeekSectionHref("who"),
    },
    {
      title: "Your first week: What we expect",
      area: "On Call",
      keywords: [...base, "expect", "hours", "handover", "ward round", "leave", "overtime", "breaks"],
      href: firstWeekSectionHref("expect"),
    },
    {
      title: "Your first week: How to escalate",
      area: "On Call",
      keywords: [...base, "escalate", "escalation", "ladder", "worried", "emergency"],
      href: firstWeekSectionHref("escalate"),
    },
    {
      title: "Your first week: Logins",
      area: "On Call",
      keywords: [...base, "logins", "access", "accounts", "systems"],
      href: firstWeekSectionHref("logins"),
    },
    {
      title: "Your first day",
      area: "On Call",
      keywords: [...base, "first day", "first shift", "before you start", "badge", "parking"],
      href: firstWeekSectionHref("first-day"),
    },
  ];
}

// ------------------------------------------------------------------ calendar

/**
 * One all-day "First day" event with two reminders: a week before (open the
 * pack) and the day before. The hospital's name is the only detail; no login,
 * name or number enters the file. A stable UID lets a calendar update it.
 */
export type FirstWeekCalendarReminders = {
  /** "Read your first week pack", a week before. */
  readonly weekBefore: boolean;
  /** "First day at ...", the day before. */
  readonly dayBefore: boolean;
};

export function firstWeekCalendarIcs(input: {
  readonly startsOn: string;
  readonly hospitalName: string | null;
  readonly now: Date;
  /** Which reminders ride on the event; both by default. */
  readonly reminders?: FirstWeekCalendarReminders;
}): string | null {
  const reminders = input.reminders ?? { weekBefore: true, dayBefore: true };
  if (dayNumber(input.startsOn) === null) return null;
  const where = input.hospitalName?.trim();
  const summary = where ? `First day at ${where}` : "First day in your new job";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PsychSift//On Call first week//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:first-day-${input.startsOn}@psychiatry.tools`,
    `DTSTAMP:${compactUtc(input.now)}`,
    `DTSTART;VALUE=DATE:${compactDate(input.startsOn)}`,
    `DTEND;VALUE=DATE:${compactDate(addDaysToDate(input.startsOn, 1))}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText("Your first week pack is in PsychSift, On Call.")}`,
    ...(reminders.weekBefore
      ? [
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          "TRIGGER:-P7D",
          `DESCRIPTION:${escapeIcsText("Read your first week pack")}`,
          "END:VALARM",
        ]
      : []),
    ...(reminders.dayBefore
      ? ["BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-P1D", `DESCRIPTION:${escapeIcsText(summary)}`, "END:VALARM"]
      : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}
