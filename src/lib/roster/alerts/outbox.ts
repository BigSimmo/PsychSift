import "server-only";
import { z } from "zod";
import type { RosterAdminClient } from "@/lib/roster/team/api";
import { fetchRosterSettings } from "@/lib/roster/settings";
import { rosterTeamReleaseEnabled } from "@/lib/roster/team/release";
import { offerRecipients } from "./offer-recipients";
import { recipientsOnNightNow } from "./night";
import { pushRosterOfferDevice, webPushConfigured } from "./send";

const eventSchema = z.object({
  open_shift_id: z.string().uuid(),
  service_id: z.string().uuid(),
  actor_id: z.string().uuid(),
  lease_token: z.string().uuid(),
  initialized: z.boolean(),
  expires_at: z.string().datetime({ offset: true }),
});
const devicesSchema = z.array(z.object({ subscription_id: z.string().uuid(), owner_id: z.string().uuid() })).max(25);

class OfferLeaseError extends Error {}

/** One bounded batch. No process-local delivery authority and no legacy fan-out fallback. */
export async function drainRosterOfferAlerts(
  client: RosterAdminClient,
  openShiftId?: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!rosterTeamReleaseEnabled() || !webPushConfigured() || signal?.aborted) return;
  const claimed = await client.rpc("roster_offer_alert_work", {
    p_operation: "claim",
    ...(openShiftId ? { p_open_shift_id: openShiftId } : {}),
  });
  if (claimed.error) throw new Error("Offer alert claim unavailable");
  if (!claimed.data) return;
  const event = eventSchema.parse(claimed.data);
  const work = async (operation: string, args: Record<string, unknown> = {}) => {
    const result = await client.rpc("roster_offer_alert_work", {
      p_operation: operation,
      p_open_shift_id: event.open_shift_id,
      p_token: event.lease_token,
      ...args,
    });
    if (result.error || result.data === null) throw new OfferLeaseError("Offer alert lease unavailable");
    return result.data;
  };
  try {
    let eligible = await offerRecipients(client, event.actor_id, event.service_id, event.open_shift_id);
    if (!event.initialized) await work("prepare", { p_owner_ids: eligible });
    const devices = devicesSchema.parse(await work("devices"));
    for (const device of devices) {
      if (signal?.aborted) break;
      let outcome: "sent" | "skipped" | "retry" = "skipped";
      try {
        // Renew the server-side eligibility decision before each network send. No endpoint is logged or stored in the outbox.
        eligible = await offerRecipients(client, event.actor_id, event.service_id, event.open_shift_id);
        if (eligible.includes(device.owner_id)) {
          const settings = await fetchRosterSettings(client, device.owner_id);
          const quiet = await recipientsOnNightNow(client, event.actor_id, event.service_id, [device.owner_id]);
          if (settings.alerts.requests && !quiet.has(device.owner_id)) {
            // Lease validation immediately before the external effect; expiry still permits at-least-once delivery after a crash.
            await work("devices");
            const { data: row, error } = await client
              .from("web_push_subscriptions")
              .select("id,owner_id,endpoint,p256dh,auth")
              .eq("id", device.subscription_id)
              .eq("owner_id", device.owner_id)
              .maybeSingle();
            if (error) throw new Error("Offer alert device unavailable");
            const ttl = Math.min(6 * 60 * 60, Math.floor((Date.parse(event.expires_at) - Date.now()) / 1000));
            if (ttl <= 0) break;
            if (row) outcome = await pushRosterOfferDevice(client, row, ttl);
          }
        }
      } catch (error) {
        if (error instanceof OfferLeaseError) throw error;
        outcome = "retry";
      }
      await work("ack", { p_subscription_id: device.subscription_id, p_outcome: outcome });
    }
  } finally {
    await work("release");
  }
}

/** Worker-owned retry consumer; non-overlapping, bounded, and stopped/drained on shutdown. */
export function startRosterOfferAlertConsumer(client: RosterAdminClient, signal: AbortSignal): () => Promise<void> {
  let current: Promise<void> | undefined;
  const tick = () => {
    if (current || signal.aborted || !rosterTeamReleaseEnabled() || !webPushConfigured()) return;
    current = drainRosterOfferAlerts(client, undefined, signal)
      .catch(() => {
        console.warn("Roster offer alert batch unavailable");
      })
      .finally(() => {
        current = undefined;
      });
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  tick();
  return async () => {
    clearInterval(timer);
    await current;
  };
}
