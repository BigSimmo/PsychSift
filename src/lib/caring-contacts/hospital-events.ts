// src/lib/caring-contacts/hospital-events.ts
//
// Hospital status events applied to a caring-contact plan.
//
// Clinical contract (decision lock, 2026-08-19):
//   * a recorded death cancels the plan and every contact that has not gone out, and nothing
//     afterwards may move that plan — not a readmission, not a correction, not a pause request;
//   * a correction to a recorded death raises an incident for human review; it never resumes the
//     episode, because resuming would put messages back in flight off the back of a data fix;
//   * a readmission and a changed mobile number pause the plan; neither rebases the calendar and
//     neither resumes on its own;
//   * a third party may stop the messages temporarily, but may never end a service the patient
//     chose — the withdrawal path refuses them by name;
//   * every refusal is a named reason. Nothing here throws, and nothing fails silently.
//
// This module composes the plan lifecycle in `./model`; it does not reimplement it.
// Pure and deterministic: the same input always yields byte-identical output.
import { applyPlanTransition, type Plan, type TransitionResult } from "./model";
import type { PlannedContact } from "./schedule";

export type HospitalStatusEvent =
  | { type: "readmission" }
  | { type: "death"; recordedAt: Date }
  | { type: "deathCorrection" }
  | { type: "mobileChanged" }
  | { type: "thirdPartyPauseRequest"; requester: string; relationship: string; note: string };

/** Something a human must look at. Exceptions never change what the plan state machine did. */
export type PlanException =
  | { type: "contactChanged" }
  | { type: "thirdPartyPause"; requester: string; relationship: string; note: string }
  | { type: "deathRecordedAtUnusable" };

/** A governance-level event that outlives the plan. */
export type PlanIncident = { type: "deathCorrection"; episodeResumed: false; requiresNewReferral: true };

/**
 * What must happen to the planned contacts. The caller applies this to stored contacts; this
 * module stays pure and never reaches for a datastore.
 */
export type ContactOutcome =
  | { type: "unchanged" }
  | { type: "holdFuture" }
  | { type: "stopAll" }
  | { type: "cancelUnsent"; recordedAt: Date; irreversible: true };

export type PlanTransition = {
  plan: Plan;
  exceptions: PlanException[];
  incident?: PlanIncident;
  contactOutcome: ContactOutcome;
};

export type WithdrawalOrigin = "patient" | "clinician" | "thirdParty";
export type WithdrawalRequest = { origin: WithdrawalOrigin };

// Type-only: the pause-raising event kinds are never needed as a runtime value, so this is a union
// rather than an `as const` array whose value would sit unused in the bundle.
type PauseEventType = "readmission" | "mobileChanged" | "thirdPartyPauseRequest";
const WITHDRAWAL_ORIGINS: readonly string[] = ["patient", "clinician", "thirdParty"];

/**
 * The planned contacts that would actually go out.
 *
 * A suppressed entry still carries a real `sendAt` — it was kept so the interface can explain the
 * plan, not so it can be sent. Sendability is therefore decided by `suppressed` and never by the
 * presence of `sendAt`. Keying off `sendAt` here would put two caring contacts on one day.
 */
export function sendableContacts(contacts: readonly PlannedContact[]): PlannedContact[] {
  return contacts.filter((contact) => contact.suppressed === undefined);
}

function isUsableInstant(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Pauses the plan without moving an already-paused one. Returning the plan untouched is what makes
 * a repeated pause request idempotent rather than a version bump with no meaning.
 */
function holdPlan(plan: Plan): TransitionResult<{ plan: Plan; alreadyHeld: boolean }> {
  if (plan.state === "paused") return { ok: true, value: { plan, alreadyHeld: true } };
  const paused = applyPlanTransition(plan, { type: "pause" });
  if (!paused.ok) return paused;
  return { ok: true, value: { plan: paused.value, alreadyHeld: false } };
}

/**
 * A recorded death. This is the path that must never fail open: an unusable timestamp is reported
 * as an exception, but it does not stop the cancellation, because a message arriving after a death
 * is the worst thing this system can do.
 */
function applyDeath(plan: Plan, recordedAt: Date): TransitionResult<PlanTransition> {
  const cancelled = applyPlanTransition(plan, { type: "cancel" });
  if (!cancelled.ok) return cancelled;

  const exceptions: PlanException[] = isUsableInstant(recordedAt) ? [] : [{ type: "deathRecordedAtUnusable" }];

  return {
    ok: true,
    value: {
      plan: cancelled.value,
      exceptions,
      contactOutcome: { type: "cancelUnsent", recordedAt, irreversible: true },
    },
  };
}

/**
 * A correction to a recorded death. The plan is deliberately left exactly where the death left it:
 * the episode does not resume, and any future plan starts from a fresh referral.
 */
function applyDeathCorrection(plan: Plan): TransitionResult<PlanTransition> {
  if (plan.state !== "cancelled") return { ok: false, reason: "death-correction-without-cancellation" };

  return {
    ok: true,
    value: {
      plan,
      exceptions: [],
      incident: { type: "deathCorrection", episodeResumed: false, requiresNewReferral: true },
      contactOutcome: { type: "unchanged" },
    },
  };
}

function applyPauseEvent(
  plan: Plan,
  event: Extract<HospitalStatusEvent, { type: PauseEventType }>,
): TransitionResult<PlanTransition> {
  const held = holdPlan(plan);
  if (!held.ok) return held;

  const exceptions: PlanException[] = [];

  if (event.type === "mobileChanged") {
    // Raised every time, even on an already-paused plan: a destination change must never be
    // swallowed, and nothing here switches the destination on its own.
    exceptions.push({ type: "contactChanged" });
  }

  if (event.type === "thirdPartyPauseRequest" && !held.value.alreadyHeld) {
    exceptions.push({
      type: "thirdPartyPause",
      requester: event.requester,
      relationship: event.relationship,
      note: event.note,
    });
  }

  // A readmission raises nothing and, deliberately, changes no date: the twelve-month calendar
  // stays anchored where it was and nothing resumes without a human.
  return { ok: true, value: { plan: held.value.plan, exceptions, contactOutcome: { type: "holdFuture" } } };
}

export function applyHospitalStatusEvent(plan: Plan, event: HospitalStatusEvent): TransitionResult<PlanTransition> {
  switch (event.type) {
    case "death":
      return applyDeath(plan, event.recordedAt);
    case "deathCorrection":
      return applyDeathCorrection(plan);
    case "readmission":
    case "mobileChanged":
    case "thirdPartyPauseRequest":
      return applyPauseEvent(plan, event);
    default:
      return { ok: false, reason: "unknown-hospital-status-event" };
  }
}

/**
 * Ending the service. A third party is refused before anything else is considered: the identity of
 * the requester is the reason, so the refusal must not depend on the plan's state.
 */
export function applyWithdrawalRequest(plan: Plan, request: WithdrawalRequest): TransitionResult<PlanTransition> {
  if (request.origin === "thirdParty") return { ok: false, reason: "third-party-withdrawal-refused" };
  if (!WITHDRAWAL_ORIGINS.includes(request.origin)) return { ok: false, reason: "unknown-withdrawal-origin" };

  const withdrawn = applyPlanTransition(plan, { type: "withdraw" });
  if (!withdrawn.ok) return withdrawn;

  return { ok: true, value: { plan: withdrawn.value, exceptions: [], contactOutcome: { type: "stopAll" } } };
}
