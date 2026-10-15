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

export async function dispatchRosterAlerts(client: RosterAdminClient, event: RosterAlertEvent): Promise<void> {
  if (!webPushConfigured()) return;
  try {
    const result = resultOf(event.result);
    if (result.status === "cancelled" || result.status === "expired") return;
    // A repeat of a post the server had already saved (the phone never heard back the first time):
    // its alerts went out with the first post, so they are never sent twice.
    if (result.replayed === true) return;
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
    if (!eligible.length) return;
    const quiet =
      type === "changed"
        ? new Set<string>()
        : await recipientsOnNightNow(client, event.actorId, event.serviceId, eligible);
    await sendRosterAlerts(client, eligible, type, quiet);
  } catch {
    // A phone alert must never turn a successful roster change into an error.
    // No identity, endpoint or payload is logged here.
  }
}
