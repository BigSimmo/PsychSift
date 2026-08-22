// tests/ward-model-phase3.test.ts
import { describe, expect, it } from "vitest";

import { DECLINE_REASONS } from "../src/components/ward-management/ward-model";
import { wardMovements } from "../src/components/ward-management/ward-movements";
import { NOW_ANCHOR } from "../src/components/ward-management/ward-sites";
import { isOpen } from "../src/components/ward-management/ward-derivations";

describe("Phase 3 model additions", () => {
  it("records out-of-catchment as a decline reason", () => {
    expect(DECLINE_REASONS).toContain("out_of_catchment");
    expect(new Set(DECLINE_REASONS).size).toBe(DECLINE_REASONS.length);
  });

  it("gives every movement a withdrawn-referral list, even an empty one", () => {
    for (const movement of wardMovements) {
      expect(Array.isArray(movement.withdrawnReferrals)).toBe(true);
    }
  });

  it("never dates a form later than the placement request it belongs to", () => {
    // The legal clock starts when the person was formed; the ED clock when this department
    // raised the request. formedAt may precede openedAt and must never follow it.
    for (const movement of wardMovements) {
      if (movement.formedAt === undefined) continue;
      expect(movement.formedAt).toBeLessThanOrEqual(movement.openedAt);
    }
  });

  it("carries at least one community-formed patient whose legal clock started before arrival", () => {
    const communityFormed = wardMovements.filter(
      (movement) => movement.formedAt !== undefined && movement.formedAt < movement.openedAt,
    );
    expect(communityFormed.length).toBeGreaterThan(0);
  });

  it("carries at least one patient brought in under police escort", () => {
    expect(wardMovements.some((movement) => movement.arrivalMode === "police")).toBe(true);
  });

  it("carries at least one examined patient, and every examination is dated at or before now", () => {
    const examined = wardMovements.filter((movement) => movement.examination !== undefined);
    expect(examined.length).toBeGreaterThan(0);
    for (const movement of examined) {
      expect(movement.examination!.at).toBeLessThanOrEqual(NOW_ANCHOR);
    }
  });

  it("holds a bed only with a time for the hold to expire at", () => {
    for (const movement of wardMovements) {
      if (movement.stage !== "bed_held") continue;
      expect(movement.bedHeldUntil).toBeDefined();
    }
  });

  it("puts a patient on 1A while awaiting examination and on 3B once examined", () => {
    // Settled by the product owner: 1A means awaiting exam; 3B means in the department awaiting a
    // bed. Form 3A is not used. The form therefore follows the examination, in both directions.
    for (const movement of wardMovements) {
      const code = movement.legalForm?.code;
      if (code === "1A") expect(movement.examination).toBeUndefined();
      if (code === "3B") expect(movement.examination?.outcome).toBe("inpatient_order");
      expect(code).not.toBe("3A");
    }
  });

  it("carries at least one patient on each of 1A and 3B", () => {
    const codes = wardMovements.map((movement) => movement.legalForm?.code);
    expect(codes).toContain("1A");
    expect(codes).toContain("3B");
  });

  it("keeps every new field free of anything that identifies a person", () => {
    const forbidden = /\b(name|dob|date of birth|mrn|medical record|address|diagnosis)\b/i;
    // A guard that checks properties and never reads strings is how the Phase 1 privacy
    // defect survived (plan Global Constraints). Accumulate every string this loop actually
    // inspects and assert there is a real, non-trivial number of them — so a future edit that
    // empties withdrawnReferrals/escalation back out of the fixture turns this test red
    // instead of leaving it vacuously green.
    const inspected: string[] = [];
    for (const movement of wardMovements.filter(isOpen)) {
      for (const withdrawn of movement.withdrawnReferrals) {
        inspected.push(withdrawn.reason);
      }
      if (movement.escalation) {
        inspected.push(movement.escalation.contact);
      }
    }
    expect(inspected.length).toBeGreaterThanOrEqual(3);
    for (const text of inspected) {
      expect(text).not.toMatch(forbidden);
    }
  });

  it("never gives a Form 3B a dueAt, and never omits one from a Form 1A", () => {
    // Task 6A: the Mental Health Act imposes no post-examination deadline (clinician-confirmed —
    // the post-examination clock is elapsed ED wait, counting up, never a legal countdown), so a
    // 3B must carry no dueAt at all — not a wrong one, none. A 1A still carries a real statutory
    // examination window and must always have one. Both sides are accumulated so this cannot
    // pass vacuously if the fixture ever stopped carrying one kind or the other — a vacuous guard
    // shape has already cost this phase two fix rounds (see the deleted test this replaces).
    const form3B: string[] = [];
    const form1A: string[] = [];
    for (const movement of wardMovements) {
      if (movement.legalForm?.code === "3B") form3B.push(movement.id);
      if (movement.legalForm?.code === "1A") form1A.push(movement.id);
    }
    expect(form3B.length).toBeGreaterThan(0);
    expect(form1A.length).toBeGreaterThan(0);
    for (const movement of wardMovements) {
      if (movement.legalForm?.code === "3B") {
        expect(movement.legalForm.dueAt).toBeUndefined();
      }
      if (movement.legalForm?.code === "1A") {
        expect(movement.legalForm.dueAt).toBeDefined();
      }
    }
  });
});
