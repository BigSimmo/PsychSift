import { expect, test } from "playwright/test";
import {
  blockExternalRequests,
  modeHomeRoutes,
  dashboardRoutes,
  longRoutes,
  phoneViewport,
  gotoPhoneSurface,
  addPhoneScrollRunway,
  readGeometry,
  installFlipCounter,
  readFlipCount,
  dragScrollBy,
} from "./helpers/phone-scroll";

/**
 * Per-route phone scroll sweep: every standalone mode home, the dashboard
 * scrollers, and the representative long pages must scroll smoothly and stay
 * bottom-stable through a chrome collapse, without hide/reveal oscillation.
 *
 * This is the breadth half of the guardrail — one case per route. The shared
 * header's own hide/reveal mechanics are in ui-phone-scroll.spec.ts.
 */

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page);
});

for (const route of [...modeHomeRoutes, ...dashboardRoutes, ...longRoutes]) {
  test(`phone scroll stays smooth and bottom-stable on ${route}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize(phoneViewport);
    await gotoPhoneSurface(page, route);
    await addPhoneScrollRunway(page);
    await installFlipCounter(page);

    const initial = await readGeometry(page);
    // Regular browser phone routes deliberately use the document scroller so
    // Safari can minimize its browser UI; standalone CSS retains an internal
    // scroller and is covered by the static display-mode contract.
    expect(initial.scrollOwner, "browser phone route must expose document scrolling to Safari").toBe("document");
    expect(initial.docScrollableExcess, "browser document owns vertical runway").toBeGreaterThan(0);
    expect(initial.horizontalOverflow, "no horizontal overflow").toBeLessThanOrEqual(2);
    expect(initial.scrollTop).toBe(0);
    expect(initial.headerHidden, "header visible at the top").toBe(false);
    // Mode/route reserve flips snap (0s). Padding only animates while
    // data-bottom-composer-hidden="true" (scroll-hide), asserted below.
    expect(initial.reserveTransitionDuration, "visible reserve must snap on mode/route flips").toBe("0s");

    // Drag to the bottom in deliberate 24px steps, then let transitions settle.
    await dragScrollBy(page, initial.maxOffset + 400, 24);
    await expect
      .poll(async () => {
        const geo = await readGeometry(page);
        return Math.abs(geo.scrollTop - geo.maxOffset) <= 2;
      })
      .toBe(true);
    const flipsAfterDescent = await readFlipCount(page);
    const atBottom = await readGeometry(page);

    // No dead band: the settled position sits on the real bottom edge of the
    // settled geometry (this is what "locks to the bottom" violated — the
    // offset was pinned to a phantom bottom short of the content).
    expect(
      Math.abs(atBottom.scrollTop - atBottom.maxOffset),
      "settled scroll sits on the true bottom edge",
    ).toBeLessThanOrEqual(2);
    // Reserve padding only animates while the short-lived
    // data-reserve-transitioning marker is on (hide/reveal). Once settled,
    // transitionDuration returns to 0s — the 240ms rule is pinned in
    // clinical-dashboard-merge-artifacts / globals.css.
    // At most one chrome transition on a pure descent (hide, when the page is
    // long enough to afford it) — more means hide/reveal oscillation.
    expect(flipsAfterDescent, "no chrome oscillation while scrolling down").toBeLessThanOrEqual(1);

    // Oscillation check: geometry must be quiet AFTER settling — no further
    // flips while the user holds still at the bottom.
    await page.waitForTimeout(400);
    expect(await readFlipCount(page), "no chrome flips while resting at the bottom").toBe(flipsAfterDescent);

    // Small deliberate nudges AT the bottom edge are the oscillation trigger:
    // pre-fix, a 32px up-drag revealed the chrome (restoring ~180px of
    // geometry under the finger), the next down-drag re-hid it, and so on —
    // the "locks to the bottom" thrash. The collapse-budget gate permits at
    // most the one legitimate reveal for in-flow chrome and refuses to re-hide
    // with no runway left. A zero-budget overlay can safely follow all three
    // deliberate direction changes because it releases no layout geometry.
    for (const nudge of [-32, 48, -32]) {
      await dragScrollBy(page, nudge, 8);
      await page.waitForTimeout(350);
    }
    const flipsAfterNudges = await readFlipCount(page);
    const allowedNudgeFlips = initial.headerMotion === "overlay" ? 3 : 1;
    expect(flipsAfterNudges - flipsAfterDescent, "bottom-edge nudges must not thrash the chrome").toBeLessThanOrEqual(
      allowedNudgeFlips,
    );
    await page.waitForTimeout(400);
    expect(await readFlipCount(page), "no chrome flips after the nudges settle").toBe(flipsAfterNudges);

    // Top must be reachable with the header visible again.
    await dragScrollBy(page, -(atBottom.maxOffset + 800), 48);
    await expect
      .poll(async () => {
        const geo = await readGeometry(page);
        return geo.scrollTop === 0 && !geo.headerHidden;
      })
      .toBe(true);
    const backAtTop = await readGeometry(page);
    expect(backAtTop.scrollTop, "top reachable after the round trip").toBe(0);
    expect(backAtTop.headerHidden, "header visible back at the top").toBe(false);
    expect(backAtTop.horizontalOverflow).toBeLessThanOrEqual(2);
  });
}

// One larger-phone pass over the worst offender to catch viewport-dependent
// regressions (the 390x844 sweep above is the canonical size).
//
// The long mechanism list moved to `/formulation/search` when `/formulation`
// became a redirect onto the shared home. The runway is the point of this test —
// it deliberately does NOT call addPhoneScrollRunway — so it follows the content.
test("phone scroll stays smooth on /formulation/search at 430x932", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 430, height: 932 });
  await gotoPhoneSurface(page, "/formulation/search");
  await installFlipCounter(page);

  const initial = await readGeometry(page);
  expect(initial.scrollOwner).toBe("document");
  expect(initial.docScrollableExcess).toBeGreaterThan(0);

  await dragScrollBy(page, initial.maxOffset + 400, 24);
  await expect
    .poll(async () => {
      const geo = await readGeometry(page);
      return Math.abs(geo.scrollTop - geo.maxOffset) <= 2;
    })
    .toBe(true);
  const atBottom = await readGeometry(page);
  expect(Math.abs(atBottom.scrollTop - atBottom.maxOffset)).toBeLessThanOrEqual(2);
  expect(await readFlipCount(page)).toBeLessThanOrEqual(1);
});

/**
 * Forms/services search used to keep focus=1 after submit. Composer focus
 * pins both chrome edges, so neither header nor the bottom dock (white
 * safe-area rail) could hide while scrolling results.
 */
test("phone forms search hides header and footer after submit without stale focus", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize(phoneViewport);
  await gotoPhoneSurface(page, "/forms?q=Form&run=1&focus=1");
  await expect(page.locator("form.answer-footer-search-dock")).toBeVisible({ timeout: 20_000 });

  // Stale focus=1 on a submitted result view must not win — the shell blurs.
  const input = page.locator('[data-testid="global-search-input"]:visible').first();
  await expect(input).not.toBeFocused({ timeout: 5_000 });

  const initial = await readGeometry(page);
  expect(initial.headerHidden, "header visible at the top").toBe(false);

  await dragScrollBy(page, Math.min(Math.max(initial.maxOffset, 240), 800), 24);
  await expect
    .poll(async () => {
      const geo = await readGeometry(page);
      return geo.headerHidden;
    })
    .toBe(true);

  const afterHide = await page.evaluate(() => {
    const collapse = document.querySelector<HTMLElement>('[data-testid="universal-header-collapse"]');
    const dock = document.querySelector<HTMLElement>("form.answer-footer-search-dock");
    const reserve = document.querySelector<HTMLElement>('[data-testid="mobile-composer-reserve-pad"]');
    const dockRect = dock?.getBoundingClientRect();
    return {
      usesCollapse: collapse !== null && collapse.getAttribute("data-phone-motion") !== "overlay",
      headerHidden: collapse?.getAttribute("data-scroll-hidden") === "true",
      dockHidden: dock?.getAttribute("data-scroll-hidden") === "true",
      reservePb: reserve ? getComputedStyle(reserve).paddingBottom : "",
      dockTop: dockRect?.top ?? -1,
      viewportHeight: window.innerHeight,
      inputFocused: document.activeElement?.getAttribute("data-testid") === "global-search-input",
    };
  });

  expect(afterHide.inputFocused, "scroll must not leave the dock focused").toBe(false);
  expect(afterHide.headerHidden, "header hides on forms result scroll").toBe(true);
  expect(afterHide.dockHidden, "footer dock hides on forms result scroll").toBe(true);
  expect(afterHide.dockTop, "hidden dock clears the viewport bottom").toBeGreaterThanOrEqual(
    afterHide.viewportHeight - 1,
  );
  expect(Number.parseFloat(afterHide.reservePb) || 0, "hidden reserve releases the bottom rail").toBeLessThanOrEqual(1);
});

test("phone route flips under reducedMotion: 'reduce' preserve layout and scroll owner", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize(phoneViewport);
  await gotoPhoneSurface(page, "/calculators");
  await addPhoneScrollRunway(page);
  const initial = await readGeometry(page);
  expect(initial.scrollOwner, "browser route uses document scrolling").toBe("document");
  expect(initial.headerHidden, "header visible at top").toBe(false);
});
