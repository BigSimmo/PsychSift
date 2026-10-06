import "server-only";

import webpush from "web-push";

import { env } from "@/lib/env";
import { fetchRosterSettings } from "@/lib/roster/settings";
import type { RosterAdminClient } from "@/lib/roster/team/api";

import type { RosterAlertType } from "./messages";
import { ownerSubscriptionFor, removeGoneSubscription, subscriptionsForOwners, type PushRow } from "./subscriptions";

export function webPushConfigured(): boolean {
  return !!(env.WEB_PUSH_PUBLIC_KEY && env.WEB_PUSH_PRIVATE_KEY && env.WEB_PUSH_SUBJECT);
}

/** Send type codes only; never log an endpoint, person, title or payload. */
export async function sendRosterAlerts(
  client: RosterAdminClient,
  recipientIds: readonly string[],
  type: RosterAlertType,
  quiet = new Set<string>(),
): Promise<{ sent: number; skipped: number; failed: number }> {
  const totals = { sent: 0, skipped: 0, failed: 0 };
  if (!webPushConfigured() || !recipientIds.length) return totals;
  const unique = [...new Set(recipientIds)].slice(0, 500);
  const enabled = new Set<string>();
  for (const ownerId of unique) {
    try {
      const settings = await fetchRosterSettings(client, ownerId);
      if (
        (type === "changed" ? settings.alerts.changes : settings.alerts.requests) &&
        (type === "changed" || !quiet.has(ownerId))
      ) {
        enabled.add(ownerId);
      } else totals.skipped += 1;
    } catch {
      totals.failed += 1;
    }
  }
  if (!enabled.size) return totals;
  const pushed = await pushCodeToOwners(client, [...enabled], type, 6 * 60 * 60);
  return { sent: pushed.sent, skipped: totals.skipped, failed: totals.failed + pushed.failed };
}

/**
 * One `{t: code}` push to every device these owners linked. The service worker
 * owns the words, so only the code travels. A gone device is removed.
 */
export async function pushCodeToOwners(
  client: RosterAdminClient,
  ownerIds: readonly string[],
  code: string,
  ttlSeconds: number,
): Promise<{ sent: number; failed: number }> {
  const totals = { sent: 0, failed: 0 };
  if (!webPushConfigured() || !ownerIds.length) return totals;
  webpush.setVapidDetails(env.WEB_PUSH_SUBJECT!, env.WEB_PUSH_PUBLIC_KEY!, env.WEB_PUSH_PRIVATE_KEY!);
  const rows = await subscriptionsForOwners(client, [...new Set(ownerIds)].slice(0, 500));
  for (const row of rows) {
    if (await pushOne(client, row, code, ttlSeconds)) totals.sent += 1;
    else totals.failed += 1;
  }
  return totals;
}

/** One `{t: code}` push to one device, only if this owner still owns it. */
export async function pushCodeToOwnerDevice(
  client: RosterAdminClient,
  ownerId: string,
  endpoint: string,
  code: string,
  ttlSeconds: number,
): Promise<boolean> {
  if (!webPushConfigured()) return false;
  const row = await ownerSubscriptionFor(client, ownerId, endpoint);
  if (!row) return false;
  webpush.setVapidDetails(env.WEB_PUSH_SUBJECT!, env.WEB_PUSH_PUBLIC_KEY!, env.WEB_PUSH_PRIVATE_KEY!);
  return pushOne(client, row, code, ttlSeconds);
}

async function pushOne(client: RosterAdminClient, row: PushRow, code: string, ttlSeconds: number): Promise<boolean> {
  try {
    await webpush.sendNotification(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      JSON.stringify({ t: code }),
      { TTL: ttlSeconds },
    );
    return true;
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) await removeGoneSubscription(client, row).catch(() => {});
    return false;
  }
}

export type TestAlertResult =
  { readonly sent: 1 } | { readonly sent: 0; readonly reason: "not_configured" | "not_owned" | "gone" | "failed" };

/**
 * "Send test" on the Alerts page: one `{t:"test"}` push to the one device that
 * asked, after checking that this owner owns it. A failure says why, so the
 * page only suggests re-linking when the link is really gone; a gone
 * subscription is removed, as a real send would.
 */
export async function sendTestAlert(
  client: RosterAdminClient,
  ownerId: string,
  endpoint: string,
): Promise<TestAlertResult> {
  if (!webPushConfigured()) return { sent: 0, reason: "not_configured" };
  const row = await ownerSubscriptionFor(client, ownerId, endpoint);
  if (!row) return { sent: 0, reason: "not_owned" };
  webpush.setVapidDetails(env.WEB_PUSH_SUBJECT!, env.WEB_PUSH_PUBLIC_KEY!, env.WEB_PUSH_PRIVATE_KEY!);
  try {
    await webpush.sendNotification(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      JSON.stringify({ t: "test" }),
      { TTL: 60 },
    );
    return { sent: 1 };
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) {
      await removeGoneSubscription(client, row).catch(() => {});
      return { sent: 0, reason: "gone" };
    }
    return { sent: 0, reason: "failed" };
  }
}
