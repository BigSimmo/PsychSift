/**
 * The Notification centre's pure rules (work-mode redesign, owner request
 * 6 Oct 2026). The header bell opens one list of what needs the reader across
 * the work areas. This file holds the typed source interface any feature uses
 * to add items, and the rules that decide what the reader sees: which items
 * are hidden by a snooze, how they are filtered (All, Action needed, Updates,
 * one area), how they are grouped (Overdue, Today, This week, Coming up), the
 * counts the bell badge and the chips share, and the next working day a
 * snooze moves an item to.
 *
 * Nothing here is stored or sent anywhere. Items are display text for the
 * signed-in reader on their own screen, so `title` and `detail` must never
 * carry a patient detail (the same rule as `TodayItem`).
 *
 * "Today" is read in the work time zone (`src/lib/work-time/`, Perth unless the
 * reader chose another), the same day My Day uses, so the bell, the
 * Notifications page, the side menu and My Day's Needs you never disagree near
 * midnight. Calendar dates are exact arithmetic on `YYYY-MM-DD` strings.
 */

import type { MyDayItem } from "@/lib/my-day/model";
import type { OnCallNotification } from "@/lib/on-call/notifications";
import {
  WA_PUBLIC_HOLIDAYS,
  WA_PUBLIC_HOLIDAYS_LAST_YEAR,
  waPublicHolidaysByRule,
} from "@/lib/on-call/wa-public-holidays";
import { currentWorkTimeZone } from "@/lib/work-time/current-zone";
import { zoneOffsetMs } from "@/lib/work-time/format";

/* ------------------------------------------------------------- the interface */

/** The work areas an item can belong to, in the order the chips show them. */
export const notificationAreas = ["on-call", "roster", "cme", "teaching", "my-work", "my-day"] as const;
export type NotificationArea = (typeof notificationAreas)[number];

export const notificationAreaLabels: Readonly<Record<NotificationArea, string>> = {
  "on-call": "On Call",
  roster: "Roster",
  cme: "CPD",
  teaching: "Teaching",
  "my-work": "Admin",
  "my-day": "Reminders",
};

/** An item asks the reader to do something, or tells them something. */
export type NotificationKind = "action" | "update";

/** One thing a source wants the reader to see. */
export interface NotificationItem {
  /** Stable and unique across every source, e.g. `roster:swap:42`. Snoozes are kept against it. */
  readonly id: string;
  /** Short, plain words. Never a patient detail. */
  readonly title: string;
  /** Optional second line, before the due time. */
  readonly detail?: string;
  /** A Perth date `YYYY-MM-DD`, an ISO instant, or null for an undated item. */
  readonly due: string | null;
  readonly area: NotificationArea;
  /** The in-app page that owns the item. A tap opens it. */
  readonly href: string;
  readonly kind: NotificationKind;
  /** The source already knows it is past due (an instant that passed, a date the producer judged). */
  readonly overdue?: boolean;
  /** False when the item has its own time and cannot be moved (a reminder). Defaults to true. */
  readonly snoozable?: boolean;
  /** False when a Remind me note makes no sense for it (it already is one). Defaults to true. */
  readonly remindable?: boolean;
  /** A one-tap way to finish the item where the source supports it (a reminder's Done). */
  readonly complete?: { readonly label: string; readonly run: () => void };
}

export type NotificationSourceStatus = "loading" | "ready" | "failed" | "signed-out" | "unavailable";

/** What one source contributes, and how its read went, so the sheet can say honestly what it could not check. */
export interface NotificationSource {
  /** Stable id, e.g. `roster`. */
  readonly id: string;
  /** Plain name for the "did not load" line ("Roster"). */
  readonly label: string;
  readonly status: NotificationSourceStatus;
  readonly items: readonly NotificationItem[];
  /** True when the items are invented demo data rather than the reader's own. */
  readonly sample?: boolean;
}

/* --------------------------------------------------------- source adapters */

const MY_DAY_UPDATE_IDS = new Set(["my-work:more", "teaching:catch-up"]);

/**
 * Whether a My Day item asks for an action or is an update. A recorded Admin
 * date still outside its renewal window, the "more dates in Renewals" line and
 * sessions to catch up on are updates; everything else asks the reader to do
 * something (answer, log, prep, book, record).
 */
export function myDayItemKind(item: MyDayItem): NotificationKind {
  if (MY_DAY_UPDATE_IDS.has(item.id)) return "update";
  if (item.id.startsWith("my-work:date:") && item.severity === "info") return "update";
  // A sick report still waiting for cover: the roster manager acts, the reader is told.
  if (item.id.startsWith("roster:sick:")) return "update";
  if (item.mode === "on-call") return "update";
  return "action";
}

/** A My Day item as a Notification centre item. */
export function myDayNotificationItem(item: MyDayItem): NotificationItem {
  return {
    id: item.id,
    title: item.title,
    detail: item.detail,
    due: item.due,
    area: item.mode,
    href: item.href,
    kind: myDayItemKind(item),
    overdue: item.severity === "overdue",
  };
}

/** The area words the features' own Needs you items use, to the centre's areas. */
const FEATURE_AREAS = {
  call: "on-call",
  admin: "my-work",
  cpd: "cme",
  teaching: "teaching",
  roster: "roster",
} as const satisfies Readonly<Record<string, NotificationArea>>;

/**
 * What a feature's own Needs you selector returns (First week, Contract, Starter
 * pack, Ready for day one, Job applications, CPD Home, Term folder): a stable id,
 * plain words, the Perth date it is due (or null), its area and page, and whether
 * it asks for an action.
 */
export interface FeatureNeedsYouItem {
  readonly id: string;
  readonly title: string;
  readonly dueOn: string | null;
  readonly area: keyof typeof FEATURE_AREAS;
  readonly href: string;
  readonly kind: NotificationKind;
}

/** A feature's Needs you item as a Notification centre item, field for field. */
export function featureNotificationItem(item: FeatureNeedsYouItem): NotificationItem {
  return {
    id: item.id,
    title: item.title,
    due: item.dueOn,
    area: FEATURE_AREAS[item.area],
    href: item.href,
    kind: item.kind,
  };
}

/**
 * An On Call notification as an item. Its title and detail are the On Call
 * module's own words, which never claim anything about the reader's standing.
 * A recorded date that has passed asks for an action; an entry nobody has
 * confirmed in a long time is an update worth checking.
 */
export function onCallNotificationItem(notification: OnCallNotification, href: string): NotificationItem {
  return {
    id: `on-call:${notification.id}`,
    title: notification.title,
    detail: notification.detail,
    due: null,
    area: "on-call",
    href,
    kind: notification.kind === "compliance-date-passed" ? "action" : "update",
    // The On Call type snooze (a week, in reminder settings) is the honest control for these rows.
    snoozable: false,
    remindable: false,
  };
}

/**
 * Admin already lists a compliance row whose recorded date has passed, so the
 * On Call copy of the same row is dropped and the item is counted once.
 */
export function withoutAdminDuplicates(
  notifications: readonly OnCallNotification[],
  items: readonly { readonly id: string }[],
): OnCallNotification[] {
  const adminIds = new Set(items.map((item) => item.id));
  return notifications.filter(
    (notification) =>
      notification.kind !== "compliance-date-passed" || !adminIds.has(`my-work:date:${notification.entry.id}`),
  );
}

/* ------------------------------------------------------------------- dates */

const PERTH_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const two = (value: number) => String(value).padStart(2, "0");

/** The Perth calendar date of an instant. Prefer `workToday`, which follows the reader's work time zone. */
export function perthToday(now: Date): string {
  const perth = new Date(now.getTime() + PERTH_OFFSET_MS);
  return `${perth.getUTCFullYear()}-${two(perth.getUTCMonth() + 1)}-${two(perth.getUTCDate())}`;
}

/** The wall clock of an instant in the zone, as a Date whose UTC fields read as that clock. */
function wallClock(ms: number, zone: string): Date {
  return new Date(ms + zoneOffsetMs(ms, zone));
}

/**
 * The calendar date of an instant in the work time zone (Perth unless the
 * reader chose another). The one "today" the feed and My Day both use.
 */
export function workToday(now: Date, zone: string = currentWorkTimeZone()): string {
  const wall = wallClock(now.getTime(), zone);
  return `${wall.getUTCFullYear()}-${two(wall.getUTCMonth() + 1)}-${two(wall.getUTCDate())}`;
}

function addDays(date: string, days: number): string {
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS);
  return `${next.getUTCFullYear()}-${two(next.getUTCMonth() + 1)}-${two(next.getUTCDate())}`;
}

function dayDifference(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** The work-zone date a due value falls on, or null when absent or unreadable. */
function dueDate(due: string | null, zone: string): string | null {
  if (due === null) return null;
  if (DATE_ONLY.test(due)) return Number.isFinite(Date.parse(`${due}T00:00:00Z`)) ? due : null;
  const ms = Date.parse(due);
  return Number.isFinite(ms) ? workToday(new Date(ms), zone) : null;
}

function isWaHoliday(date: string): boolean {
  const year = Number(date.slice(0, 4));
  if (year <= WA_PUBLIC_HOLIDAYS_LAST_YEAR) return WA_PUBLIC_HOLIDAYS.has(date);
  return waPublicHolidaysByRule(year).includes(date);
}

/**
 * The next working day after `today` (a Perth `YYYY-MM-DD`): Monday to Friday
 * and not a Western Australian public holiday. A snooze hides an item until
 * that morning.
 */
export function nextWorkingDay(today: string): string {
  let date = addDays(today, 1);
  for (let guard = 0; guard < 14; guard += 1) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !isWaHoliday(date)) return date;
    date = addDays(date, 1);
  }
  return date;
}

/** "Tomorrow" or "Mon 12 Oct", for a snooze button and its confirmation. */
export function formatSnoozeDay(date: string, today: string): string {
  if (dayDifference(today, date) === 1) return "tomorrow";
  return formatShortDate(date, today);
}

function formatShortDate(date: string, today: string): string {
  const [year, month, day] = date.split("-").map((part) => Number.parseInt(part, 10));
  const weekday = DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  const base = `${weekday} ${day} ${MONTHS[month - 1]}`;
  return String(year) === today.slice(0, 4) ? base : `${base} ${year}`;
}

/**
 * The due part of a row's second line: "Today 14:30", "Tomorrow", "Thu 8 Oct",
 * "Was due Wed 23 Sep". Empty for an undated item.
 */
export function formatNotificationDue(due: string | null, now: Date, zone: string = currentWorkTimeZone()): string {
  const date = dueDate(due, zone);
  if (due === null || date === null) return "";
  const today = workToday(now, zone);
  const days = dayDifference(today, date);
  const timed = !DATE_ONLY.test(due);
  const clock = timed
    ? (() => {
        const wall = wallClock(Date.parse(due), zone);
        return ` ${two(wall.getUTCHours())}:${two(wall.getUTCMinutes())}`;
      })()
    : "";
  if (days === 0) return `Today${clock}`;
  if (days === 1) return `Tomorrow${clock}`;
  if (days === -1) return `Was due yesterday${clock}`;
  if (days < 0) return `Was due ${formatShortDate(date, today)}`;
  return `${formatShortDate(date, today)}${clock}`;
}

/* ----------------------------------------------------------- the rules */

export type NotificationUrgency = "overdue" | "today" | "week" | "later";
export const notificationUrgencies = [
  "overdue",
  "today",
  "week",
  "later",
] as const satisfies readonly NotificationUrgency[];
export const notificationUrgencyLabels: Readonly<Record<NotificationUrgency, string>> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Coming up",
};

/**
 * Overdue when the source says so or the due moment has passed; Today when it
 * falls today; This week within the next six days; otherwise, or undated,
 * Coming up (the key stays `later`).
 */
export function notificationUrgency(
  item: NotificationItem,
  now: Date,
  zone: string = currentWorkTimeZone(),
): NotificationUrgency {
  if (item.overdue) return "overdue";
  const date = dueDate(item.due, zone);
  if (item.due === null || date === null) return "later";
  if (!DATE_ONLY.test(item.due) && Date.parse(item.due) < now.getTime()) return "overdue";
  const days = dayDifference(workToday(now, zone), date);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 6) return "week";
  return "later";
}

function dueInstant(due: string | null): number | null {
  if (due === null) return null;
  const ms = DATE_ONLY.test(due) ? Date.parse(`${due}T00:00:00Z`) - PERTH_OFFSET_MS : Date.parse(due);
  return Number.isFinite(ms) ? ms : null;
}

/** Earliest due first (undated last), then area order, then title and id, so the order never depends on input order. */
export function compareNotifications(a: NotificationItem, b: NotificationItem): number {
  const aDue = dueInstant(a.due);
  const bDue = dueInstant(b.due);
  if (aDue !== bDue) {
    if (aDue === null) return 1;
    if (bDue === null) return -1;
    return aDue - bDue;
  }
  const area = notificationAreas.indexOf(a.area) - notificationAreas.indexOf(b.area);
  if (area !== 0) return area;
  const title = a.title.localeCompare(b.title, "en");
  if (title !== 0) return title;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Snoozes: item id to the Perth date it comes back. */
export type NotificationSnoozes = Readonly<Record<string, string>>;

export interface NotificationFeedSummary {
  /** Every item the reader can see now (not snoozed), in display order. */
  readonly visible: readonly NotificationItem[];
  /** Items hidden by a snooze, with the date each comes back. */
  readonly snoozed: readonly { readonly item: NotificationItem; readonly until: string }[];
  /** The bell badge and the All segment: `visible.length`. */
  readonly count: number;
  readonly overdue: number;
}

/**
 * Merge every source: first copy of a repeated id wins, snoozed items set
 * aside, the rest sorted by urgency then due. The badge count is `count`, the
 * same number the sheet's All segment shows.
 */
export function summariseNotifications(
  sources: readonly NotificationSource[],
  snoozes: NotificationSnoozes,
  now: Date,
  zone: string = currentWorkTimeZone(),
): NotificationFeedSummary {
  const today = workToday(now, zone);
  const seen = new Set<string>();
  const visible: NotificationItem[] = [];
  const snoozed: { item: NotificationItem; until: string }[] = [];
  for (const source of sources) {
    if (source.status !== "ready") continue;
    for (const item of source.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const until = snoozes[item.id];
      if (item.snoozable !== false && until !== undefined && until > today) snoozed.push({ item, until });
      else visible.push(item);
    }
  }
  const rank = (item: NotificationItem) => notificationUrgencies.indexOf(notificationUrgency(item, now, zone));
  visible.sort((a, b) => rank(a) - rank(b) || compareNotifications(a, b));
  snoozed.sort((a, b) => a.until.localeCompare(b.until) || compareNotifications(a.item, b.item));
  const overdue = visible.filter((item) => notificationUrgency(item, now, zone) === "overdue").length;
  return { visible, snoozed, count: visible.length, overdue };
}

export type NotificationSegment = "all" | "action" | "update";
export const notificationSegments = ["all", "action", "update"] as const satisfies readonly NotificationSegment[];
export const notificationSegmentLabels: Readonly<Record<NotificationSegment, string>> = {
  all: "All",
  action: "Action needed",
  update: "Updates",
};

export function inSegment(item: NotificationItem, segment: NotificationSegment): boolean {
  return segment === "all" || item.kind === segment;
}

/** Per-area counts inside a segment, for the chips. Areas with nothing are left out. */
export function areaCounts(
  items: readonly NotificationItem[],
  segment: NotificationSegment,
): { readonly area: NotificationArea; readonly label: string; readonly count: number }[] {
  return notificationAreas
    .map((area) => ({
      area,
      label: notificationAreaLabels[area],
      count: items.filter((item) => item.area === area && inSegment(item, segment)).length,
    }))
    .filter((entry) => entry.count > 0);
}

export interface NotificationGroup {
  readonly urgency: NotificationUrgency;
  readonly label: string;
  readonly items: readonly NotificationItem[];
}

/** The filtered items grouped Overdue, Today, This week, Coming up; empty groups left out. Order inside is kept. */
export function groupNotifications(
  items: readonly NotificationItem[],
  now: Date,
  segment: NotificationSegment = "all",
  area: NotificationArea | null = null,
  zone: string = currentWorkTimeZone(),
): NotificationGroup[] {
  const shown = items.filter((item) => inSegment(item, segment) && (area === null || item.area === area));
  return notificationUrgencies
    .map((urgency) => ({
      urgency,
      label: notificationUrgencyLabels[urgency],
      items: shown.filter((item) => notificationUrgency(item, now, zone) === urgency),
    }))
    .filter((group) => group.items.length > 0);
}

/** The bell's badge text: the count, capped at "9+". Empty for nothing. */
export function notificationBadgeText(count: number): string {
  if (count <= 0) return "";
  return count > 9 ? "9+" : String(count);
}

/** The bell's accessible name, so a screen reader hears what the badge shows. */
export function notificationBellLabel(count: number | null, overdue = 0): string {
  if (count === null || count <= 0) return "Notifications";
  const waiting = `${count} ${count === 1 ? "needs" : "need"} you`;
  return overdue > 0 ? `Notifications, ${waiting}, ${overdue} overdue` : `Notifications, ${waiting}`;
}
