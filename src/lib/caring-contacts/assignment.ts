// src/lib/caring-contacts/assignment.ts
//
// Plan ownership, reassignment, and coverage (spec §4.2, §4.3). `claimPlan` and `reassignPlan`
// are granted action names with no field to record them against, which is why the workload
// monitor ("active plans per coordinator") is currently uncomputable -- this module is that
// field and its transitions.
//
// Coverage windows are AWST calendar days in YYYY-MM-DD form, matching `PlannedContact.calendarDay`
// (see ./schedule) -- not full ISO instants. `effectiveResponder` compares calendar days for
// exactly that reason: a coordinator names "covering from the 20th to the 27th", not an instant.
//
// A reassignment never deletes the previous owner -- it is appended to `reassignmentHistory`, so
// spec §4.3's "named coordinator and any formal reassignment still visible" stays true. Coverage
// never touches `ownerId` at all: the named coordinator stays visible behind whoever is covering,
// and ends automatically once `atIso`'s calendar day moves past the window.
//
// Pure transition module: no ambient time beyond the injected `Clock`, no storage, no permission
// check -- the caller has already authorised the action.
import { awstCalendarDay, awstIsoTimestamp, type Clock } from "./clock";
import type { ActorId } from "./ids";
import type { TransitionResult } from "./model";
import { isAwstCalendarDay } from "./schedule";

export type PlanAssignment = {
  ownerId: ActorId | null;
  claimedAt: string | null;
  coveredBy: { actorId: ActorId; from: string; until: string } | null;
  reassignmentHistory: readonly { fromActorId: ActorId; toActorId: ActorId; reason: string; at: string }[];
};

export type AssignmentAction =
  | { type: "claim"; actorId: ActorId }
  | { type: "reassign"; toActorId: ActorId; reason: string }
  | { type: "startCoverage"; actorId: ActorId; from: string; until: string }
  | { type: "endCoverage" };

/** The spec's 60-minute unclaimed-work escalation threshold. */
export const UNCLAIMED_ESCALATION_MINUTES = 60;

export function unassigned(): PlanAssignment {
  return { ownerId: null, claimedAt: null, coveredBy: null, reassignmentHistory: [] };
}

/**
 * Applies one ownership/coverage action.
 *
 * Refusals:
 *   * `plan-already-claimed` -- `claim` is only legal while there is no owner.
 *   * `plan-not-claimed` -- `reassign` and `startCoverage` both require an existing owner; there
 *     is nobody to reassign from or cover for otherwise.
 *   * `reassignment-reason-required` -- `reassign` requires a non-blank reason.
 *   * `coverage-window-not-calendar-day` -- `startCoverage` requires both ends to be real AWST
 *     calendar days in `YYYY-MM-DD` form. Checked BEFORE the ordering, because `until > from` is a
 *     lexical string compare that any pair of words satisfies: `"cherry" > "banana"` is true, so a
 *     window of nonsense used to be accepted and stored, and `effectiveResponder` -- which compares
 *     these as calendar days -- then silently named the wrong person. The Postgres schema's own
 *     `~ '^\d{4}-\d{2}-\d{2}$'` check caught the same input by raising, which is a throw where this
 *     domain's convention is a named refusal, and it meant the two stores answered one malformed
 *     request two different ways.
 *   * `coverage-window-invalid` -- `startCoverage` requires `until` strictly after `from`.
 *
 * `reassign` appends to `reassignmentHistory` and keeps the full history -- a reassignment never
 * deletes the earlier owner. `startCoverage` never changes `ownerId`. `endCoverage` always
 * succeeds and clears `coveredBy`.
 */
export function applyAssignmentAction(
  assignment: PlanAssignment,
  action: AssignmentAction,
  clock: Clock,
): TransitionResult<PlanAssignment> {
  switch (action.type) {
    case "claim": {
      if (assignment.ownerId !== null) return { ok: false, reason: "plan-already-claimed" };
      return {
        ok: true,
        value: { ...assignment, ownerId: action.actorId, claimedAt: awstIsoTimestamp(clock.now()) },
      };
    }

    case "reassign": {
      if (assignment.ownerId === null) return { ok: false, reason: "plan-not-claimed" };
      if (action.reason.trim() === "") return { ok: false, reason: "reassignment-reason-required" };

      const entry = {
        fromActorId: assignment.ownerId,
        toActorId: action.toActorId,
        reason: action.reason,
        at: awstIsoTimestamp(clock.now()),
      };
      return {
        ok: true,
        value: {
          ...assignment,
          ownerId: action.toActorId,
          reassignmentHistory: [...assignment.reassignmentHistory, entry],
        },
      };
    }

    case "startCoverage": {
      if (assignment.ownerId === null) return { ok: false, reason: "plan-not-claimed" };
      // Shape before ordering. The ordering test below is a lexical string compare, so it cannot
      // tell a malformed window from an ordered one -- see the refusal list above.
      if (!isAwstCalendarDay(action.from) || !isAwstCalendarDay(action.until)) {
        return { ok: false, reason: "coverage-window-not-calendar-day" };
      }
      if (!(action.until > action.from)) return { ok: false, reason: "coverage-window-invalid" };
      return {
        ok: true,
        value: { ...assignment, coveredBy: { actorId: action.actorId, from: action.from, until: action.until } },
      };
    }

    case "endCoverage":
      return { ok: true, value: { ...assignment, coveredBy: null } };
  }
}

/**
 * The actor who should actually respond at `atIso`: the coverer when `atIso`'s AWST calendar day
 * falls within the coverage window, the named owner otherwise. Coverage windows are AWST calendar
 * days (YYYY-MM-DD), so `atIso` is compared by calendar day, not by instant.
 */
export function effectiveResponder(assignment: PlanAssignment, atIso: string): ActorId | null {
  const { coveredBy } = assignment;
  if (coveredBy === null) return assignment.ownerId;

  const day = atIso.length === 10 ? atIso : awstCalendarDay(new Date(atIso));
  return day >= coveredBy.from && day <= coveredBy.until ? coveredBy.actorId : assignment.ownerId;
}

/** Whole minutes elapsed between `claimableSinceIso` and `nowIso`, floored, never negative. */
export function queueAgeMinutes(claimableSinceIso: string, nowIso: string): number {
  const elapsedMs = new Date(nowIso).getTime() - new Date(claimableSinceIso).getTime();
  return Math.max(0, Math.floor(elapsedMs / 60_000));
}
