import { describe, expect, it } from "vitest";

import { seedWardFlowState, wardFlowReducer } from "../src/components/ward-management/ward-flow-reducer";
import type { WardFlowState } from "../src/components/ward-management/ward-flow-reducer";
import { PARALLEL_REFERRAL_CAP } from "../src/components/ward-management/ward-model";
import type { MovementStage } from "../src/components/ward-management/ward-model";
import { NOW_ANCHOR } from "../src/components/ward-management/ward-sites";
import { eligibleCandidates } from "../src/components/ward-management/ward-derivations";
import { wardMovements } from "../src/components/ward-management/ward-movements";

const NOW = NOW_ANCHOR;
const MOVEMENT_ID = "WF-001";
const ACCEPTED_UNIT_ID = "fre-adult-open";
const DECLINED_UNIT_ID = "scgh-adult-open";
const WITHDRAWN_UNIT_ID = "arm-adult-open";

/**
 * Every state the system can reach by walking one patient the whole way through.
 *
 * Fix round 1: the subject is WF-001, not WF-009. WF-009's seed fixture already carried five
 * declines and an examination before the walk's first event ran, so invariants 4, 5 and 6 were
 * asserting against fixture history rather than anything the walk itself produced — confirmed
 * vacuous by disabling the reducer's own writes and watching the suite stay green. WF-001 is
 * the only hand-authored movement early enough in its journey (`placement_requested`) to walk
 * the whole path while also carrying no seed `declines` or `referredUnitIds`, so every decline,
 * referral, withdrawal and acceptance the invariants below inspect is caused by one of these
 * events, not by data the fixture handed them for free.
 *
 * The first event is deliberately raised with the wrong role. The reducer's role check runs
 * before the event's payload or the movement's stage is inspected at all, so this is safe to
 * raise before the movement has even been referred anywhere — and it gives the privacy
 * invariant a real, walk-caused rejection to inspect instead of an empty `state.rejections`.
 */
function walk(): WardFlowState[] {
  let state = seedWardFlowState();
  const seen: WardFlowState[] = [state];
  const events = [
    { type: "ACCEPT_IN_PRINCIPLE", role: "coordinator", unitId: DECLINED_UNIT_ID },
    { type: "REFER_TO_UNITS", role: "coordinator", unitIds: [DECLINED_UNIT_ID, WITHDRAWN_UNIT_ID, ACCEPTED_UNIT_ID] },
    { type: "DECLINE", role: "ward", unitId: DECLINED_UNIT_ID, reason: "no_bed" },
    { type: "ACCEPT_IN_PRINCIPLE", role: "ward", unitId: ACCEPTED_UNIT_ID },
    { type: "HOLD_BED", role: "ward", unitId: ACCEPTED_UNIT_ID },
    { type: "HANDOVER_READY", role: "ed" },
    { type: "TRANSPORT_ACCEPTED", role: "officer" },
    { type: "TRANSPORT_EN_ROUTE", role: "officer" },
    { type: "PATIENT_COLLECTED", role: "officer" },
    { type: "PATIENT_ARRIVED", role: "officer" },
  ] as const;
  for (const event of events) {
    state = wardFlowReducer(state, { ...event, now: NOW, movementId: MOVEMENT_ID } as never);
    seen.push(state);
  }
  return seen;
}

/**
 * `walk()`'s state indices: `seen[0]` is the seed; `seen[i + 1]` is the state after `events[i]`.
 * Named here once so the bed-accounting test below can read the exact unit before and after
 * each bed-moving step without recomputing the offsets inline.
 */
const AFTER_REFER_TO_UNITS = 2;
const BEFORE_HOLD_BED = 4; // = AFTER_ACCEPT_IN_PRINCIPLE
const AFTER_HOLD_BED = 5;
const BEFORE_PATIENT_ARRIVED = 9; // = AFTER_PATIENT_COLLECTED
const AFTER_PATIENT_ARRIVED = 10;

describe("invariants across every reachable state", () => {
  it("never lets a movement hold more than the parallel cap", () => {
    for (const state of walk()) {
      for (const movement of state.movements) {
        expect(movement.referredUnitIds.length).toBeLessThanOrEqual(PARALLEL_REFERRAL_CAP);
      }
    }
  });

  it("keeps the accepted unit's raw bed counts exact across each bed-moving step", () => {
    // Fix round 1: routing this through `unitCapacity()` let the invariant survive real
    // corruption, because that helper is deliberately defensive — it re-partitions `unit.beds`
    // from whatever `empty`/`allocatable`/`blocked` it is given, so a wrong decrement rarely
    // changes its output. Reading the raw fields directly, immediately before and after each
    // step that is supposed to move them, is the correct instrument for an arithmetic contract.
    const states = walk();
    const unitIn = (state: WardFlowState) => state.units.find((unit) => unit.id === ACCEPTED_UNIT_ID)!;

    const beforeHold = unitIn(states[BEFORE_HOLD_BED]);
    const afterHold = unitIn(states[AFTER_HOLD_BED]);
    expect(beforeHold.allocatable.value).toBe(3);
    expect(afterHold.allocatable.value).toBe(2);
    expect(afterHold.empty.value).toBe(beforeHold.empty.value); // HOLD_BED must not touch `empty`

    const beforeArrival = unitIn(states[BEFORE_PATIENT_ARRIVED]);
    const afterArrival = unitIn(states[AFTER_PATIENT_ARRIVED]);
    expect(beforeArrival.empty.value).toBe(4);
    expect(afterArrival.empty.value).toBe(3);
    expect(afterArrival.allocatable.value).toBe(beforeArrival.allocatable.value); // nor must PATIENT_ARRIVED touch `allocatable`
    expect(beforeArrival.sexMix.Female).toBe(9);
    expect(afterArrival.sexMix.Female).toBe(10);
  });

  it("never leaves a movement ownerless", () => {
    for (const state of walk()) {
      for (const movement of state.movements) {
        expect(movement.owner.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("never returns a declined unit to that patient's eligible candidates", () => {
    // Fix round 1: assert the specific unit id is genuinely excluded, not merely that some set
    // shrank — first prove it was eligible before the walk declined it (so this isn't checking
    // a unit that could never have been a candidate anyway), then prove the walk's own DECLINE
    // event removes it from the real candidate list the screens use.
    const states = walk();
    const beforeDecline = states[AFTER_REFER_TO_UNITS].movements.find((movement) => movement.id === MOVEMENT_ID)!;
    const beforeCandidates = eligibleCandidates(beforeDecline, NOW, Number.POSITIVE_INFINITY);
    expect(beforeCandidates.some((c) => c.unit.id === DECLINED_UNIT_ID && c.verdict.eligible)).toBe(true);

    const final = states.at(-1)!;
    const target = final.movements.find((movement) => movement.id === MOVEMENT_ID)!;
    expect(target.declines.some((decline) => decline.unitId === DECLINED_UNIT_ID)).toBe(true);

    const afterCandidates = eligibleCandidates(target, NOW, Number.POSITIVE_INFINITY);
    const eligibleIds = new Set(afterCandidates.filter((c) => c.verdict.eligible).map((c) => c.unit.id));
    expect(eligibleIds.has(DECLINED_UNIT_ID)).toBe(false);
  });

  it("records the withdrawal the referral's own acceptance caused", () => {
    // Fix round 1: assert the withdrawn entry's unit id and its exact reason text, not just
    // that the array is non-empty. `WITHDRAWN_UNIT_ID` is still a live referral right up to the
    // moment ACCEPT_IN_PRINCIPLE fires on a different unit — the withdrawal below exists only
    // because that event's own bookkeeping produced it, not because the fixture pre-populated it.
    const final = walk().at(-1)!;
    const target = final.movements.find((movement) => movement.id === MOVEMENT_ID)!;
    expect(target.acceptedUnitId).toBe(ACCEPTED_UNIT_ID);

    const withdrawn = target.withdrawnReferrals.find((entry) => entry.unitId === WITHDRAWN_UNIT_ID);
    expect(withdrawn).toBeDefined();
    expect(withdrawn?.reason).toBe("withdrawn — placed at FRE Adult Open");

    // The declined unit ends its referral through `declines`, never through `withdrawnReferrals`
    // — the two mechanisms record different things and must not blur together.
    expect(target.withdrawnReferrals.some((entry) => entry.unitId === DECLINED_UNIT_ID)).toBe(false);
  });

  it("never lets the statutory form disagree with the examination", () => {
    // 1A is awaiting exam; 3B is awaiting a bed after one. An event that records an examination
    // must not leave a patient claiming to still be awaiting it.
    for (const state of walk()) {
      for (const movement of state.movements) {
        const code = movement.legalForm?.code;
        if (code === "1A") expect(movement.examination).toBeUndefined();
        if (code === "3B") expect(movement.examination?.outcome).toBe("inpatient_order");
      }
    }
  });

  it("keeps every rendered string free of anything identifying a person", () => {
    // Fix round 1: mirrors Task 1's fix (tests/ward-model-phase3.test.ts) — a guard that checks
    // properties and never reads strings is how a privacy defect can survive. Accumulate every
    // string this loop actually inspects and assert there is a real, non-trivial number of them
    // before checking content, so a future edit that empties `rejections`/`withdrawnReferrals`
    // back out turns this test red instead of leaving it vacuously green. The walk's own wrong-role
    // attempt (a real, walk-caused rejection) and its own accept-triggered withdrawal both land in
    // the strings this inspects, on top of the pre-existing fixture data on other movements.
    const forbidden = /\b(name|dob|date of birth|mrn|medical record|address|diagnosis)\b/i;
    const inspected: string[] = [];
    for (const state of walk()) {
      for (const rejection of state.rejections) {
        inspected.push(rejection.reason);
      }
      for (const movement of state.movements) {
        for (const withdrawn of movement.withdrawnReferrals) {
          inspected.push(withdrawn.reason);
        }
      }
    }
    expect(inspected.length).toBeGreaterThanOrEqual(2);
    for (const text of inspected) {
      expect(text).not.toMatch(forbidden);
    }
  });
});

/**
 * Fixture coherence, not reducer coherence: the invariants above walk one movement through
 * `wardFlowReducer` and check every state the reducer itself produces. These invariants instead
 * inspect `wardMovements` — the hand-authored + generated seed data — directly, because the
 * fixture does not go through the reducer at all. Nothing stops fixture authoring from putting a
 * movement in a stage/stamp combination the reducer could never reach on its own, and that is
 * exactly what happened: six "moving" movements shipped with `transport.collectedAt` unset, a
 * state `PATIENT_COLLECTED` (the only producer of stage "moving") cannot leave behind, because it
 * always sets `collectedAt` in the same update it sets the stage. Ruling R64 then found the same
 * shape of defect again — five "handover_ready" movements with no `transport` job, four of those
 * five also with no `acceptedUnitId` — because the invariant list this block started from (R58)
 * was written by hand rather than derived from the reducer, and an incomplete list cannot catch
 * what it never enumerated.
 *
 * R64's method: enumerate every `wardFlowReducer` branch that assigns a `stage`, and for each,
 * record what else that same branch writes in the same update. Every one of those is a direct
 * implication; chaining preconditions across branches (a later stage's precondition on an earlier
 * branch's output) gives the transitive ones. The complete table, read off `ward-flow-reducer.ts`
 * on 2026-08-22:
 *
 * | Branch                | Produces stage         | Also writes (same update)                          |
 * |------------------------|------------------------|-----------------------------------------------------|
 * | `RAISE_REFERRAL`       | `placement_requested`  | `referredUnitIds: []`, `declines: []`, `withdrawnReferrals: []` (new movement — no `acceptedUnitId`/`transport`/`bedHeldUntil`) |
 * | `REFER_TO_UNITS`       | `destination_review`   | `referredUnitIds: event.unitIds`                     |
 * | `ACCEPT_IN_PRINCIPLE`  | `accepted_awaiting_bed`| `acceptedUnitId: event.unitId`, `referredUnitIds: []`, `withdrawnReferrals: [...]` |
 * | `HOLD_BED`             | `bed_held`             | `bedHeldUntil: event.now + 60` (requires the movement already at `accepted_awaiting_bed` with `acceptedUnitId === event.unitId`) |
 * | `DECLINE`              | `destination_review`   | `referredUnitIds`: filtered, `declines: [...]`       |
 * | `HANDOVER_READY`       | `handover_ready`       | `transport: {...}` (requires stage already `bed_held`, so `acceptedUnitId`/`bedHeldUntil` carry over unchanged) |
 * | `PATIENT_COLLECTED`    | `moving`               | `transport.collectedAt: event.now` (requires `transport.enRouteAt` already set) |
 * | `PATIENT_ARRIVED`      | `arrived`              | `transport.arrivedAt: event.now`, `closure: {...}` (requires `acceptedUnitId` and `transport.collectedAt` already set) |
 *
 * Every other branch (`RECORD_EXAMINATION`, `TRANSPORT_ACCEPTED`, `TRANSPORT_EN_ROUTE`,
 * `CONFIRM_CAPACITY`, `RECORD_ESCALATION`, `RESET_SCENARIO`, `ADVANCE_CLOCK`) never assigns
 * `stage` on an existing movement, so it contributes no row.
 *
 * Chaining that table's preconditions gives the transitive implications the direct table alone
 * cannot: `ACCEPT_IN_PRINCIPLE` is the only branch that ever writes `acceptedUnitId`, and no
 * branch ever clears it, so every stage reachable only after `accepted_awaiting_bed` —
 * `accepted_awaiting_bed`, `bed_held`, `handover_ready`, `moving`, `arrived` — requires it.
 * Symmetrically, `ACCEPT_IN_PRINCIPLE` rejects outright when `acceptedUnitId` is already set and
 * always advances the stage away from `destination_review` in that same update, so a movement
 * still at `placement_requested` or `destination_review` can never carry one. `HANDOVER_READY`
 * is the only branch that ever writes `transport`, and its own precondition is stage `bed_held`
 * — which itself requires having already passed through `accepted_awaiting_bed` — so
 * `handover_ready` without `transport` is unreachable, and doubly so without `acceptedUnitId`.
 * This is exactly the R64 defect: the direct table alone (only `HANDOVER_READY`'s own row) would
 * have caught the missing `transport`, but not the missing `acceptedUnitId`, which only the
 * chained precondition surfaces.
 *
 * `bedHeldUntil` does not extend the same way past `bed_held`: fixture authoring convention (both
 * hand-authored and generated) drops it once a movement moves on to `handover_ready` or later —
 * a hold that has already resulted in a handover is no longer "held" in the sense the field
 * describes — so the invariant below is scoped to `bed_held` itself, matching the pre-existing,
 * previously-unproven fact that no `bed_held` record lacks it. The same is true of `transport` at
 * `arrived`: the two current `arrived` records both close through a path that never had a
 * transport job at all, a state the existing test below deliberately keeps proving as legitimate
 * (a real `arrived` record with a transport job still must carry `arrivedAt`).
 *
 * Every rule below is read off `ward-flow-reducer.ts`'s transport transitions, not guessed:
 * - `PATIENT_COLLECTED` requires stage `"handover_ready"` and `transport.enRouteAt`, and moves
 *   the movement to stage `"moving"` while setting `transport.collectedAt` — so stage `"moving"`
 *   without `collectedAt` is unreachable.
 * - `PATIENT_ARRIVED` requires stage `"moving"` and `transport.collectedAt`, and moves the
 *   movement to stage `"arrived"` while setting `transport.arrivedAt` — so a movement with a
 *   transport job that is stage `"arrived"` and lacks `arrivedAt` is unreachable. (No current
 *   fixture record actually carries stage `"arrived"` together with a `transport` job — the two
 *   hand-authored and generated "arrived" records both close without ever having had transport at
 *   all — so this branch does not fire against today's data. It still guards a real invariant: a
 *   future "arrived" record that does carry a transport job must carry its arrival stamp too, and
 *   the mutation below (see the transport-stage-coherence report) proves the assertion still kills
 *   a violation when one is introduced.)
 * - `TRANSPORT_EN_ROUTE` requires `transport.acceptedAt`; `PATIENT_COLLECTED` requires
 *   `transport.enRouteAt`; `PATIENT_ARRIVED` requires `transport.collectedAt` — so the four
 *   transport stamps can only ever be present in the order acceptedAt, enRouteAt, collectedAt,
 *   arrivedAt: a later one is never set without every earlier one.
 * - Every event's `now` becomes the stamp it writes, and nothing in the reducer moves the clock
 *   backward, so on any real walk every stamp is `<= NOW_ANCHOR` and `>=` whichever stamp on the
 *   same job preceded it.
 */
describe("fixture stage/stamp coherence (ward-movements.ts)", () => {
  it("never leaves a 'moving' movement without the collection its stage implies", () => {
    // Counts records the assertion actually inspected (stage === "moving"), not every iteration
    // of the loop. A counter that increments on every movement regardless of stage would prove
    // only that `wardMovements` is non-empty — which is always true — not that this assertion
    // ever ran. That is the exact shape of defect this project has shipped before (Task 1's
    // privacy guard, whose loop bodies executed zero times and so could never fail).
    let matched = 0;
    for (const movement of wardMovements) {
      if (movement.stage === "moving") {
        matched += 1;
        expect(
          movement.transport?.collectedAt,
          `${movement.id} is stage "moving" but transport.collectedAt is unset — PATIENT_COLLECTED ` +
            `is the only reducer transition that produces "moving" and it always sets collectedAt`,
        ).toBeDefined();
      }
    }
    // Six records are stage "moving" today (WF-006, WF-014, WF-306, WF-313, WF-320, WF-327) — the
    // exact defect this fix corrects. If a future edit removed every "moving" record or renamed
    // the stage, this would go red instead of the assertion above silently inspecting nothing.
    expect(matched).toBeGreaterThan(0);
  });

  it("never leaves an 'arrived' movement's transport job without the arrival it implies", () => {
    let matched = 0;
    for (const movement of wardMovements) {
      if (movement.stage === "arrived" && movement.transport) {
        matched += 1;
        expect(
          movement.transport.arrivedAt,
          `${movement.id} is stage "arrived" with a transport job but transport.arrivedAt is unset`,
        ).toBeDefined();
      }
    }
    // No current fixture record is stage "arrived" while still carrying a transport job — both
    // the hand-authored WF-007 and every generated "arrived" record close without ever having had
    // a transport job at all. This is a forward-looking guard, not a vacuous one: asserting the
    // real count (0) today, rather than `toBeGreaterThan(0)`, keeps that honest instead of
    // inventing a fixture record just to make a non-zero check pass. The assertion above still
    // runs on every movement that matches the condition, and still fails the moment one exists —
    // proved by mutation in the accompanying report, which forces a "moving" movement's stage to
    // "arrived" without giving it `arrivedAt` and confirms both this line and the inner assertion
    // go red.
    expect(matched).toBe(0);
  });

  it("only ever fills transport stamps in the order the reducer allows, never after NOW_ANCHOR", () => {
    let inspected = 0;
    for (const movement of wardMovements) {
      const transport = movement.transport;
      if (!transport) continue;
      inspected += 1;
      const { acceptedAt, enRouteAt, collectedAt, arrivedAt } = transport;

      if (enRouteAt !== undefined) {
        expect(acceptedAt, `${movement.id} has transport.enRouteAt without transport.acceptedAt`).toBeDefined();
      }
      if (collectedAt !== undefined) {
        expect(enRouteAt, `${movement.id} has transport.collectedAt without transport.enRouteAt`).toBeDefined();
      }
      if (arrivedAt !== undefined) {
        expect(collectedAt, `${movement.id} has transport.arrivedAt without transport.collectedAt`).toBeDefined();
      }

      const stamps = [acceptedAt, enRouteAt, collectedAt, arrivedAt].filter(
        (stamp): stamp is number => stamp !== undefined,
      );
      for (const stamp of stamps) {
        expect(stamp, `${movement.id} has a transport stamp after NOW_ANCHOR (${NOW_ANCHOR})`).toBeLessThanOrEqual(
          NOW_ANCHOR,
        );
      }
      for (let i = 1; i < stamps.length; i += 1) {
        expect(stamps[i], `${movement.id}'s transport stamps are not in non-decreasing order`).toBeGreaterThanOrEqual(
          stamps[i - 1],
        );
      }
    }
    // Every movement with a transport job must actually have been walked — a filter that quietly
    // matched nothing would make every expectation above vacuously true.
    expect(inspected).toBeGreaterThan(0);
  });

  it("never leaves a 'handover_ready' movement without the transport its stage implies", () => {
    // Direct table entry: `HANDOVER_READY` is the only reducer branch that produces stage
    // "handover_ready", and it always writes a `transport` job in that same update
    // (`ward-flow-reducer.ts`'s own `case "HANDOVER_READY"`) — so "handover_ready" with no
    // `transport` is unreachable. Ruling R64: five records shipped in exactly that state.
    let matched = 0;
    for (const movement of wardMovements) {
      if (movement.stage === "handover_ready") {
        matched += 1;
        expect(
          movement.transport,
          `${movement.id} is stage "handover_ready" but has no transport job — HANDOVER_READY ` +
            `is the only reducer transition that produces "handover_ready" and it always creates one`,
        ).toBeDefined();
      }
    }
    // Two records are stage "handover_ready" today (WF-005, WF-015) after ruling R64 moved the
    // five that lacked a transport job back to the stage their own fields actually support.
    expect(matched).toBe(2);
  });

  it("never leaves an accepted, bed-held, handover-ready, moving or arrived movement without the accepted unit its stage implies", () => {
    // Transitive table entry: `ACCEPT_IN_PRINCIPLE` is the only branch that ever writes
    // `acceptedUnitId`, and no branch ever clears it, so every stage reachable only after
    // `accepted_awaiting_bed` requires one. `ward-model.test.ts` already proves this for
    // `accepted_awaiting_bed`/`bed_held`; this closes the same invariant for the three stages
    // that test does not reach, including "handover_ready" — the second half of the R64 defect
    // (four of the five broken records had no `acceptedUnitId` at all, not just no transport).
    const requiresAcceptedUnit: MovementStage[] = [
      "accepted_awaiting_bed",
      "bed_held",
      "handover_ready",
      "moving",
      "arrived",
    ];
    let matched = 0;
    for (const movement of wardMovements) {
      if (requiresAcceptedUnit.includes(movement.stage)) {
        matched += 1;
        expect(
          movement.acceptedUnitId,
          `${movement.id} is stage "${movement.stage}" but has no acceptedUnitId — only ` +
            `ACCEPT_IN_PRINCIPLE ever sets it and nothing later clears it`,
        ).toBeDefined();
      }
    }
    // 6 accepted_awaiting_bed + 7 bed_held + 2 handover_ready + 6 moving + 6 arrived = 27 today.
    expect(matched).toBe(27);
  });

  it("never leaves a 'bed_held' movement without the bed hold its stage implies", () => {
    // Direct table entry: `HOLD_BED` is the only branch that produces stage "bed_held", and it
    // always writes `bedHeldUntil` in that same update. Unlike `acceptedUnitId`, fixture
    // authoring convention does not carry `bedHeldUntil` forward past "bed_held" (a hold that
    // already resulted in a handover is no longer "held"), so this is scoped to "bed_held" only.
    let matched = 0;
    for (const movement of wardMovements) {
      if (movement.stage === "bed_held") {
        matched += 1;
        expect(
          movement.bedHeldUntil,
          `${movement.id} is stage "bed_held" but has no bedHeldUntil — HOLD_BED is the only ` +
            `reducer transition that produces "bed_held" and it always sets an expiry`,
        ).toBeDefined();
      }
    }
    expect(matched).toBe(7);
  });

  it("never lets a movement earlier than 'accepted_awaiting_bed' carry the accepted unit only a later stage should have", () => {
    // The mirror image of the acceptedUnitId invariant above: `ACCEPT_IN_PRINCIPLE` rejects
    // outright when `movement.acceptedUnitId` is already set, and the only way to reach
    // "placement_requested" or "destination_review" leaves acceptedUnitId untouched or unset —
    // so a movement still at either stage can never carry one. Currently zero records violate
    // this; asserting the real count (0), not `toBeGreaterThan(0)`, keeps that honest per the
    // match-counting rule rather than inventing a violation to get a positive count. The
    // mutation in the accompanying report proves this line still goes red the moment one exists.
    const preAcceptanceStages: MovementStage[] = ["placement_requested", "destination_review"];
    let matched = 0;
    for (const movement of wardMovements) {
      if (preAcceptanceStages.includes(movement.stage) && movement.acceptedUnitId !== undefined) {
        matched += 1;
      }
    }
    expect(matched).toBe(0);
  });
});
