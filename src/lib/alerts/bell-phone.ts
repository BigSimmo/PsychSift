import type { NotificationItem } from "@/lib/needs-you/feed";
import {
  ALL_DAY_ALERT_BASE_MINUTES,
  applyQuietHours,
  BELL_PHONE_AREAS,
  type BellPhoneArea,
  type ReminderSettings,
} from "@/lib/reminders/settings";

/**
 * Bell reminders on the phone (top 20, item 12, 8 Oct 2026): a reminder in
 * the bell that falls due later buzzes this phone at that moment, even with
 * the app closed.
 *
 * The words never leave the phone. The phone queues each one on the server
 * under a random id with its due time only (the Remind me queue, owner
 * decision 1, 5 Oct 2026), and the service worker shows one fixed line that
 * names nothing. This file is the pure part: which bell items buzz, when, and
 * what to add to or take off the queue.
 */

/** Prefix of a bell reminder's queue id; Remind me notes use `r`. The sender picks the lock-screen line by it. */
export const BELL_PHONE_REF_PREFIX = "w-";
/** At most this many wait on the server at once, leaving the shared queue's room for Remind me notes. */
export const BELL_PHONE_QUEUE_LIMIT = 5;
/** The server refuses anything more than 8 days ahead; stay inside that so a slow clock is never refused. */
export const BELL_PHONE_MAX_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;
/** Nothing is queued for the next minute: it would arrive after the reader has already seen it. */
const MIN_AHEAD_MS = 60 * 1000;

const PERTH_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function isBellPhoneArea(area: string): area is BellPhoneArea {
  return (BELL_PHONE_AREAS as readonly string[]).includes(area);
}

/**
 * When an item would buzz: its own instant, or 09:00 Perth on a date-only
 * item's day (the calendar alerts' anchor), moved to the end of quiet hours
 * when it lands inside them. Null for an undated or unreadable due.
 */
export function bellAlertAt(due: string | null, settings: ReminderSettings): number | null {
  if (!due) return null;
  let at: number;
  if (DATE_ONLY.test(due)) {
    const day = Date.parse(`${due}T00:00:00Z`);
    if (!Number.isFinite(day)) return null;
    at = day + ALL_DAY_ALERT_BASE_MINUTES * 60_000 - PERTH_OFFSET_MS;
  } else {
    at = Date.parse(due);
    if (!Number.isFinite(at)) return null;
  }
  return applyQuietHours(at, settings.quietHours);
}

/** One reminder this phone wants buzzed, keyed by the bell item and its due, so a moved due is a new entry. */
export type BellPhoneWanted = { readonly key: string; readonly dueAt: string };

/**
 * The bell items that should buzz this phone, soonest first. Only things that
 * ask the reader to act, in an area they left on, not already past, not a
 * Remind me note (those buzz on their own), and never example records.
 */
export function planBellPhoneAlerts(
  items: readonly NotificationItem[],
  settings: ReminderSettings,
  now: Date,
  sampleIds: ReadonlySet<string> = new Set(),
): BellPhoneWanted[] {
  if (!settings.bellPhone.enabled) return [];
  const from = now.getTime() + MIN_AHEAD_MS;
  const to = now.getTime() + BELL_PHONE_MAX_AHEAD_MS;
  const wanted: { key: string; at: number }[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (item.kind !== "action" || item.overdue) continue;
    if (item.id.startsWith("example:") || item.id.startsWith("remind:") || sampleIds.has(item.id)) continue;
    if (!isBellPhoneArea(item.area) || !settings.bellPhone.areas[item.area]) continue;
    const at = bellAlertAt(item.due, settings);
    if (at === null || at < from || at > to) continue;
    wanted.push({ key: item.id, at });
  }
  return wanted
    .sort((a, b) => a.at - b.at || a.key.localeCompare(b.key))
    .slice(0, BELL_PHONE_QUEUE_LIMIT)
    .map(({ key, at }) => ({ key, dueAt: new Date(at).toISOString() }));
}

/** What this phone has queued: the random id the server knows, by bell item. */
export type BellPhoneQueued = { readonly ref: string; readonly key: string; readonly dueAt: string };

export type BellPhoneQueueChanges = {
  readonly add: readonly BellPhoneQueued[];
  readonly remove: readonly BellPhoneQueued[];
};

/**
 * What to add to and take off the server queue. An entry whose item moved
 * its due is replaced. While `complete` is false (a source failed or is still
 * loading, so a missing item may only be unread) nothing is taken off except
 * entries whose time has passed, which the server has already sent or dropped.
 */
export function bellPhoneQueueChanges(
  queued: readonly BellPhoneQueued[],
  wanted: readonly BellPhoneWanted[],
  now: Date,
  complete: boolean,
  makeRef: () => string,
): BellPhoneQueueChanges {
  const wantedByKey = new Map(wanted.map((entry) => [entry.key, entry]));
  const remove: BellPhoneQueued[] = [];
  const kept = new Map<string, BellPhoneQueued>();
  for (const entry of queued) {
    const want = wantedByKey.get(entry.key);
    const passed = Date.parse(entry.dueAt) <= now.getTime();
    if (want && want.dueAt === entry.dueAt) kept.set(entry.key, entry);
    else if (passed) continue;
    else if (want || complete) remove.push(entry);
    else kept.set(entry.key, entry);
  }
  const room = Math.max(0, BELL_PHONE_QUEUE_LIMIT - kept.size);
  const add = wanted
    .filter((entry) => !kept.has(entry.key))
    .slice(0, room)
    .map((entry) => ({ ref: makeRef(), key: entry.key, dueAt: entry.dueAt }));
  return { add, remove };
}

/** A random queue id the server can't read anything from (the bell item's id never travels). */
export function newBellPhoneRef(random: () => string = () => crypto.randomUUID()): string {
  return `${BELL_PHONE_REF_PREFIX}${random()
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 24)}`;
}

/** The stored queue, read defensively: anything unreadable is dropped. */
export function normalizeBellPhoneQueue(input: unknown): BellPhoneQueued[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (entry): entry is BellPhoneQueued =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.ref === "string" &&
        entry.ref.startsWith(BELL_PHONE_REF_PREFIX) &&
        /^[A-Za-z0-9_-]{1,64}$/.test(entry.ref) &&
        typeof entry.key === "string" &&
        typeof entry.dueAt === "string" &&
        Number.isFinite(Date.parse(entry.dueAt)),
    )
    .slice(0, BELL_PHONE_QUEUE_LIMIT * 4)
    .map(({ ref, key, dueAt }) => ({ ref, key, dueAt }));
}
