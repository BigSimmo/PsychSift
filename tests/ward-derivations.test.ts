// tests/ward-derivations.test.ts
import { describe, expect, it } from "vitest";

import { clockState } from "../src/components/ward-management/ward-clock";
import {
  buildActionInbox,
  eligibleCandidates,
  restrictionNotice,
  transportLeg,
} from "../src/components/ward-management/ward-derivations";
import { eligibility } from "../src/components/ward-management/ward-eligibility";
import { PARALLEL_REFERRAL_CAP, type TransportJob } from "../src/components/ward-management/ward-model";
import { wardMovements } from "../src/components/ward-management/ward-movements";
import { allUnits, NOW_ANCHOR } from "../src/components/ward-management/ward-sites";

function transportJob(overrides: Partial<TransportJob> = {}): TransportJob {
  return {
    id: "TR-TEST",
    provider: "St John WA",
    escortRequired: true,
    ...overrides,
  };
}

describe("buildActionInbox", () => {
  // RULING 1 (Task 8): buildActionInbox used to build each of its three categories with
  // `.find()`, so it could only ever report one movement per category. The real fixture at
  // NOW_ANCHOR carries more than one qualifying movement in two of the three categories — a
  // drawer built on `.find()` would tell a coordinator a single legal breach exists when several
  // do. Expected numbers here are derived from `wardMovements` itself, never hard-coded, so this
  // test keeps proving the real count rather than pinning today's fixture size.
  it("emits one item per movement that carries a breached legal deadline, not just the first", () => {
    const expectedIds = wardMovements
      .filter(
        (movement) =>
          movement.legalForm?.dueAt !== undefined && clockState(movement.legalForm.dueAt, NOW_ANCHOR) === "breached",
      )
      .map((movement) => `legal-${movement.id}`)
      .sort();

    const items = buildActionInbox(wardMovements, NOW_ANCHOR)
      .filter((item) => item.id.startsWith("legal-"))
      .map((item) => item.id)
      .sort();

    expect(expectedIds.length).toBeGreaterThan(1);
    expect(items).toEqual(expectedIds);
  });

  it("emits one item per movement that reached the parallel-referral cap, not just the first", () => {
    const expectedIds = wardMovements
      .filter((movement) => movement.declines.length >= PARALLEL_REFERRAL_CAP)
      .map((movement) => `declines-${movement.id}`)
      .sort();

    const items = buildActionInbox(wardMovements, NOW_ANCHOR)
      .filter((item) => item.id.startsWith("declines-"))
      .map((item) => item.id)
      .sort();

    expect(items).toEqual(expectedIds);
  });

  it("emits one item per movement with transport accepted but not yet en route, not just the first", () => {
    const expectedIds = wardMovements
      .filter(
        (movement) =>
          movement.transport?.acceptedAt !== undefined &&
          movement.transport.enRouteAt === undefined &&
          movement.transport.cancelledAt === undefined,
      )
      .map((movement) => `transport-${movement.id}`)
      .sort();

    const items = buildActionInbox(wardMovements, NOW_ANCHOR)
      .filter((item) => item.id.startsWith("transport-"))
      .map((item) => item.id)
      .sort();

    expect(expectedIds.length).toBeGreaterThan(1);
    expect(items).toEqual(expectedIds);
  });

  // The drawer's toggle count and the drawer's own rendered rows must agree (Task 8 ruling 3).
  // This is the model-side half of that guarantee: the total item count really is the sum of
  // every category's own real count, never a number computed independently of the rows below it.
  it("lists expired bed holds so a lapsed reservation cannot disappear silently", () => {
    const expired = wardMovements.find((movement) => movement.id === "WF-004")!;
    expect(expired.bedHeldUntil).toBeLessThan(NOW_ANCHOR);

    expect(buildActionInbox(wardMovements, NOW_ANCHOR)).toContainEqual(
      expect.objectContaining({
        id: "bed-hold-WF-004",
        title: "Bed hold expired",
        movementId: "WF-004",
      }),
    );
  });

  it("returns exactly as many items as the four categories combined — no more, no fewer", () => {
    const legalCount = wardMovements.filter(
      (movement) =>
        movement.legalForm?.dueAt !== undefined && clockState(movement.legalForm.dueAt, NOW_ANCHOR) === "breached",
    ).length;
    const declineCount = wardMovements.filter((movement) => movement.declines.length >= PARALLEL_REFERRAL_CAP).length;
    const transportCount = wardMovements.filter(
      (movement) =>
        movement.transport?.acceptedAt !== undefined &&
        movement.transport.enRouteAt === undefined &&
        movement.transport.cancelledAt === undefined,
    ).length;
    const expiredHoldCount = wardMovements.filter(
      (movement) =>
        movement.stage === "bed_held" && movement.bedHeldUntil !== undefined && movement.bedHeldUntil < NOW_ANCHOR,
    ).length;

    expect(buildActionInbox(wardMovements, NOW_ANCHOR)).toHaveLength(
      legalCount + declineCount + transportCount + expiredHoldCount,
    );
  });

  it("gives every item a unique id even with several movements in the same category", () => {
    const items = buildActionInbox(wardMovements, NOW_ANCHOR);
    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Task 6A: WF-003 is a real fixture Form 3B, which now honestly carries no dueAt (the Mental
  // Health Act imposes no post-examination deadline). It must never surface a "legal-WF-003"
  // inbox item, however long it has been open — a form with no deadline is never breached.
  it("never lists a legal-timing item for a movement whose form has no dueAt", () => {
    const movement = wardMovements.find((candidate) => candidate.id === "WF-003");
    expect(movement?.legalForm?.code).toBe("3B");
    expect(movement?.legalForm?.dueAt).toBeUndefined();

    const items = buildActionInbox(wardMovements, NOW_ANCHOR);
    expect(items.find((item) => item.id === "legal-WF-003")).toBeUndefined();
  });
});

describe("eligibleCandidates", () => {
  it("evaluates candidates against the caller's live unit state", () => {
    const movement = wardMovements.find((candidate) => candidate.id === "WF-001")!;
    const liveUnits = allUnits();
    const original = eligibleCandidates(movement, NOW_ANCHOR, Number.POSITIVE_INFINITY, liveUnits).find(
      (candidate) => candidate.unit.id === "rph-adult-secure",
    );
    expect(original?.verdict.eligible).toBe(true);

    const exhaustedUnits = liveUnits.map((unit) =>
      unit.id === "rph-adult-secure" ? { ...unit, allocatable: { ...unit.allocatable, value: 0 } } : unit,
    );
    const exhausted = eligibleCandidates(movement, NOW_ANCHOR, Number.POSITIVE_INFINITY, exhaustedUnits).find(
      (candidate) => candidate.unit.id === "rph-adult-secure",
    );
    expect(exhausted?.verdict.eligible).toBe(false);
  });

  // Fix round 1, Finding 2. The two-pass truncate-then-reorder fix only had incidental coverage
  // before this: one Playwright assertion on one unit name for one movement, and the vitest
  // contract test that also exercises this function calls it with `Number.POSITIVE_INFINITY`, so
  // truncation never engages there at all. This pins the actual invariant directly, against the
  // real fixture: reordering by restrictiveness must never change WHICH candidates are in the
  // top-`PARALLEL_REFERRAL_CAP` cut, only their order within it. Restoring the original one-pass
  // version (reorder-then-truncate) turns this red — see the task report for the captured output.
  //
  // The "expected" set below is deliberately reimplemented from `allUnits()`/`eligibility()`
  // directly, never derived by calling `eligibleCandidates(..., Infinity)` — an Infinity call
  // still runs the function's OWN second (restriction-reorder) pass over the whole cohort, which
  // would make the oracle circular: re-sorting that already-reordered array by eligibility alone
  // does not recover the raw `allUnits()`-order tie-break, so slicing it would silently compare
  // the implementation against a copy of itself instead of an independent ground truth.
  it("reorders by restrictiveness within the eligible-first cut without ever changing which candidates are in it", () => {
    const CAP = PARALLEL_REFERRAL_CAP;
    let provedAMixedReorder = false;

    for (const movement of wardMovements) {
      const cohortUnits = allUnits().filter((unit) => unit.cohort === movement.cohort);
      if (cohortUnits.length <= CAP) continue; // truncation never engages for this movement

      const eligibleFirstOnly = cohortUnits
        .map((unit) => ({ unit, verdict: eligibility(movement, unit, NOW_ANCHOR) }))
        .sort((a, b) => Number(b.verdict.eligible) - Number(a.verdict.eligible))
        .slice(0, CAP);

      const capped = eligibleCandidates(movement, NOW_ANCHOR, CAP);
      const cappedIds = new Set(capped.map((candidate) => candidate.unit.id));
      const expectedIds = new Set(eligibleFirstOnly.map((candidate) => candidate.unit.id));
      expect(cappedIds, `${movement.id}: top-${CAP} membership must match the eligible-first cut`).toEqual(expectedIds);

      // Only counts as proof of the REORDER (not just the slice) if this movement's cut actually
      // mixes a restricted and an unrestricted candidate — otherwise the second sort pass is a
      // no-op for this movement and it proves nothing about reordering, only about truncation.
      const anyRestricted = capped.some((candidate) => restrictionNotice(movement, candidate.unit) !== undefined);
      const anyUnrestricted = capped.some((candidate) => restrictionNotice(movement, candidate.unit) === undefined);
      if (anyRestricted && anyUnrestricted) provedAMixedReorder = true;
    }

    expect(
      provedAMixedReorder,
      "fixture assumption: at least one movement's top-N cut mixes restricted and unrestricted candidates",
    ).toBe(true);
  });
});

describe("transportLeg", () => {
  // RULING (Task 10 prep): transportStatusLabel mixes the discrete transport leg with
  // provider prose, so a caller that needs "which leg is this job on" cannot use it directly —
  // two of its seven outputs embed the provider name instead of a leg name. transportLeg
  // exists to give that caller a value that is always exactly one of the five capitalised leg
  // names, or a distinct "Cancelled"/absent value, never prose. The real fixture only exercises
  // "Accepted" and "En route" (all 8 transport jobs carry acceptedAt; 6 of those also carry
  // enRouteAt), so every case here is built directly rather than pulled from wardMovements —
  // otherwise this test would silently prove far less than its name claims.

  it("returns undefined when the movement carries no transport job at all", () => {
    expect(transportLeg(undefined)).toBeUndefined();
  });

  it("returns Requested for a transport job with no stamps at all", () => {
    expect(transportLeg(transportJob())).toBe("Requested");
  });

  it("returns Accepted once acceptedAt is stamped", () => {
    expect(transportLeg(transportJob({ acceptedAt: NOW_ANCHOR - 10 }))).toBe("Accepted");
  });

  it("returns En route once enRouteAt is stamped", () => {
    expect(transportLeg(transportJob({ acceptedAt: NOW_ANCHOR - 20, enRouteAt: NOW_ANCHOR - 10 }))).toBe("En route");
  });

  it("returns Collected once collectedAt is stamped", () => {
    expect(
      transportLeg(
        transportJob({ acceptedAt: NOW_ANCHOR - 30, enRouteAt: NOW_ANCHOR - 20, collectedAt: NOW_ANCHOR - 10 }),
      ),
    ).toBe("Collected");
  });

  it("returns Arrived once arrivedAt is stamped", () => {
    expect(
      transportLeg(
        transportJob({
          acceptedAt: NOW_ANCHOR - 40,
          enRouteAt: NOW_ANCHOR - 30,
          collectedAt: NOW_ANCHOR - 20,
          arrivedAt: NOW_ANCHOR - 10,
        }),
      ),
    ).toBe("Arrived");
  });

  it("returns Cancelled when cancelledAt is stamped, distinct from every leg", () => {
    expect(transportLeg(transportJob({ cancelledAt: NOW_ANCHOR - 5 }))).toBe("Cancelled");
  });

  it("resolves precedence to the furthest-progressed stamp when several are set at once, and cancelledAt always wins", () => {
    const fullyProgressed = transportJob({
      acceptedAt: NOW_ANCHOR - 40,
      enRouteAt: NOW_ANCHOR - 30,
      collectedAt: NOW_ANCHOR - 20,
      arrivedAt: NOW_ANCHOR - 10,
    });
    expect(transportLeg(fullyProgressed)).toBe("Arrived");

    const cancelledAfterProgress = transportJob({
      acceptedAt: NOW_ANCHOR - 40,
      enRouteAt: NOW_ANCHOR - 30,
      collectedAt: NOW_ANCHOR - 20,
      arrivedAt: NOW_ANCHOR - 10,
      cancelledAt: NOW_ANCHOR - 5,
    });
    expect(transportLeg(cancelledAfterProgress)).toBe("Cancelled");
  });
});
