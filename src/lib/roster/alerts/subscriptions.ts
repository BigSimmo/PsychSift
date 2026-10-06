import "server-only";

import { z } from "zod";

import { PublicApiError } from "@/lib/http";
import type { RosterAdminClient } from "@/lib/roster/team/api";

const pushHost = (hostname: string) =>
  hostname === "fcm.googleapis.com" ||
  hostname === "web.push.apple.com" ||
  hostname === "updates.push.services.mozilla.com" ||
  hostname.endsWith(".notify.windows.com");

export function validPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      value.length <= 1000 &&
      url.protocol === "https:" &&
      pushHost(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (!url.port || url.port === "443")
    );
  } catch {
    return false;
  }
}

const key = z
  .string()
  .min(8)
  .max(300)
  .regex(/^[A-Za-z0-9_+\-/=]+$/);
export const subscriptionBodySchema = z
  .object({
    endpoint: z.string().min(1).max(1000).refine(validPushEndpoint),
    keys: z.object({ p256dh: key, auth: key }).strict(),
  })
  .strict();
export const removeSubscriptionBodySchema = z
  .object({
    endpoint: z.string().min(1).max(1000).refine(validPushEndpoint),
  })
  .strict();

export type PushRow = { id: string; owner_id: string; endpoint: string; p256dh: string; auth: string };

function storageError(error: { message?: string | null; code?: string | null }): PublicApiError {
  if (error.message === "roster_limit")
    return new PublicApiError("This account already has alerts on 10 phones.", 409, { code: "roster_limit" });
  return new PublicApiError("Phone alerts couldn't be saved. Try again shortly.", 503, { code: "roster_unavailable" });
}

/** The endpoint is a browser secret, so never log it. A shared phone belongs to its last subscriber. */
export async function saveOwnerSubscription(
  client: RosterAdminClient,
  ownerId: string,
  input: z.infer<typeof subscriptionBodySchema>,
): Promise<void> {
  // This is the one intentional cross-owner delete: an endpoint uniquely names
  // a physical browser subscription, and the last signed-in account owns it.
  const { error: oldError } = await client.from("web_push_subscriptions").delete().eq("endpoint", input.endpoint);
  if (oldError) throw storageError(oldError);
  const { error } = await client.from("web_push_subscriptions").insert({
    owner_id: ownerId,
    endpoint: input.endpoint,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
  });
  if (error) throw storageError(error);
}

export async function removeOwnerSubscription(
  client: RosterAdminClient,
  ownerId: string,
  endpoint: string,
): Promise<void> {
  const { error } = await client
    .from("web_push_subscriptions")
    .delete()
    .eq("owner_id", ownerId)
    .eq("endpoint", endpoint);
  if (error) throw storageError(error);
  // Sign-out and "off" end here: the device's queued Remind me times go too (the sender
  // would find no device to buzz anyway, but nothing is kept that has no use).
  await client.from("alert_reminder_times").delete().eq("owner_id", ownerId).eq("endpoint", endpoint);
}

/** The browser having an endpoint does not prove that this signed-in owner receives it. */
export async function ownerHasSubscription(
  client: RosterAdminClient,
  ownerId: string,
  endpoint: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("web_push_subscriptions")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("endpoint", endpoint)
    .limit(1);
  if (error || !data) throw storageError(error ?? {});
  return data.length > 0;
}

/** Delete my data uses this owner-filtered helper after its undo window ends. */
export async function removeAllOwnerSubscriptions(client: RosterAdminClient, ownerId: string): Promise<void> {
  const { error } = await client.from("web_push_subscriptions").delete().eq("owner_id", ownerId);
  if (error) throw storageError(error);
  const times = await client.from("alert_reminder_times").delete().eq("owner_id", ownerId);
  if (times.error) throw storageError(times.error);
}

export async function subscriptionsForOwners(
  client: RosterAdminClient,
  ownerIds: readonly string[],
): Promise<PushRow[]> {
  if (!ownerIds.length) return [];
  const { data, error } = await client
    .from("web_push_subscriptions")
    .select("id,owner_id,endpoint,p256dh,auth")
    .in("owner_id", [...ownerIds])
    .limit(5000);
  if (error || !data) throw storageError(error ?? {});
  return data as PushRow[];
}

export async function removeGoneSubscription(
  client: RosterAdminClient,
  row: Pick<PushRow, "id" | "owner_id">,
): Promise<void> {
  await client.from("web_push_subscriptions").delete().eq("owner_id", row.owner_id).eq("id", row.id);
}

/** The owner's own row for one endpoint, or null: a test may only reach the device that asked for it. */
export async function ownerSubscriptionFor(
  client: RosterAdminClient,
  ownerId: string,
  endpoint: string,
): Promise<PushRow | null> {
  const { data, error } = await client
    .from("web_push_subscriptions")
    .select("id,owner_id,endpoint,p256dh,auth")
    .eq("owner_id", ownerId)
    .eq("endpoint", endpoint)
    .limit(1);
  if (error || !data) throw storageError(error ?? {});
  return (data[0] as PushRow | undefined) ?? null;
}
