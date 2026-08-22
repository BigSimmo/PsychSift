// src/lib/caring-contacts/model.ts
import type { ContactId, PathwayVersionId, PatientId, PlanId, ReferralId, TeamId } from "./ids";

export type TransitionResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export type ReferralState = "awaitingHandover" | "accepted" | "returnedForClarification" | "declined";
export type PlanState = "draft" | "active" | "paused" | "withdrawn" | "cancelled" | "completed";
export type ContactState =
  | "scheduled"
  | "processing"
  | "sent"
  | "delivered"
  | "notDelivered"
  | "numberInvalid"
  | "contactChanged"
  | "statusUnavailable"
  | "missed"
  | "suppressed"
  | "cancelled";
export type PathwayVersionState = "draft" | "inReview" | "approved" | "retired";
export type MessageType = "standard" | "first" | "closing";
export type SendingPreference = "morning" | "afternoon" | "earlyEvening";

/**
 * The plan states that end an episode.
 *
 * Exported because it was needed in three places and declared in three places: this module, the
 * in-memory store and the Postgres store each carried their own copy, so "which states are
 * terminal" could be changed in one and not the others. The de-identification policy module's own
 * terminal list is deliberately NOT this constant -- it is declared over the parallel
 * `EpisodeState` union, and the two were kept separate on purpose.
 */
export const TERMINAL_PLAN_STATES: readonly PlanState[] = Object.freeze(["withdrawn", "cancelled", "completed"]);

const TERMINAL_CONTACT_STATES: readonly ContactState[] = ["delivered", "suppressed", "cancelled"];

/**
 * Contact states that mean the message already left. Reporting only -- nothing keys a send off it.
 * Exported for the same reason as `TERMINAL_PLAN_STATES`: both stores had written their own copy.
 */
export const DISPATCHED_CONTACT_STATES: readonly ContactState[] = Object.freeze([
  "sent",
  "delivered",
  "notDelivered",
  "numberInvalid",
  "contactChanged",
  "statusUnavailable",
]);

export type Plan = { id: PlanId; teamId: TeamId; state: PlanState; version: number };
export type Contact = { id: ContactId; planId: PlanId; state: ContactState; version: number };
export type Referral = {
  id: ReferralId;
  teamId: TeamId;
  patientId: PatientId;
  state: ReferralState;
  pathwayVersionId: PathwayVersionId | null;
};

export type PlanAction =
  | { type: "activate" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "withdraw" }
  | { type: "cancel" }
  | { type: "complete" };

export function applyPlanTransition(plan: Plan, action: PlanAction): TransitionResult<Plan> {
  if (TERMINAL_PLAN_STATES.includes(plan.state)) return { ok: false, reason: "plan-terminal" };
  const advance = (state: PlanState): TransitionResult<Plan> => ({
    ok: true,
    value: { ...plan, state, version: plan.version + 1 },
  });
  switch (action.type) {
    case "activate":
      return plan.state === "draft" ? advance("active") : { ok: false, reason: "plan-not-draft" };
    case "pause":
      return plan.state === "active" ? advance("paused") : { ok: false, reason: "plan-not-active" };
    case "resume":
      return plan.state === "paused" ? advance("active") : { ok: false, reason: "plan-not-paused" };
    case "withdraw":
      return plan.state === "active" || plan.state === "paused"
        ? advance("withdrawn")
        : { ok: false, reason: "plan-not-withdrawable" };
    case "cancel":
      return advance("cancelled");
    case "complete":
      return plan.state === "active" ? advance("completed") : { ok: false, reason: "plan-not-active" };
  }
}

export type ProviderStatus = "delivered" | "notDelivered" | "numberInvalid" | "contactChanged" | "statusUnavailable";

export type ContactAction =
  | { type: "startProcessing" }
  | { type: "markSent" }
  | { type: "providerStatus"; status: ProviderStatus }
  | { type: "suppress" }
  | { type: "cancel" }
  | { type: "markMissed" };

export function applyContactTransition(contact: Contact, action: ContactAction): TransitionResult<Contact> {
  if (TERMINAL_CONTACT_STATES.includes(contact.state)) return { ok: false, reason: "contact-terminal" };
  const advance = (state: ContactState): TransitionResult<Contact> => ({
    ok: true,
    value: { ...contact, state, version: contact.version + 1 },
  });
  switch (action.type) {
    case "startProcessing":
      return contact.state === "scheduled" ? advance("processing") : { ok: false, reason: "contact-not-scheduled" };
    case "markSent":
      return contact.state === "processing" ? advance("sent") : { ok: false, reason: "contact-not-processing" };
    case "providerStatus":
      return contact.state === "sent" ? advance(action.status) : { ok: false, reason: "contact-out-of-order" };
    case "suppress":
      return advance("suppressed");
    case "cancel":
      return advance("cancelled");
    case "markMissed":
      // `processing` is accepted as well as `scheduled`. A provider timeout leaves a contact in
      // `processing` having sent nothing, and without this it had no exit at all: `markSent` would
      // claim a message that never left, `cancel` would say the plan stopped it, and the contact
      // would sit in `processing` for ever -- neither sent nor accounted for. Recording it missed
      // is the truthful ending, and it sends nothing.
      return contact.state === "scheduled" || contact.state === "processing"
        ? advance("missed")
        : { ok: false, reason: "contact-not-missable" };
  }
}
