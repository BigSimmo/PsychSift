import { expect, test, type Page } from "playwright/test";
import { readPrimaryScrollGeometry } from "./playwright-scroll";

/**
 * Tablet/desktop top-bar hide-and-return, with breakpoint-specific search ownership.
 *
 * Two defects are guarded here:
 *
 *  1. Above the phone breakpoint the top bar used to scroll away with the page
 *     and only return at the very top (no scroll reporter / sticky travel).
 *  2. Search belongs to normal page flow on tablets and desktops, where it
 *     scrolls away independently from the sticky top bar.
 *
 * The load-bearing assertions are (a) the reveal *mid-page* and (b) the search
 * input leaving the viewport while the top bar can return mid-page. Asserting
 * only `data-scroll-hidden` would miss both.
 *
 * The suite-wide `reducedMotion: "reduce"` is kept deliberately: the chrome
 * carries `motion-reduce:transition-none`, so geometry settles in one frame and
 * these position reads are exact. Transition timing is covered by
 * ui-phone-scroll.spec.ts, which re-enables motion for that purpose.
 */

const breakpoints = [
  { name: "tablet", viewport: { width: 834, height: 1112 } },
  { name: "desktop", viewport: { width: 1440, height: 900 } },
];

// One surface per scroll-ownership model above the phone breakpoint, chosen for
// having real scroll runway at both sizes (short pages legitimately never hide).
// These result/detail pages own the generic page-flow slot on desktop.
const surfaces: Array<{ name: string; route: string; minimumRunway?: number }> = [
  { name: "shell results", route: "/forms?q=form%201A&run=1" },
  // A long service record used to carry a fourth surface here, back when detail
  // pages owned the page-flow composer. Information pages no longer render one
  // in any mode, so a record page cannot satisfy this loop's slot assertions —
  // its hide/reveal proof moved to the dedicated information-page test below,
  // which keeps the same long record and drops only the composer expectations.
  { name: "dashboard results", route: "/?mode=prescribing&q=a&run=1" },
  // Therapy search carries the shared `ModeNav` inside the collapse row. The
  // phone case is covered by ui-phone-scroll; this is the tablet/desktop proof
  // that the bar travels with the header at every width, which is the whole
  // reason its portal drops PhoneHeaderCollapsePortal's 639px gate.
  { name: "shell mode nav", route: "/therapy-compass/search?q=CBT&run=1" },
];

const requiredRunway = 700;

async function blockExternalRequests(page: Page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
    ) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.fallback();
  });
}

interface ChromeState {
  offset: number;
  maxOffset: number;
  hidden: boolean;
  headerTop: number;
  headerBottom: number;
  searchTop: number;
  searchBottom: number;
  searchVisible: boolean;
  searchPlacement: string | null;
  searchInsideDesktopPageSlot: boolean;
  searchHasStickyAncestor: boolean;
  desktopPageSearchClearsFollowingContent: boolean | null;
  hiddenBottomComposers: number;
}

/**
 * Reads whichever element actually scrolls at this width, so one spec can cover
 * both the document-scrolled shell and the `<main>`-scrolled dashboard.
 */
function readChromeState(page: Page): Promise<ChromeState> {
  return page
    .evaluate(() => {
      // Collapse hosts flip data-scroll-hidden on the top-bar grid wrapper; the
      // answer view's overlay glass bar flips it on header#search itself.
      const header = document.querySelector("header#search");
      const hideTarget = document.querySelector('[data-testid="universal-header-collapse"]') ?? header;
      const rect = header?.getBoundingClientRect();
      // Prefer the global search input; fall back to any visible search textbox
      // so hero-portaled composers still count.
      const search =
        document.querySelector<HTMLElement>('[data-testid="global-search-input"]') ??
        document.querySelector<HTMLElement>('input[type="search"], input[role="combobox"]');
      const searchRect = search?.getBoundingClientRect();
      const searchForm = search?.closest("form");
      const desktopPageSlot = searchForm?.closest<HTMLElement>('[data-testid="desktop-page-search-composer-slot"]');
      const followingContent = desktopPageSlot
        ? Array.from(desktopPageSlot.parentElement?.children ?? [])
            .slice(Array.from(desktopPageSlot.parentElement?.children ?? []).indexOf(desktopPageSlot) + 1)
            .find((element) => {
              const candidateRect = element.getBoundingClientRect();
              return candidateRect.width > 0 && candidateRect.height > 0;
            })
        : null;
      let searchHasStickyAncestor = false;
      for (let node = searchForm?.parentElement ?? null; node && !searchHasStickyAncestor; node = node.parentElement) {
        searchHasStickyAncestor = window.getComputedStyle(node).position === "sticky";
      }
      const searchOnScreen = Boolean(
        searchRect &&
        searchRect.width > 0 &&
        searchRect.height > 0 &&
        searchRect.bottom > 0 &&
        searchRect.top < window.innerHeight,
      );
      return {
        hidden: hideTarget?.getAttribute("data-scroll-hidden") === "true",
        headerTop: rect ? Math.round(rect.top) : Number.NaN,
        headerBottom: rect ? Math.round(rect.bottom) : Number.NaN,
        searchTop: searchRect ? Math.round(searchRect.top) : Number.NaN,
        searchBottom: searchRect ? Math.round(searchRect.bottom) : Number.NaN,
        searchVisible: searchOnScreen,
        searchPlacement: searchForm?.dataset.composerPlacement ?? null,
        searchInsideDesktopPageSlot: Boolean(searchForm?.closest('[data-testid="desktop-page-search-composer-slot"]')),
        searchHasStickyAncestor,
        desktopPageSearchClearsFollowingContent:
          desktopPageSlot && followingContent
            ? desktopPageSlot.getBoundingClientRect().bottom <= followingContent.getBoundingClientRect().top + 1
            : null,
        hiddenBottomComposers: document.querySelectorAll('form[data-scroll-hidden="true"]').length,
      };
    })
    .then((state) =>
      readPrimaryScrollGeometry(page).then((geometry) => ({
        ...state,
        offset: Math.round(geometry.scrollTop),
        maxOffset: Math.round(geometry.maxScrollTop),
      })),
    );
}

/** Scrolls in per-frame steps so the reporter sees real directional intent. */
async function scrollBy(page: Page, totalPx: number, stepPx: number) {
  const { owner } = await readPrimaryScrollGeometry(page);

  const steps = Math.max(1, Math.ceil(Math.abs(totalPx) / stepPx));
  const direction = totalPx < 0 ? -1 : 1;
  const stepPxAbs = Math.abs(stepPx);
  let remaining = Math.abs(totalPx);

  for (let i = 0; i < steps && remaining > 0; i += 1) {
    const delta = direction * Math.min(stepPxAbs, remaining);
    if (owner === "main") {
      await page.evaluate((nextDelta) => {
        const main = document.getElementById("main-content");
        if (!main) return;
        main.scrollTop += nextDelta;
        main.dispatchEvent(new Event("scroll", { bubbles: true }));
      }, delta);
    } else {
      await page.mouse.wheel(0, delta);
    }
    remaining -= Math.min(stepPxAbs, remaining);
    await page.waitForTimeout(16);
  }
}

/**
 * These routes stream content in after first paint, so the runway a test needs
 * does not exist at domcontentloaded. Waiting for it beats a fixed timeout.
 */
async function waitForRunway(page: Page, minimum: number) {
  await page.waitForFunction(
    (min) => {
      const main = document.getElementById("main-content");
      const fromMain = main ? main.scrollHeight - main.clientHeight : 0;
      const fromDocument = document.documentElement.scrollHeight - window.innerHeight;
      return Math.max(fromMain, fromDocument) >= min;
    },
    minimum,
    { timeout: 20_000 },
  );
}

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page);
});

test("1024px bounded main scrolling preserves focused page search", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?mode=prescribing&q=a&run=1", { waitUntil: "domcontentloaded" });
  // Scope to the visible composer: Next may briefly retain a hidden streaming
  // `S:` clone of the page root under CI load, so a document-wide getByTestId
  // strict-mode fails on two identical inputs, one of them hidden. Same class of
  // flake the differentials detail page hit, and the same remedy already used
  // for this exact testid in ui-overlap.spec.ts.
  const input = page.locator('[data-testid="global-search-input"]:visible').first();
  await expect(input).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => (await readPrimaryScrollGeometry(page)).maxScrollTop, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(requiredRunway);
  await expect.poll(async () => (await readPrimaryScrollGeometry(page)).owner).toBe("main");
  await input.focus();
  await expect(input).toBeFocused();

  await scrollBy(page, 320, 80);

  await expect.poll(async () => (await readPrimaryScrollGeometry(page)).owner).toBe("main");
  await expect.poll(async () => (await readPrimaryScrollGeometry(page)).scrollTop).toBeGreaterThan(0);
  await expect(input, "bounded desktop main scrolling must preserve deliberate keyboard focus").toBeFocused();
});

test.describe("tablet and desktop scroll chrome", () => {
  // These breakpoints drive the page with a mouse wheel and pin tablet/desktop owners.
  // The iPhone projects (isMobile) have no wheel and never render those owners.
  test.skip(({ isMobile }) => isMobile, "tablet/desktop wheel scrolling does not apply to the iPhone projects");
  for (const { name: sizeName, viewport } of breakpoints) {
    for (const { name: surfaceName, route, minimumRunway = requiredRunway } of surfaces) {
      test(`${sizeName}: top bar hides on scroll down and returns mid-page on ${surfaceName}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await expect(page.locator("header#search").first()).toBeVisible({ timeout: 15_000 });
        await waitForRunway(page, minimumRunway);
        await page.waitForTimeout(400);

        const atTop = await readChromeState(page);
        expect(atTop.hidden, "top bar visible at the top").toBe(false);
        expect(atTop.headerTop, "top bar starts at the viewport top").toBeLessThanOrEqual(8);
        expect(atTop.searchVisible, "search starts on screen").toBe(true);
        if (sizeName === "tablet" || sizeName === "desktop") {
          expect(atTop.searchPlacement).toBe("desktop-page");
          expect(atTop.searchInsideDesktopPageSlot).toBe(true);
          expect(atTop.searchHasStickyAncestor).toBe(false);
          expect(atTop.desktopPageSearchClearsFollowingContent).toBe(true);
        }

        await scrollBy(page, atTop.maxOffset + 320, 160);
        await expect
          .poll(async () => {
            const state = await readChromeState(page);
            return state.hidden && state.headerBottom <= 0;
          })
          .toBe(true);

        const scrolledDown = await readChromeState(page);
        expect(scrolledDown.offset, "descent moved the scroller").toBeGreaterThan(minimumRunway - 200);
        expect(scrolledDown.hidden, "top bar hides on a deliberate scroll down").toBe(true);
        expect(scrolledDown.headerBottom, "hidden top bar is off the top of the viewport").toBeLessThanOrEqual(0);
        expect(scrolledDown.searchVisible, "page search scrolls away with page content").toBe(false);

        // Three deliberate upward steps — nowhere near the top of the page.
        await scrollBy(page, -360, 120);
        await expect
          .poll(async () => {
            const state = await readChromeState(page);
            return !state.hidden && state.headerTop <= 8 && state.headerBottom > 0;
          })
          .toBe(true);

        const scrolledUp = await readChromeState(page);
        expect(scrolledUp.offset, "the reveal happens well short of the top").toBeGreaterThan(200);
        expect(scrolledUp.hidden, "top bar returns on a deliberate scroll up").toBe(false);
        expect(scrolledUp.headerBottom, "returned top bar is actually on screen").toBeGreaterThan(0);
        expect(scrolledUp.headerTop, "returned top bar sits at the viewport top").toBeLessThanOrEqual(8);
        expect(scrolledUp.searchVisible, "returning the top bar does not re-anchor page search").toBe(false);
      });

      test(`${sizeName}: search composer keeps its breakpoint owner on ${surfaceName}`, async ({ page }) => {
        // data-scroll-hidden is reserved for the phone dock. Tablet and desktop
        // search leave by ordinary page scrolling instead.
        await page.setViewportSize(viewport);
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await expect(page.locator("header#search").first()).toBeVisible({ timeout: 15_000 });
        await waitForRunway(page, minimumRunway);
        await page.waitForTimeout(400);

        const atTop = await readChromeState(page);
        expect(atTop.searchVisible).toBe(true);
        await scrollBy(page, atTop.maxOffset + 320, 160);
        await expect
          .poll(async () => {
            const state = await readChromeState(page);
            return state.hidden && state.headerBottom <= 0;
          })
          .toBe(true);

        const scrolledDown = await readChromeState(page);
        expect(scrolledDown.hidden, "the top bar still hides").toBe(true);
        expect(
          scrolledDown.hiddenBottomComposers,
          "no composer flips data-scroll-hidden above the phone breakpoint",
        ).toBe(0);
        expect(atTop.searchInsideDesktopPageSlot, "tablet and desktop search start in the page slot").toBe(true);
        expect(scrolledDown.searchVisible, "page search scrolls away with page content").toBe(false);
      });
    }

    /**
     * Information pages own no composer in any mode, at any breakpoint. That is a
     * different contract from the surfaces above, not a variant of it: there is no
     * page slot to sit in and nothing to scroll away, so the loop's search
     * assertions cannot express it. What still has to hold is the top bar's own
     * hide-and-return, which is what the retired "shell service detail" surface
     * was really proving. This record measures ~2000px of runway at 834x1112 and
     * ~1300px at 1440x900, both clear of the 700px floor.
     */
    test(`${sizeName}: a record page hides the top bar on scroll and returns it mid-page with no composer`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/services/mother-and-baby-mental-health-unit-fiona-stanley-hospital", {
        waitUntil: "domcontentloaded",
      });
      await expect(page.locator("header#search").first()).toBeVisible({ timeout: 15_000 });
      await waitForRunway(page, requiredRunway);
      await page.waitForTimeout(400);

      await expect(page.getByTestId("global-search-input")).toHaveCount(0);
      await expect(page.getByTestId("desktop-page-search-composer-slot")).toHaveCount(0);

      const atTop = await readChromeState(page);
      expect(atTop.hidden, "top bar visible at the top").toBe(false);
      expect(atTop.headerTop, "top bar starts at the viewport top").toBeLessThanOrEqual(8);

      await scrollBy(page, atTop.maxOffset + 320, 160);
      await expect
        .poll(async () => {
          const state = await readChromeState(page);
          return state.hidden && state.headerBottom <= 0;
        })
        .toBe(true);

      const scrolledDown = await readChromeState(page);
      expect(scrolledDown.offset, "descent moved the scroller").toBeGreaterThan(requiredRunway - 200);
      expect(scrolledDown.hidden, "top bar hides on a deliberate scroll down").toBe(true);
      expect(scrolledDown.headerBottom, "hidden top bar is off the top of the viewport").toBeLessThanOrEqual(0);

      // Three deliberate upward steps — nowhere near the top of the page.
      await scrollBy(page, -360, 120);
      await expect
        .poll(async () => {
          const state = await readChromeState(page);
          return !state.hidden && state.headerTop <= 8;
        })
        .toBe(true);

      const scrolledUp = await readChromeState(page);
      expect(scrolledUp.offset, "the reveal happens well short of the top").toBeGreaterThan(200);
      expect(scrolledUp.hidden, "top bar returns on a deliberate scroll up").toBe(false);
      expect(scrolledUp.headerTop, "returned top bar sits at the viewport top").toBeLessThanOrEqual(8);
      expect(scrolledUp.searchVisible, "a record page never grows a composer on reveal").toBe(false);
    });
  }
});

/**
 * Dead scroll: a scroll range on a page whose content has already ended.
 *
 * Page-fill floors used to be written as `calc(100dvh - <chrome estimate>)`.
 * Every estimate was short — `--shell-header-h` (4rem) omits the header's own
 * `pt-[max(0.5rem,var(--safe-area-top))]`, nothing knew about the
 * `header-collapse-addon` nav row on topic routes, and nothing knew about
 * `#main-content`'s own `sm:pb-8`. The result was a permanent 8-273px of scroll
 * on pages with nothing left to show: a scrollbar on a page that fits, and a
 * wheel notch that jolts the page and slams into the bottom.
 *
 * These surfaces now grow into the box above them instead, so the range must be
 * exactly zero. The viewport is deliberately tall enough that every one of these
 * routes fits; a route whose content genuinely exceeds it belongs in the
 * scrolling suites above, not here.
 */
test.describe("pages that fit the window have no scroll range", () => {
  const fitsWithoutScrolling = [
    { name: "shared home", route: "/" },
    { name: "dashboard mode home", route: "/?mode=documents" },
    { name: "standalone mode home", route: "/medications" },
    { name: "addon nav row route", route: "/factsheets/topics" },
    // #6KR6BR: the 2026-08-27 sweep after PR #2419 reported 2px of residual
    // range here at 1280x1200 and nowhere else. Re-measured 2026-09-02 across
    // 1024/1280/1440 x 800/1200 at deviceScaleFactor 1 and 2, in both page
    // states, it is 0 — the catalogue's content is a fixed 1018px tall, so a
    // 1200px window clears it by 182px. Both states are pinned at the exact
    // reported viewport so a future content-driven regression is caught here
    // rather than by another ad-hoc sweep. The catalogue is static module data,
    // so its length does not vary with demo vs live mode.
    {
      name: "calculators catalogue",
      route: "/calculators/search",
      viewport: { width: 1280, height: 1200 },
    },
    {
      name: "calculators submitted results",
      route: "/calculators/search?q=depression&run=1",
      viewport: { width: 1280, height: 1200 },
    },
  ];

  for (const { name, route, viewport = { width: 1440, height: 1200 } } of fitsWithoutScrolling) {
    test(`desktop: ${name} has zero scroll range`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("header#search").first()).toBeVisible({ timeout: 15_000 });
      // Late chrome (composer portal, nav row, notices) mounts after first paint
      // and is exactly what a static estimate would miss, so settle before
      // reading — then read a second time. A single early read could catch the
      // page before the nav row lands and pass on a range that is about to grow.
      await page.waitForTimeout(800);
      const settled = await readPrimaryScrollGeometry(page);
      expect(settled.maxScrollTop, `${route} reserves ${settled.maxScrollTop}px of scroll past its content`).toBe(0);

      await page.waitForTimeout(400);
      const stable = await readPrimaryScrollGeometry(page);
      expect(stable.maxScrollTop, `${route} grew a scroll range after late chrome mounted`).toBe(0);
    });
  }

  test("desktop: tall documents home centres its action cluster in the available canvas", async ({ page }) => {
    await page.setViewportSize({ width: 1720, height: 1350 });
    await page.goto("/?mode=documents", { waitUntil: "domcontentloaded" });
    await expect(page.locator("header#search").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("shared-home-empty-state")).toBeVisible();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );

    const geometry = await page.evaluate(() => {
      const home = document.querySelector<HTMLElement>('[data-testid="shared-home-empty-state"]');
      const canvas = document.querySelector<HTMLElement>("[data-mode-home-canvas]");
      const main = document.getElementById("main-content");
      if (!home || !canvas || !main) return null;

      const homeRect = home.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      return {
        homeMidY: homeRect.top + homeRect.height / 2,
        canvasMidY: canvasRect.top + canvasRect.height / 2,
        maxScrollTop: Math.max(0, main.scrollHeight - main.clientHeight),
      };
    });

    expect(geometry).not.toBeNull();
    expect(Math.abs(geometry!.homeMidY - geometry!.canvasMidY)).toBeLessThanOrEqual(1);
    expect(geometry!.maxScrollTop).toBe(0);
  });
});
