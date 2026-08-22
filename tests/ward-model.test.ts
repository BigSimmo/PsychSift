import { describe, expect, it } from "vitest";

import {
  DECLINE_REASONS,
  ED_ACCESS_TARGET_MINUTES,
  MOVEMENT_STAGES,
  PARALLEL_REFERRAL_CAP,
} from "../src/components/ward-management/ward-model";
import { allEmergencyDepartments, allUnits, siteByCode, wardSites } from "../src/components/ward-management/ward-sites";
import { requiresAuthorisedDestination } from "../src/components/ward-management/ward-eligibility";
import { isOpen, unitCapacity } from "../src/components/ward-management/ward-derivations";
import { bedReleases, movementById, wardMovements } from "../src/components/ward-management/ward-movements";

describe("ward model constants", () => {
  it("carries the seven stages in pathway order", () => {
    expect(MOVEMENT_STAGES).toEqual([
      "placement_requested",
      "destination_review",
      "accepted_awaiting_bed",
      "bed_held",
      "handover_ready",
      "moving",
      "arrived",
    ]);
  });

  it("offers a fixed decline vocabulary rather than free text", () => {
    expect(DECLINE_REASONS).toContain("no_bed");
    expect(DECLINE_REASONS).toContain("sex_mix");
    expect(DECLINE_REASONS).toContain("specialling_unavailable");
    expect(DECLINE_REASONS).toContain("acuity_mix");
    expect(DECLINE_REASONS).toContain("capability_mismatch");
    expect(DECLINE_REASONS).toContain("bed_held_for_earlier_referral");
  });

  it("caps parallel referrals so wards are not spammed", () => {
    expect(PARALLEL_REFERRAL_CAP).toBe(3);
  });

  it("pins the ED access target as a departmental performance measure, not a legal clock", () => {
    // Task 6A: the Mental Health Act imposes no post-examination deadline — the clinician
    // confirmed the post-examination clock is elapsed ED wait, counting up, not a legal
    // countdown. This constant is the real, separately named figure from spec §7 (originally the
    // four-hour access target departments are judged on; the product owner superseded that
    // figure to 24 hours on 2026-08-22 — see the constant's own doc comment); Task 11's ED
    // screen renders it against `openedAt`. Pinned here so a later task cannot silently redefine
    // it as, or attach it to, a legal deadline.
    expect(ED_ACCESS_TARGET_MINUTES).toBe(1440);
  });
});

describe("ward sites", () => {
  it("models the eight metro emergency departments", () => {
    const codes = allEmergencyDepartments()
      .map((ed) => ed.siteCode)
      .sort();
    expect(codes).toEqual(["ARM", "FSH", "JHC", "PEEL", "RGH", "RPH", "SCGH", "SJGM"]);
  });

  it("includes sites that have units but no emergency department", () => {
    expect(siteByCode("FRE")?.emergencyDepartment).toBeUndefined();
    expect(siteByCode("FRE")?.units.length).toBeGreaterThan(0);
    expect(siteByCode("BTY")?.emergencyDepartment).toBeUndefined();
  });

  it("includes emergency departments that feed elsewhere and hold no units", () => {
    expect(siteByCode("PEEL")?.emergencyDepartment).toBeDefined();
    expect(siteByCode("PEEL")?.units).toHaveLength(0);
  });

  it("accounts for every bed in every unit exactly once across the five-state grid", () => {
    // The single source of truth for the five-state bed grid is `unitCapacity` — this is the
    // only invariant every unit must satisfy: available + held + blocked + occupied === beds,
    // with none of the four negative. A previous version of this test asserted a third,
    // divergent reading (`occupants + empty + blocked === beds`) that put held beds nowhere
    // and let the real UI formula double-count them without failing.
    for (const unit of allUnits()) {
      const capacity = unitCapacity(unit);
      expect(capacity.available, `${unit.id} available is negative`).toBeGreaterThanOrEqual(0);
      expect(capacity.held, `${unit.id} held is negative`).toBeGreaterThanOrEqual(0);
      expect(capacity.blocked, `${unit.id} blocked is negative`).toBeGreaterThanOrEqual(0);
      expect(capacity.occupied, `${unit.id} occupied is negative`).toBeGreaterThanOrEqual(0);
      expect(
        capacity.available + capacity.held + capacity.blocked + capacity.occupied,
        `${unit.id} five-state grid does not reconcile to its bed count`,
      ).toBe(unit.beds);
    }
  });

  it("keeps at least one older-adult unit at zero allocatable, because scarcity is the norm", () => {
    const olderAdult = allUnits().filter((unit) => unit.cohort === "Older adult");
    expect(olderAdult.length).toBeGreaterThan(2);
    expect(olderAdult.some((unit) => unit.allocatable.value === 0)).toBe(true);
  });

  it("marks private and non-authorised units honestly", () => {
    expect(allUnits().some((unit) => !unit.authorised)).toBe(true);
    expect(wardSites.some((site) => site.service === "Private")).toBe(true);
    expect(wardSites.some((site) => site.service === "WACHS")).toBe(true);
  });
});

const NOW_ANCHOR = 10 * 60 + 42;

describe("ward movements", () => {
  it("runs at realistic pressure, not comfortable pressure", () => {
    expect(wardMovements.length).toBeGreaterThanOrEqual(40);
    expect(wardMovements.length).toBeLessThanOrEqual(60);
    const eds = new Set(wardMovements.map((movement) => movement.originEdId));
    expect(eds.size).toBe(8);
  });

  it("gives every movement an emergency department it is actually sitting in", () => {
    for (const movement of wardMovements) {
      expect(movement.originEdId, `${movement.id} has no origin`).toBeTruthy();
    }
  });

  it("carries no patient identity beyond sex", () => {
    for (const movement of wardMovements) {
      expect(movement.id).toMatch(/^WF-\d{3}$/);
      expect(movement).not.toHaveProperty("name");
      expect(movement).not.toHaveProperty("dateOfBirth");
      expect(movement).not.toHaveProperty("mrn");
      expect(movement).not.toHaveProperty("address");
      expect(movement).not.toHaveProperty("diagnosis");
      expect(movement).not.toHaveProperty("clinicalHistory");
    }
  });

  it("never exceeds the parallel referral cap", () => {
    for (const movement of wardMovements) {
      expect(movement.referredUnitIds.length).toBeLessThanOrEqual(PARALLEL_REFERRAL_CAP);
    }
  });

  it("never leaves an open movement without an owner", () => {
    for (const movement of wardMovements) {
      if (movement.closure) continue;
      expect(movement.owner.length, `${movement.id} is ownerless`).toBeGreaterThan(0);
    }
  });

  it("gives every non-voluntary movement a legal form with a deadline", () => {
    for (const movement of wardMovements) {
      if (!requiresAuthorisedDestination(movement.legalStatus)) continue;
      expect(movement.legalForm, `${movement.id} has no legal form`).toBeDefined();
    }
  });

  it("includes the states the old fixture could not express", () => {
    expect(wardMovements.some((movement) => movement.stage === "accepted_awaiting_bed")).toBe(true);
    expect(wardMovements.some((movement) => movement.declines.length >= 3)).toBe(true);
    expect(wardMovements.some((movement) => movement.statusChanges.length > 0)).toBe(true);
    expect(wardMovements.some((movement) => movement.closure?.outcome === "did_not_proceed")).toBe(true);
    expect(wardMovements.some((movement) => (movement.legalForm?.dueAt ?? Infinity) < NOW_ANCHOR)).toBe(true);
  });

  it("never records a decline against a unit that is also a live referral", () => {
    for (const movement of wardMovements) {
      for (const decline of movement.declines) {
        expect(movement.referredUnitIds).not.toContain(decline.unitId);
      }
    }
  });

  it("flags bed releases without any departing-patient detail", () => {
    expect(bedReleases.length).toBeGreaterThan(4);
    // A bed release "carries no detail whatsoever about the departing patient" (spec §4) —
    // checking for absent properties alone previously missed free-text `blocker` strings that
    // named a patient's legal status, disability, family member, or discharge destination.
    const forbiddenSubstrings = ["patient", "family", "tribunal", "ndis", "aged care", "discharge order"];
    for (const release of bedReleases) {
      expect(release.id).toMatch(/^WR-\d{3}$/);
      expect(release).not.toHaveProperty("name");
      expect(release).not.toHaveProperty("mrn");
      expect(release).not.toHaveProperty("diagnosis");
      const blockerLower = release.blocker.toLowerCase();
      for (const forbidden of forbiddenSubstrings) {
        expect(
          blockerLower.includes(forbidden),
          `${release.id} blocker "${release.blocker}" mentions "${forbidden}"`,
        ).toBe(false);
      }
    }
  });

  it("returns undefined for an unknown movement rather than a different patient", () => {
    expect(movementById("WF-999")).toBeUndefined();
  });

  it("closes every movement that is arrived or did-not-proceed, and leaves every other movement open", () => {
    for (const movement of wardMovements) {
      const shouldBeOpen = !movement.closure && movement.stage !== "arrived";
      expect(isOpen(movement), `${movement.id} open/closed disagrees with its own fields`).toBe(shouldBeOpen);
    }
    // The dataset must actually exercise both branches, or this test proves nothing.
    expect(wardMovements.some((movement) => isOpen(movement))).toBe(true);
    expect(wardMovements.some((movement) => !isOpen(movement))).toBe(true);
  });

  it("gives every generated movement the fields its own stage implies", () => {
    // The hand-authored seeded movements always keep acceptedUnitId/transport/closure
    // consistent with their stage; the generated routine movements must too, or a movement
    // can render as "Moving" with no transport job anywhere in the app.
    for (const movement of wardMovements) {
      if (movement.stage === "accepted_awaiting_bed" || movement.stage === "bed_held") {
        expect(movement.acceptedUnitId, `${movement.id} is ${movement.stage} with no accepted unit`).toBeDefined();
      }
      if (movement.stage === "moving") {
        expect(movement.transport?.enRouteAt, `${movement.id} is moving with no transport en route`).toBeDefined();
      }
      if (movement.stage === "arrived") {
        expect(movement.closure, `${movement.id} is arrived with no closure`).toBeDefined();
      }
    }
  });
});
