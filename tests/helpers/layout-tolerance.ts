import { expect, type Locator } from "playwright/test";

/**
 * Comparing a measured CSS length against a floor, without failing on the
 * engine's own rounding.
 *
 * `release-browser-matrix` had three Firefox failures of one shape, and none
 * of them was a layout regression:
 *
 * - `ui-formulation-result-cards`: a 16px card gap measured 15.999969482421875
 * - `ui-stress`: a 12px medication column gap measured 11.999954223632812
 * - `ui-smoke`: a 48px tap target, already allowed 2px of slack, measured
 *   47.98333740234375 against that allowance
 *
 * Two causes, one class. The gaps are subtractions of two `getBoundingClientRect`
 * values, so they carry IEEE-754 error from the subtraction itself. The tap
 * target is Firefox's layout quantum: Firefox stores layout in app units of
 * 1/60 CSS px, so 47.98333740234375 is exactly 2879/60 — one app unit below the
 * boundary, the smallest miss the engine is capable of expressing.
 *
 * `subpixelTolerance` is therefore sized to swallow one Firefox app unit
 * (0.0167px) with room to spare, and nothing larger. It is three orders of
 * magnitude below any difference a person could see or a stylesheet could
 * intend, so a gap that genuinely collapses to 15px, or a control that genuinely
 * shrinks to 44px, still fails exactly as before. Widening this number to make
 * a test pass would be quarantining that test in disguise; fix the layout, or
 * change the floor deliberately and say why.
 *
 * Deliberately not applied to `toBeLessThanOrEqual` overflow ceilings
 * (`ceilingOverflow`, `rightEdgeOverflow`, and friends). Those already allow a
 * whole pixel, which is sixty app units — they have never been near this class
 * of failure, and loosening a ceiling errs towards admitting real overflow.
 */
export const subpixelTolerance = 0.05;

/**
 * Whether `actual` clears a `minimum` CSS-pixel floor once engine rounding is
 * discounted.
 *
 * Split out as a pure predicate so the floor can be proved offline. Firefox and
 * WebKit cannot be installed in every environment this repository is worked in
 * — `cdn.playwright.dev` is not on the egress allowlist in Claude Cloud — so
 * `tests/layout-tolerance.test.ts` pins the real measured values from the CI log
 * against this function rather than against a copy of its arithmetic.
 */
export function meetsCssPxFloor(actual: number, minimum: number): boolean {
  return actual >= minimum - subpixelTolerance;
}

/**
 * Asserts `actual` is at least `minimum` CSS pixels, ignoring sub-pixel rounding.
 *
 * `label` rides along as the assertion message, because these failures are read
 * from a CI log with no page in front of you — "compact cross-mode link width"
 * is worth far more there than a bare pair of numbers.
 */
export function expectAtLeastCssPx(actual: number, minimum: number, label: string): void {
  expect(meetsCssPxFloor(actual, minimum), `${label}: ${actual}px is below the ${minimum}px floor`).toBe(true);
}

/**
 * Asserts a control is big enough to hit.
 *
 * `ui-smoke` and `ui-tools` each carried a byte-identical private copy of this,
 * which is how the Firefox tap-target failure was fixed in one spec and left
 * live in the other. One definition now, so the pair cannot drift.
 *
 * `measurementTolerance` is the pre-existing 2px allowance for engine layout
 * differences and is unchanged — the substantive floor is still "within 2px of
 * `minSize`". Only the sub-pixel comparison below it is new.
 *
 * `minSize` defaults to 44 (WCAG 2.5.5), and production chrome passes 48 for the
 * repository's `min-h-12` tap targets. Do not lower a 48 call site to 44 to make
 * a run green: that reintroduces the known `ui-smoke` flake AGENTS.md calls out.
 */
export async function expectMinTouchTarget(locator: Locator, minSize = 44): Promise<void> {
  // `boundingBox()` does not wait: it returns null for a target that is attached
  // but mid re-render, which WebKit hit on the diagnosis detail page. Wait for
  // the target to paint first; a target that never paints still fails here.
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const measurementTolerance = 2;
  expectAtLeastCssPx(box!.height + measurementTolerance, minSize, "tap target height");
  expectAtLeastCssPx(box!.width + measurementTolerance, minSize, "tap target width");
}
