import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { elapsedLabel } from "../src/components/ward-management/ward-derivations";
import { MOVEMENT_STAGES, PARALLEL_REFERRAL_CAP } from "../src/components/ward-management/ward-model";
import { movementById, wardMovements } from "../src/components/ward-management/ward-movements";
import { NOW_ANCHOR, allUnits } from "../src/components/ward-management/ward-sites";
import { toolCatalogRecordById } from "../src/lib/tools-catalog";

const modesSource = readFileSync("src/components/ward-management/ward-management-modes.tsx", "utf8");

/**
 * The mode strip renders one literal `<Link href="...">` per view so
 * `tests/route-reachability.test.ts` can find the hrefs by static AST scan. Reading the
 * source back is therefore the only way to assert the strip and the routes agree.
 */
function wardModeHrefs() {
  const source = readFileSync("src/components/ward-management/ward-management-navigation.tsx", "utf8");
  const modeStrip = source.slice(source.indexOf("export function WardModeNavigation"));
  return [...modeStrip.matchAll(/href="(\/ward-management[^"]*)"/g)].map((match) => match[1]);
}

function routeFileFor(href: string) {
  return `src/app${href}/page.tsx`;
}

describe("Ward Flow synthetic prototype", () => {
  it("declares every queue and capacity header as a column header", () => {
    const thTags = [...modesSource.matchAll(/<th(?:\s[^>]*)?>/g)].map((match) => match[0]);
    expect(thTags).toHaveLength(12);
    expect(thTags.every((tag) => tag.includes('scope="col"'))).toBe(true);
  });

  it("keeps the production route reachable from the Tools catalogue", () => {
    expect(toolCatalogRecordById("ward-management").href).toBe("/ward-management");
  });

  it("maps every Ward Flow view to a distinct reachable route", () => {
    const hrefs = wardModeHrefs();
    expect(hrefs).toEqual([
      "/ward-management",
      "/ward-management/network",
      "/ward-management/queue",
      "/ward-management/capacity",
      "/ward-management/movements",
      "/ward-management/exceptions",
      "/ward-management/transport",
      "/ward-management/governance",
    ]);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) {
      expect(existsSync(routeFileFor(href)), `${href} has no page.tsx`).toBe(true);
    }
  });

  it("uses only synthetic operational movement identifiers and minimised fields", () => {
    expect(wardMovements).toHaveLength(48);
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

  it("keeps human urgency tiers within range and referrals within the parallel-referral cap", () => {
    for (const movement of wardMovements) {
      expect([1, 2, 3]).toContain(movement.urgency);
      expect(movement.referredUnitIds.length).toBeLessThanOrEqual(PARALLEL_REFERRAL_CAP);
    }
  });

  it("models the approved seven movement stages, counts derived from the movements themselves", () => {
    expect([...MOVEMENT_STAGES]).toEqual([
      "placement_requested",
      "destination_review",
      "accepted_awaiting_bed",
      "bed_held",
      "handover_ready",
      "moving",
      "arrived",
    ]);
    const total = MOVEMENT_STAGES.reduce(
      (sum, stage) => sum + wardMovements.filter((movement) => movement.stage === stage).length,
      0,
    );
    expect(total).toBe(wardMovements.length);
  });

  it("models units with a real five-figure capacity picture, not a single available count", () => {
    for (const unit of allUnits()) {
      expect(unit).toEqual(
        expect.objectContaining({
          beds: expect.any(Number),
          held: expect.any(Number),
          blocked: expect.any(Number),
          empty: expect.objectContaining({ value: expect.any(Number), confirmedAt: expect.any(Number) }),
          allocatable: expect.objectContaining({ value: expect.any(Number), confirmedAt: expect.any(Number) }),
        }),
      );
    }
  });

  it("preserves plain-language legal status and form readiness", () => {
    const referredMovement = movementById("WF-001");
    expect(referredMovement?.legalStatus).toBe("Referred for psychiatric examination");
    expect(referredMovement?.legalForm?.code).toBe("1A");
    expect(referredMovement?.legalForm?.label).toBe("Referral for examination");
  });

  it("labels how long a movement has been waiting, not how overdue it is", () => {
    // WF-001 opened 95 minutes before NOW_ANCHOR — this exercises elapsedLabel itself
    // (not just formatElapsed) so a future transposition of its minutesUntil arguments
    // back to the original bug (minutesUntil(movement.openedAt, now), which yields a
    // negative/clamped duration) fails this assertion.
    const movement = movementById("WF-001");
    expect(movement).toBeDefined();
    expect(elapsedLabel(movement!, NOW_ANCHOR)).toBe("1h 35m waiting");
  });
});
