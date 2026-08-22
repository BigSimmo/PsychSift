import { describe, expect, it } from "vitest";

import { seedWardFlowState, wardFlowReducer } from "../src/components/ward-management/ward-flow-reducer";
import { FORM_1A_REFERRAL_EXPIRY_MINUTES } from "../src/components/ward-management/ward-model";
import { NOW_ANCHOR } from "../src/components/ward-management/ward-sites";

const NOW = NOW_ANCHOR;

function seeded() {
  return seedWardFlowState();
}

function movement(state: ReturnType<typeof seeded>, id: string) {
  const found = state.movements.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`state is missing ${id}`);
  return found;
}

describe("seeding", () => {
  it("copies the fixture rather than aliasing it", () => {
    const first = seeded();
    const second = seeded();
    expect(first.movements[0]).not.toBe(second.movements[0]);
    expect(first.units[0]).not.toBe(second.units[0]);
  });

  it("starts with no refusals and a zero clock offset", () => {
    const state = seeded();
    expect(state.rejections).toEqual([]);
    expect(state.clockOffsetMinutes).toBe(0);
  });
});

describe("referral", () => {
  it("never refers above the parallel cap", () => {
    const state = seeded();
    const next = wardFlowReducer(state, {
      type: "REFER_TO_UNITS",
      role: "coordinator",
      now: NOW,
      movementId: "WF-009",
      unitIds: ["rph-adult-secure", "fsh-adult-secure", "rgh-adult-secure", "gry-adult-secure"],
    });
    expect(next.rejections).toHaveLength(1);
    expect(movement(next, "WF-009").referredUnitIds).toHaveLength(0);
  });

  it("moves a referred movement to destination review", () => {
    const state = seeded();
    const next = wardFlowReducer(state, {
      type: "REFER_TO_UNITS",
      role: "coordinator",
      now: NOW,
      movementId: "WF-009",
      unitIds: ["rph-adult-secure", "fsh-adult-secure"],
    });
    expect(movement(next, "WF-009").stage).toBe("destination_review");
    expect(movement(next, "WF-009").referredUnitIds).toEqual(["rph-adult-secure", "fsh-adult-secure"]);
  });
});

describe("acceptance", () => {
  function referred() {
    return wardFlowReducer(seeded(), {
      type: "REFER_TO_UNITS",
      role: "coordinator",
      now: NOW,
      movementId: "WF-009",
      unitIds: ["rph-adult-secure", "fsh-adult-secure", "rgh-adult-secure"],
    });
  }

  it("withdraws the other referrals and records each one", () => {
    const next = wardFlowReducer(referred(), {
      type: "ACCEPT_IN_PRINCIPLE",
      role: "ward",
      now: NOW,
      movementId: "WF-009",
      unitId: "rph-adult-secure",
    });
    const target = movement(next, "WF-009");
    expect(target.acceptedUnitId).toBe("rph-adult-secure");
    expect(target.stage).toBe("accepted_awaiting_bed");
    expect(target.withdrawnReferrals.map((entry) => entry.unitId).sort()).toEqual([
      "fsh-adult-secure",
      "rgh-adult-secure",
    ]);
    for (const withdrawn of target.withdrawnReferrals) {
      expect(withdrawn.reason).toContain("RPH Adult Secure");
    }
  });

  it("refuses a second acceptance and says the referral was withdrawn", () => {
    const accepted = wardFlowReducer(referred(), {
      type: "ACCEPT_IN_PRINCIPLE",
      role: "ward",
      now: NOW,
      movementId: "WF-009",
      unitId: "rph-adult-secure",
    });
    const next = wardFlowReducer(accepted, {
      type: "ACCEPT_IN_PRINCIPLE",
      role: "ward",
      now: NOW,
      movementId: "WF-009",
      unitId: "fsh-adult-secure",
    });
    expect(next.rejections).toHaveLength(1);
    expect(next.rejections[0].reason).toMatch(/withdraw/i);
    expect(movement(next, "WF-009").acceptedUnitId).toBe("rph-adult-secure");
  });
});

describe("the last bed", () => {
  it("refuses the second acceptance against a unit with one allocatable bed", () => {
    // Two patients, one bed. The model already names the answer; the reducer must enforce it.
    let state = seeded();
    const unit = state.units.find((candidate) => candidate.allocatable.value === 1);
    if (!unit) throw new Error("fixture no longer contains a single-allocatable-bed unit");

    for (const movementId of ["WF-009", "WF-017"]) {
      state = wardFlowReducer(state, {
        type: "REFER_TO_UNITS",
        role: "coordinator",
        now: NOW,
        movementId,
        unitIds: [unit.id],
      });
      state = wardFlowReducer(state, {
        type: "ACCEPT_IN_PRINCIPLE",
        role: "ward",
        now: NOW,
        movementId,
        unitId: unit.id,
      });
      state = wardFlowReducer(state, { type: "HOLD_BED", role: "ward", now: NOW, movementId, unitId: unit.id });
    }

    expect(state.rejections.some((rejection) => rejection.reason.includes("bed_held_for_earlier_referral"))).toBe(true);
  });
});

describe("holds", () => {
  it("gives a held bed sixty minutes to lapse in", () => {
    let state = seeded();
    state = wardFlowReducer(state, {
      type: "REFER_TO_UNITS",
      role: "coordinator",
      now: NOW,
      movementId: "WF-009",
      unitIds: ["rph-adult-secure"],
    });
    state = wardFlowReducer(state, {
      type: "ACCEPT_IN_PRINCIPLE",
      role: "ward",
      now: NOW,
      movementId: "WF-009",
      unitId: "rph-adult-secure",
    });
    state = wardFlowReducer(state, {
      type: "HOLD_BED",
      role: "ward",
      now: NOW,
      movementId: "WF-009",
      unitId: "rph-adult-secure",
    });
    expect(movement(state, "WF-009").bedHeldUntil).toBe(NOW + 60);
    expect(movement(state, "WF-009").stage).toBe("bed_held");
  });
});

describe("roles", () => {
  it("refuses an event raised by the wrong role", () => {
    const next = wardFlowReducer(seeded(), {
      type: "ACCEPT_IN_PRINCIPLE",
      role: "coordinator",
      now: NOW,
      movementId: "WF-009",
      unitId: "rph-adult-secure",
    });
    expect(next.rejections).toHaveLength(1);
    expect(next.rejections[0].reason).toMatch(/role/i);
    expect(movement(next, "WF-009").acceptedUnitId).toBeUndefined();
  });
});

describe("arrival", () => {
  it("consumes the bed and closes the record", () => {
    let state = seeded();
    const before = state.units.find((unit) => unit.id === "rph-adult-secure")!.allocatable.value;
    for (const event of [
      { type: "REFER_TO_UNITS", role: "coordinator", unitIds: ["rph-adult-secure"] },
      { type: "ACCEPT_IN_PRINCIPLE", role: "ward", unitId: "rph-adult-secure" },
      { type: "HOLD_BED", role: "ward", unitId: "rph-adult-secure" },
      { type: "HANDOVER_READY", role: "ed" },
      { type: "TRANSPORT_ACCEPTED", role: "officer" },
      { type: "TRANSPORT_EN_ROUTE", role: "officer" },
      { type: "PATIENT_COLLECTED", role: "officer" },
      { type: "PATIENT_ARRIVED", role: "officer" },
    ] as const) {
      state = wardFlowReducer(state, { ...event, now: NOW, movementId: "WF-009" } as never);
    }
    expect(state.rejections).toEqual([]);
    expect(movement(state, "WF-009").stage).toBe("arrived");
    const after = state.units.find((unit) => unit.id === "rph-adult-secure")!;
    expect(after.allocatable.value).toBeLessThan(before);
  });
});

describe("new referrals", () => {
  it("issues deterministic ids without any random source", () => {
    const first = wardFlowReducer(seeded(), {
      type: "RAISE_REFERRAL",
      role: "ed",
      now: NOW,
      edId: "jhc-ed",
      draft: {
        cohort: "Adult",
        security: "Open",
        sex: "Female",
        specialling: false,
        legalStatus: "Voluntary",
        urgency: 2,
      },
    });
    const second = wardFlowReducer(seeded(), {
      type: "RAISE_REFERRAL",
      role: "ed",
      now: NOW,
      edId: "jhc-ed",
      draft: {
        cohort: "Adult",
        security: "Open",
        sex: "Female",
        specialling: false,
        legalStatus: "Voluntary",
        urgency: 2,
      },
    });
    const firstId = first.movements[first.movements.length - 1].id;
    expect(firstId).toBe(second.movements[second.movements.length - 1].id);
    expect(first.movements).toHaveLength(second.movements.length);
  });

  it("gives a new referral an owner and the raising department", () => {
    const next = wardFlowReducer(seeded(), {
      type: "RAISE_REFERRAL",
      role: "ed",
      now: NOW,
      edId: "jhc-ed",
      draft: {
        cohort: "Adult",
        security: "Open",
        sex: "Male",
        specialling: false,
        legalStatus: "Voluntary",
        urgency: 3,
      },
    });
    const created = next.movements[next.movements.length - 1];
    expect(created.originEdId).toBe("jhc-ed");
    expect(created.owner.length).toBeGreaterThan(0);
    expect(created.stage).toBe("placement_requested");
    expect(created.withdrawnReferrals).toEqual([]);
  });

  it.each(["Referred for psychiatric examination", "Detained awaiting examination"] as const)(
    "creates an examinable Form 1A for a %s referral",
    (legalStatus) => {
      const referred = wardFlowReducer(seeded(), {
        type: "RAISE_REFERRAL",
        role: "ed",
        now: NOW,
        edId: "jhc-ed",
        draft: {
          cohort: "Adult",
          security: "Open",
          sex: "Female",
          specialling: false,
          legalStatus,
          urgency: 2,
        },
      });
      const created = referred.movements.at(-1)!;
      expect(created.legalForm).toEqual({
        code: "1A",
        label: "Referral for examination",
        kind: "examination",
        dueAt: NOW + FORM_1A_REFERRAL_EXPIRY_MINUTES,
      });
      expect(created.formedAt).toBe(NOW);

      const examined = wardFlowReducer(referred, {
        type: "RECORD_EXAMINATION",
        role: "ed",
        now: NOW + 1,
        movementId: created.id,
        outcome: "inpatient_order",
      });
      expect(examined.rejections).toEqual([]);
      expect(movement(examined, created.id).legalForm?.code).toBe("3B");
    },
  );
});

describe("purity", () => {
  it("never mutates the state it was given", () => {
    const state = seeded();
    const snapshot = JSON.stringify(state);
    wardFlowReducer(state, {
      type: "REFER_TO_UNITS",
      role: "coordinator",
      now: NOW,
      movementId: "WF-009",
      unitIds: ["rph-adult-secure"],
    });
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe("examination", () => {
  it("moves a Form 1A to a Form 3B when the examination confirms an inpatient order", () => {
    // WF-001 is seeded on 1A ("Referral for examination", no examination recorded yet).
    const next = wardFlowReducer(seeded(), {
      type: "RECORD_EXAMINATION",
      role: "ed",
      now: NOW,
      movementId: "WF-001",
      outcome: "inpatient_order",
    });
    const target = movement(next, "WF-001");
    expect(target.examination).toEqual({ at: NOW, outcome: "inpatient_order" });
    expect(target.legalForm?.code).toBe("3B");
    // Task 6A: the Mental Health Act imposes no post-examination deadline, so the reducer-
    // produced 3B must carry no dueAt at all — pinned as an explicit absence, not merely no
    // longer contradicted by a stale expected value.
    expect(target.legalForm?.dueAt).toBeUndefined();
  });

  it("closes the movement without an inpatient bed when the examination is revoked", () => {
    const next = wardFlowReducer(seeded(), {
      type: "RECORD_EXAMINATION",
      role: "ed",
      now: NOW,
      movementId: "WF-001",
      outcome: "revoked",
    });
    const target = movement(next, "WF-001");
    expect(target.legalForm).toBeUndefined();
    expect(target.closure?.outcome).toBe("did_not_proceed");
  });

  it("cancels downstream transport, releases the held bed, and refuses further transitions when a movement closes", () => {
    // WF-005 is seeded at handover_ready, accepted at fre-adult-open, with a transport job
    // already accepted (but not yet en route). fre-adult-open's allocatable count reflects an
    // earlier HOLD_BED on this same movement.
    const before = seeded();
    const beforeUnit = before.units.find((candidate) => candidate.id === "fre-adult-open")!;

    const next = wardFlowReducer(before, {
      type: "RECORD_EXAMINATION",
      role: "ed",
      now: NOW,
      movementId: "WF-005",
      outcome: "revoked",
    });
    const target = movement(next, "WF-005");
    expect(target.closure?.outcome).toBe("did_not_proceed");
    // Transport is cancelled, not silently left in its last live state.
    expect(target.transport?.cancelledAt).toBe(NOW);
    // The bed reserved by the earlier HOLD_BED is given back to the unit.
    const afterUnit = next.units.find((candidate) => candidate.id === "fre-adult-open")!;
    expect(afterUnit.allocatable.value).toBe(beforeUnit.allocatable.value + 1);

    // A closed movement can no longer be moved along the transport pathway — this reproduces
    // the reported defect, where TRANSPORT_EN_ROUTE was still accepted after the movement had
    // already been recorded as revoked.
    const enRoute = wardFlowReducer(next, {
      type: "TRANSPORT_EN_ROUTE",
      role: "officer",
      now: NOW + 5,
      movementId: "WF-005",
    });
    expect(enRoute.rejections).toHaveLength(1);
    expect(movement(enRoute, "WF-005").transport?.enRouteAt).toBeUndefined();
  });
});

describe("capacity confirmation", () => {
  it("writes the ward's restated allocatable count to that unit only", () => {
    const next = wardFlowReducer(seeded(), {
      type: "CONFIRM_CAPACITY",
      role: "ward",
      now: NOW,
      unitId: "rph-older-adult",
      value: 3,
    });
    const unit = next.units.find((candidate) => candidate.id === "rph-older-adult")!;
    expect(unit.allocatable.value).toBe(3);
    expect(unit.allocatable.confirmedAt).toBe(NOW);
    // Untouched: a sibling unit's allocatable count must not move.
    const sibling = next.units.find((candidate) => candidate.id === "rph-adult-secure")!;
    expect(sibling.allocatable.value).toBe(1);
  });
});

describe("decline", () => {
  it("drops the unit from the live referral and records why", () => {
    // WF-010 is seeded at destination_review, referred only to sjgm-adult-open.
    const next = wardFlowReducer(seeded(), {
      type: "DECLINE",
      role: "ward",
      now: NOW,
      movementId: "WF-010",
      unitId: "sjgm-adult-open",
      reason: "out_of_catchment",
    });
    const target = movement(next, "WF-010");
    expect(target.declines).toContainEqual({
      unitId: "sjgm-adult-open",
      at: NOW,
      reason: "out_of_catchment",
      note: undefined,
    });
    expect(target.referredUnitIds).not.toContain("sjgm-adult-open");
    expect(target.stage).toBe("destination_review");
  });
});

describe("escalation", () => {
  it("stamps what was tried and who is being contacted", () => {
    // WF-010 carries no escalation at seed time.
    const next = wardFlowReducer(seeded(), {
      type: "RECORD_ESCALATION",
      role: "coordinator",
      now: NOW,
      movementId: "WF-010",
      triedUnitIds: ["sjgm-adult-open", "rph-adult-secure"],
      contact: "State bed coordination desk",
    });
    expect(movement(next, "WF-010").escalation).toEqual({
      at: NOW,
      triedUnitIds: ["sjgm-adult-open", "rph-adult-secure"],
      contact: "State bed coordination desk",
    });
  });
});

describe("demo controls", () => {
  it("advances the clock offset by the given number of minutes", () => {
    const next = wardFlowReducer(seeded(), { type: "ADVANCE_CLOCK", role: "demo", now: NOW, minutes: 15 });
    expect(next.clockOffsetMinutes).toBe(15);
  });

  it("resets a genuinely mutated state back to the seed, not just back to itself", () => {
    let state = seeded();
    state = wardFlowReducer(state, {
      type: "REFER_TO_UNITS",
      role: "coordinator",
      now: NOW,
      movementId: "WF-009",
      unitIds: ["rph-adult-secure"],
    });
    state = wardFlowReducer(state, { type: "ADVANCE_CLOCK", role: "demo", now: NOW, minutes: 30 });
    // Sanity: the mutation actually took, so the reset below is proving something real.
    expect(movement(state, "WF-009").referredUnitIds).toEqual(["rph-adult-secure"]);
    expect(state.clockOffsetMinutes).toBe(30);

    const reset = wardFlowReducer(state, { type: "RESET_SCENARIO", role: "demo", now: NOW });
    expect(movement(reset, "WF-009").referredUnitIds).toEqual([]);
    expect(reset.clockOffsetMinutes).toBe(0);
    expect(reset.rejections).toEqual([]);
  });
});

describe("arrival capacity floor", () => {
  it("refuses an arrival once the unit's physically empty beds are exhausted", () => {
    // A ward can CONFIRM_CAPACITY an allocatable count above what is physically empty — nothing
    // in HOLD_BED's own guard prevents that, since it only bounds `allocatable.value`. That makes
    // over-arriving a real, reachable sequence, not a hypothetical: hold and arrive one patient
    // against rph-adult-secure's single seeded allocatable bed (empty 2 -> 1), have the ward
    // restate a larger allocatable count than physically exists, then hold and arrive a second
    // patient (empty 1 -> 0), then attempt a third. The third must be refused rather than driving
    // `empty.value` negative.
    const walkToArrival = (state: ReturnType<typeof seeded>, movementId: string) => {
      const steps = [
        { type: "REFER_TO_UNITS", role: "coordinator", unitIds: ["rph-adult-secure"] },
        { type: "ACCEPT_IN_PRINCIPLE", role: "ward", unitId: "rph-adult-secure" },
        { type: "HOLD_BED", role: "ward", unitId: "rph-adult-secure" },
        { type: "HANDOVER_READY", role: "ed" },
        { type: "TRANSPORT_ACCEPTED", role: "officer" },
        { type: "TRANSPORT_EN_ROUTE", role: "officer" },
        { type: "PATIENT_COLLECTED", role: "officer" },
        { type: "PATIENT_ARRIVED", role: "officer" },
      ] as const;
      let next = state;
      for (const step of steps) {
        next = wardFlowReducer(next, { ...step, now: NOW, movementId } as never);
      }
      return next;
    };

    let state = seeded();
    state = walkToArrival(state, "WF-009"); // empty 2 -> 1, allocatable 1 -> 0
    state = wardFlowReducer(state, {
      type: "CONFIRM_CAPACITY",
      role: "ward",
      now: NOW,
      unitId: "rph-adult-secure",
      value: 5,
    });
    state = walkToArrival(state, "WF-017"); // empty 1 -> 0, allocatable 5 -> 4

    const before = state.units.find((unit) => unit.id === "rph-adult-secure")!.empty.value;
    expect(before).toBe(0);

    // A third referral raised fresh, so its stage starts clean regardless of fixture state.
    const raised = wardFlowReducer(state, {
      type: "RAISE_REFERRAL",
      role: "ed",
      now: NOW,
      edId: "jhc-ed",
      draft: {
        cohort: "Adult",
        security: "Secure",
        sex: "Male",
        specialling: false,
        legalStatus: "Voluntary",
        urgency: 3,
      },
    });
    const thirdId = raised.movements[raised.movements.length - 1].id;
    const final = walkToArrival(raised, thirdId);

    expect(movement(final, thirdId).stage).not.toBe("arrived");
    expect(final.rejections.some((rejection) => rejection.reason.includes("no_bed"))).toBe(true);
    const after = final.units.find((unit) => unit.id === "rph-adult-secure")!;
    expect(after.empty.value).toBe(0);
  });
});
