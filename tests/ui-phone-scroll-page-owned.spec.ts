import { expect, test } from "playwright/test";
import {
  blockExternalRequests,
  standalonePageOwnedFooterRoutes,
  phoneViewport,
  gotoPhoneSurface,
  forceCompiledStandalonePhoneCss,
  addPhoneScrollRunway,
  readGeometry,
  dragScrollBy,
  dragScrollUntilHidden,
  expectChromeHidden,
  readPageOwnedFooterGeometry,
} from "./helpers/phone-scroll";
import { readPrimaryScrollAndDomGeometry } from "./playwright-scroll";
import { expectSingleSettledOwner } from "./playwright-settlement";

/**
 * Page-owned phone chrome: the document viewer's own composer, the standalone
 * frame-owned footers and the Services result canvas.
 *
 * These surfaces own their composer instead of using the shell's, so their
 * hide/reveal and reserve behaviour is independent of the shared header swept in
 * ui-phone-scroll.spec.ts. See docs/search-chrome-behaviour.md.
 */

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page);
});

test("phone browser results use document scrolling so Safari can minimize its browser chrome", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize(phoneViewport);
  await gotoPhoneSurface(page, "/services?q=clinic&run=1&focus=1", 112);
  await expect(page.getByTestId("service-search-results")).toBeVisible({ timeout: 20_000 });
  await addPhoneScrollRunway(page);

  await expectSingleSettledOwner(page.locator("#main-content"), { message: "Services result scroll owner" });
  const initial = await readPrimaryScrollAndDomGeometry(page, {
    main: "#main-content",
    shell: ".phone-viewport-shell",
    footer: "form.answer-footer-search-dock",
  });

  expect(
    initial.nodes.shell.style?.position,
    "the phone browser canvas must not use WebKit's fixed-root compositor path",
  ).not.toBe("fixed");
  expect(initial.nodes.shell.style?.overflowY).toBe("visible");
  expect(
    initial.nodes.main.style?.overflowX,
    "x clipping must not silently turn the main surface back into a y scroller",
  ).toBe("clip");
  expect(initial.nodes.main.style?.overflowY).toBe("visible");
  expect(initial.scroll.owner).toBe("document");
  expect(initial.scroll.maxScrollTop, "the document must own the Services result runway").toBeGreaterThan(500);
  expect(initial.scroll.scrollTop).toBe(0);
  expect(initial.nodes.main.count).toBe(1);
  expect(initial.nodes.footer.count).toBe(1);
  expect(initial.nodes.main.data.phoneScrollOwner).toBe("document");
  expect(initial.nodes.main.data.phoneFooterOwner).toBe("shell");
  expect(initial.nodes.main.data.phoneComposerReserve).not.toBe("0rem");
  expect(initial.nodes.main.data.phoneChromeTransition).toBe("idle");

  await page.evaluate(async () => {
    for (let step = 0; step < 32; step += 1) {
      window.scrollBy(0, 24);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    }
  });
  await expect(page.getByTestId("universal-header-collapse")).toHaveAttribute("data-scroll-hidden", "true");
  await expect(page.locator(".answer-footer-search-dock")).toHaveAttribute("data-scroll-hidden", "true");

  const hidden = await page.evaluate(() => {
    const main = document.getElementById("main-content");
    return {
      windowScrollY: window.scrollY,
      mainScrollTop: main?.scrollTop ?? -1,
    };
  });
  expect(hidden.windowScrollY, "a vertical gesture must move Safari's document scroll owner").toBeGreaterThan(120);
  expect(hidden.mainScrollTop, "the legacy inner scroll pane must stay inactive").toBe(0);

  // Reveal while still mid-page. The state flag alone is insufficient: if the
  // shared header is no longer sticky it can report visible while remaining
  // hundreds of pixels above Safari's viewport.
  await dragScrollBy(page, -48, 12);
  await expect(page.getByTestId("universal-header-collapse")).not.toHaveAttribute("data-scroll-hidden", "true");
  const revealedHeaderBottom = await page
    .getByTestId("universal-header-collapse")
    .evaluate((header) => header.getBoundingClientRect().bottom);
  expect(revealedHeaderBottom, "an upward gesture must return the shared header inside the viewport").toBeGreaterThan(
    1,
  );
});

for (const phoneOwner of ["browser document", "standalone PWA main"] as const) {
  test(`document detail header overlay and footer follow ${phoneOwner} scrolling together`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize(phoneViewport);
    await gotoPhoneSurface(page, "/documents/11111111-1111-4111-8111-111111111111?page=1");
    if (phoneOwner === "standalone PWA main") {
      expect(await forceCompiledStandalonePhoneCss(page), "compiled CSS must expose standalone rules").toBeGreaterThan(
        0,
      );
    }

    const expectedOwner = phoneOwner === "browser document" ? "document" : "main";
    const collapse = page.getByTestId("universal-header-collapse");
    const overlayStack = page.locator('.phone-sticky-header-stack[data-phone-motion="overlay"]');
    const documentRow = page.locator("[data-document-sticky-header]");
    const sectionTrack = documentRow.locator(':scope > span[aria-hidden="true"]');
    const composer = page.locator("form.document-viewer-composer");
    const content = page.getByTestId("document-viewer-content");
    const sectionTrigger = page.getByTestId("document-section-trigger");

    await expect(composer).toHaveCount(0);
    await expect(content).toHaveAttribute("data-phone-footer-owner", "none");
    await expect(content).toHaveAttribute("data-phone-composer-reserve", "0.75rem");
    await page.getByRole("button", { name: "Open document actions" }).click();
    await page.getByRole("dialog", { name: "This document" }).getByRole("button", { name: "Search document" }).click();
    await expect(composer).toBeVisible({ timeout: 20_000 });
    await expect(content).toHaveAttribute("data-phone-scroll-owner", expectedOwner);
    await expect(content).toHaveAttribute("data-phone-footer-owner", "document-viewer");
    await expect(collapse).toHaveAttribute("data-phone-motion", "overlay");
    await expect(overlayStack).toHaveCount(1);
    await expect(documentRow).toBeVisible();
    await expect(sectionTrack).toBeVisible();
    await expect
      .poll(async () => (await readPrimaryScrollAndDomGeometry(page, {})).scroll.owner, {
        message: `${phoneOwner} document-detail scroll owner`,
      })
      .toBe(expectedOwner);
    await addPhoneScrollRunway(page);

    const visibleGeometry = await readPrimaryScrollAndDomGeometry(page, {
      stack: '.phone-sticky-header-stack[data-phone-motion="overlay"]',
      universalRow: "header#search",
      documentRow: "[data-document-sticky-header]",
      sectionTrack: '[data-document-sticky-header] > span[aria-hidden="true"]',
      content: '[data-testid="document-viewer-content"]',
    });
    expect(visibleGeometry.nodes.stack.count).toBe(1);
    expect(visibleGeometry.nodes.stack.style?.position).toBe(phoneOwner === "browser document" ? "fixed" : "absolute");
    expect(visibleGeometry.nodes.universalRow.rect?.bottom ?? 0).toBeGreaterThan(1);
    expect(visibleGeometry.nodes.documentRow.rect?.bottom ?? 0).toBeGreaterThan(1);
    expect(visibleGeometry.nodes.sectionTrack.rect?.bottom ?? 0).toBeGreaterThan(1);

    // Portaled page-header focus pins the complete stack, matching the shared
    // header controls and preventing keyboard focus from moving off-screen.
    await sectionTrigger.focus();
    await expect(sectionTrigger).toBeFocused();
    await dragScrollBy(page, 360, 24);
    await expect(collapse, "focused document header keeps the overlay visible").not.toHaveAttribute(
      "data-scroll-hidden",
      "true",
    );
    await sectionTrigger.evaluate((element) => element.blur());

    await dragScrollUntilHidden(page, 720, 24);
    await expectChromeHidden(page, collapse, "first hide with motion enabled");
    await expect(overlayStack).toHaveAttribute("data-scroll-hidden", "true");
    await expect(composer).toHaveAttribute("data-scroll-hidden", "true");

    const hiddenGeometry = await readPrimaryScrollAndDomGeometry(page, {
      stack: '.phone-sticky-header-stack[data-phone-motion="overlay"]',
      universalRow: "header#search",
      documentRow: "[data-document-sticky-header]",
      sectionTrack: '[data-document-sticky-header] > span[aria-hidden="true"]',
      content: '[data-testid="document-viewer-content"]',
    });
    expect(hiddenGeometry.scroll.owner).toBe(expectedOwner);
    expect(hiddenGeometry.scroll.scrollTop, `${phoneOwner} must drive document-detail chrome`).toBeGreaterThan(120);
    expect(hiddenGeometry.nodes.universalRow.rect?.bottom ?? 1).toBeLessThanOrEqual(1);
    expect(hiddenGeometry.nodes.documentRow.rect?.bottom ?? 1).toBeLessThanOrEqual(1);
    expect(hiddenGeometry.nodes.sectionTrack.rect?.bottom ?? 1).toBeLessThanOrEqual(1);
    await expect(overlayStack).toHaveCSS("pointer-events", "none");
    await expect(overlayStack).toHaveCSS("opacity", "0");

    // Trigger reveal, then stop changing the scroll owner. The remaining
    // transition frames may move only the overlay; the reader and document
    // anchor must remain fixed.
    await dragScrollBy(page, -48, 8);
    await expect(collapse).not.toHaveAttribute("data-scroll-hidden", "true");
    const revealFrames = await page.evaluate(async () => {
      const main = document.getElementById("main-content");
      const mainOwnsScroll = Boolean(
        main &&
        /^(?:auto|scroll|overlay)$/.test(getComputedStyle(main).overflowY) &&
        main.scrollHeight > main.clientHeight + 1,
      );
      const owner = mainOwnsScroll && main ? main : (document.scrollingElement ?? document.documentElement);
      const stack = document.querySelector<HTMLElement>('.phone-sticky-header-stack[data-phone-motion="overlay"]');
      const universal = document.querySelector<HTMLElement>("header#search");
      const documentHeader = document.querySelector<HTMLElement>("[data-document-sticky-header]");
      const track = documentHeader?.querySelector<HTMLElement>(':scope > span[aria-hidden="true"]') ?? null;
      const anchor = document.querySelector<HTMLElement>('[data-testid="document-viewer-content"]');
      if (!stack || !universal || !documentHeader || !track || !anchor) {
        throw new Error("document overlay geometry nodes were not rendered");
      }
      const frames: Array<{
        scrollTop: number;
        windowScrollY: number;
        anchorTop: number;
        stackHeight: number;
        stackBottom: number;
        universalBottom: number;
        documentBottom: number;
        trackBottom: number;
      }> = [];
      for (let frame = 0; frame < 18; frame += 1) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        frames.push({
          scrollTop: owner.scrollTop,
          windowScrollY: window.scrollY,
          anchorTop: anchor.getBoundingClientRect().top,
          stackHeight: stack.getBoundingClientRect().height,
          stackBottom: stack.getBoundingClientRect().bottom,
          universalBottom: universal.getBoundingClientRect().bottom,
          documentBottom: documentHeader.getBoundingClientRect().bottom,
          trackBottom: track.getBoundingClientRect().bottom,
        });
      }
      return frames;
    });
    const revealScrollTop = revealFrames[0]?.scrollTop ?? -1;
    const revealWindowScrollY = revealFrames[0]?.windowScrollY ?? -1;
    const revealAnchorTop = revealFrames[0]?.anchorTop ?? -1;
    const stableStackHeight = revealFrames[0]?.stackHeight ?? -1;
    for (const frame of revealFrames) {
      expect(frame.scrollTop, "reveal cannot change the settled reading offset").toBeCloseTo(revealScrollTop, 0);
      expect(frame.windowScrollY, "reveal cannot change window.scrollY").toBeCloseTo(revealWindowScrollY, 0);
      expect(frame.anchorTop, "reveal cannot move the document/PDF anchor").toBeCloseTo(revealAnchorTop, 0);
      expect(frame.stackHeight, "overlay stack footprint stays geometrically stable").toBeCloseTo(stableStackHeight, 0);
    }
    const revealed = revealFrames.at(-1)!;
    expect(revealed.universalBottom, "global Documents row returns inside the viewport").toBeGreaterThan(1);
    expect(revealed.documentBottom, "document title row returns with the global row").toBeGreaterThan(1);
    expect(revealed.trackBottom, "section track returns with both rows").toBeGreaterThan(1);
    expect(revealed.stackBottom, "returned stack overlays the document anchor").toBeGreaterThan(revealAnchorTop);

    // The document's own sheet pins its footer and locks the underlying owner;
    // opening it from the visible header must not release either chrome edge.
    await sectionTrigger.click();
    await expect(page.getByTestId("document-section-sheet")).toBeVisible();
    await expect(collapse).not.toHaveAttribute("data-scroll-hidden", "true");
    await expect(composer).not.toHaveAttribute("data-scroll-hidden", "true");
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    await page.getByRole("button", { name: "Close section list" }).click();
    await expect(page.getByTestId("document-section-sheet")).toHaveCount(0);
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
    await expect(sectionTrigger).toBeFocused();
    // Move focus into the reader instead of blurring to <body>. Sheet focus
    // restoration intentionally retries after 50 ms when focus fell through
    // to <body>; a bare blur races that retry in production builds and can
    // re-pin the header after this assertion has already continued.
    await content.evaluate((element) => {
      element.tabIndex = -1;
      element.focus({ preventScroll: true });
    });
    await expect(content).toBeFocused();
    await expect(sectionTrigger).not.toBeFocused();

    // Reduced motion removes the transition but retains the out-of-flow
    // geometry. Prove another hide/reveal cycle cannot displace the reader.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await dragScrollBy(page, -480, 16);
    await expect(collapse).not.toHaveAttribute("data-scroll-hidden", "true");
    await dragScrollUntilHidden(page, 720, 24);
    await expectChromeHidden(page, collapse, "reduced-motion hide after the section-sheet round-trip");
    const reducedHidden = await readPrimaryScrollAndDomGeometry(page, {
      stack: '.phone-sticky-header-stack[data-phone-motion="overlay"]',
      content: '[data-testid="document-viewer-content"]',
    });
    await expect(overlayStack).toHaveCSS("transition-property", "none");
    await dragScrollBy(page, -48, 8);
    await expect(collapse).not.toHaveAttribute("data-scroll-hidden", "true");
    const reducedRevealed = await readPrimaryScrollAndDomGeometry(page, {
      stack: '.phone-sticky-header-stack[data-phone-motion="overlay"]',
      content: '[data-testid="document-viewer-content"]',
    });
    expect(reducedRevealed.scroll.scrollTop).toBeLessThan(reducedHidden.scroll.scrollTop);
    expect(reducedRevealed.nodes.stack.rect?.height).toBeCloseTo(reducedHidden.nodes.stack.rect?.height ?? -1, 0);
    expect(
      (reducedRevealed.nodes.content.rect?.top ?? 0) - (reducedHidden.nodes.content.rect?.top ?? 0),
      "reduced-motion reveal moves the anchor only by the intended reverse scroll",
    ).toBeCloseTo(reducedHidden.scroll.scrollTop - reducedRevealed.scroll.scrollTop, 0);
  });
}

test("compiled standalone PWA rules bind full-height footer chrome to the inner scroller", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize(phoneViewport);
  await gotoPhoneSurface(page, "/services?q=clinic&run=1&focus=1", 112);
  await expect(page.locator("form.answer-footer-search-dock")).toBeVisible({ timeout: 20_000 });
  expect(
    await forceCompiledStandalonePhoneCss(page),
    "compiled CSS must expose the standalone media rules",
  ).toBeGreaterThanOrEqual(4);
  await addPhoneScrollRunway(page);
  await expect(page.locator("#main-content")).toHaveAttribute("data-phone-scroll-owner", "main");
  await expect(page.locator("#main-content")).toHaveAttribute("data-phone-footer-owner", "shell");

  const initial = await page.evaluate(() => {
    const main = document.getElementById("main-content");
    const shell = main?.closest<HTMLElement>(".phone-viewport-shell");
    if (main) main.dataset.chromeTransitioning = "true";
    const result = {
      shellHeight: shell?.getBoundingClientRect().height ?? -1,
      viewportHeight: window.innerHeight,
      mainOverflowY: main ? getComputedStyle(main).overflowY : "missing",
      mainOverflowAnchor: main ? getComputedStyle(main).overflowAnchor : "missing",
      footerPosition: document.querySelector("form.answer-footer-search-dock")
        ? getComputedStyle(document.querySelector("form.answer-footer-search-dock")!).position
        : "missing",
      footerBackdropPosition: document.querySelector(".answer-footer-search-backdrop")
        ? getComputedStyle(document.querySelector(".answer-footer-search-backdrop")!).position
        : "missing",
      documentRunway: (document.scrollingElement?.scrollHeight ?? 0) - window.innerHeight,
    };
    if (main) delete main.dataset.chromeTransitioning;
    return result;
  });
  expect(initial.shellHeight, "the installed shell must cover its entire PWA viewport").toBeCloseTo(
    initial.viewportHeight,
    0,
  );
  expect(initial.mainOverflowY).toBe("auto");
  expect(initial.mainOverflowAnchor, "the active PWA scroller must ignore transition anchoring").toBe("none");
  expect(initial.footerPosition, "the PWA footer must anchor to the 100vh shell").toBe("absolute");
  expect(initial.footerBackdropPosition, "the PWA footer scrim must share its shell-owned edge").toBe("absolute");
  expect(initial.documentRunway, "the PWA document must stay bounded while main owns scrolling").toBeLessThanOrEqual(1);

  await dragScrollUntilHidden(page, 720, 24);
  await expect(page.getByTestId("universal-header-collapse")).toHaveAttribute("data-scroll-hidden", "true");
  await expect(page.locator("form.answer-footer-search-dock")).toHaveAttribute("data-scroll-hidden", "true");
  const hidden = await page.evaluate(() => ({
    windowScrollY: window.scrollY,
    mainScrollTop: document.getElementById("main-content")?.scrollTop ?? -1,
  }));
  expect(hidden.windowScrollY).toBe(0);
  expect(hidden.mainScrollTop, "the PWA footer must follow the inner scroll owner").toBeGreaterThan(120);
});

for (const scrollOwner of ["browser document", "standalone PWA main"] as const) {
  test(`${scrollOwner} search keeps focus through passive scroll settling and releases it on a user gesture`, async ({
    page,
  }) => {
    await page.setViewportSize(phoneViewport);
    await gotoPhoneSurface(page, "/services?q=clinic&run=1&focus=1");
    if (scrollOwner === "standalone PWA main") {
      expect(await forceCompiledStandalonePhoneCss(page), "compiled CSS must expose standalone rules").toBeGreaterThan(
        0,
      );
    }
    await addPhoneScrollRunway(page);

    const input = page.getByTestId("global-search-input");
    await expect(input).toBeVisible({ timeout: 20_000 });
    // Overlay motion portals the dock into the footer host on phones. Wait until
    // that host owns the composer so `bottom: 0` resolves against the viewport /
    // frame rather than a transient inline ancestor.
    await expect
      .poll(
        async () =>
          input.evaluate((element) => {
            const dock = element.closest<HTMLElement>("form.answer-footer-search-dock");
            const rect = dock?.getBoundingClientRect();
            const inFooterHost = Boolean(element.closest('[data-testid="phone-footer-layer-host"]'));
            return Boolean(inFooterHost && rect && rect.bottom >= window.innerHeight - 2 && rect.top > 0);
          }),
        { timeout: 10_000 },
      )
      .toBe(true);
    // Stay inside the top-reveal band before focusing. Overlay / reserve-only
    // motion may hide after 8px + hide-intent travel; a 40px pre-scroll was only
    // safe under in-flow collapse (72px activation) and parked the dock off-screen.
    await page.evaluate((owner) => {
      const main = document.getElementById("main-content");
      const target = owner === "standalone PWA main" ? main : (document.scrollingElement ?? document.documentElement);
      if (!target) throw new Error("search focus proof did not find its scroll owner");
      target.scrollTop = 0;
      (owner === "standalone PWA main" ? main : window)?.dispatchEvent(new Event("scroll"));
    }, scrollOwner);

    await input.click();
    await expect(input).toBeFocused();

    // iOS keyboard opening, scrollIntoView(), and viewport settling can emit a
    // passive scroll notification without any user scroll intent. It must not
    // close the keyboard or make the composer eligible to hide.
    await page.evaluate((owner) => {
      const target = owner === "standalone PWA main" ? document.getElementById("main-content") : window;
      target?.dispatchEvent(new Event("scroll"));
    }, scrollOwner);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await expect(input).toBeFocused();

    // Keyboard scrolling carries explicit user intent without a wheel/touch
    // event. Release focus first, then prove that the active owner can hide the
    // shared chrome as it scrolls through the result canvas.
    await input.dispatchEvent("keydown", { key: "PageDown" });
    await expect(input).not.toBeFocused();
    await page.evaluate((owner) => {
      const main = document.getElementById("main-content");
      const target = owner === "standalone PWA main" ? main : (document.scrollingElement ?? document.documentElement);
      if (!target) throw new Error("keyboard scroll proof did not find its scroll owner");
      target.scrollTop = 720;
      (owner === "standalone PWA main" ? main : window)?.dispatchEvent(new Event("scroll"));
    }, scrollOwner);
    await expect(page.getByTestId("universal-header-collapse")).toHaveAttribute("data-scroll-hidden", "true");
    await expect(page.locator("form.answer-footer-search-dock")).toHaveAttribute("data-scroll-hidden", "true");
  });
}

for (const footerCase of standalonePageOwnedFooterRoutes) {
  test(`standalone ${footerCase.name} is frame-owned and stays anchored while main scrolls`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize(phoneViewport);
    await gotoPhoneSurface(page, footerCase.route, 112);

    if (footerCase.openViaDocumentActions) {
      await page.getByRole("button", { name: "Open document actions" }).click();
      await page
        .getByRole("dialog", { name: "This document" })
        .getByRole("button", { name: "Search document" })
        .click();
    }
    const footer = page.locator(footerCase.selector);
    await expect(footer).toBeVisible({ timeout: 20_000 });
    expect(
      await forceCompiledStandalonePhoneCss(page),
      "compiled CSS must expose the standalone media rules",
    ).toBeGreaterThanOrEqual(4);
    await addPhoneScrollRunway(page);

    if (footerCase.focusSelector) {
      const focusTarget = footer.locator(footerCase.focusSelector);
      await focusTarget.focus();
      await expect(focusTarget).toBeFocused();
    }

    const initial = await readPageOwnedFooterGeometry(footer, footerCase.reserveSelector);
    expect(initial.hostFound, "phone footer must be portaled into the frame-owned host").toBe(true);
    expect(initial.footerParentIsHost, "the host must directly own the portaled footer element").toBe(true);
    expect(initial.hostInsideFrame, "the footer host must remain inside the viewport frame").toBe(true);
    expect(initial.mainContainsFooter, "the standalone scroller must not contain its edge footer").toBe(false);
    expect(initial.mainOverflowY).toBe("auto");
    expect(initial.mainRunway, "standalone main must have enough inner-scroll runway for this proof").toBeGreaterThan(
      500,
    );
    expect(initial.footerPosition, "standalone footer must anchor to the frame rather than the viewport").toBe(
      "absolute",
    );
    expect(initial.frameHeight).toBeCloseTo(initial.viewportHeight, 0);
    expect(initial.frameBottom, "the standalone viewport frame cannot be vertically displaced").toBeCloseTo(
      initial.viewportHeight,
      0,
    );
    expect(initial.footerBottom, "the anchored footer cannot extend below its viewport frame").toBeLessThanOrEqual(
      initial.frameBottom + 1,
    );
    if (footerCase.flushBottom) {
      expect(initial.footerBottom, "full-width footer paint must reach the frame's final pixel").toBeCloseTo(
        initial.frameBottom,
        0,
      );
    } else {
      expect(
        initial.frameBottom - initial.footerBottom,
        "the document composer intentionally keeps its floating safe-area gap",
      ).toBeGreaterThan(0);
    }
    if (footerCase.focusSelector) {
      expect(initial.focusInsideFooter, "focus must intentionally pin hideable page-owned chrome").toBe(true);
    }

    await dragScrollBy(page, 720, 24);

    const afterScroll = await readPageOwnedFooterGeometry(footer, footerCase.reserveSelector);
    expect(
      afterScroll.mainScrollTop,
      "the forced standalone journey must move the inner main scroller",
    ).toBeGreaterThan(120);
    expect(afterScroll.documentScrollTop, "the standalone document must stay bounded").toBe(0);
    expect(afterScroll.mainContainsFooter, "inner scrolling must not pull the frame-owned footer into main").toBe(
      false,
    );
    expect(afterScroll.footerHidden, "the footer must remain visible for the anchoring assertion").toBe(false);
    expect(
      afterScroll.frameBottom - afterScroll.footerBottom,
      "inner scrolling must preserve the footer's intended frame-bottom inset",
    ).toBeCloseTo(initial.frameBottom - initial.footerBottom, 0);
    expect(afterScroll.frameBottom).toBeCloseTo(initial.frameBottom, 0);
    if (footerCase.focusSelector) {
      expect(afterScroll.focusInsideFooter, "focused hideable chrome must stay pinned during inner scrolling").toBe(
        true,
      );

      const focusTarget = footer.locator(footerCase.focusSelector);
      await focusTarget.blur();
      await expect(focusTarget).not.toBeFocused();
      // The downward intent was recorded while focus intentionally pinned the
      // composer. Once focus leaves, React must release that pin before a new
      // gesture; dispatching another synthetic scroll in the same task as
      // blur can coalesce with the focus-state commit and is not a user-realistic
      // ordering.
      await expect(footer).toHaveAttribute("data-scroll-hidden", "true");
      await expect
        .poll(async () => (await readPageOwnedFooterGeometry(footer, footerCase.reserveSelector)).footerOpacity)
        .toBe(0);
      await expect
        .poll(async () => (await readPageOwnedFooterGeometry(footer, footerCase.reserveSelector)).reservePaddingBottom)
        // DocumentViewer's own content reserve (document composer case) keeps a
        // small 0.75rem/12px resting pad even once hidden — see the matching
        // comment on `document-viewer-content` in DocumentViewer.tsx — so the
        // last card never paints flush against the physical bottom edge. Allow
        // that, with a little slack, while still catching a regression back
        // toward the full ~9rem visible-state clearance.
        .toBeLessThanOrEqual(13);

      const hidden = await readPageOwnedFooterGeometry(footer, footerCase.reserveSelector);
      expect(hidden.footerPointerEvents, "hidden footer cannot retain an interactive edge layer").toBe("none");
      expect(hidden.ownsLastFramePixel, "hidden footer cannot paint or hit-test the frame's last pixel").toBe(false);
      expect(
        hidden.mainScrollTop,
        "hiding the footer cannot jump the reading position backward",
      ).toBeGreaterThanOrEqual(afterScroll.mainScrollTop - 1);
      expect(hidden.documentScrollTop).toBe(0);

      await dragScrollBy(page, -48, 8);
      await expect(footer).not.toHaveAttribute("data-scroll-hidden", "true");
      await expect
        .poll(async () => {
          const geometry = await readPageOwnedFooterGeometry(footer, footerCase.reserveSelector);
          return geometry.frameBottom - geometry.footerBottom;
        })
        .toBeCloseTo(initial.frameBottom - initial.footerBottom, 0);
      const revealed = await readPageOwnedFooterGeometry(footer, footerCase.reserveSelector);
      expect(revealed.mainScrollTop, "upward intent must move the inner scroller monotonically").toBeLessThan(
        hidden.mainScrollTop,
      );
      expect(revealed.mainScrollTop, "footer reveal cannot introduce an extra backward jump").toBeGreaterThanOrEqual(
        hidden.mainScrollTop - 64,
      );
    }
  });
}

test("differential footer returns inline when the viewport leaves phone mode", async ({ page }) => {
  await page.setViewportSize(phoneViewport);
  await gotoPhoneSurface(page, "/differentials/presentations/acute-confusion-encephalopathy");

  const footer = page.getByTestId("differential-presentation-phone-footer");
  await expect(footer).toHaveCount(1);
  await expect(footer).toBeVisible({ timeout: 20_000 });
  await footer.evaluate((node) => {
    const host = node.closest<HTMLElement>(".phone-footer-layer-host");
    if (!host) throw new Error("differential footer was not portaled into its phone frame host");
    host.dataset.resizeProbe = "true";
  });
  const phoneOwnership = await footer.evaluate((node) => ({
    inMain: Boolean(document.getElementById("main-content")?.contains(node)),
    inHost: Boolean(node.closest(".phone-footer-layer-host")),
  }));
  expect(phoneOwnership).toEqual({ inMain: false, inHost: true });

  await page.setViewportSize({ width: 768, height: 900 });
  await expect
    .poll(() =>
      footer.evaluate((node) => ({
        inMain: Boolean(document.getElementById("main-content")?.contains(node)),
        inMobileSection: Boolean(node.closest('section[aria-label="Mobile differential comparison"]')),
      })),
    )
    .toEqual({ inMain: true, inMobileSection: true });

  await expect(footer).toHaveCount(1);
  await expect(footer, "md:hidden must continue suppressing the mobile comparison footer").toBeHidden();
  await expect
    .poll(() =>
      page.locator('[data-resize-probe="true"]').evaluate((host) => ({
        childCount: host.childElementCount,
        containsFooter: Boolean(host.querySelector('[data-testid="differential-presentation-phone-footer"]')),
      })),
    )
    .toEqual({ childCount: 0, containsFooter: false });
});

test("Services results keep a continuous browser viewport after shared chrome releases", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize(phoneViewport);
  // A submitted Services search exercises GlobalSearchShell's shared phone
  // result canvas (rather than a mode-home or page-owned navigation surface).
  // The exaggerated inset catches paint that leaks only through a freshly
  // relaunched Home Screen PWA's notched-phone safe area.
  await gotoPhoneSurface(page, "/services?q=clinic&run=1&focus=1", 112);
  await expect(page.locator("form.answer-footer-search-dock")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="global-search-input"]:visible').first()).not.toBeFocused({ timeout: 5_000 });
  await expect(page.getByTestId("services-navigator")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("service-search-results")).toBeVisible({ timeout: 20_000 });

  const visible = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>("header#search");
    const headerBackdrop = document.querySelector<HTMLElement>(".edge-glass-header-backdrop");
    const dock = document.querySelector<HTMLElement>(".answer-footer-search-dock");
    const dockBackdrop = dock?.querySelector<HTMLElement>(".answer-footer-search-backdrop");
    const pill = dock?.querySelector<HTMLElement>(".answer-footer-search-pill");
    const dockRect = dock?.getBoundingClientRect();
    const backdropPaint = dockBackdrop ? getComputedStyle(dockBackdrop).backgroundImage : "";
    const readMaskImage = (element: Element, pseudo?: string) => {
      const style = getComputedStyle(element, pseudo);
      return style.maskImage !== "none" ? style.maskImage : style.getPropertyValue("-webkit-mask-image");
    };
    const backdropMask = dockBackdrop ? readMaskImage(dockBackdrop) : "";
    const backdropBeforeMask = dockBackdrop ? readMaskImage(dockBackdrop, "::before") : "";
    const backdropAfterMask = dockBackdrop ? readMaskImage(dockBackdrop, "::after") : "";
    const paintAlphaValues = [
      ...[...backdropPaint.matchAll(/\/\s*(0(?:\.\d+)?|1(?:\.0+)?)\)/g)].map((match) => Number(match[1])),
      ...[...backdropPaint.matchAll(/rgba\([^)]*,\s*(0(?:\.\d+)?|1(?:\.0+)?)\)/g)].map((match) => Number(match[1])),
    ];
    const hasTransparentTerminal = (paint: string) =>
      /rgba\(0,\s*0,\s*0,\s*0\)(?: 100%)?\)$/.test(paint) || /transparent(?: 100%)?\)$/.test(paint);
    return {
      headerBackground: header ? getComputedStyle(header).backgroundColor : "",
      headerBackdropFilter: header ? getComputedStyle(header).backdropFilter : "",
      headerBackdropDisplay: headerBackdrop ? getComputedStyle(headerBackdrop).display : "missing",
      dockBackdropDisplay: dockBackdrop ? getComputedStyle(dockBackdrop).display : "missing",
      dockBackground: dock ? getComputedStyle(dock).backgroundColor : "",
      dockBackdropPosition: dockBackdrop ? getComputedStyle(dockBackdrop).position : "missing",
      dockBackdropPaint: backdropPaint,
      dockBackdropFilter: dockBackdrop ? getComputedStyle(dockBackdrop).backdropFilter : "",
      dockBackdropPointerEvents: dockBackdrop ? getComputedStyle(dockBackdrop).pointerEvents : "",
      dockBackdropHasTranslucentStop: dockBackdrop
        ? /transparent|\/\s*(?:0?\.)\d+/.test(getComputedStyle(dockBackdrop).backgroundImage)
        : false,
      dockBackdropMaxAlpha: paintAlphaValues.length > 0 ? Math.max(...paintAlphaValues) : 1,
      dockBackdropTerminalTransparent: hasTransparentTerminal(backdropPaint),
      dockBackdropMaskTerminalTransparent: hasTransparentTerminal(backdropMask),
      dockBackdropBeforeMaskTerminalTransparent: hasTransparentTerminal(backdropBeforeMask),
      dockBackdropAfterMaskTerminalTransparent: hasTransparentTerminal(backdropAfterMask),
      dockLeft: dockRect?.left ?? -1,
      dockRight: dockRect?.right ?? -1,
      dockBottom: dockRect?.bottom ?? -1,
      pillBackground: pill ? getComputedStyle(pill).backgroundColor : "",
    };
  });

  expect(visible.headerBackground).toMatch(/^rgb\(/);
  expect(visible.headerBackdropFilter).toBe("none");
  expect(visible.headerBackdropDisplay).toBe("none");
  expect(visible.dockBackground).toBe("rgba(0, 0, 0, 0)");
  expect(visible.dockBackdropDisplay).toBe("block");
  expect(visible.dockBackdropPosition).toBe("absolute");
  expect(visible.dockBackdropPaint).toContain("gradient");
  expect(visible.dockBackdropHasTranslucentStop).toBe(true);
  expect(visible.dockBackdropMaxAlpha).toBeLessThanOrEqual(0.52);
  expect(visible.dockBackdropTerminalTransparent).toBe(true);
  expect(visible.dockBackdropMaskTerminalTransparent).toBe(true);
  expect(visible.dockBackdropBeforeMaskTerminalTransparent).toBe(true);
  expect(visible.dockBackdropAfterMaskTerminalTransparent).toBe(true);
  // The runner may emulate reduced transparency; the fallback deliberately
  // removes blur but keeps this translucent gradient instead of a solid slab.
  expect(["none", "blur(2px) saturate(1.3)"]).toContain(visible.dockBackdropFilter);
  expect(visible.dockBackdropPointerEvents).toBe("none");
  expect(visible.dockLeft).toBeCloseTo(0, 0);
  expect(visible.dockRight).toBeCloseTo(phoneViewport.width, 0);
  expect(visible.dockBottom).toBeCloseTo(phoneViewport.height, 0);
  expect(visible.pillBackground).toMatch(/(?:^rgba\([^)]+,\s*0\.97\)|\/ 0\.97\))/);

  const geometry = await readGeometry(page);
  await dragScrollBy(page, Math.min(geometry.maxOffset, 500), 24);
  await expect(page.getByTestId("universal-header-collapse")).toHaveAttribute("data-scroll-hidden", "true");
  await expect(page.locator(".answer-footer-search-dock")).toHaveAttribute("data-scroll-hidden", "true");
  await page.waitForTimeout(300);

  const hidden = await page.evaluate(() => {
    const collapse = document.querySelector<HTMLElement>('[data-testid="universal-header-collapse"]');
    const header = document.querySelector<HTMLElement>("header#search");
    const dock = document.querySelector<HTMLElement>(".answer-footer-search-dock");
    const backdrop = dock?.querySelector<HTMLElement>(".answer-footer-search-backdrop");
    const main = document.getElementById("main-content");
    const shell = main?.closest<HTMLElement>(".phone-viewport-shell");
    const resultList = document.querySelector<HTMLElement>('[data-testid="service-search-results"]');
    const bottomPaintOwner = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 1);
    const scrollingElement = document.scrollingElement ?? document.documentElement;
    return {
      // Missing collapse (Answer strategy:"overlay") is overlay, not collapse.
      usesCollapse: collapse !== null && collapse.getAttribute("data-phone-motion") !== "overlay",
      collapseHeight: collapse?.getBoundingClientRect().height ?? -1,
      headerBottom: header?.getBoundingClientRect().bottom ?? -1,
      dockTop: dock?.getBoundingClientRect().top ?? -1,
      dockOpacity: dock ? getComputedStyle(dock).opacity : "",
      backdropTop: backdrop?.getBoundingClientRect().top ?? -1,
      backdropOpacity: backdrop ? getComputedStyle(backdrop).opacity : "",
      backdropVisibility: backdrop ? getComputedStyle(backdrop).visibility : "",
      reserve: main ? getComputedStyle(main).getPropertyValue("--mobile-composer-reserve").trim() : "",
      shellPosition: shell ? getComputedStyle(shell).position : "missing",
      shellOverflowY: shell ? getComputedStyle(shell).overflowY : "missing",
      mainOverflowX: main ? getComputedStyle(main).overflowX : "missing",
      mainOverflowY: main ? getComputedStyle(main).overflowY : "missing",
      bottomPaintOwnedByResults: Boolean(resultList && bottomPaintOwner && resultList.contains(bottomPaintOwner)),
      anchorTop: resultList?.getBoundingClientRect().top ?? -1,
      documentScrollTop: scrollingElement.scrollTop,
      mainScrollTop: main?.scrollTop ?? -1,
      viewportHeight: window.innerHeight,
    };
  });
  // Overlay keeps collapse-row geometry; collapse releases it to zero.
  if (hidden.usesCollapse) {
    expect(hidden.collapseHeight).toBeLessThanOrEqual(1);
  } else {
    expect(hidden.headerBottom, "overlay header clears the viewport top").toBeLessThanOrEqual(1);
  }
  expect(hidden.dockTop).toBeGreaterThanOrEqual(phoneViewport.height - 1);
  expect(hidden.dockOpacity).toBe("0");
  expect(hidden.backdropTop).toBeGreaterThanOrEqual(phoneViewport.height - 1);
  expect(hidden.backdropOpacity).toBe("0");
  expect(hidden.backdropVisibility).toBe("hidden");
  expect(hidden.reserve).toBe("0rem");
  expect(hidden.shellPosition, "browser phone canvas must stay out of WebKit's fixed-root path").not.toBe("fixed");
  expect(hidden.shellOverflowY).toBe("visible");
  expect(hidden.mainOverflowX).toBe("clip");
  expect(hidden.mainOverflowY).toBe("visible");
  expect(hidden.documentScrollTop, "the document advances while shared chrome is hidden").toBeGreaterThan(0);
  expect(hidden.mainScrollTop, "the browser layout cannot retain a competing inner scroll offset").toBe(0);
  expect(
    hidden.bottomPaintOwnedByResults,
    "the rendered browser viewport has no app-owned band beneath Services results",
  ).toBe(true);

  // Safari toolbar changes shrink and expand the visual viewport after a
  // scroll. Document ownership must keep the reading offset and its content
  // anchor stable without switching back to a fixed or nested canvas.
  const overlayReserveBefore = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--phone-overlay-chrome-h").trim(),
  );
  await page.setViewportSize({ width: phoneViewport.width, height: phoneViewport.height - 64 });
  // Wait for chrome *and* the result anchor to settle rather than sleeping
  // (#146). A viewport-range / height change can spuriously re-show chrome under
  // CI load; product code holds hide via both the range-change guard and the
  // viewportHeightChanged rebase, and the poll must name which half of the
  // contract failed. While chrome is up the results anchor sits exactly
  // `collapseHeight + safe-area-top` lower — 72 + 59 = the 131 px jump that
  // failed this assertion on multiple heads, with `documentScrollTop`
  // unchanged. A related CI failure (PR #1562) kept chrome attribute-hidden and
  // scrollTop stable while the overlay reserve briefly published `0px` then
  // restored — same 131px anchor jump, different half of the contract. Polling
  // only `header.bottom <= 1` is a false settle: the bar can clear the top edge
  // a frame before `data-scroll-hidden` and the content anchor finish recovering
  // (reproduced on PR #1521 tip `061468e4`, Production UI shard 1). Keep the
  // 0.5px anchor tolerance (#146 stop rule) and require a positive overlay
  // reserve so a 0px publish cannot read as settled chrome.
  await expect
    .poll(
      async () => {
        return page.evaluate(
          ({ expectedAnchorTop, expectedReserve }) => {
            const header = document.querySelector("header#search");
            const collapse = document.querySelector('[data-testid="universal-header-collapse"]');
            const dock = document.querySelector(".answer-footer-search-dock");
            const resultList = document.querySelector('[data-testid="service-search-results"]');
            const scrollingElement = document.scrollingElement ?? document.documentElement;
            const headerBottom = header?.getBoundingClientRect().bottom ?? -1;
            const anchorTop = resultList?.getBoundingClientRect().top ?? Number.NaN;
            const overlayReserve = getComputedStyle(document.documentElement)
              .getPropertyValue("--phone-overlay-chrome-h")
              .trim();
            const reservePx = Number.parseFloat(overlayReserve);
            const chromeHidden =
              headerBottom <= 1 &&
              collapse?.getAttribute("data-scroll-hidden") === "true" &&
              dock?.getAttribute("data-scroll-hidden") === "true";
            const anchorStable = Number.isFinite(anchorTop) && Math.abs(anchorTop - expectedAnchorTop) < 0.5;
            const reserveStable =
              Number.isFinite(reservePx) &&
              reservePx > 0 &&
              (!expectedReserve || Math.abs(reservePx - Number.parseFloat(expectedReserve)) < 1);
            return {
              ok: chromeHidden && anchorStable && reserveStable,
              chromeHidden,
              anchorStable,
              reserveStable,
              headerBottom,
              collapseHidden: collapse?.getAttribute("data-scroll-hidden"),
              dockHidden: dock?.getAttribute("data-scroll-hidden"),
              scrollSignal: collapse?.getAttribute("data-scroll-signal") ?? "missing",
              anchorTop,
              expectedAnchorTop,
              overlayReserve,
              expectedReserve,
              documentScrollTop: scrollingElement.scrollTop,
            };
          },
          { expectedAnchorTop: hidden.anchorTop, expectedReserve: overlayReserveBefore },
        );
      },
      {
        timeout: 10_000,
        message: "shared chrome and Services result anchor did not re-settle after the viewport shrink",
      },
    )
    .toMatchObject({ ok: true });
  const afterViewportResize = await page.evaluate(() => {
    const main = document.getElementById("main-content");
    const resultList = document.querySelector<HTMLElement>('[data-testid="service-search-results"]');
    const bottomPaintOwner = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 1);
    const scrollingElement = document.scrollingElement ?? document.documentElement;
    return {
      bottomPaintOwnedByResults: Boolean(resultList && bottomPaintOwner && resultList.contains(bottomPaintOwner)),
      anchorTop: resultList?.getBoundingClientRect().top ?? -1,
      documentScrollTop: scrollingElement.scrollTop,
      mainScrollTop: main?.scrollTop ?? -1,
    };
  });
  expect(afterViewportResize.bottomPaintOwnedByResults).toBe(true);
  expect(afterViewportResize.anchorTop, "viewport shrink keeps the result content anchor stable").toBeCloseTo(
    hidden.anchorTop,
    0,
  );
  expect(afterViewportResize.documentScrollTop, "viewport resize does not jump the reading position").toBeCloseTo(
    hidden.documentScrollTop,
    0,
  );
  expect(afterViewportResize.mainScrollTop).toBe(0);

  await page.setViewportSize(phoneViewport);
  await page.waitForTimeout(100);
  const afterViewportRestore = await page.evaluate(() => {
    const main = document.getElementById("main-content");
    const resultList = document.querySelector<HTMLElement>('[data-testid="service-search-results"]');
    const bottomPaintOwner = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 1);
    const scrollingElement = document.scrollingElement ?? document.documentElement;
    return {
      bottomPaintOwnedByResults: Boolean(resultList && bottomPaintOwner && resultList.contains(bottomPaintOwner)),
      anchorTop: resultList?.getBoundingClientRect().top ?? -1,
      documentScrollTop: scrollingElement.scrollTop,
      mainScrollTop: main?.scrollTop ?? -1,
    };
  });
  expect(afterViewportRestore.bottomPaintOwnedByResults).toBe(true);
  expect(afterViewportRestore.documentScrollTop, "viewport expansion does not jump the reading position").toBeCloseTo(
    hidden.documentScrollTop,
    0,
  );
  expect(afterViewportRestore.mainScrollTop).toBe(0);
  expect(afterViewportRestore.anchorTop, "viewport resize keeps the result content anchor stable").toBeCloseTo(
    hidden.anchorTop,
    0,
  );
});

test("calculator results stay usable across the responsive and accessibility matrix", async ({ page }) => {
  const viewports = [
    { width: 320, height: 740 },
    { width: 390, height: 844 },
    { width: 639, height: 900 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ] as const;

  for (const { width, height } of viewports) {
    await page.emulateMedia({ colorScheme: "light", forcedColors: "none", reducedMotion: "no-preference" });
    await page.setViewportSize({ width, height });
    await gotoPhoneSurface(page, "/calculators?q=depression&run=1", 112);

    const pageSurface = page.getByTestId("calculators-search-page");
    const geometry = await pageSurface.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(geometry.scrollWidth, `${width}px calculator canvas must not clip result controls`).toBeLessThanOrEqual(
      geometry.clientWidth + 1,
    );

    const filterTrigger = page.getByTestId(
      width < 640 ? "calculators-filter-trigger-phone" : "calculators-filter-trigger-desktop",
    );
    for (const control of [filterTrigger, page.getByRole("button", { name: /^Open PHQ-9/ })]) {
      const box = await control.boundingBox();
      expect(box, `${width}px calculator control should be rendered`).not.toBeNull();
      expect(box!.x, `${width}px calculator control starts inside the viewport`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${width}px calculator control ends inside the viewport`).toBeLessThanOrEqual(
        width + 1,
      );
    }

    await filterTrigger.click();
    const filterSheet = page.getByTestId("calculators-filter-sheet");
    await expect(filterSheet).toBeVisible();
    const filterGeometry = await filterSheet.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      right: element.getBoundingClientRect().right,
    }));
    expect(filterGeometry.scrollWidth, `${width}px calculator filters must not overflow`).toBeLessThanOrEqual(
      filterGeometry.clientWidth + 1,
    );
    expect(filterGeometry.right, `${width}px calculator filters stay inside the viewport`).toBeLessThanOrEqual(
      width + 1,
    );
    await page.keyboard.press("Escape");
    await expect(filterSheet).toBeHidden();
    await expect(filterTrigger).toBeFocused();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  for (const media of [
    { colorScheme: "dark" as const, forcedColors: "none" as const, reducedMotion: "no-preference" as const },
    { colorScheme: "light" as const, forcedColors: "none" as const, reducedMotion: "reduce" as const },
    { colorScheme: "light" as const, forcedColors: "active" as const, reducedMotion: "no-preference" as const },
  ]) {
    await page.emulateMedia(media);
    await gotoPhoneSurface(page, "/calculators?q=depression&run=1", 112);
    await expect(page.getByTestId("calculators-search-page")).toBeVisible();
    await expect(page.getByTestId("calculators-filter-trigger-phone")).toBeVisible();
  }
});
