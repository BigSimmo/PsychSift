import { expect, type Locator, type Page } from "playwright/test";
import { phoneHeaderCollapseAddonSlotId } from "../../src/lib/mode-home-composer";

/**
 * Shared fixtures for the phone scroll-geometry guardrails (the #964 regression class).
 *
 * Hiding the phone chrome (header grid collapse + dock reserve-pad shrink)
 * releases layout back into the active phone scroll owner. Browser tabs use
 * document scrolling so Safari can collapse its own chrome; installed and
 * otherwise bounded contexts may retain #main-content as an inner scroller.
 * When a chrome release exceeds the remaining scroll runway, the offset
 * clamps onto the new bottom edge and any small upward drag snaps the geometry back — a
 * hide/reveal oscillation that reads as "scroll locks to the bottom" plus a
 * blank band below the content. use-hide-on-scroll's collapse-budget gate
 * refuses such hides; the specs that import this sweep every phone surface and
 * assert the scroll geometry stays stable at the bottom edge.
 *
 * IMPORTANT: the suite-wide default emulates `reducedMotion: reduce`, which
 * disables the very padding/grid transitions that produce this failure mode —
 * it is exactly how #964 shipped green. Every test using these fixtures re-enables
 * motion via page.emulateMedia({ reducedMotion: "no-preference" }).
 *
 * The phone-scroll coverage is split across three spec files (see
 * docs/process-hardening.md). `tests/playwright-project-isolation.test.ts`
 * asserts every `ui-phone-scroll*.spec.ts` on disk is matched by both
 * `productionSpecPattern` and `testMatch` in playwright.config.ts, so a new
 * sibling that those patterns miss fails closed rather than silently not running.
 */

// Standalone mode homes share GlobalSearchShell's phone scroller. They keep the
// in-flow hero pill on phones (the composer sits in the hero and scrolls with the
// content — no bottom dock), while the sticky header still collapses on scroll;
// this sweep guards that the scroll geometry stays stable through that collapse.
// (list mirrors isStandaloneModeHomePath in search-route-ownership.ts).
export const modeHomeRoutes = [
  "/formulation",
  "/dsm",
  "/tools",
  "/calculators",
  "/differentials",
  "/specifiers",
  "/factsheets",
  "/therapy-compass",
  "/services",
  "/forms",
  "/favourites",
];

// ClinicalDashboard scroller (answer home keeps the in-flow hero pill; the
// other modes dock the compact composer) plus representative long pages.
export const dashboardRoutes = ["/?mode=answer", "/?mode=documents", "/?mode=prescribing"];
export const longRoutes = [
  "/formulation/worry",
  "/formulation/builder?mechanism=rumination&template=5Ps",
  "/documents/search",
  "/calculators?q=depression&run=1",
  // Demo-corpus document detail: DocumentViewer owns its composer here, and its
  // scroll container binding has its own failure mode (stale #main-content).
  "/documents/11111111-1111-4111-8111-111111111111?page=1",
];

export const appModeHeaderRoutes = [
  { mode: "Answer", route: "/?mode=answer" },
  { mode: "Documents", route: "/?mode=documents" },
  { mode: "Services", route: "/services" },
  { mode: "Forms", route: "/forms" },
  { mode: "Favourites", route: "/favourites" },
  { mode: "Differentials", route: "/differentials" },
  { mode: "DSM", route: "/dsm" },
  { mode: "Specifiers", route: "/specifiers" },
  { mode: "Formulation", route: "/formulation" },
  { mode: "Medication", route: "/?mode=prescribing" },
  { mode: "Tools", route: "/tools" },
  { mode: "Calculators", route: "/calculators" },
  { mode: "Therapy", route: "/therapy-compass" },
  { mode: "Factsheets", route: "/factsheets" },
];

// Every phone route now overlays its chrome, portaled page navigation included:
// collapsing the row in flow moved the reader's position by the released header
// height (measured 147px on /therapy-compass/pathways and 137px on a
// differential detail) every time the chrome hid. `--phone-overlay-chrome-h` is
// measured from the live stack, so it absorbs the extra addon band these routes
// portal into the collapse row.
export const pageOwnedHeaderRoutes = [
  {
    name: "Therapy mode navigation",
    route: "/therapy-compass/search?q=CBT&run=1",
    selector: '[data-testid="mode-nav"]',
    phoneMotion: "overlay" as const,
  },
  {
    // A second Therapy route, kept from when Compare and Search shipped
    // different navigation: the bar is now shared, so this proves the same
    // component travels with the header on a route that reaches it by a
    // different render path.
    name: "Therapy mode navigation (compare)",
    route: "/therapy-compass/compare",
    selector: '[data-testid="mode-nav"]',
    phoneMotion: "overlay" as const,
  },
  {
    name: "document navigation",
    route: "/documents/11111111-1111-4111-8111-111111111111?page=1",
    selector: "header",
    phoneMotion: "overlay" as const,
  },
  {
    name: "differential detail navigation",
    route: "/differentials/diagnoses/delirium",
    selector: '[data-testid="differential-detail-header"]',
    phoneMotion: "overlay" as const,
  },
  {
    // The breadcrumb shape of the same shared header: no section track, and on
    // this route a second band for the reading-level segments. That band is the
    // reason it is here — it is the tallest addon the collapse row carries, so
    // it is the strongest test that `--phone-overlay-chrome-h` is measured from
    // the live stack rather than assumed.
    name: "factsheet detail navigation",
    route: "/factsheets/sertraline",
    selector: '[data-testid="factsheet-detail-header"]',
    phoneMotion: "overlay" as const,
  },
];

export const standalonePageOwnedFooterRoutes = [
  {
    name: "document composer",
    route: "/documents/11111111-1111-4111-8111-111111111111?page=1",
    selector: "form.document-viewer-composer",
    openViaDocumentActions: true,
    focusSelector: 'input[placeholder="Search within this document..."]',
    reserveSelector: '[data-testid="document-viewer-content"]',
    flushBottom: false,
  },
  {
    name: "differential comparison actions",
    route: "/differentials/presentations/acute-confusion-encephalopathy",
    selector: '[data-testid="differential-presentation-phone-footer"]',
    openViaDocumentActions: false,
    focusSelector: null,
    reserveSelector: null,
    flushBottom: true,
  },
] as const;

export const phoneViewport = { width: 390, height: 844 };

export async function blockExternalRequests(page: Page) {
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

export async function gotoPhoneSurface(page: Page, path: string, safeAreaBottom = 34) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#main-content").first()).toBeVisible({ timeout: 15_000 });
  // Simulate installed-PWA safe-area insets (the repo routes env() through
  // these vars precisely so Chromium tests can exercise them).
  await page.addStyleTag({
    content: `:root{--safe-area-top:59px !important;--safe-area-bottom:${safeAreaBottom}px !important;}`,
  });
  // Let hydration, fonts, and the composer/portal layout settle.
  await page.waitForTimeout(700);
}

/**
 * Chromium cannot emulate the `display-mode` media feature. Apply the exact
 * compiled rules from the app's standalone media block after load so computed
 * layout and scrolling still exercise that production cascade. The static CSS
 * contract separately pins those declarations inside the standalone query;
 * physical iOS acceptance remains the final viewport-paint proof.
 */
export function forceCompiledStandalonePhoneCss(page: Page): Promise<number> {
  return page.evaluate(() => {
    const standaloneRules: string[] = [];
    const visit = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSMediaRule && rule.conditionText.includes("display-mode: standalone")) {
          standaloneRules.push(...Array.from(rule.cssRules, (child) => child.cssText));
          continue;
        }
        const nestedRules = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
        if (nestedRules) visit(nestedRules);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        visit(sheet.cssRules);
      } catch {
        // Ignore browser/extension sheets whose CSSOM is intentionally opaque.
      }
    }
    const style = document.createElement("style");
    style.dataset.testid = "forced-standalone-phone-css";
    style.textContent = standaloneRules.join("\n");
    document.head.append(style);
    window.dispatchEvent(new Event("resize"));
    return standaloneRules.length;
  });
}

/**
 * Emulates an installed phone PWA environment with `display-mode: standalone`.
 *
 * Configures the phone viewport, safe-area CSS variables, and enables the
 * standalone display-mode media feature via CDP (on Chromium) and by applying
 * compiled standalone rules from globals.css across all browser engines.
 */
export async function emulatePhoneStandalonePwa(
  page: Page,
  path: string,
  options: { safeAreaBottom?: number } = {},
): Promise<number> {
  await page.setViewportSize(phoneViewport);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  if (page.context().browser()?.browserType().name() === "chromium") {
    try {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setEmulatedMedia", {
        features: [{ name: "display-mode", value: "standalone" }],
      });
    } catch {
      // Sandboxed Chromium without CDP access falls back to forced CSS below.
    }
  }
  await gotoPhoneSurface(page, path, options.safeAreaBottom ?? 34);
  const rulesCount = await forceCompiledStandalonePhoneCss(page);
  await page.waitForTimeout(300);
  return rulesCount;
}

export interface StandaloneShellGeometry {
  shellHeight: number;
  shellOverflowY: string;
  frameHeight: number;
  framePosition: string;
  frameOverflow: string;
  mainOverflowY: string;
  mainOverscrollBehaviorY: string;
  scrollOwner: "document" | "main";
  headerPosition: string;
  headerHidden: boolean;
  docScrollTop: number;
  mainScrollTop: number;
  horizontalOverflow: number;
}

export function readStandaloneShellGeometry(page: Page): Promise<StandaloneShellGeometry> {
  return page.evaluate(() => {
    const shell =
      document.querySelector<HTMLElement>(".phone-viewport-shell") ??
      document.querySelector<HTMLElement>(".mobile-app-shell");
    const frame = document.querySelector<HTMLElement>(".phone-viewport-frame");
    const main = document.getElementById("main-content");
    const header =
      document.querySelector<HTMLElement>('[data-testid="universal-header-collapse"]') ??
      document.querySelector<HTMLElement>("header#search");
    const doc = document.scrollingElement ?? document.documentElement;
    const mainOverflowY = main ? getComputedStyle(main).overflowY : "";
    const mainOwnsScroll = Boolean(
      main && /^(?:auto|scroll|overlay)$/.test(mainOverflowY) && main.scrollHeight > main.clientHeight + 1,
    );

    return {
      shellHeight: shell?.getBoundingClientRect().height ?? 0,
      shellOverflowY: shell ? getComputedStyle(shell).overflowY : "",
      frameHeight: frame?.getBoundingClientRect().height ?? 0,
      framePosition: frame ? getComputedStyle(frame).position : "",
      frameOverflow: frame ? getComputedStyle(frame).overflow : "",
      mainOverflowY,
      mainOverscrollBehaviorY: main ? getComputedStyle(main).overscrollBehaviorY : "",
      scrollOwner: mainOwnsScroll ? "main" : "document",
      headerPosition: header ? getComputedStyle(header).position : "",
      headerHidden: header?.getAttribute("data-scroll-hidden") === "true",
      docScrollTop: doc.scrollTop,
      mainScrollTop: main?.scrollTop ?? 0,
      horizontalOverflow: Math.max(doc.scrollWidth, document.body?.scrollWidth ?? 0) - window.innerWidth,
    };
  });
}

export async function addPhoneScrollRunway(page: Page) {
  await page.evaluate(() => {
    const main = document.getElementById("main-content");
    if (!main) throw new Error("addPhoneScrollRunway: #main-content was not rendered");
    const filler = document.createElement("div");
    filler.dataset.testid = "phone-header-scroll-runway";
    filler.setAttribute("aria-hidden", "true");
    filler.style.height = "1600px";
    filler.style.pointerEvents = "none";
    main.append(filler);
  });
  // Wait for the runway to exist rather than for 50ms to pass. The sleep was a bet
  // that layout lands within 50ms of the append; on a loaded CI runner it does not
  // have to, and the caller then drags against a scroll range that is still short.
  await expect
    .poll(async () => (await readGeometry(page)).maxOffset, {
      message: "the appended 1600px runway must reach layout before the caller scrolls against it",
    })
    .toBeGreaterThanOrEqual(minimumHideTravelPx);
}

export interface ScrollGeometry {
  scrollTop: number;
  maxOffset: number;
  scrollOwner: "document" | "main";
  headerHidden: boolean;
  headerMotion: "collapse" | "overlay";
  docScrollableExcess: number;
  horizontalOverflow: number;
  reserveTransitionDuration: string;
}

export function readGeometry(page: Page): Promise<ScrollGeometry> {
  return page.evaluate(() => {
    const main = document.getElementById("main-content");
    const header = document.querySelector<HTMLElement>('[data-testid="universal-header-collapse"]');
    const doc = document.scrollingElement ?? document.documentElement;
    const mainOverflowY = main ? getComputedStyle(main).overflowY : "";
    const mainOwnsScroll = Boolean(
      main && /^(?:auto|scroll|overlay)$/.test(mainOverflowY) && main.scrollHeight > main.clientHeight + 1,
    );
    const scrollOwner = mainOwnsScroll && main ? main : doc;
    const reserveHost = main?.querySelector<HTMLElement>('[data-testid="mobile-composer-reserve-pad"]') ?? main;
    return {
      scrollTop: scrollOwner.scrollTop,
      maxOffset: Math.max(0, scrollOwner.scrollHeight - scrollOwner.clientHeight),
      scrollOwner: mainOwnsScroll ? "main" : "document",
      headerHidden: header?.getAttribute("data-scroll-hidden") === "true",
      // Answer view uses strategy:"overlay" (glass bar) without a collapse track /
      // data-phone-motion attribute — treat any `.phone-overlay-header` as overlay.
      headerMotion:
        header?.dataset.phoneMotion === "overlay" || document.querySelector(".phone-overlay-header")
          ? "overlay"
          : "collapse",
      docScrollableExcess: doc.scrollHeight - doc.clientHeight,
      horizontalOverflow: Math.max(doc.scrollWidth, document.body?.scrollWidth ?? 0) - window.innerWidth,
      reserveTransitionDuration: reserveHost ? getComputedStyle(reserveHost).transitionDuration : "",
    };
  });
}

/** Counts phone-chrome hide/reveal flips (header collapse + composer dock). */
export async function installFlipCounter(page: Page) {
  await page.evaluate(() => {
    const counter = { flips: 0 };
    (window as unknown as { __scrollFlipCounter: typeof counter }).__scrollFlipCounter = counter;
    // Collapse hosts flip data-scroll-hidden on the grid wrapper; overlay
    // hosts (the answer home's glass bar) flip it on header#search itself.
    const header =
      document.querySelector('[data-testid="universal-header-collapse"]') ?? document.querySelector("header#search");
    // Fail loudly: returning early would leave the counter pinned at 0, so
    // every flip assertion would pass vacuously.
    if (!header) throw new Error("installFlipCounter: no scroll-hide chrome element found");
    new MutationObserver(() => {
      counter.flips += 1;
    }).observe(header, { attributes: true, attributeFilter: ["data-scroll-hidden"] });
  });
}

export function readFlipCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __scrollFlipCounter?: { flips: number } }).__scrollFlipCounter?.flips ?? 0,
  );
}

/**
 * Drags whichever phone scroller is active in deliberate steps (one per
 * frame) so the scroll state machine sees real directional intent. Browser
 * tabs move the document; installed/bounded layouts can still move main.
 *
 * Returns the distance actually travelled. `scrollTop +=` clamps silently at
 * either end of the range, so the requested distance is a ceiling, not a
 * promise — callers that need the drag to cross a threshold must check it
 * (see `dragScrollUntilHidden`).
 */
export async function dragScrollBy(page: Page, totalPx: number, stepPx: number): Promise<number> {
  return page.evaluate(
    async ({ total, step }) => {
      // Re-resolved every step: releasing the chrome changes the runway mid-drag
      // and can hand ownership between main and the document. Resolving once up
      // front, as this helper used to, keeps pushing an element that has stopped
      // scrolling and reports nothing unusual when it does.
      const resolveOwner = () => {
        const main = document.getElementById("main-content");
        const mainOverflowY = main ? getComputedStyle(main).overflowY : "";
        const mainOwnsScroll = Boolean(
          main && /^(?:auto|scroll|overlay)$/.test(mainOverflowY) && main.scrollHeight > main.clientHeight + 1,
        );
        const documentScroller = document.scrollingElement ?? document.documentElement;
        return {
          element: mainOwnsScroll && main ? main : documentScroller,
          eventTarget: mainOwnsScroll && main ? (main as EventTarget) : (window as EventTarget),
        };
      };
      if (!document.getElementById("main-content")) return 0;
      const steps = Math.max(1, Math.ceil(Math.abs(total) / step));
      const direction = total < 0 ? -1 : 1;
      let travelled = 0;
      for (let i = 0; i < steps; i += 1) {
        const { element, eventTarget } = resolveOwner();
        const before = element.scrollTop;
        element.scrollTop += direction * step;
        travelled += element.scrollTop - before;
        eventTarget.dispatchEvent(new Event("scroll", { bubbles: true }));
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      }
      return travelled;
    },
    { total: totalPx, step: stepPx },
  );
}

/**
 * Minimum downward travel that can legitimately hide the phone chrome. The
 * document-detail contract below asserts `scrollTop > 120` in the hidden state,
 * so a drag that delivers less than this cannot hide anything and the chrome is
 * right to stay visible.
 */
const minimumHideTravelPx = 160;

/**
 * Drags down to cross the scroll-hide threshold, and proves the page had the
 * runway and that the gesture actually travelled.
 *
 * This is a DIAGNOSTIC AND A GUARD, NOT A FIX for the `#127` flake. That issue —
 * "document-detail hide sticks visible under CI load" — carries trace evidence
 * from PR #1404 (run `30521269873`) that on its occurrence the drag delivered in
 * full (`documentElement.scrollTop` = 1272, exactly the 552 + 720 asked for) with
 * ~1300 px of runway to spare, and that a 10 s non-flip is a latched state rather
 * than a race. So under-delivery was NOT the cause there, and this helper would
 * have passed its checks and failed on the same assertion.
 *
 * What it does buy: `scrollTop +=` clamps silently, and the old helper returned
 * nothing, so "the drag was short" could never be ruled out from a CI log alone.
 * Now it is ruled out by construction — a future failure here proves the gesture
 * landed, which narrows `#127` to its remaining candidates (`scrollHidden` false
 * vs `sharedChromePinned` latched). Separating THOSE two still needs the pin
 * state exposed in the DOM; today only the composite `data-scroll-hidden`
 * (`scrollHidden && !sharedChromePinned`) is observable, so both look identical.
 *
 * The call-site assertions are untouched: a genuinely stuck header fails exactly
 * as before, once the drag is proven to have happened.
 */
export async function dragScrollUntilHidden(page: Page, totalPx: number, stepPx: number) {
  await expect
    .poll(
      async () => {
        const geometry = await readGeometry(page);
        return geometry.maxOffset - geometry.scrollTop;
      },
      { message: "the page must have enough remaining downward runway to cross the scroll-hide threshold" },
    )
    .toBeGreaterThanOrEqual(minimumHideTravelPx);
  const travelled = await dragScrollBy(page, totalPx, stepPx);
  expect(
    travelled,
    `a ${totalPx}px drag delivered only ${travelled}px, so the chrome was never asked to hide`,
  ).toBeGreaterThanOrEqual(minimumHideTravelPx);
}

/**
 * Asserts the phone chrome hid, and on failure says whether the header's own scroll
 * signal arrived or a pin swallowed it.
 *
 * `dragScrollUntilHidden` above already proves the gesture happened, so what is left is
 * the split its doc comment names as unobservable: `data-scroll-hidden` is the composite
 * `scrollHidden && !sharedChromePinned`, so a reporter that never fired and a latched pin
 * look identical. `data-scroll-signal` on the same element publishes the raw `scrollHidden`
 * before the pin is applied, which separates them.
 *
 * Note the header and DocumentViewer run SEPARATE reporters — the shell's
 * `chromeScrollHide` (global-search-shell.tsx) versus
 * use-document-viewer-chrome-scroll.ts — so the page-owned composer is never a proxy for
 * the header's state. It is reported only as context, and a divergence between the two is
 * itself a finding.
 */
export async function expectChromeHidden(page: Page, collapse: Locator, phase: string) {
  try {
    await expect(collapse).toHaveAttribute("data-scroll-hidden", "true", { timeout: 10_000 });
    return;
  } catch (error) {
    const state = await page.evaluate((addonSlotId) => {
      const attribute = (selector: string, name: string) =>
        document.querySelector(selector)?.getAttribute(name) ?? null;
      const describe = (element: Element | null) => {
        if (!element) return "none";
        const testId = element.getAttribute("data-testid");
        return `${element.tagName.toLowerCase()}${testId ? `[data-testid="${testId}"]` : ""}`;
      };
      const active = document.activeElement;
      const addonHost = document.getElementById(addonSlotId);
      const collapseSelector = '[data-testid="universal-header-collapse"]';
      return {
        headerScrollSignal: attribute(collapseSelector, "data-scroll-signal"),
        headerCollapse: attribute(collapseSelector, "data-scroll-hidden"),
        documentComposer: attribute("form.document-viewer-composer", "data-scroll-hidden"),
        documentContent: attribute('[data-testid="document-viewer-content"]', "data-scroll-hidden"),
        activeElement: describe(active),
        focusInsideAddonHost: Boolean(addonHost && active && addonHost.contains(active)),
        addonHostPresent: Boolean(addonHost),
        expandedMenuTrigger: document.querySelector('[aria-haspopup="menu"][aria-expanded="true"]') !== null,
        expandedCombobox: document.querySelector('[role="combobox"][aria-expanded="true"]') !== null,
        scopePopover: document.querySelector('[data-testid="scope-command-popover"]') !== null,
        openDialogs: document.querySelectorAll('[role="dialog"]').length,
        openMenus: document.querySelectorAll('[role="menu"]').length,
      };
    }, phoneHeaderCollapseAddonSlotId);

    const documentViewerHidden = state.documentComposer === "true" || state.documentContent === "true";
    const verdict =
      state.headerScrollSignal === "hidden"
        ? "the header's own scrollHidden is TRUE, so sharedChromePinned swallowed it — see the pin tells below"
        : state.headerScrollSignal === "visible"
          ? `the header's own scrollHidden is FALSE — the shell reporter never saw the proven gesture${
              documentViewerHidden
                ? ", while DocumentViewer's independent reporters DID: the two scroll feeds diverged"
                : ""
            }`
          : "data-scroll-signal is absent, so the two causes cannot be separated";

    throw new Error(
      `${phase}: the phone chrome never hid.\n${verdict}\nchrome state: ${JSON.stringify(state, null, 2)}\n\n` +
        `Original assertion failure:\n${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export interface PageOwnedFooterGeometry {
  footerOpacity: number;
  footerPosition: string;
  footerPointerEvents: string;
  footerBottom: number;
  footerHidden: boolean;
  footerParentIsHost: boolean;
  hostFound: boolean;
  hostInsideFrame: boolean;
  mainContainsFooter: boolean;
  mainOverflowY: string;
  mainRunway: number;
  mainScrollTop: number;
  documentScrollTop: number;
  ownsLastFramePixel: boolean;
  reservePaddingBottom: number;
  frameBottom: number;
  frameHeight: number;
  viewportHeight: number;
  focusInsideFooter: boolean;
}

export function readPageOwnedFooterGeometry(
  footer: Locator,
  reserveSelector: string | null = null,
): Promise<PageOwnedFooterGeometry> {
  return footer.evaluate((node, selector) => {
    const main = document.getElementById("main-content");
    const host = node.closest<HTMLElement>(".phone-footer-layer-host");
    const frame = host?.closest<HTMLElement>(".phone-viewport-frame") ?? null;
    const reserve = selector ? document.querySelector<HTMLElement>(selector) : null;
    const footerRect = node.getBoundingClientRect();
    const frameRect = frame?.getBoundingClientRect();
    const framePixelOwner = frameRect
      ? document.elementFromPoint(
          frameRect.left + frameRect.width / 2,
          Math.min(window.innerHeight - 1, frameRect.bottom - 1),
        )
      : null;

    return {
      footerOpacity: Number.parseFloat(getComputedStyle(node).opacity),
      footerPosition: getComputedStyle(node).position,
      footerPointerEvents: getComputedStyle(node).pointerEvents,
      footerBottom: footerRect.bottom,
      footerHidden: node.getAttribute("data-scroll-hidden") === "true",
      footerParentIsHost: node.parentElement === host,
      hostFound: host !== null,
      hostInsideFrame: Boolean(frame?.contains(host)),
      mainContainsFooter: Boolean(main?.contains(node)),
      mainOverflowY: main ? getComputedStyle(main).overflowY : "missing",
      mainRunway: main ? main.scrollHeight - main.clientHeight : -1,
      mainScrollTop: main?.scrollTop ?? -1,
      documentScrollTop: (document.scrollingElement ?? document.documentElement).scrollTop,
      ownsLastFramePixel: Boolean(framePixelOwner && node.contains(framePixelOwner)),
      reservePaddingBottom: reserve ? Number.parseFloat(getComputedStyle(reserve).paddingBottom) : -1,
      frameBottom: frameRect?.bottom ?? -1,
      frameHeight: frameRect?.height ?? -1,
      viewportHeight: window.innerHeight,
      focusInsideFooter: node.contains(document.activeElement),
    };
  }, reserveSelector);
}
