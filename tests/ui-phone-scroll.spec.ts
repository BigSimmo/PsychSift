import { expect, test } from "playwright/test";
import {
  blockExternalRequests,
  appModeHeaderRoutes,
  pageOwnedHeaderRoutes,
  phoneViewport,
  gotoPhoneSurface,
  emulatePhoneStandalonePwa,
  readStandaloneShellGeometry,
  addPhoneScrollRunway,
  installFlipCounter,
  readFlipCount,
  dragScrollBy,
} from "./helpers/phone-scroll";
import { visibleByTestId } from "./playwright-settlement";

/**
 * Shared shell phone chrome: the universal collapse owner, per-mode top-edge
 * release, portaled addon focus pinning, and the header hide/reveal animation
 * and safe-area band.
 *
 * This file keeps the original name because it holds the #964 core — the shared
 * header's own hide/reveal. Its siblings are ui-phone-scroll-routes.spec.ts (the
 * per-route breadth sweep) and ui-phone-scroll-page-owned.spec.ts (surfaces that
 * own their composer). All three share tests/helpers/phone-scroll.ts.
 */

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page);
});

for (const { mode, route } of appModeHeaderRoutes) {
  test(`phone ${mode} mode releases the complete top edge without oscillation`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize(phoneViewport);
    await gotoPhoneSurface(page, route);
    await addPhoneScrollRunway(page);
    await installFlipCounter(page);

    const initial = await page.evaluate(() => {
      const collapse = document.querySelector<HTMLElement>('[data-testid="universal-header-collapse"]');
      const header = document.querySelector<HTMLElement>("header#search");
      const safeArea = document.querySelector<HTMLElement>('[data-testid="chrome-safe-area-top"]');
      const main = document.getElementById("main-content");
      const safeAreaTopPx = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--safe-area-top"),
      );
      return {
        // Answer view uses strategy:"overlay" with no collapse track — that is
        // overlay motion, not an in-flow collapse that failed to mount.
        usesCollapse: collapse !== null && collapse.getAttribute("data-phone-motion") !== "overlay",
        hidden: (collapse ?? header)?.getAttribute("data-scroll-hidden") === "true",
        safeAreaHeight: safeArea?.getBoundingClientRect().height ?? 0,
        safeAreaTopPx,
        mainTop: main?.getBoundingClientRect().top ?? -1,
      };
    });
    expect(initial.hidden, "header starts visible").toBe(false);
    if (initial.usesCollapse) {
      expect(initial.safeAreaHeight, "visible collapse header owns the top inset").toBeGreaterThanOrEqual(
        initial.safeAreaTopPx - 1,
      );
      expect(initial.mainTop, "visible collapse header remains in flow").toBeGreaterThan(initial.safeAreaTopPx);
    }

    await dragScrollBy(page, 720, 24);
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const collapse = document.querySelector<HTMLElement>('[data-testid="universal-header-collapse"]');
          const header = document.querySelector<HTMLElement>("header#search");
          return (collapse ?? header)?.getAttribute("data-scroll-hidden") === "true";
        });
      })
      .toBe(true);

    const hidden = await page.evaluate(() => {
      const collapse = document.querySelector<HTMLElement>('[data-testid="universal-header-collapse"]');
      const header = document.querySelector<HTMLElement>("header#search");
      const safeArea = document.querySelector<HTMLElement>('[data-testid="chrome-safe-area-top"]');
      const main = document.getElementById("main-content");
      const mainRect = main?.getBoundingClientRect();
      return {
        usesCollapse: collapse !== null && collapse.getAttribute("data-phone-motion") !== "overlay",
        hidden: (collapse ?? header)?.getAttribute("data-scroll-hidden") === "true",
        collapseHeight: collapse?.getBoundingClientRect().height ?? 0,
        safeAreaHeight: safeArea?.getBoundingClientRect().height ?? 0,
        headerBottom: header?.getBoundingClientRect().bottom ?? -1,
        mainTop: mainRect?.top ?? -1,
        mainLeft: mainRect?.left ?? -1,
        mainRight: mainRect?.right ?? -1,
        viewportWidth: window.innerWidth,
      };
    });
    expect(hidden.hidden, "one deliberate descent hides the header").toBe(true);
    if (hidden.usesCollapse) {
      expect(hidden.collapseHeight, "all collapsed header rows release their height").toBeLessThanOrEqual(1);
      expect(hidden.safeAreaHeight, "hidden header releases the top safe area").toBeLessThanOrEqual(1);
    } else {
      expect(hidden.headerBottom, "overlay header clears the viewport top").toBeLessThanOrEqual(1);
    }
    expect(hidden.mainTop, "content reaches the physical top edge").toBeLessThanOrEqual(1);
    expect(hidden.mainLeft, "content reaches the left edge").toBeCloseTo(0, 0);
    expect(hidden.mainRight, "content reaches the right edge").toBeCloseTo(hidden.viewportWidth, 0);
    expect(await readFlipCount(page), "descent produces one stable hide transition").toBe(1);

    await page.waitForTimeout(350);
    expect(await readFlipCount(page), "resting after hide cannot oscillate").toBe(1);

    await dragScrollBy(page, -48, 8);
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const collapse = document.querySelector<HTMLElement>('[data-testid="universal-header-collapse"]');
          const header = document.querySelector<HTMLElement>("header#search");
          return (collapse ?? header)?.getAttribute("data-scroll-hidden") === "true";
        });
      })
      .toBe(false);
    const revealed = await page.evaluate(() => {
      const collapse = document.querySelector<HTMLElement>('[data-testid="universal-header-collapse"]');
      const header = document.querySelector<HTMLElement>("header#search");
      const safeArea = document.querySelector<HTMLElement>('[data-testid="chrome-safe-area-top"]');
      return {
        hidden: (collapse ?? header)?.getAttribute("data-scroll-hidden") === "true",
        safeAreaHeight: safeArea?.getBoundingClientRect().height ?? 0,
        safeAreaTopPx: Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--safe-area-top"),
        ),
      };
    });
    expect(revealed.hidden, "one deliberate upward gesture reveals the header").toBe(false);
    if (hidden.usesCollapse) {
      expect(revealed.safeAreaHeight, "revealed header restores the top inset").toBeGreaterThanOrEqual(
        revealed.safeAreaTopPx - 1,
      );
    }
    expect(await readFlipCount(page), "hide and reveal remain a single symmetric cycle").toBe(2);
  });
}

for (const { name, route, selector, phoneMotion } of pageOwnedHeaderRoutes) {
  test(`phone ${name} uses the universal collapse owner`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 320, height: 720 });
    await gotoPhoneSurface(page, route);

    const collapse = page.getByTestId("universal-header-collapse");
    const addon = page.getByTestId("header-collapse-addon");
    const pageHeader = page.locator(selector).first();
    await expect(pageHeader).toBeVisible({ timeout: 20_000 });
    await expect(
      addon.locator(selector).first(),
      "phone page header is portaled into the one collapse track",
    ).toBeVisible();
    const pageHeaderBox = await pageHeader.boundingBox();
    expect(pageHeaderBox).not.toBeNull();
    expect(pageHeaderBox!.x, "page header cannot overflow the viewport left edge").toBeGreaterThanOrEqual(0);
    expect(pageHeaderBox!.x + pageHeaderBox!.width, "page header cannot expand past the viewport").toBeLessThanOrEqual(
      320,
    );
    const visibleCollapseHeight = await collapse.evaluate((element) => element.getBoundingClientRect().height);
    const safeArea = page.getByTestId("chrome-safe-area-top");
    const visibleSafeAreaHeight = await safeArea.evaluate((element) => element.getBoundingClientRect().height);
    await addPhoneScrollRunway(page);

    await dragScrollBy(page, 720, 24);

    await expect(collapse).toHaveAttribute("data-scroll-hidden", "true");
    if (phoneMotion === "overlay") {
      await expect
        .poll(async () => collapse.evaluate((element) => element.getBoundingClientRect().height))
        .toBeCloseTo(visibleCollapseHeight, 0);
      await expect
        .poll(async () => safeArea.evaluate((element) => element.getBoundingClientRect().height))
        .toBeCloseTo(visibleSafeAreaHeight, 0);
      const overlayStack = page.locator('.phone-sticky-header-stack[data-phone-motion="overlay"]');
      await expect(overlayStack).toHaveAttribute("data-scroll-hidden", "true");
      await expect(overlayStack).toHaveCSS("pointer-events", "none");
    } else {
      await expect
        .poll(async () => collapse.evaluate((element) => element.getBoundingClientRect().height))
        .toBeLessThanOrEqual(1);
      await expect
        .poll(async () => safeArea.evaluate((element) => element.getBoundingClientRect().height))
        .toBeLessThanOrEqual(1);
    }
  });
}

test("phone portaled addon focus pins the universal collapse owner during scroll", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 320, height: 720 });
  await gotoPhoneSurface(page, "/differentials/diagnoses/delirium");

  const collapse = page.getByTestId("universal-header-collapse");
  const addon = page.getByTestId("header-collapse-addon");
  const backLink = addon.getByRole("link", { name: "Back to diagnoses" });
  await expect(backLink).toBeVisible({ timeout: 20_000 });
  await addPhoneScrollRunway(page);

  await backLink.focus();
  await expect(backLink).toBeFocused();
  await dragScrollBy(page, 720, 24);
  await expect
    .poll(async () => page.evaluate(() => window.scrollY || document.documentElement.scrollTop))
    .toBeGreaterThan(0);

  await expect(backLink, "focused addon control keeps keyboard focus").toBeFocused();
  await expect(backLink, "focused addon control remains visible").toBeVisible();
  await expect(collapse, "focused portaled addon keeps the header visible").not.toHaveAttribute(
    "data-scroll-hidden",
    "true",
  );
  expect(await collapse.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(1);
  expect(
    await page.getByTestId("chrome-safe-area-top").evaluate((element) => element.getBoundingClientRect().height),
  ).toBeGreaterThan(1);
});

test("phone portaled addon focus clears when its focused control navigates away", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 320, height: 720 });
  await gotoPhoneSurface(page, "/differentials/diagnoses/delirium");

  const addon = page.getByTestId("header-collapse-addon");
  const backLink = addon.getByRole("link", { name: "Back to diagnoses" });
  await expect(backLink).toBeVisible({ timeout: 20_000 });
  await backLink.focus();
  await expect(backLink).toBeFocused();

  await backLink.press("Enter");
  await expect(page).toHaveURL(/\/differentials\/diagnoses(?:$|\?)/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Diagnoses", level: 1 })).toBeVisible({ timeout: 20_000 });
  await addPhoneScrollRunway(page);

  await dragScrollBy(page, 720, 24);

  await expect(
    page.getByTestId("universal-header-collapse"),
    "removed focused addon control cannot leave the shared header pinned",
  ).toHaveAttribute("data-scroll-hidden", "true");
});

/**
 * Overlay hide/reveal moves the chrome, never the reader's place on the page.
 *
 * This used to assert the opposite mechanism — that the collapse row animated
 * through intermediate *heights* down to zero. That animation was the defect:
 * releasing the header row and its top safe area back into the scroller moved
 * the content under the reader's finger by the released height (measured 147px
 * on `/therapy-compass/pathways`, 121px on this route, 137px on a differential
 * detail, 72px on the dashboard's non-answer modes with no top inset reported).
 * Overlay translates the same stack at a constant height instead, so the two
 * assertions that matter now are that `chromeTop` animates monotonically off
 * the top edge, and that `contentAnchor` — the content edge's position in the
 * document — never moves at all.
 */
test("phone header hide and reveal animate monotonically without a geometry jump", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize(phoneViewport);
  await gotoPhoneSurface(page, "/therapy-compass/search?q=CBT&run=1");
  await addPhoneScrollRunway(page);

  const sampleFrames = (direction: "down" | "up") =>
    page.evaluate(async (gesture: "down" | "up") => {
      const main = document.getElementById("main-content");
      const collapse = document.querySelector<HTMLElement>('[data-testid="universal-header-collapse"]');
      const safeArea = document.querySelector<HTMLElement>('[data-testid="chrome-safe-area-top"]');
      const stack = collapse?.closest<HTMLElement>(".phone-sticky-header-stack") ?? collapse;
      if (!main || !collapse || !safeArea || !stack) throw new Error("phone chrome geometry was not rendered");
      const mainOwnsScroll =
        /^(?:auto|scroll|overlay)$/.test(getComputedStyle(main).overflowY) && main.scrollHeight > main.clientHeight + 1;
      const scrollOwner = mainOwnsScroll ? main : (document.scrollingElement ?? document.documentElement);
      const totalFrames = gesture === "down" ? 55 : 45;
      const gestureFrames = gesture === "down" ? 20 : 6;
      const frames: Array<{
        time: number;
        chromeTransitionMs: number;
        hidden: boolean;
        chromeHeight: number;
        chromeTop: number;
        mainTop: number;
        scrollTop: number;
        contentAnchor: number;
      }> = [];
      for (let frame = 0; frame < totalFrames; frame += 1) {
        if (frame < gestureFrames) {
          scrollOwner.scrollTop += gesture === "down" ? 8 : -8;
          (mainOwnsScroll ? main : window).dispatchEvent(new Event("scroll", { bubbles: true }));
        }
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        const mainTop = main.getBoundingClientRect().top;
        // A running transform transition on the stack, read from the Web Animations API. This is
        // evidence of animation that does not depend on how many frames the engine paints.
        const chromeTransition = stack
          .getAnimations()
          .find(
            (animation) =>
              animation.playState === "running" &&
              /^(?:transform|translate)$/.test((animation as CSSTransition).transitionProperty ?? ""),
          );
        const chromeTransitionMs = Number(chromeTransition?.effect?.getTiming().duration ?? 0) || 0;
        frames.push({
          time: performance.now(),
          chromeTransitionMs,
          hidden: collapse.getAttribute("data-scroll-hidden") === "true",
          chromeHeight: collapse.getBoundingClientRect().height + safeArea.getBoundingClientRect().height,
          // Overlay translates the stack rather than collapsing it, so its
          // viewport offset is what animates.
          chromeTop: stack.getBoundingClientRect().top,
          mainTop,
          scrollTop: scrollOwner.scrollTop,
          // Where the content edge sits in the document. Scrolling changes
          // mainTop and scrollTop together and leaves this fixed; only a layout
          // release above the content can move it.
          contentAnchor: mainTop + scrollOwner.scrollTop,
        });
      }
      return frames;
    }, direction);

  const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
  // Every hide and reveal must run as a transform transition. Counting sampled positions is also
  // required, but only when enough frames were painted inside the transition to resolve one:
  // headless WebKit on a GPU-less runner paints 50-400 ms frames (measured 2026-09-25: one
  // 390 ms frame spanned the whole 240 ms hide), so it can show only the start and end states.
  // Chromium paints ~16 ms frames here, so it keeps the full intermediate-frame requirement.
  const expectAnimatedTravel = (frames: Awaited<ReturnType<typeof sampleFrames>>, label: string) => {
    const transitionMs = Math.max(...frames.map((frame) => frame.chromeTransitionMs));
    expect(transitionMs, `${label} runs as a transform transition`).toBeGreaterThan(0);
    const framesInsideTransition = frames.filter((frame) => frame.time - frames[0].time < transitionMs).length;
    if (framesInsideTransition >= 5) {
      expect(
        new Set(frames.map((frame) => Math.round(frame.chromeTop))).size,
        `${label} has intermediate frames`,
      ).toBeGreaterThan(3);
    }
  };

  const hideFrames = await sampleFrames("down");
  const firstHiddenFrame = hideFrames.findIndex((frame) => frame.hidden);
  expect(firstHiddenFrame, "the stepped descent triggers hide").toBeGreaterThan(-1);
  const hiding = hideFrames.slice(firstHiddenFrame);
  expectAnimatedTravel(hiding, "hide");
  for (let index = 1; index < hiding.length; index += 1) {
    expect(hiding[index].chromeTop, "chrome offset never reverses during hide").toBeLessThanOrEqual(
      hiding[index - 1].chromeTop + 1,
    );
    expect(hiding[index].scrollTop, "downward intent remains monotonic during hide").toBeGreaterThanOrEqual(
      hiding[index - 1].scrollTop - 1,
    );
  }
  expect(
    spread(hideFrames.map((frame) => frame.chromeHeight)),
    "overlay hide releases no chrome height into the scroller",
  ).toBeLessThanOrEqual(1);
  expect(
    spread(hideFrames.map((frame) => frame.contentAnchor)),
    "hiding the chrome never moves the reader's place on the page",
  ).toBeLessThanOrEqual(1);
  const settledChromeHeight = hiding.at(-1)?.chromeHeight ?? 0;
  expect(settledChromeHeight, "the chrome keeps its full height while hidden").toBeGreaterThan(100);
  expect(hiding.at(-1)?.chromeTop ?? 0, "hide settles with the stack clear of the top edge").toBeLessThanOrEqual(
    -(settledChromeHeight - 1),
  );

  const revealFrames = await sampleFrames("up");
  const firstRevealedFrame = revealFrames.findIndex((frame) => !frame.hidden);
  expect(firstRevealedFrame, "the upward gesture triggers reveal").toBeGreaterThan(-1);
  const revealing = revealFrames.slice(firstRevealedFrame);
  expectAnimatedTravel(revealing, "reveal");
  for (let index = 1; index < revealing.length; index += 1) {
    expect(revealing[index].chromeTop, "chrome offset never reverses during reveal").toBeGreaterThanOrEqual(
      revealing[index - 1].chromeTop - 1,
    );
    expect(revealing[index].scrollTop, "upward intent remains monotonic during reveal").toBeLessThanOrEqual(
      revealing[index - 1].scrollTop + 1,
    );
  }
  expect(
    spread(revealFrames.map((frame) => frame.contentAnchor)),
    "revealing the chrome never moves the reader's place on the page",
  ).toBeLessThanOrEqual(1);
  expect(revealing.at(-1)?.chromeHeight ?? 0, "reveal restores the full phone chrome").toBeGreaterThan(100);
  expect(revealing.at(-1)?.chromeTop ?? -1, "reveal returns the stack to the top edge").toBeGreaterThanOrEqual(-1);
});

/** Phone edge-to-edge guard for the shared header on Therapy results. */
test("phone shared header releases its top safe-area band after hide", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize(phoneViewport);
  await gotoPhoneSurface(page, "/therapy-compass/search?q=CBT&run=1");
  await expect(page.getByTestId("mode-nav")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("chrome-safe-area-top")).toBeVisible();

  const initial = await page.evaluate(() => {
    const safeArea = document.querySelector<HTMLElement>('[data-testid="chrome-safe-area-top"]');
    const collapse = document.querySelector<HTMLElement>('[data-testid="universal-header-collapse"]');
    const main = document.getElementById("main-content");
    const safeAreaTopPx = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--safe-area-top"),
    );
    return {
      usesCollapse: collapse !== null && collapse.getAttribute("data-phone-motion") !== "overlay",
      headerHidden: collapse?.getAttribute("data-scroll-hidden") === "true",
      safeAreaHeight: safeArea?.getBoundingClientRect().height ?? -1,
      mainTop: main?.getBoundingClientRect().top ?? -1,
      safeAreaTopPx,
    };
  });
  expect(initial.headerHidden, "header starts visible").toBe(false);
  expect(initial.safeAreaHeight, "visible header owns the simulated OS inset").toBeGreaterThanOrEqual(
    initial.safeAreaTopPx - 1,
  );
  // Overlay motion takes the stack out of flow and keeps its geometry stable, so
  // in-flow height and safe-area release are collapse-only expectations. Branch on
  // data-phone-motion rather than on the node existing — the collapse row is still
  // present under overlay, it just no longer owns layout (Codex P1, 2026-07-30).
  if (initial.usesCollapse) {
    expect(initial.mainTop, "visible header and Therapy nav remain in flow").toBeGreaterThan(initial.safeAreaTopPx);
  }

  await dragScrollBy(page, 720, 24);
  await expect
    .poll(async () => {
      const collapse = page.locator('[data-testid="universal-header-collapse"]');
      return (await collapse.getAttribute("data-scroll-hidden")) === "true";
    })
    .toBe(true);

  const afterHide = await page.evaluate(() => {
    const safeArea = document.querySelector<HTMLElement>('[data-testid="chrome-safe-area-top"]');
    const collapse = document.querySelector<HTMLElement>('[data-testid="universal-header-collapse"]');
    const main = document.getElementById("main-content");
    const safeRect = safeArea?.getBoundingClientRect();
    const mainRect = main?.getBoundingClientRect();
    return {
      usesCollapse: collapse !== null && collapse.getAttribute("data-phone-motion") !== "overlay",
      headerHidden: collapse?.getAttribute("data-scroll-hidden") === "true",
      safeAreaHeight: safeRect?.height ?? 0,
      mainTop: mainRect?.top ?? -1,
      mainLeft: mainRect?.left ?? -1,
      mainRight: mainRect?.right ?? -1,
      viewportWidth: window.innerWidth,
    };
  });

  expect(afterHide.headerHidden, "shared header collapses after a deliberate descent").toBe(true);
  if (afterHide.usesCollapse) {
    expect(afterHide.safeAreaHeight, "hidden header releases the opaque status-bar band").toBeLessThanOrEqual(1);
  }
  expect(afterHide.mainTop, "hidden header lets content reach the physical top edge").toBeLessThanOrEqual(1);
  expect(afterHide.mainLeft, "phone scroll surface reaches the left edge").toBeCloseTo(0, 0);
  expect(afterHide.mainRight, "phone scroll surface reaches the right edge").toBeCloseTo(afterHide.viewportWidth, 0);

  await dragScrollBy(page, -720, 24);
  await expect
    .poll(async () => {
      const collapse = page.locator('[data-testid="universal-header-collapse"]');
      return (await collapse.getAttribute("data-scroll-hidden")) === "true";
    })
    .toBe(false);

  const afterReveal = await page.evaluate(() => {
    const safeArea = document.querySelector<HTMLElement>('[data-testid="chrome-safe-area-top"]');
    const collapse = document.querySelector<HTMLElement>('[data-testid="universal-header-collapse"]');
    const main = document.getElementById("main-content");
    const safeAreaTopPx = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--safe-area-top"),
    );
    return {
      usesCollapse: collapse !== null && collapse.getAttribute("data-phone-motion") !== "overlay",
      headerHidden: collapse?.getAttribute("data-scroll-hidden") === "true",
      safeAreaHeight: safeArea?.getBoundingClientRect().height ?? -1,
      mainTop: main?.getBoundingClientRect().top ?? -1,
      safeAreaTopPx,
    };
  });

  expect(afterReveal.headerHidden, "upward scroll reveals the shared header").toBe(false);
  expect(afterReveal.safeAreaHeight, "revealed header restores the OS inset").toBeGreaterThanOrEqual(
    afterReveal.safeAreaTopPx - 1,
  );
  if (!afterReveal.usesCollapse) {
    // Overlay never changed flow height, so there is nothing to restore.
  } else
    expect(afterReveal.mainTop, "revealed header restores its complete flow height").toBeGreaterThan(
      afterReveal.safeAreaTopPx,
    );
});

test.describe("phone PWA standalone mode bounded scroll shell (#71NT23)", () => {
  for (const { mode, route } of appModeHeaderRoutes) {
    test(`phone PWA ${mode} mode operates in bounded shell with main scrollport`, async ({ page }) => {
      await emulatePhoneStandalonePwa(page, route);
      await addPhoneScrollRunway(page);
      await installFlipCounter(page);

      const initial = await readStandaloneShellGeometry(page);
      expect(initial.headerHidden, "header starts visible in standalone shell").toBe(false);
      expect(initial.scrollOwner, "standalone PWA delegates scrolling to #main-content").toBe("main");
      expect(initial.mainOverflowY, "standalone #main-content is scrollable").toMatch(/^(?:auto|scroll)$/);
      expect(initial.mainOverscrollBehaviorY, "main contains overscroll").toBe("contain");
      expect(initial.framePosition, "phone viewport frame is relative").toBe("relative");
      expect(initial.shellOverflowY, "shell bounds overflow").toBe("hidden");
      expect(initial.shellHeight, "standalone shell matches viewport height").toBeCloseTo(phoneViewport.height, 0);
      expect(initial.frameHeight, "phone viewport frame matches viewport height").toBeCloseTo(phoneViewport.height, 0);
      expect(initial.docScrollTop, "document remains un-scrolled").toBe(0);

      // Drag within the main scroller to trigger scroll-hide
      await dragScrollBy(page, 720, 24);
      await expect.poll(async () => (await readStandaloneShellGeometry(page)).headerHidden).toBe(true);

      const hidden = await readStandaloneShellGeometry(page);
      expect(hidden.headerHidden, "downward drag in standalone scroller hides header").toBe(true);
      expect(hidden.docScrollTop, "document still does not scroll in standalone mode").toBe(0);
      expect(hidden.mainScrollTop, "main scrollport absorbed travel").toBeGreaterThan(0);
      expect(hidden.horizontalOverflow, "no horizontal overflow introduced in standalone mode").toBeLessThanOrEqual(1);
      expect(await readFlipCount(page), "hiding produces one stable transition").toBe(1);

      // Upward drag reveals header
      await dragScrollBy(page, -720, 24);
      await expect.poll(async () => (await readStandaloneShellGeometry(page)).headerHidden).toBe(false);

      const revealed = await readStandaloneShellGeometry(page);
      expect(revealed.headerHidden, "upward drag in standalone scroller reveals header").toBe(false);
      expect(await readFlipCount(page), "hide and reveal remain a single symmetric cycle").toBe(2);
    });
  }

  for (const { name, route, selector, phoneMotion } of pageOwnedHeaderRoutes) {
    test(`phone PWA ${name} clamps overlay headers inside bounded frame`, async ({ page }) => {
      await emulatePhoneStandalonePwa(page, route);

      const collapse = page.getByTestId("universal-header-collapse");
      const pageHeader = page.locator(selector).first();
      await expect(pageHeader).toBeVisible({ timeout: 20_000 });

      const frame = page.locator(".phone-viewport-frame");
      const frameBox = await frame.boundingBox();
      expect(frameBox, "phone viewport frame is measurable").not.toBeNull();

      const pageHeaderBox = await pageHeader.boundingBox();
      expect(pageHeaderBox, "page header bounding box is measurable").not.toBeNull();
      expect(pageHeaderBox!.x, "page header starts inside frame left bound").toBeGreaterThanOrEqual(frameBox!.x - 1);
      expect(pageHeaderBox!.x + pageHeaderBox!.width, "page header stays inside frame right bound").toBeLessThanOrEqual(
        frameBox!.x + frameBox!.width + 1,
      );
      expect(pageHeaderBox!.y, "page header starts at or below frame top").toBeGreaterThanOrEqual(frameBox!.y - 1);

      const overlayStack = page.locator('.phone-sticky-header-stack[data-phone-motion="overlay"]');
      if (phoneMotion === "overlay") {
        await expect(overlayStack).toHaveCount(1);
        const position = await overlayStack.evaluate((node) => getComputedStyle(node).position);
        expect(position, "overlay stack is absolute within relative frame in standalone mode").toBe("absolute");

        const stackBox = await overlayStack.boundingBox();
        expect(stackBox, "overlay stack bounding box is measurable").not.toBeNull();
        expect(stackBox!.x, "overlay stack starts inside frame left bound").toBeGreaterThanOrEqual(frameBox!.x - 1);
        expect(stackBox!.x + stackBox!.width, "overlay stack stays inside frame right bound").toBeLessThanOrEqual(
          frameBox!.x + frameBox!.width + 1,
        );
        expect(stackBox!.y, "overlay stack starts at or below frame top").toBeGreaterThanOrEqual(frameBox!.y - 1);
      }

      await addPhoneScrollRunway(page);
      await dragScrollBy(page, 720, 24);

      await expect(collapse).toHaveAttribute("data-scroll-hidden", "true");
      if (phoneMotion === "overlay") {
        await expect(overlayStack).toHaveAttribute("data-scroll-hidden", "true");
        await expect(overlayStack).toHaveCSS("pointer-events", "none");
      }
    });
  }
});

test("a cold phone load never moves Open comparison when the nav row joins the header (#CHPC5C)", async ({ page }) => {
  // The mode nav row starts in page flow and a portal moves it into the fixed
  // phone header. If the reserve that clears the header grows even a few frames
  // later, every element on the page jumps up by the row's height and back —
  // long enough for a tap to press "Open comparison" and release on "Edit
  // selection" (the recorded #CHPC5C failure, on exactly this route). Sample the
  // link's position in every animation frame of a cold load and require that,
  // once it exists, it never moves. Before the fix it rose 49px on every load.
  // The suite runs with reduced motion, which also pins the one-frame variant:
  // a 0.01ms padding-top transition that painted the stale reserve once.
  await page.setViewportSize(phoneViewport);
  await page.addInitScript(() => {
    const samples: { top: number; occupied: boolean }[] = [];
    (window as typeof window & { __compareOpenTops?: typeof samples }).__compareOpenTops = samples;
    const sample = () => {
      const link = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="differential-compare-open"]')).find(
        (node) => node.getBoundingClientRect().height > 0,
      );
      const slot = document.querySelector<HTMLElement>('[data-testid="header-collapse-addon"]');
      if (link) {
        samples.push({
          top: Math.round(link.getBoundingClientRect().top),
          occupied: (slot?.childElementCount ?? 0) > 0,
        });
      }
      if (samples.length < 2000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  await page.goto("/differentials/compare?ids=wernicke-encephalopathy", { waitUntil: "load" });
  await expect(visibleByTestId(page, "differential-compare-open")).toBeVisible({ timeout: 30_000 });
  // Keep sampling well past the reserve hook's 80ms quiet window.
  await page.waitForTimeout(1_500);

  const samples = await page.evaluate(
    () =>
      (window as typeof window & { __compareOpenTops?: { top: number; occupied: boolean }[] }).__compareOpenTops ?? [],
  );
  expect(
    samples.some((entry) => entry.occupied),
    "the nav row must reach the phone header while the link is on screen",
  ).toBe(true);
  const tops = samples.map((entry) => entry.top);
  expect(new Set(tops).size, `Open comparison moved during a cold load: ${[...new Set(tops)].join(" -> ")}px`).toBe(1);
});
