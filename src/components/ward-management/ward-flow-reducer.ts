import { EVENT_ROLE, type WardFlowEvent, type WardFlowRole } from "@/components/ward-management/ward-flow-events";
import { FORM_1A_REFERRAL_EXPIRY_MINUTES, PARALLEL_REFERRAL_CAP } from "@/components/ward-management/ward-model";
import type { Movement, MovementStage, Rejection, Unit } from "@/components/ward-management/ward-model";
import { wardMovements } from "@/components/ward-management/ward-movements";
import { allEmergencyDepartments, allUnits } from "@/components/ward-management/ward-sites";

/**
 * Stages `REFER_TO_UNITS` accepts, exported so a UI surface can pre-check referability and gate
 * its own control before dispatching — never optimistically claim a referral happened and let
 * this be the thing that silently refuses it (Task 5 fix round 1: `ShortlistPanel` used to
 * dispatch and unconditionally render success, so a movement at, say, `bed_held` — still open,
 * still offering eligible candidates — showed "Referred by a human coordinator" while nothing
 * had happened). A single shared constant, used here AND by `ward-derivations.ts`'s
 * `referralBlockedReason`, so the two checks can never drift apart.
 */
export const REFERRABLE_MOVEMENT_STAGES: readonly MovementStage[] = ["placement_requested", "destination_review"];

/**
 * The whole of Task 3 onward is proved against this shape. Units live in state, not just
 * movements — the correction the design spec calls out explicitly: a ward that accepts, holds
 * and receives a patient with capacity that never moves makes the primary screen less true the
 * more it is used.
 */
export type WardFlowState = {
  movements: Movement[];
  units: Unit[];
  /** Refused transitions, newest first. */
  rejections: Rejection[];
  /** Demo jump-forward control. `now` is NOW_ANCHOR + elapsed + this offset, derived outside the reducer. */
  clockOffsetMinutes: number;
  /** Deterministic id source for referrals raised through RAISE_REFERRAL. No Math.random(). */
  referralSequence: number;
};

/** Deep-copies the frozen fixture so tests (and later, screens) never alias or mutate it. */
export function seedWardFlowState(): WardFlowState {
  return {
    movements: structuredClone(wardMovements),
    units: structuredClone(allUnits()),
    rejections: [],
    clockOffsetMinutes: 0,
    referralSequence: 0,
  };
}

/** The id a rejection is filed against, for events that are not about one specific movement. */
function subjectId(event: WardFlowEvent): string {
  switch (event.type) {
    case "RAISE_REFERRAL":
      return event.edId;
    case "CONFIRM_CAPACITY":
      return event.unitId;
    case "ADVANCE_CLOCK":
    case "RESET_SCENARIO":
      return "none";
    default:
      return event.movementId;
  }
}

/**
 * Stable, non-random id: derived from the movement/subject, the event type and how many
 * rejections this state already carries — never a module-level counter, which would make two
 * calls with identical (state, event) produce different results and break the reducer's purity.
 */
function makeRejection(state: WardFlowState, event: WardFlowEvent, reason: string): Rejection {
  const subject = subjectId(event);
  return {
    id: `rejection-${subject}-${event.type}-${state.rejections.length}`,
    at: event.now,
    movementId: subject,
    attempted: event.type,
    reason,
  };
}

function reject(state: WardFlowState, event: WardFlowEvent, reason: string): WardFlowState {
  return { ...state, rejections: [...state.rejections, makeRejection(state, event, reason)] };
}

function findMovement(state: WardFlowState, movementId: string): Movement | undefined {
  return state.movements.find((candidate) => candidate.id === movementId);
}

function findUnit(state: WardFlowState, unitId: string): Unit | undefined {
  return state.units.find((candidate) => candidate.id === unitId);
}

/** Replaces one movement in the array by id, leaving every other element untouched. */
function replaceMovement(state: WardFlowState, movementId: string, next: Movement): WardFlowState {
  return {
    ...state,
    movements: state.movements.map((candidate) => (candidate.id === movementId ? next : candidate)),
  };
}

function replaceUnit(state: WardFlowState, unitId: string, next: Unit): WardFlowState {
  return { ...state, units: state.units.map((candidate) => (candidate.id === unitId ? next : candidate)) };
}

function nextReferralId(sequence: number): string {
  // "WF-9NN" — the 9 prefix keeps runtime-raised referrals visibly distinct from the
  // hand-authored and generated WF-0xx/WF-1xx..WF-4xx fixture ids.
  return `WF-9${String(sequence).padStart(2, "0")}`;
}

export function wardFlowReducer(state: WardFlowState, event: WardFlowEvent): WardFlowState {
  // 1. Role check first, before the event's payload is inspected at all.
  const requiredRole: WardFlowRole = EVENT_ROLE[event.type];
  if (requiredRole !== event.role) {
    return reject(state, event, `${event.type} requires role ${requiredRole}, but was raised by role ${event.role}`);
  }

  switch (event.type) {
    case "RESET_SCENARIO":
      return seedWardFlowState();

    case "ADVANCE_CLOCK":
      return { ...state, clockOffsetMinutes: state.clockOffsetMinutes + event.minutes };

    case "RAISE_REFERRAL": {
      const department = allEmergencyDepartments().find((ed) => ed.id === event.edId);
      if (!department) {
        return reject(state, event, `no emergency department found for id ${event.edId}`);
      }
      const sequence = state.referralSequence + 1;
      const awaitingExamination =
        event.draft.legalStatus === "Referred for psychiatric examination" ||
        event.draft.legalStatus === "Detained awaiting examination";
      const created: Movement = {
        id: nextReferralId(sequence),
        originEdId: event.edId,
        openedAt: event.now,
        urgency: event.draft.urgency,
        cohort: event.draft.cohort,
        security: event.draft.security,
        sex: event.draft.sex,
        specialling: event.draft.specialling,
        legalStatus: event.draft.legalStatus,
        legalForm: awaitingExamination
          ? {
              code: "1A",
              label: "Referral for examination",
              kind: "examination",
              dueAt: event.now + FORM_1A_REFERRAL_EXPIRY_MINUTES,
            }
          : undefined,
        statusChanges: [],
        stage: "placement_requested",
        owner: department.name,
        referredUnitIds: [],
        declines: [],
        blocker: "Awaiting coordinator referral",
        withdrawnReferrals: [],
        ...(awaitingExamination ? { formedAt: event.now } : {}),
      };
      return {
        ...state,
        movements: [...state.movements, created],
        referralSequence: sequence,
      };
    }

    case "RECORD_EXAMINATION": {
      const movement = findMovement(state, event.movementId);
      if (!movement) return reject(state, event, `no movement found for id ${event.movementId}`);
      if (movement.legalForm?.code !== "1A") {
        return reject(
          state,
          event,
          `cannot record an examination while the movement's form is ${movement.legalForm?.code ?? "none"}, not 1A`,
        );
      }
      if (movement.examination) {
        return reject(state, event, `movement ${movement.id} was already examined`);
      }

      if (event.outcome === "inpatient_order") {
        const updated: Movement = {
          ...movement,
          examination: { at: event.now, outcome: event.outcome },
          // 1A (awaiting examination) becomes 3B (examined, awaiting a bed) — the statutory
          // form follows the examination, it is never authored independently of it. The Mental
          // Health Act imposes no post-examination deadline (clinician-confirmed, Task 6A), so
          // the 3B carries no dueAt — the patient's wait from here is the ED clock (elapsed,
          // counting up from `openedAt`), never a legal countdown.
          legalForm: {
            code: "3B",
            label: "Inpatient treatment order",
            kind: "detention",
          },
        };
        return replaceMovement(state, movement.id, updated);
      }

      // community_order or revoked: the patient does not proceed to an inpatient bed. The
      // record closes and the detention form is cleared rather than left dangling on a
      // movement that is no longer going anywhere. A closure also has to unwind whatever
      // downstream placement state the movement was carrying — an in-flight transport job and
      // a bed already held at the accepted unit — rather than leaving both dangling: every
      // downstream handler below now also rejects once `movement.closure` is set (the same
      // signal `isOpenMovement` in ward-derivations.ts already treats as authoritative), but
      // that only stops *further* progress; it does not by itself give back capacity already
      // reserved by an earlier HOLD_BED.
      const heldStages: MovementStage[] = ["bed_held", "handover_ready", "moving"];
      const releasedState =
        movement.acceptedUnitId && heldStages.includes(movement.stage)
          ? (() => {
              const heldUnit = findUnit(state, movement.acceptedUnitId!);
              if (!heldUnit) return state;
              const releasedUnit: Unit = {
                ...heldUnit,
                allocatable: { ...heldUnit.allocatable, value: heldUnit.allocatable.value + 1, confirmedAt: event.now },
              };
              return replaceUnit(state, heldUnit.id, releasedUnit);
            })()
          : state;
      const updated: Movement = {
        ...movement,
        examination: { at: event.now, outcome: event.outcome },
        legalForm: undefined,
        transport:
          movement.transport && movement.transport.cancelledAt === undefined
            ? { ...movement.transport, cancelledAt: event.now }
            : movement.transport,
        closure: { at: event.now, outcome: "did_not_proceed", reason: `examination outcome ${event.outcome}` },
      };
      return replaceMovement(releasedState, movement.id, updated);
    }

    case "REFER_TO_UNITS": {
      const movement = findMovement(state, event.movementId);
      if (!movement) return reject(state, event, `no movement found for id ${event.movementId}`);
      if (movement.closure) {
        return reject(state, event, `cannot refer a closed movement (${movement.closure.reason})`);
      }
      if (event.unitIds.length > PARALLEL_REFERRAL_CAP) {
        return reject(
          state,
          event,
          `cannot refer to ${event.unitIds.length} units at once — the parallel cap is ${PARALLEL_REFERRAL_CAP}`,
        );
      }
      if (!REFERRABLE_MOVEMENT_STAGES.includes(movement.stage)) {
        return reject(state, event, `cannot refer a movement while it is ${movement.stage}`);
      }
      const unknown = event.unitIds.find((unitId) => !findUnit(state, unitId));
      if (unknown) {
        return reject(state, event, `no unit found for id ${unknown}`);
      }
      const updated: Movement = {
        ...movement,
        referredUnitIds: [...event.unitIds],
        stage: "destination_review",
      };
      return replaceMovement(state, movement.id, updated);
    }

    case "ACCEPT_IN_PRINCIPLE": {
      const movement = findMovement(state, event.movementId);
      if (!movement) return reject(state, event, `no movement found for id ${event.movementId}`);
      if (movement.closure) {
        return reject(state, event, `cannot accept a closed movement (${movement.closure.reason})`);
      }
      if (movement.acceptedUnitId) {
        const already = findUnit(state, movement.acceptedUnitId);
        const attemptedUnit = findUnit(state, event.unitId);
        return reject(
          state,
          event,
          `movement ${movement.id} is already accepted at ${already?.name ?? movement.acceptedUnitId}; the referral to ${attemptedUnit?.name ?? event.unitId} was withdrawn`,
        );
      }
      if (movement.stage !== "destination_review") {
        return reject(state, event, `cannot accept a movement while it is ${movement.stage}`);
      }
      if (!movement.referredUnitIds.includes(event.unitId)) {
        return reject(state, event, `${event.unitId} does not hold a live referral for movement ${movement.id}`);
      }
      const acceptedUnit = findUnit(state, event.unitId);
      if (!acceptedUnit) return reject(state, event, `no unit found for id ${event.unitId}`);

      const withdrawn = movement.referredUnitIds
        .filter((unitId) => unitId !== event.unitId)
        .map((unitId) => ({ unitId, at: event.now, reason: `withdrawn — placed at ${acceptedUnit.name}` }));

      const updated: Movement = {
        ...movement,
        acceptedUnitId: event.unitId,
        stage: "accepted_awaiting_bed",
        referredUnitIds: [],
        withdrawnReferrals: [...movement.withdrawnReferrals, ...withdrawn],
      };
      return replaceMovement(state, movement.id, updated);
    }

    case "HOLD_BED": {
      const movement = findMovement(state, event.movementId);
      if (!movement) return reject(state, event, `no movement found for id ${event.movementId}`);
      if (movement.closure) {
        return reject(state, event, `cannot hold a bed for a closed movement (${movement.closure.reason})`);
      }
      if (movement.stage !== "accepted_awaiting_bed") {
        return reject(state, event, `cannot hold a bed while the movement is ${movement.stage}`);
      }
      if (movement.acceptedUnitId !== event.unitId) {
        return reject(
          state,
          event,
          `movement ${movement.id} was accepted at ${movement.acceptedUnitId ?? "no unit"}, not ${event.unitId}`,
        );
      }
      const unit = findUnit(state, event.unitId);
      if (!unit) return reject(state, event, `no unit found for id ${event.unitId}`);
      if (unit.allocatable.value <= 0) {
        return reject(state, event, `no allocatable bed remains at ${unit.name} (bed_held_for_earlier_referral)`);
      }

      const updatedUnit: Unit = {
        ...unit,
        allocatable: { ...unit.allocatable, value: unit.allocatable.value - 1, confirmedAt: event.now },
      };
      const updatedMovement: Movement = {
        ...movement,
        stage: "bed_held",
        bedHeldUntil: event.now + 60,
      };
      const withUnit = replaceUnit(state, unit.id, updatedUnit);
      return replaceMovement(withUnit, movement.id, updatedMovement);
    }

    case "DECLINE": {
      const movement = findMovement(state, event.movementId);
      if (!movement) return reject(state, event, `no movement found for id ${event.movementId}`);
      if (movement.closure) {
        return reject(state, event, `cannot decline for a closed movement (${movement.closure.reason})`);
      }
      if (movement.stage !== "destination_review") {
        return reject(state, event, `cannot decline while the movement is ${movement.stage}`);
      }
      if (!movement.referredUnitIds.includes(event.unitId)) {
        return reject(state, event, `${event.unitId} does not hold a live referral for movement ${movement.id}`);
      }
      const updated: Movement = {
        ...movement,
        referredUnitIds: movement.referredUnitIds.filter((unitId) => unitId !== event.unitId),
        declines: [
          ...movement.declines,
          { unitId: event.unitId, at: event.now, reason: event.reason, note: event.note },
        ],
        stage: "destination_review",
      };
      return replaceMovement(state, movement.id, updated);
    }

    case "HANDOVER_READY": {
      const movement = findMovement(state, event.movementId);
      if (!movement) return reject(state, event, `no movement found for id ${event.movementId}`);
      if (movement.closure) {
        return reject(state, event, `cannot ready a handover for a closed movement (${movement.closure.reason})`);
      }
      if (movement.stage !== "bed_held") {
        return reject(state, event, `cannot ready a handover while the movement is ${movement.stage}`);
      }
      const updated: Movement = {
        ...movement,
        stage: "handover_ready",
        transport: {
          id: `${movement.id}-transport`,
          provider: "State patient transport service",
          escortRequired: movement.legalStatus !== "Voluntary",
        },
      };
      return replaceMovement(state, movement.id, updated);
    }

    case "TRANSPORT_ACCEPTED": {
      const movement = findMovement(state, event.movementId);
      if (!movement) return reject(state, event, `no movement found for id ${event.movementId}`);
      if (movement.closure) {
        return reject(state, event, `cannot accept transport for a closed movement (${movement.closure.reason})`);
      }
      if (movement.stage !== "handover_ready" || !movement.transport) {
        return reject(state, event, `cannot accept transport while the movement is ${movement.stage}`);
      }
      if (movement.transport.acceptedAt) {
        return reject(state, event, `transport for movement ${movement.id} was already accepted`);
      }
      const updated: Movement = {
        ...movement,
        transport: { ...movement.transport, acceptedAt: event.now },
      };
      return replaceMovement(state, movement.id, updated);
    }

    case "TRANSPORT_EN_ROUTE": {
      const movement = findMovement(state, event.movementId);
      if (!movement) return reject(state, event, `no movement found for id ${event.movementId}`);
      if (movement.closure) {
        return reject(state, event, `cannot move transport for a closed movement (${movement.closure.reason})`);
      }
      if (movement.stage !== "handover_ready" || !movement.transport?.acceptedAt) {
        return reject(state, event, `cannot mark transport en route before it has been accepted`);
      }
      if (movement.transport.enRouteAt) {
        return reject(state, event, `transport for movement ${movement.id} is already en route`);
      }
      const updated: Movement = {
        ...movement,
        transport: { ...movement.transport, enRouteAt: event.now },
      };
      return replaceMovement(state, movement.id, updated);
    }

    case "PATIENT_COLLECTED": {
      const movement = findMovement(state, event.movementId);
      if (!movement) return reject(state, event, `no movement found for id ${event.movementId}`);
      if (movement.closure) {
        return reject(state, event, `cannot collect a patient for a closed movement (${movement.closure.reason})`);
      }
      if (movement.stage !== "handover_ready" || !movement.transport?.enRouteAt) {
        return reject(state, event, `cannot collect a patient before transport is en route`);
      }
      const updated: Movement = {
        ...movement,
        stage: "moving",
        transport: { ...movement.transport, collectedAt: event.now },
      };
      return replaceMovement(state, movement.id, updated);
    }

    case "PATIENT_ARRIVED": {
      const movement = findMovement(state, event.movementId);
      if (!movement) return reject(state, event, `no movement found for id ${event.movementId}`);
      if (movement.closure) {
        return reject(state, event, `cannot arrive a patient for a closed movement (${movement.closure.reason})`);
      }
      if (movement.stage !== "moving" || !movement.transport?.collectedAt) {
        return reject(state, event, `cannot arrive a patient while the movement is ${movement.stage}`);
      }
      if (!movement.acceptedUnitId) {
        return reject(state, event, `movement ${movement.id} has no accepted destination unit`);
      }
      const unit = findUnit(state, movement.acceptedUnitId);
      if (!unit) return reject(state, event, `no unit found for id ${movement.acceptedUnitId}`);
      if (unit.empty.value <= 0) {
        // Reachable in practice: HOLD_BED's own floor check only bounds `allocatable.value`, and
        // CONFIRM_CAPACITY can raise `allocatable.value` back above `empty.value` after earlier
        // arrivals have already consumed the physically empty beds. Without this guard a later
        // arrival would drive `empty.value` negative.
        return reject(state, event, `no physically empty bed remains at ${unit.name} (no_bed)`);
      }

      const updatedUnit: Unit = {
        ...unit,
        empty: { ...unit.empty, value: unit.empty.value - 1, confirmedAt: event.now },
        sexMix: { ...unit.sexMix, [movement.sex]: (unit.sexMix[movement.sex] ?? 0) + 1 },
      };
      const updatedMovement: Movement = {
        ...movement,
        stage: "arrived",
        transport: { ...movement.transport, arrivedAt: event.now },
        closure: { at: event.now, outcome: "arrived", reason: "Patient arrived at the accepting unit" },
      };
      const withUnit = replaceUnit(state, unit.id, updatedUnit);
      return replaceMovement(withUnit, movement.id, updatedMovement);
    }

    case "CONFIRM_CAPACITY": {
      const unit = findUnit(state, event.unitId);
      if (!unit) return reject(state, event, `no unit found for id ${event.unitId}`);
      const updatedUnit: Unit = {
        ...unit,
        allocatable: { ...unit.allocatable, value: event.value, source: "ward", confirmedAt: event.now },
      };
      return replaceUnit(state, unit.id, updatedUnit);
    }

    case "RECORD_ESCALATION": {
      const movement = findMovement(state, event.movementId);
      if (!movement) return reject(state, event, `no movement found for id ${event.movementId}`);
      if (movement.closure) {
        return reject(state, event, `cannot escalate a closed movement (${movement.closure.reason})`);
      }
      const updated: Movement = {
        ...movement,
        escalation: { at: event.now, triedUnitIds: [...event.triedUnitIds], contact: event.contact },
      };
      return replaceMovement(state, movement.id, updated);
    }
  }
}
