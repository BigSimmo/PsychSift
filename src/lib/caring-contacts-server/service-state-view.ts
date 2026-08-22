// src/lib/caring-contacts-server/service-state-view.ts
//
// Ruling 43: the service-state read is narrowed HERE, at the API boundary, and nowhere else.
//
// `getServiceState` is deliberately not capability-checked in either store. It must not be: the
// safety stop is service-wide (Ruling 9), so a team that had no part in an incident still has to
// learn that sending is halted, on every screen, including screens with no patient in view. The
// record it hands back, however, carries `note` -- free text a responder writes mid-incident,
// naming which message and which patient -- and the schema classifies that as patient data.
//
// Narrowing it inside the store was rejected: every in-store shape was either a lie (an empty
// string reads as "no note was written", when the domain refuses a blank note outright) or an
// improvised change to a sealed safety type. So the store keeps returning the whole truth and this
// boundary decides what may be released. The two halves are equally binding:
//
//   * the note never reaches an actor without the capability to see incident detail;
//   * the stopped FACT, its reason category, and its timing reach every actor of every team.
//
// The withheld case says so explicitly rather than omitting the field, because "no note" and "a
// note you may not see" are different facts and only one of them is true here.
import "server-only";

import type { ActorId } from "@/lib/caring-contacts/ids";
import { canPerformCaringContactAction, type CaringContactActor } from "@/lib/caring-contacts/permissions";
import {
  describeServiceStop,
  type ServiceRestartApproval,
  type ServiceRestartOutcome,
  type ServiceState,
  type ServiceStopReason,
} from "@/lib/caring-contacts/service-state";

/** Who recorded the incident and what they wrote, or the named reason it is being withheld. */
export type ServiceIncidentDetail =
  { visible: true; stoppedBy: ActorId; note: string } | { visible: false; withheldReason: string };

export type ServiceStateView =
  | { stopped: false; banner: null }
  | {
      stopped: true;
      reason: ServiceStopReason;
      /** AWST ISO-8601 instant with an explicit `+08:00` offset. */
      stoppedAt: string;
      restartApprovals: readonly ServiceRestartApproval[];
      banner: string | null;
      incidentDetail: ServiceIncidentDetail;
    };

/**
 * The reply to a recorded restart approval (Ruling 65).
 *
 * It takes NO actor, and that is the point: `approveServiceRestart` now returns
 * `ServiceRestartOutcome`, which carries no note, no `stoppedBy` and no reporting team, so there is
 * nothing here left to gate. `narrowServiceStateForActor` below is a boundary that decides what may
 * be released; this is a value that has nothing to withhold — a strictly stronger position, and the
 * one that also cleans up the store's persisted replay result, which no API boundary can reach.
 *
 * It is deliberately NOT a `ServiceStateView`. Reusing that type would force an `incidentDetail` of
 * `{ visible: false, withheldReason: … }`, which says "there is a note you may not see" — a
 * different fact from "this reply does not carry one", and the wrong one for a reporting-team
 * approver who may in fact read it through the GET.
 */
export type ServiceRestartView =
  | { stopped: false; banner: null }
  | {
      stopped: true;
      reason: ServiceStopReason;
      /** AWST ISO-8601 instant with an explicit `+08:00` offset. */
      stoppedAt: string;
      restartApprovals: readonly ServiceRestartApproval[];
      banner: string | null;
    };

export function viewRestartOutcome(outcome: ServiceRestartOutcome): ServiceRestartView {
  if (!outcome.stopped) return { stopped: false, banner: null };
  return {
    stopped: true,
    reason: outcome.reason,
    stoppedAt: outcome.stoppedAt,
    restartApprovals: outcome.restartApprovals,
    banner: describeServiceStop({
      stopped: true,
      reason: outcome.reason,
      restartApprovals: outcome.restartApprovals,
    }),
  };
}

/**
 * The capability that gates incident detail. The note is patient data, so the actor needs the
 * patient-record capability FOR THE REPORTING TEAM -- passing `state.reportedByTeamId` as the
 * resource makes `canPerformCaringContactAction` answer the team question and the role question in
 * one decision, using the sealed grant table rather than a rule restated here.
 */
export function narrowServiceStateForActor(state: ServiceState, actor: CaringContactActor): ServiceStateView {
  if (!state.stopped) return { stopped: false, banner: null };

  const decision = canPerformCaringContactAction(actor, "viewPatientRecord", { teamId: state.reportedByTeamId });

  return {
    stopped: true,
    reason: state.reason,
    stoppedAt: state.stoppedAt,
    restartApprovals: state.restartApprovals,
    // `describeServiceStop` takes `ServiceStopBannerFacts`, whose type omits `note` by
    // construction, so the banner cannot interpolate it even by accident.
    banner: describeServiceStop({
      stopped: true,
      reason: state.reason,
      restartApprovals: state.restartApprovals,
    }),
    incidentDetail: decision.allowed
      ? { visible: true, stoppedBy: state.stoppedBy, note: state.note }
      : { visible: false, withheldReason: decision.reason },
  };
}
