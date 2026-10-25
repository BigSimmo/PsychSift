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

/** How long worker shutdown waits for an in-flight offer alert batch before leaving it to lease expiry. */
export const ROSTER_OFFER_STOP_GRACE_MS = 15_000;

/** One bounded batch. No process-local delivery authority and no legacy fan-out fallback. */
export async function drainRosterOfferAlerts(
  client: RosterAdminClient,
  openShiftId?: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!rosterTeamReleaseEnabled() || !webPushConfigured() || signal?.aborted) return false;
  const claimed = await client.rpc("roster_offer_alert_work", {
    p_operation: "claim",
    ...(openShiftId ? { p_open_shift_id: openShiftId } : {}),
  });
  if (claimed.error) throw new Error("Offer alert claim unavailable");
  if (!claimed.data) return false;
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
  let unwinding = false;
  try {
    let eligible = await offerRecipients(client, event.actor_id, event.service_id, event.open_shift_id);
    if (!event.initialized) await work("prepare", { p_owner_ids: eligible });
    const deadline = Date.now() + 8 * 60 * 1000;
    while (!signal?.aborted && Date.now() < deadline) {
      const devices = devicesSchema.parse(await work("devices"));
      if (!devices.length) break;
      for (const device of devices) {
        if (signal?.aborted || Date.now() >= deadline) break;
        let outcome: "sent" | "skipped" | "retry" = "skipped";
        try {
          // Eligibility can change while earlier devices are being sent.
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
              // Expired: stop the whole batch, not just this page; finally still releases the lease.
              if (ttl <= 0) return true;
              if (row) outcome = await pushRosterOfferDevice(client, row, ttl);
            }
          }
        } catch (error) {
          if (error instanceof OfferLeaseError) throw error;
          outcome = "retry";
        }
        await work("ack", { p_subscription_id: device.subscription_id, p_outcome: outcome });
      }
    }
  } catch (error) {
    unwinding = true;
    throw error;
  } finally {
    try {
      await work("release");
    } catch (releaseError) {
      // A lost lease on release must not hide the failure that is already unwinding; lease expiry
      // still frees the claim.
      if (!unwinding) throw releaseError;
    }
  }
  return true;
}

/** Worker-owned retry consumer; non-overlapping, bounded, and stopped/drained on shutdown. */
export function startRosterOfferAlertConsumer(
  client: RosterAdminClient,
  workerSignal: AbortSignal,
): () => Promise<void> {
  let current: Promise<void> | undefined;
  // The returned stop function aborts this too, so a one-shot (--once) worker, whose own signal never fires
  // when its job loop simply finishes, does not wait out a long drain before exiting.
  const stopController = new AbortController();
  const signal = AbortSignal.any([workerSignal, stopController.signal]);
  const tick = () => {
    if (current || signal.aborted || !rosterTeamReleaseEnabled() || !webPushConfigured()) return;
    current = (async () => {
      const deadline = Date.now() + 50_000;
      while (!signal.aborted && Date.now() < deadline) {
        try {
          const claimed = await drainRosterOfferAlerts(client, undefined, signal);
          if (!claimed) break;
        } catch (error) {
          const reported = error instanceof Error ? error : new Error("Unknown offer alert failure");
          console.warn("Roster offer alert batch unavailable", {
            type: reported.name.slice(0, 80),
            message: reported.message.slice(0, 200),
            stack: reported.stack?.slice(0, 2000),
          });
          break;
        }
      }
    })().finally(() => {
      current = undefined;
    });
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  tick();
  return async () => {
    clearInterval(timer);
    stopController.abort();
    // A stalled push or RPC must not hold worker shutdown open. The claim is a lease that expires on its
    // own, so an abandoned batch is retried later (at-least-once) rather than lost.
    if (!current) return;
    let grace: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      current,
      new Promise<void>((resolve) => {
        grace = setTimeout(resolve, ROSTER_OFFER_STOP_GRACE_MS);
        grace.unref?.();
      }),
    ]);
    clearTimeout(grace);
  };
}
