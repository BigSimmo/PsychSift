// src/lib/caring-contacts/referrals.ts
//
// The referral lifecycle (spec §8). `referrals` has an audit trigger that nothing writes to
// today because no referral transition exists yet -- this module is that transition, plus the
// duplicate-referral routing rule that keeps a second qualifying discharge for the same patient
// from ever starting a second concurrent episode while one is already open.
//
// Pure transition module: no ambient time, no storage, no permission check -- the caller has
// already authorised the action.
import type { PathwayVersionId, PatientId, PlanId } from "./ids";
import type { Referral, TransitionResult } from "./model";

export type ReferralAction =
  | { type: "accept"; pathwayVersionId: PathwayVersionId }
  | { type: "returnForClarification"; reason: string }
  | { type: "decline"; reason: string };

export type DuplicateReferralOutcome =
  { type: "createNewEpisode" } | { type: "routeToExistingEpisode"; planId: PlanId };

/**
 * Applies one referral action.
 *
 * Refusals:
 *   * `referral-not-awaiting-handover` -- every action is only legal from `awaitingHandover`.
 *   * `referral-reason-required` -- `returnForClarification` and `decline` require a non-blank
 *     reason.
 *
 * `accept` records the chosen pathway version. `returnForClarification` and `decline` clear
 * `pathwayVersionId` back to `null` -- neither leaves a stale pathway attached to a referral that
 * did not end up accepted onto it.
 */
export function applyReferralTransition(referral: Referral, action: ReferralAction): TransitionResult<Referral> {
  if (referral.state !== "awaitingHandover") return { ok: false, reason: "referral-not-awaiting-handover" };

  switch (action.type) {
    case "accept":
      return { ok: true, value: { ...referral, state: "accepted", pathwayVersionId: action.pathwayVersionId } };

    case "returnForClarification":
      if (action.reason.trim() === "") return { ok: false, reason: "referral-reason-required" };
      return { ok: true, value: { ...referral, state: "returnedForClarification", pathwayVersionId: null } };

    case "decline":
      if (action.reason.trim() === "") return { ok: false, reason: "referral-reason-required" };
      return { ok: true, value: { ...referral, state: "declined", pathwayVersionId: null } };
  }
}

/**
 * Decides whether an incoming referral for `patientId` should start a new episode or be routed
 * to the plan that is already open for that patient. Never mutates anything -- the caller applies
 * whichever outcome this returns.
 */
export function routeIncomingReferral(input: {
  patientId: PatientId;
  existingNonTerminalPlanId: PlanId | null;
}): DuplicateReferralOutcome {
  return input.existingNonTerminalPlanId !== null
    ? { type: "routeToExistingEpisode", planId: input.existingNonTerminalPlanId }
    : { type: "createNewEpisode" };
}
