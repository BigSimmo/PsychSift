import "server-only";

import { briefIsDue, morningBriefTime, type BriefShift } from "@/lib/alerts/morning-brief";
import { normalizeReminderSettings } from "@/lib/reminders/settings";
import { pushCodeToOwnerDevice, pushCodeToOwners, webPushConfigured } from "@/lib/roster/alerts/send";
import { addDaysToDate, perthDateOf, perthWallToIso } from "@/lib/roster/shifts/perth-time";
import type { RosterAdminClient } from "@/lib/roster/team/api";

/**
 * The timed sender behind My Day › Alerts. Once a minute it sends:
 *
 * - each Remind me note that has come due, as `{t:"reminder"}`, to the one
 *   phone that set it. The server holds only the due time, an id the phone
 *   chose and that phone's alert link, never the words
 *   (owner decision 1, 5 Oct 2026); the row is deleted as it is taken. A
 *   reminder breaks through quiet hours at the exact time the reader set
 *   (decision 2), so quiet hours are not applied to it.
 * - the morning brief, as `{t:"brief"}`, once per Perth day, at the time
 *   `morningBriefTime` gives.
 *
 * The service worker owns every word on the lock screen, so only the code
 * travels. Nothing here logs an owner, endpoint or time.
 */

/** A reminder this late (the server was down) is dropped rather than buzzing long after the moment. */
export const REMINDER_LATE_LIMIT_MS = 30 * 60 * 1000;
const TICK_MS = 60 * 1000;
const OWNER_LIMIT = 500;

type ClaimedReminder = { owner_id: string; ref: string; due_at: string; endpoint: string };

export async function sendDueReminders(client: RosterAdminClient, now: Date): Promise<number> {
  const { data, error } = await client.rpc("alert_claim_due_reminders", {
    p_now: now.toISOString(),
    p_limit: 200,
  });
  if (error) throw new Error("Reminder claim unavailable");
  let sent = 0;
  for (const row of (data ?? []) as ClaimedReminder[]) {
    if (now.getTime() - Date.parse(row.due_at) >= REMINDER_LATE_LIMIT_MS) continue;
    // Only the phone that holds the words is buzzed; another device would have nothing to show.
    if (await pushCodeToOwnerDevice(client, row.owner_id, row.endpoint, "reminder", 15 * 60)) sent += 1;
  }
  return sent;
}

export async function sendMorningBriefs(client: RosterAdminClient, now: Date): Promise<number> {
  const today = perthDateOf(now);
  const linked = await client
    .from("web_push_subscriptions")
    .select("owner_id")
    .limit(OWNER_LIMIT * 2);
  if (linked.error) throw new Error("Subscriptions unavailable");
  const linkedOwners = [...new Set((linked.data ?? []).map((row) => row.owner_id as string))].slice(0, OWNER_LIMIT);
  if (!linkedOwners.length) return 0;
  const prefs = await client
    .from("user_preferences")
    .select("user_id, preferences")
    .in("user_id", linkedOwners)
    .eq("preferences->reminders->brief->>enabled", "true");
  if (prefs.error) throw new Error("Preferences unavailable");
  const wanting = prefs.data ?? [];
  if (!wanting.length) return 0;

  const from = perthWallToIso(addDaysToDate(today, -1), "00:00");
  const to = perthWallToIso(addDaysToDate(today, 1), "00:00");
  const shifts = await client
    .from("on_call_shifts")
    .select("owner_id, starts_at, ends_at, kind")
    .in(
      "owner_id",
      wanting.map((row) => row.user_id as string),
    )
    .gte("ends_at", from!)
    .lt("starts_at", to!)
    .limit(5000);
  if (shifts.error) throw new Error("Shifts unavailable");
  const byOwner = new Map<string, BriefShift[]>();
  for (const row of shifts.data ?? []) {
    const list = byOwner.get(row.owner_id as string) ?? [];
    list.push({ startsAt: row.starts_at as string, endsAt: row.ends_at as string, kind: (row.kind as string) ?? null });
    byOwner.set(row.owner_id as string, list);
  }

  const due: string[] = [];
  for (const row of wanting) {
    const ownerId = row.user_id as string;
    const settings = normalizeReminderSettings((row.preferences as { reminders?: unknown })?.reminders);
    if (!settings.brief.enabled) continue;
    const time = morningBriefTime(settings.brief, settings.quietHours, today, byOwner.get(ownerId) ?? []);
    if (!time || !briefIsDue(time, now)) continue;
    const claim = await client.rpc("alert_claim_morning_brief", { p_owner_id: ownerId, p_perth_date: today });
    if (!claim.error && claim.data === true) due.push(ownerId);
  }
  if (!due.length) return 0;
  return (await pushCodeToOwners(client, due, "brief", 2 * 60 * 60)).sent;
}

/** One pass of both senders. Each half fails on its own, so a reminder still goes when the brief can't. */
export async function runTimedAlerts(client: RosterAdminClient, now = new Date()): Promise<void> {
  const results = await Promise.allSettled([sendDueReminders(client, now), sendMorningBriefs(client, now)]);
  if (results.some((result) => result.status === "rejected")) {
    console.warn("[alerts] timed sender pass incomplete");
  }
}

const RUNNING = Symbol.for("psychsift.alerts.timedSender");

/**
 * Starts the once-a-minute pass in this server process. Safe to call twice,
 * and safe with several servers: every send is claimed in the database first.
 * Does nothing without phone-alert keys.
 */
export function startTimedAlertSender(createClient: () => RosterAdminClient): boolean {
  const holder = globalThis as unknown as Record<symbol, unknown>;
  if (holder[RUNNING] || !webPushConfigured()) return false;
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    runTimedAlerts(createClient())
      .catch(() => console.warn("[alerts] timed sender pass failed"))
      .finally(() => {
        busy = false;
      });
  }, TICK_MS);
  timer.unref?.();
  holder[RUNNING] = timer;
  return true;
}
