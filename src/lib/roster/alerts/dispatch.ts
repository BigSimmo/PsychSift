import type { RosterAdminClient } from "@/lib/roster/team/api";
import type { RosterAction } from "@/lib/roster/team/model";
import { addDaysToDate, perthDateOf } from "@/lib/roster/shifts/perth-time";
import { openShiftCandidates } from "@/lib/roster/team/eligibility";
import { rosterRead } from "@/lib/roster/team/repository";

import type { RosterAlertType } from "./messages";
import { recipientsOnNightNow } from "./night";
import { activeRecipientIds, openParties, previousOpenHolder, swapParties } from "./recipients";
import { sendRosterAlerts, webPushConfigured } from "./send";

/** Phone alerts for a completed team change; failures never affect that change. */
export type RosterAlertEvent = {
  readonly serviceId: string;
  readonly actorId: string;
  readonly action: RosterAction | { readonly action: "publish" } | { readonly action: "remind" };
  readonly result: unknown;
  /** `open.decline` clears the claimer in SQL, so the route reads it first. */
  readonly before?: { readonly claimedBy: string | null };
};

function resultOf(value: unknown): {
  status?: string;
  swapId?: string;
  openShiftId?: string;
  replayed?: boolean;
  recipientIds?: string[];
  changedUserIds?: string[];
  swapsCancelled?: { requesterId?: string; counterpartyId?: string }[];
} {
  return value && typeof value === "object" ? (value as ReturnType<typeof resultOf>) : {};
}

const deliveredOpenPostAlerts = new Set<string>();
const pendingOrFailedOpenPostAlerts = new Set<string>();
const inFlightOpenPostAlerts = new Map<string, Promise<void>>();

function openPostAlertKey(serviceId: string, openShiftId: string): string {
  return `${serviceId}:${openShiftId}`;
}

async function isOpenPostAlertDelivered(
  client: RosterAdminClient,
  serviceId: string,
  openShiftId: string,
  replayed: boolean,
): Promise<boolean> {
  const key = openPostAlertKey(serviceId, openShiftId);
  if (deliveredOpenPostAlerts.has(key)) return true;
  try {
    const fromFn = (client as unknown as { from?: (table: string) => unknown })?.from;
    if (typeof fromFn === "function") {
      const table = fromFn.call(client, "roster_open_post_alerts") as {
        select?: (columns: string) => {
          eq?: (
            col: string,
            val: string,
          ) => {
            eq?: (
              col2: string,
              val2: string,
            ) => {
              maybeSingle?: () => Promise<{
                data: { open_shift_id?: string } | null;
                error: unknown;
              }>;
            };
          };
        };
      } | null;
      const query = table?.select?.("open_shift_id")?.eq?.("service_id", serviceId)?.eq?.("open_shift_id", openShiftId);
      if (query && typeof query.maybeSingle === "function") {
        const { data, error } = await query.maybeSingle();
        if (error) return false;
        if (data?.open_shift_id) {
          deliveredOpenPostAlerts.add(key);
          pendingOrFailedOpenPostAlerts.delete(key);
          return true;
        }
        return false;
      }
    }
  } catch {
    // Fall back to in-memory tracking when the table query is unavailable.
  }
  if (pendingOrFailedOpenPostAlerts.has(key)) return false;
  return replayed;
}

async function markOpenPostAlertDelivered(
  client: RosterAdminClient,
  serviceId: string,
  openShiftId: string,
): Promise<void> {
  const key = openPostAlertKey(serviceId, openShiftId);
  deliveredOpenPostAlerts.add(key);
  pendingOrFailedOpenPostAlerts.delete(key);
  try {
    const fromFn = (client as unknown as { from?: (table: string) => unknown })?.from;
    if (typeof fromFn === "function") {
      const table = fromFn.call(client, "roster_open_post_alerts") as {
        upsert?: (
          values: { service_id: string; open_shift_id: string; delivered_at: string },
          options: { onConflict: string },
        ) => Promise<unknown>;
      } | null;
      const result = await table?.upsert?.(
        {
          service_id: serviceId,
          open_shift_id: openShiftId,
          delivered_at: new Date().toISOString(),
        },
        { onConflict: "service_id,open_shift_id" },
      );
      if (result && typeof result === "object" && "error" in result && result.error) {
        pendingOrFailedOpenPostAlerts.add(key);
        return;
      }
    }
    deliveredOpenPostAlerts.add(key);
    pendingOrFailedOpenPostAlerts.delete(key);
  } catch {
    pendingOrFailedOpenPostAlerts.add(key);
  }
}

async function runRosterAlertDispatch(
  client: RosterAdminClient,
  event: RosterAlertEvent,
  result: ReturnType<typeof resultOf>,
  isOpenPostOffer: boolean,
): Promise<void> {
  // The overview checks the actor's team access. G3's manager list is the
  // only authority for manager alerts; active membership is checked below.
  const overview = await rosterRead(client, event.actorId, event.serviceId, "overview");
  const managers = (overview.managers ?? []).map((person) => person.userId);
  const action = event.action.action;
  let type: RosterAlertType | null = null;
  let recipients: (string | null | undefined)[] = [];

  if (action.startsWith("swap.") && result.swapId) {
    const parties = await swapParties(client, event.serviceId, result.swapId);
    if (!parties) return;
    if (action === "swap.create") {
      type = "request";
      recipients = [parties.counterpartyId];
    } else if (action === "swap.accept" && result.status === "accepted") {
      type = "manage";
      recipients = managers;
    } else if (action === "swap.accept" && result.status === "approved") {
      type = "changed";
      recipients = [parties.requesterId];
    } else if (action === "swap.approve") {
      type = "changed";
      recipients = [parties.requesterId, parties.counterpartyId];
    } else if (action === "swap.decline") {
      type = "request";
      recipients = [parties.requesterId];
    } else if (action === "swap.undo") {
      type = "changed";
      recipients = [parties.requesterId === event.actorId ? parties.counterpartyId : parties.requesterId];
    }
  } else if (action.startsWith("open.") && result.openShiftId) {
    const open = await openParties(client, event.serviceId, result.openShiftId);
    if (!open) return;
    if ((action === "open.post" && result.status === "open") || action === "open.release") {
      type = "offer";
      const date = perthDateOf(open.starts_at);
      const assignments = await rosterRead(client, event.actorId, event.serviceId, "assignments", {
        from: addDaysToDate(date, -7),
        to: addDaysToDate(date, 7),
      });
      recipients = openShiftCandidates(
        assignments.assignments,
        {
          startsAt: open.starts_at,
          endsAt: open.ends_at,
          minGrade: open.min_grade as never,
          assignmentId: open.assignment_id,
        },
        overview.settings,
        open.posted_by,
      ).map((candidate) => candidate.userId);
    } else if (action === "open.report" || (action === "open.claim" && result.status === "claimed")) {
      type = "manage";
      recipients = managers;
    } else if ((action === "open.claim" && result.status === "approved") || action === "open.approve") {
      type = "changed";
      recipients = [open.claimed_by, await previousOpenHolder(client, event.serviceId, result.openShiftId)];
    } else if (action === "open.decline") {
      type = "request";
      recipients = [event.before?.claimedBy];
    }
  } else if (action === "remind") {
    type = "changed";
    recipients = Array.isArray(result.recipientIds) ? result.recipientIds : [];
  } else if (action === "publish") {
    // Publish may only alert user ids the publishing route supplies from its
    // reviewed change set. A result with counts alone is not a recipient list.
    type = "changed";
    recipients = [
      ...(Array.isArray(result.changedUserIds) ? result.changedUserIds : []),
      ...(Array.isArray(result.swapsCancelled)
        ? result.swapsCancelled.flatMap((swap) => [swap.requesterId, swap.counterpartyId])
        : []),
    ];
  }
  if (!type) return;
  const candidateIds = [
    ...new Set(recipients.filter((id): id is string => typeof id === "string" && id !== event.actorId)),
  ].slice(0, 500);
  const active = await activeRecipientIds(client, event.serviceId, candidateIds);
  const eligible = candidateIds.filter((id) => active.has(id));
  if (!eligible.length) {
    if (isOpenPostOffer && result.openShiftId) {
      await markOpenPostAlertDelivered(client, event.serviceId, result.openShiftId);
    }
    return;
  }
  const quiet =
    type === "changed"
      ? new Set<string>()
      : await recipientsOnNightNow(client, event.actorId, event.serviceId, eligible);
  const delivery = await sendRosterAlerts(client, eligible, type, quiet);
  if (isOpenPostOffer && result.openShiftId && (delivery?.failed ?? 0) === 0) {
    await markOpenPostAlertDelivered(client, event.serviceId, result.openShiftId);
  }
}

export async function dispatchRosterAlerts(client: RosterAdminClient, event: RosterAlertEvent): Promise<void> {
  if (!webPushConfigured()) return;
  try {
    const result = resultOf(event.result);
    if (result.status === "cancelled" || result.status === "expired") return;
    const action = event.action.action;
    const isOpenPostOffer = action === "open.post" && result.status === "open" && Boolean(result.openShiftId);
    // A repeat of a post the server had already saved: for open.post we check
    // whether the offer alert actually completed delivery before skipping.
    if (!isOpenPostOffer && result.replayed === true) return;

    if (isOpenPostOffer && result.openShiftId) {
      const key = openPostAlertKey(event.serviceId, result.openShiftId);
      const existingInFlight = inFlightOpenPostAlerts.get(key);
      if (existingInFlight) {
        await existingInFlight.catch(() => undefined);
      }
      if (await isOpenPostAlertDelivered(client, event.serviceId, result.openShiftId, result.replayed === true)) {
        return;
      }
      pendingOrFailedOpenPostAlerts.add(key);
      const runPromise = runRosterAlertDispatch(client, event, result, true);
      inFlightOpenPostAlerts.set(key, runPromise);
      try {
        await runPromise;
      } finally {
        if (inFlightOpenPostAlerts.get(key) === runPromise) {
          inFlightOpenPostAlerts.delete(key);
        }
      }
      return;
    }

    await runRosterAlertDispatch(client, event, result, false);
  } catch {
    // A phone alert must never turn a successful roster change into an error.
    // No identity, endpoint or payload is logged here.
  }
}
