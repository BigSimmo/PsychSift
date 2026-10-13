import { describe, expect, it } from "vitest";

import { meetsCssPxFloor, subpixelTolerance } from "./helpers/layout-tolerance";

/**
 * The offline proof for the Firefox sub-pixel fix.
 *
 * Firefox and WebKit cannot be installed in every environment this repository
 * is worked in (`cdn.playwright.dev` is blocked in Claude Cloud), so the change
 * that made three `release-browser-matrix` Firefox failures pass could not be
 * demonstrated by running Firefox. What can be demonstrated, and is worth more
 * than a green run anyway, is the arithmetic: these are the exact values
 * Firefox printed in run 35503893104, asserted against the real predicate.
 *
 * The second half is the half that matters. A tolerance is only safe if it
 * still fails a real regression, so every floor here is also pinned from below.
 */
describe("meetsCssPxFloor", () => {
  it("accepts the three values Firefox actually reported", () => {
    // A 16px card gap Firefox reported (formerly tests/ui-formulation-result-cards.spec.ts).
    expect(meetsCssPxFloor(15.999969482421875, 16)).toBe(true);
    // tests/ui-stress.spec.ts:624 — a 12px medication column gap.
    expect(meetsCssPxFloor(11.999954223632812, 12)).toBe(true);
    // tests/ui-smoke.spec.ts:754 — a 48px tap target, plus its 2px allowance.
    expect(meetsCssPxFloor(45.98333740234375 + 2, 48)).toBe(true);
  });

  it("still fails a real regression at each of those floors", () => {
    // One whole pixel lost is a layout change, not engine rounding.
    expect(meetsCssPxFloor(15, 16)).toBe(false);
    expect(meetsCssPxFloor(11, 12)).toBe(false);
    // A 44px control offered where 48px is required, allowance included.
    expect(meetsCssPxFloor(44 + 2, 48)).toBe(false);
  });

  it("absorbs one Firefox app unit and little more", () => {
    // Firefox stores layout in app units of 1/60 CSS px, so one unit short of a
    // floor is the smallest miss the engine can express. The tolerance must
    // cover that and stay far below anything a stylesheet could mean.
    const oneAppUnit = 1 / 60;
    expect(subpixelTolerance).toBeGreaterThan(oneAppUnit);
    expect(subpixelTolerance).toBeLessThan(0.5);
    expect(meetsCssPxFloor(48 - oneAppUnit, 48)).toBe(true);
    expect(meetsCssPxFloor(48 - 0.5, 48)).toBe(false);
  });

  it("treats an exact hit and a comfortable clearance as passing", () => {
    expect(meetsCssPxFloor(16, 16)).toBe(true);
    expect(meetsCssPxFloor(24, 16)).toBe(true);
  });
});
