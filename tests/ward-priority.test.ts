// tests/ward-priority.test.ts
import { describe, expect, it } from "vitest";

import { operationalScore, queueOrder } from "../src/components/ward-management/ward-priority";
import { wardMovements } from "../src/components/ward-management/ward-movements";
import { isOpen } from "../src/components/ward-management/ward-derivations";
import { NOW_ANCHOR } from "../src/components/ward-management/ward-sites";
import type { Movement } from "../src/components/ward-management/ward-model";

function movementById(id: string) {
  const found = wardMovements.find((movement) => movement.id === id);
  if (!found) throw new Error(`fixture is missing ${id}`);
  return found;
}

describe("operational score", () => {
  it("never reads urgency — two movements differing only in tier score identically", () => {
    const base = movementById("WF-001");
    const tierOne: Movement = { ...base, urgency: 1 };
    const tierThree: Movement = { ...base, urgency: 3 };
    expect(operationalScore(tierOne, NOW_ANCHOR).score).toBe(operationalScore(tierThree, NOW_ANCHOR).score);
  });

  it("scores a longer wait above a shorter one, all else equal", () => {
    const base = movementById("WF-001");
    const waitedLonger: Movement = { ...base, openedAt: base.openedAt - 240 };
    expect(operationalScore(waitedLonger, NOW_ANCHOR).score).toBeGreaterThan(operationalScore(base, NOW_ANCHOR).score);
  });

  it("scores a breached legal deadline above a clear one", () => {
    const base = movementById("WF-001");
    const breached: Movement = {
      ...base,
      legalForm: { code: "1A", label: "Referral for examination", kind: "examination", dueAt: NOW_ANCHOR - 30 },
    };
    const clear: Movement = {
      ...base,
      legalForm: { code: "1A", label: "Referral for examination", kind: "examination", dueAt: NOW_ANCHOR + 400 },
    };
    expect(operationalScore(breached, NOW_ANCHOR).score).toBeGreaterThan(operationalScore(clear, NOW_ANCHOR).score);
  });

  it("awards Bed need confirmed points when an examination outcome is recorded as inpatient_order", () => {
    const base = movementById("WF-001");
    const confirmed: Movement = { ...base, examination: { at: NOW_ANCHOR - 30, outcome: "inpatient_order" } };
    const { factors } = operationalScore(confirmed, NOW_ANCHOR);
    const factor = factors.find((factor) => factor.label === "Bed need confirmed");
    expect(factor).toBeDefined();
    expect(factor?.points).toBe(25);
  });

  it("does not award Bed need confirmed points for any other examination outcome, or no examination at all", () => {
    const base = movementById("WF-001");
    expect(base.examination).toBeUndefined();
    expect(operationalScore(base, NOW_ANCHOR).factors.find((f) => f.label === "Bed need confirmed")).toBeUndefined();

    const communityOrder: Movement = { ...base, examination: { at: NOW_ANCHOR - 30, outcome: "community_order" } };
    expect(
      operationalScore(communityOrder, NOW_ANCHOR).factors.find((f) => f.label === "Bed need confirmed"),
    ).toBeUndefined();

    const revoked: Movement = { ...base, examination: { at: NOW_ANCHOR - 30, outcome: "revoked" } };
    expect(operationalScore(revoked, NOW_ANCHOR).factors.find((f) => f.label === "Bed need confirmed")).toBeUndefined();
  });

  it("ranks a movement with a confirmed bed need above an otherwise-identical unassessed one — the clinician's rule that review precedes referral", () => {
    const base = movementById("WF-001");
    const unassessed: Movement = { ...base, legalForm: undefined, examination: undefined };
    const confirmed: Movement = {
      ...unassessed,
      examination: { at: NOW_ANCHOR - 30, outcome: "inpatient_order" },
    };
    expect(operationalScore(confirmed, NOW_ANCHOR).score).toBeGreaterThan(
      operationalScore(unassessed, NOW_ANCHOR).score,
    );
  });

  it("awards no Statutory timing points to a legal form with no dueAt", () => {
    // Task 6A: a Form 3B honestly carries no dueAt (the Mental Health Act imposes no
    // post-examination deadline). This must never score as breached, critical or due — the
    // patient's priority rides on "Time waiting" alone, which is precisely the clinician's rule,
    // and this must never gain a compensating bonus for being detained instead.
    const base = movementById("WF-003");
    const noDeadline: Movement = {
      ...base,
      legalForm: { code: "3B", label: "Inpatient treatment order", kind: "detention" },
    };
    const { factors } = operationalScore(noDeadline, NOW_ANCHOR);
    expect(factors.find((factor) => factor.label === "Statutory timing")).toBeUndefined();
  });

  it("explains itself — every point scored is attributed to a named factor", () => {
    for (const movement of wardMovements) {
      const { score, factors } = operationalScore(movement, NOW_ANCHOR);
      expect(factors.reduce((sum, factor) => sum + factor.points, 0)).toBe(score);
      for (const factor of factors) {
        expect(factor.label.length).toBeGreaterThan(0);
        expect(factor.detail.length).toBeGreaterThan(0);
      }
    }
  });

  it("stays inside its stated range so it cannot be read as a percentage of anything", () => {
    for (const movement of wardMovements) {
      const { score } = operationalScore(movement, NOW_ANCHOR);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("does not report a blocker for a movement whose blocker field says there is none", () => {
    for (const id of ["WF-006", "WF-007", "WF-014"]) {
      const movement = movementById(id);
      const { factors } = operationalScore(movement, NOW_ANCHOR);
      expect(factors.find((factor) => factor.label === "Active blocker")).toBeUndefined();
    }
  });

  it("does not report a blocker for a value that only happens to start with 'None'", () => {
    const base = movementById("WF-001");
    const realBlocker: Movement = { ...base, blocker: "None of the secure units can take him" };
    const { factors } = operationalScore(realBlocker, NOW_ANCHOR);
    expect(factors.find((factor) => factor.label === "Active blocker")).toBeDefined();
  });

  it("states the decline count without a self-contradictory fraction against the parallel cap", () => {
    const movement = movementById("WF-009");
    const { factors } = operationalScore(movement, NOW_ANCHOR);
    const declineFactor = factors.find((factor) => factor.label === "Destinations declined");
    expect(declineFactor).toBeDefined();
    expect(declineFactor?.detail).not.toContain(" of 3");
    expect(declineFactor?.detail).toContain("5");
  });

  it("does not claim a transport delay for a movement already en route", () => {
    for (const movement of wardMovements) {
      if (movement.transport?.enRouteAt === undefined) continue;
      const { factors } = operationalScore(movement, NOW_ANCHOR);
      expect(factors.find((factor) => factor.label === "Transport delay")).toBeUndefined();
    }
  });

  it("still claims a transport delay for a movement accepted but not yet departed", () => {
    for (const id of ["WF-005", "WF-015"]) {
      const movement = movementById(id);
      const { factors } = operationalScore(movement, NOW_ANCHOR);
      expect(factors.find((factor) => factor.label === "Transport delay")).toBeDefined();
    }
  });
});

describe("queue order", () => {
  it("puts every tier 1 movement above every tier 2, and every tier 2 above every tier 3", () => {
    const ordered = queueOrder(wardMovements, NOW_ANCHOR);
    const tiers = ordered.map((movement) => movement.urgency);
    expect([...tiers].sort((a, b) => a - b)).toEqual(tiers);
  });

  it("orders by operational score within a tier, highest first", () => {
    const ordered = queueOrder(wardMovements, NOW_ANCHOR);
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index].urgency !== ordered[index - 1].urgency) continue;
      expect(operationalScore(ordered[index - 1], NOW_ANCHOR).score).toBeGreaterThanOrEqual(
        operationalScore(ordered[index], NOW_ANCHOR).score,
      );
    }
  });

  it("excludes closed and arrived movements", () => {
    const ordered = queueOrder(wardMovements, NOW_ANCHOR);
    expect(ordered.every((movement) => !movement.closure && movement.stage !== "arrived")).toBe(true);
    expect(ordered.length).toBe(wardMovements.filter(isOpen).length);
  });

  it("puts a tier 1 movement with a confirmed bed need ahead of a tier 1 movement nobody has assessed — WF-009's examined, confirmed need outranks WF-303's unassessed wait", () => {
    // Real fixture, not a synthetic pair: before this factor existed, WF-303 (no examination,
    // score 61) led every tier-1 movement and WF-009 (examination outcome inpatient_order, score
    // 53) sat behind it. That ordering was exactly backwards under the clinician's rule — a
    // patient confirmed to need a bed should not sit behind one nobody has reviewed.
    const ordered = queueOrder(wardMovements, NOW_ANCHOR);
    const tierOneIds = ordered.filter((movement) => movement.urgency === 1).map((movement) => movement.id);
    expect(tierOneIds.indexOf("WF-009")).toBeLessThan(tierOneIds.indexOf("WF-303"));
  });
});
