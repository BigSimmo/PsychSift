import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Static contract for the shared top-bar hide/reveal.
 *
 * The top bar (mode / new chat) hides on scroll down and returns on scroll up at
 * every breakpoint, while the search field stays pinned on tablets and belongs
 * to normal page flow on desktop. The bottom search dock stays phone-only. Getting that right depends on wiring no
 * runtime unit test can see: which scroll source feeds the reporter, whether
 * only `header#search` is inside the collapse row, and whether sticky hosts pin
 * an outer [top bar | search] stack instead of translating the search away.
 *
 * The Chromium proof lives in tests/ui-chrome-scroll.spec.ts; this file keeps
 * the cheap suite honest about the wiring that proof depends on.
 */

const read = (relativePath: string) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
const hookSource = read("src/components/clinical-dashboard/use-hide-on-scroll.ts");
const headerSource = read("src/components/clinical-dashboard/master-search-header.tsx");
const shellSource = read("src/components/clinical-dashboard/global-search-shell.tsx");
const reserveHookSource = read("src/components/clinical-dashboard/use-phone-overlay-chrome-reserve.ts");
const globalsSource = read("src/app/globals.css");
const reserveSource = read("src/components/clinical-dashboard/mobile-composer-reserve.ts");
const dashboardSource = read("src/components/ClinicalDashboard.tsx");
const dashboardCoordinatorSource = read("src/components/clinical-dashboard/use-dashboard-chrome-coordinator.ts");
const activeScrollOwnerSource = read("src/components/clinical-dashboard/use-active-scroll-owner.ts");
const dashboardResultComposerSlotSource = read(
  "src/components/clinical-dashboard/dashboard-desktop-result-composer-slot.tsx",
);
const composerSlotSource = read("src/lib/mode-home-composer.ts");
const phoneHeaderPortalSource = read("src/components/clinical-dashboard/phone-header-collapse-portal.tsx");
const phoneFooterPortalSource = read("src/components/clinical-dashboard/phone-footer-layer-portal.tsx");
const registryModeNavSource = read("src/components/mode-nav/registry-mode-nav.tsx");
const modeNavSource = read("src/components/mode-nav/mode-nav.tsx");
const modeNavPortalSource = read("src/components/mode-nav/mode-nav-portal.tsx");
const documentViewerSource = read("src/components/DocumentViewer.tsx");
const documentSearchComposerSource = read("src/components/document-viewer/document-viewer-search-composer.tsx");
const calculatorSearchSource = read("src/components/calculators/search-page.tsx");
const documentViewerChromeHookSource = read("src/components/clinical-dashboard/use-document-viewer-chrome-scroll.ts");
const differentialDetailSource = read("src/components/differentials/differential-detail-page.tsx");
/**
 * The default in-page navigation template, extracted from the differentials
 * detail page so every information page can adopt it. Structural assertions
 * about the header shape belong here now; the pages are checked for adopting it.
 */
const inPageNavHeaderSource = read("src/components/in-page-nav/in-page-nav-header.tsx");
const differentialPresentationSource = read("src/components/differentials/differential-presentation-workflow-page.tsx");
const behaviourDocSource = read("docs/search-chrome-behaviour.md");

describe("shared header hide/reveal wiring", () => {
  it("widens both app shells past the phone media gate", () => {
    // Second argument is `allowAllBreakpoints`; leaving it off is what pinned
    // hide-on-scroll to phones.
    // GlobalSearchShell also passes pathname as resetKey so shared mode homes
    // do not inherit a collapsed top bar across routes.
    expect(shellSource).toContain("useScrollHideReporter(false, true, pathname)");
    expect(dashboardSource).toContain("useDashboardChromeCoordinator(searchMode)");
    expect(dashboardCoordinatorSource).toContain("useScrollHideReporter(false, true, resetKey)");
    expect(hookSource).toContain("export function useScrollHideReporter(disabled = false, allowAllBreakpoints = false");
  });

  it("feeds both app hosts from browser-phone document scrolling", () => {
    // Browser phones need document scrolling for Safari chrome collapse;
    // standalone phones retain their bounded main scroller.
    expect(hookSource).toContain("export function useDocumentScrollHideReporter");
    expect(shellSource).toContain(
      "useDocumentScrollHideReporter(chromeScrollHide.reportScroll, mainElement, inputRef)",
    );
    expect(dashboardCoordinatorSource).toContain(
      "useDocumentScrollHideReporter(chromeScrollHide.reportScroll, mainScrollRoot, composerInputRef)",
    );
    // #146: viewport/toolbar range changes must re-sample maxOffset without
    // waiting for a user scroll that may never arrive after chrome re-shows.
    // Layout + visualViewport resize both feed evaluate(); product code then
    // holds hide via the range-change guard and viewportHeightChanged rebase.
    expect(hookSource).toContain('window.addEventListener("resize", onViewportResize, { passive: true })');
    expect(hookSource).toContain('window.visualViewport?.addEventListener("resize", onViewportResize)');
    expect(hookSource).toContain("maxOffset !== previousMaxOffset");
    expect(hookSource).toContain("lastOffset - offset < revealIntentDistance");
    expect(hookSource).toContain("viewportHeightChanged");
  });

  it("feeds DocumentViewer footer chrome from both possible phone scroll owners", () => {
    expect(documentViewerChromeHookSource).toContain("const innerScrollHidden = useHideOnScroll");
    expect(documentViewerChromeHookSource).toContain("scrollContainer: shellScrollContainer");
    expect(documentViewerChromeHookSource).toContain("const documentScrollHidden = useHideOnScroll");
    expect(documentViewerChromeHookSource).toContain("documentCollapseRoot: shellScrollContainer");
    expect(documentViewerChromeHookSource).toContain("innerScrollHidden || documentScrollHidden");
  });

  it("holds DocumentViewer chrome open while either of its sheets is showing", () => {
    // A sheet is not chrome, but hiding the header and composer underneath one
    // releases both edges while an overlay still covers the document.
    expect(documentViewerSource).toContain("mobileActionsOpen || sectionSheetOpen");
  });

  it("drops the DocumentViewer rail offset when the universal top bar hides", () => {
    // Otherwise a dead band the height of the hidden bar stays above the rail.
    // When the universal bar is hidden, the rail still clears the page-owned
    // sticky document header on sm+; when it is visible, the rail offsets by the
    // bar's measured height rather than a hand-copied 69px that drifts with type
    // size. The literal survives only as a first-paint fallback.
    const rail = read("src/components/document-viewer/document-rail-panels.tsx");
    expect(rail).toContain('"lg:top-[var(--document-sticky-header-height,0px)]"');
    expect(rail).toContain('"lg:top-[var(--document-collapse-height,69px)]"');
    expect(read("src/components/document-viewer/use-document-chrome-metrics.ts")).toContain(
      '"--document-collapse-height"',
    );
    expect(read("src/components/document-viewer/use-document-chrome-metrics.ts")).toContain(
      'data-testid="universal-header-collapse"',
    );
    expect(documentViewerSource).toContain("data-document-sticky-header");
  });

  it("measures section anchor offsets from the live collapse row", () => {
    // A fixed scroll-mt strands headings whenever the row is a different height
    // or hidden entirely.
    expect(documentViewerSource).not.toContain("scroll-mt-24");
    expect(documentViewerSource).toContain("scroll-mt-[var(--document-anchor-offset,6rem)]");
    const chromeMetricsSource = read("src/components/document-viewer/use-document-chrome-metrics.ts");
    expect(chromeMetricsSource).toContain("--document-anchor-offset");
    expect(chromeMetricsSource).toContain("data-document-sticky-header");
    expect(chromeMetricsSource).toContain('"(max-width: 639px)"');
  });

  it("picks the hide mechanism from where each host's scrollport lives", () => {
    // GlobalSearchShell hands scrolling back to the document above phones, so
    // the outer stack sticks while only the top-bar row collapses.
    expect(shellSource).toContain('strategy: "collapse"');
    expect(shellSource).toContain('phoneMotion: "overlay"');
    expect(shellSource).toContain('wide: "sticky"');
    // ClinicalDashboard uses the document on browser phones and <main> in
    // standalone/sm+; both feed the same collapse reporter. Its non-answer modes
    // keep the wide collapse and overlay on phones. The descriptor lives beside
    // the chrome state it depends on, in use-dashboard-chrome-coordinator.
    expect(dashboardSource).toContain("hideOnScroll={resolveDashboardHideOnScroll(searchMode, chromeScrollHidden)}");
    expect(dashboardCoordinatorSource).toContain(
      '{ strategy: "collapse", wide: "collapse", phoneMotion: "overlay", scrollHidden }',
    );
    // Both phone stacks stay `display: contents` at sm+ so the wide layout keeps
    // the top bar and composer as direct children of the host's own column.
    expect(headerSource.match(/"phone-sticky-header-stack sm:contents"/g)).toHaveLength(2);
    expect(headerSource).toContain('"phone-overlay-header sm:absolute sm:inset-x-0 sm:top-0"');
    expect(shellSource).toContain('data-chrome-transitioning={chromeTransitioning ? "true" : undefined}');
    expect(dashboardSource).toContain('data-chrome-transitioning={chromeTransitioning ? "true" : undefined}');
  });

  it("overlays phone motion on every route so hiding moves no content", () => {
    expect(headerSource).toContain('phoneMotion?: "collapse" | "overlay"');
    expect(headerSource).toContain('const phoneMotion = hideOnScroll?.phoneMotion ?? "collapse"');
    expect(headerSource).toContain('hideStrategy === "collapse" && phoneMotion === "overlay"');
    // Every phone route on both hosts overlays, with no route or mode
    // exception. The 1fr -> 0fr grid plus the `chrome-safe-area-top` height
    // transition handed layout back to the scroller on every hide, so content
    // slid under the animation and the reader lost their place — measured
    // 147px on /therapy-compass/pathways, 137px on a differential detail and
    // 72px on the dashboard's non-answer modes (more wherever the OS reports a
    // top inset), against 0px everywhere overlay was already in force. Do not
    // reintroduce a route-conditional or mode-conditional collapse here.
    expect(shellSource).toContain('phoneMotion: "overlay"');
    expect(shellSource).not.toContain('phoneMotion: isDocumentViewerOwnedRoute(pathname) ? "overlay" : "collapse"');
    // The last collapse-motion route predicate is gone; a route list is a
    // layout shift by construction.
    expect(reserveSource).not.toContain("isCollapseMotionPhoneRoute");
    expect(shellSource).not.toContain("isCollapseMotionPhoneRoute");
    expect(dashboardCoordinatorSource).toContain('phoneMotion: "overlay"');
    expect(headerSource).toContain("data-phone-motion={phoneMotion}");
    expect(headerSource).toContain("max-sm:pointer-events-none max-sm:-translate-y-full max-sm:opacity-0");
    // Overlay must reach the collapse-at-every-width branch too (the
    // ClinicalDashboard path). Two occurrences of the stack's overlay classes —
    // one per return branch — is what proves it; a single one means the
    // dashboard fell back to the in-flow stack.
    expect(headerSource.match(/phone-overlay-header max-sm:transition-\[transform,translate,opacity\]/g)).toHaveLength(
      2,
    );
    expect(headerSource.match(/phoneOverlayMotion && usesPhoneBottomDock \?/g)).toHaveLength(2);
  });

  it("transitions the property the hidden state actually sets", () => {
    // Tailwind 4 compiles `-translate-y-full` to the standalone `translate`
    // property, not `transform`. The `transition-transform` *utility* knows
    // this and expands to `transform, translate, scale, rotate` (verified in
    // Chromium), but an *arbitrary* list is literal: `transition-[transform,
    // opacity]` never covered `translate`, so the phone overlay stacks jumped
    // to their hidden position in a single frame while only the fade animated.
    // `getComputedStyle(...).transform` reads `none` in both states, which is
    // what disguised it. Any arbitrary transition list paired with a
    // `-translate-y-*` utility must name `translate` explicitly.
    // The two overlay stacks hide via the translate utility, so their arbitrary
    // lists must name `translate`. (The `topBar` also uses the utility, but its
    // list is the `transition-transform` *utility*, which Tailwind expands to
    // `transform, translate, scale, rotate` — verified in Chromium — so it is
    // already covered and is not asserted here.)
    expect(headerSource.match(/max-sm:transition-\[transform,translate,opacity\]/g)).toHaveLength(2);
    // The bottom composer dock is the deliberate contrast: it hides via a raw
    // `transform: translateY(...)` rule in globals.css, not a translate
    // utility, so `transform` is the property it actually animates.
    expect(headerSource).toContain('"max-sm:transition-[transform,opacity] motion-reduce:transition-none"');
  });

  it("reserves a constant phone top clearance beneath the overlay header", () => {
    // Overlay takes the stack out of flow (`.phone-overlay-header` is fixed in
    // browser tabs, absolute in standalone), so content needs clearance or the
    // first row sits under the chrome at scroll top. The reserve must be
    // constant: an animated or hidden-state-dependent value is the layout shift
    // overlay exists to remove.
    expect(shellSource).toContain("usePhoneOverlayChromeReserve()");
    expect(shellSource).toContain("max-sm:pt-[var(--phone-overlay-chrome-h)]");
    // Both hosts overlay their phone chrome, so both publish and consume the
    // reserve. Answer *results* keep the glass-bar pad on <main>. Answer *home*
    // on phones uses the same overlay token as every other overlay home so the
    // idle cluster is not double-padded against a second 4rem+safe-area floor.
    expect(dashboardCoordinatorSource).toContain("usePhoneOverlayChromeReserve()");
    expect(dashboardSource).toContain('searchMode === "answer" && compactMobileModeHome');
    expect(dashboardSource).toContain(
      '"max-sm:pt-[var(--phone-overlay-chrome-h)] sm:pt-[calc(4rem+max(0.5rem,env(safe-area-inset-top)))] sm:[scroll-padding-top:calc(4.5rem+max(0.5rem,env(safe-area-inset-top)))]"',
    );
    expect(dashboardSource).toContain(
      '"pt-[calc(4rem+max(0.5rem,env(safe-area-inset-top)))] [scroll-padding-top:calc(4.5rem+max(0.5rem,env(safe-area-inset-top)))]"',
    );
    expect(dashboardSource).toContain(': "max-sm:pt-[var(--phone-overlay-chrome-h)]"');
    expect(reserveHookSource).toContain('const reserveProperty = "--phone-overlay-chrome-h"');
    // The property must be seeded in CSS and refined before paint. A passive
    // effect or a `,0px` fallback paints content under the out-of-flow header
    // and shifts it down at hydration — a cold-load jump, which is the defect
    // class this whole change removes (Codex P1, 2026-07-30).
    // The top term is `max(0.5rem, inset)`, matching the header's own
    // `pt-[max(0.5rem,var(--safe-area-top))]`. Seeding the bare inset
    // under-reserves by 8px wherever the phone reports no top inset, so the
    // layout effect corrects it after paint (Codex P1, 2026-07-30 — second
    // round). `--shell-header-h` already covers the inner min-h-14 bar + pb-2.
    expect(globalsSource).toContain(
      "--phone-overlay-chrome-h: calc(max(0.5rem, var(--safe-area-top)) + var(--shell-header-h))",
    );
    expect(headerSource).toContain("pt-[max(0.5rem,var(--safe-area-top))]");
    // The pad must never transition padding-top: under reduced motion every
    // element gets a 0.01ms duration, and a claimed reserve then painted the
    // stale value for one frame (#CHPC5C). The Playwright cold-load check pins
    // the behaviour; this pins the rule it depends on.
    expect(globalsSource).toMatch(/\[data-testid="mobile-composer-reserve-pad"\] \{\s*transition-property: none;\s*\}/);
    expect(reserveHookSource).toContain("useLayoutEffect");
    expect(shellSource).not.toContain("--phone-overlay-chrome-h,0px");
    // offsetHeight ignores transforms, so the measurement is the revealed
    // height in either state. The hook must therefore never branch on the hide
    // state — that is what would make the reserve vary and shift content.
    expect(reserveHookSource).not.toContain('getAttribute("data-scroll-hidden")');
    expect(reserveHookSource).not.toContain("dataset.scrollHidden");
    expect(reserveHookSource).toContain("offsetHeight");
    expect(reserveHookSource).toContain("ResizeObserver");
    // A present stack with offsetHeight 0 (display:contents / mid-unmount) must
    // not publish 0px over the CSS seed via `??` — that collapses content under
    // the out-of-flow header and jumps it back by the full stack height on the
    // next measure (Services result-anchor +131px under CI, PR #1562 / #146).
    expect(reserveHookSource).toContain("stack?.offsetHeight || collapse?.offsetHeight");
    expect(reserveHookSource).toContain("if (measured <= 0)");
    expect(reserveHookSource).toContain("readPhoneOverlayChromeReservePx");
  });

  it("portals the phone bottom dock out of the transformed overlay layer", () => {
    // The overlay hide translates the header stack, and a non-none `transform`
    // makes an element a containing block for `position: fixed` descendants. A
    // phone dock left inside that subtree resolves `bottom: 0` against the
    // ~72px header rather than the viewport and renders near the top of the
    // screen (observed as formBottom 772px from the viewport bottom at 390x844).
    // Portalling on phones is the fix; `sm+` must stay inline because tablet
    // may not double-sticky the composer.
    expect(headerSource).toContain("PhoneFooterLayerPortal");
    expect(headerSource).toContain("{phoneOverlayMotion && usesPhoneBottomDock ? (");
    // The translate that creates the containing block, so the pairing is visible
    // to anyone editing either half.
    // Resting state must be transform-free: a transform at rest is a containing
    // block for the fixed dock from the very first paint, before the portal that
    // escapes it exists (Codex P1, 2026-07-30).
    expect(headerSource).not.toContain("max-sm:translate-y-0");
    expect(headerSource).toContain("max-sm:-translate-y-full");
  });

  it("moves submitted search composers into normal page flow on tablets and desktops", () => {
    expect(composerSlotSource).toContain(
      'export const desktopPageComposerSlotId = "desktop-page-search-composer-slot"',
    );
    expect(headerSource).toContain('const desktopPageComposerMediaQuery = "(min-width: 640px)"');
    expect(headerSource).toContain("desktopHomeComposerSlotId ?? desktopPageComposerSlotId");
    expect(headerSource).toContain('placement: "default" | "desktop-home" | "desktop-page"');
    expect(headerSource).toContain("data-composer-placement={placement}");
    expect(headerSource).toContain(
      '"document-mobile-search-edge universal-top-search-edge relative z-20 mx-auto w-full max-w-3xl px-4 py-3 lg:max-w-4xl"',
    );
    expect(shellSource).toContain('data-testid="desktop-page-search-composer-slot"');
    expect(shellSource).toContain("data-composer-reserve={modeHomeComposerReservePendingValue}");
    expect(shellSource).toContain(
      'className="desktop-page-composer-slot hidden sm:block sm:min-h-0 sm:data-[composer-reserve=pending]:min-h-[var(--spacing-mode-home-composer-wide)] sm:[&:not(:empty)]:min-h-[var(--spacing-mode-home-composer-wide)]"',
    );
    // Dashboard result slot lives in a budget-extracted helper so ClinicalDashboard
    // stays under the maintainability no-growth ceiling.
    expect(dashboardSource).toContain("DashboardDesktopResultComposerSlot");
    expect(dashboardResultComposerSlotSource).toContain('data-testid="desktop-page-search-composer-slot"');
    expect(dashboardResultComposerSlotSource).toContain("data-composer-reserve={modeHomeComposerReservePendingValue}");
    expect(dashboardResultComposerSlotSource).toContain(
      'className="desktop-page-composer-slot hidden sm:block sm:min-h-0 sm:data-[composer-reserve=pending]:min-h-[var(--spacing-mode-home-composer-wide)] sm:[&:not(:empty)]:min-h-[var(--spacing-mode-home-composer-wide)]"',
    );
    expect(behaviourDocSource).toContain("Tablet and desktop search are page-owned");
  });

  it("collapses only the top bar and keeps the search composer outside that row", () => {
    // Wrapping headerAndComposer (top bar + search) is what made tablet/desktop
    // search disappear with the mode bar.
    expect(headerSource).toContain("const collapsingTopBar = (");
    expect(headerSource).toContain("{topBar}");
    expect(headerSource).toContain("{searchComposer}");
    expect(headerSource).not.toContain("{headerAndComposer}");
    // The collapse testid must sit on the top-bar wrapper, not a joint stack.
    const collapseIdx = headerSource.indexOf('data-testid="universal-header-collapse"');
    const topBarCloseIdx = headerSource.indexOf("{topBar}", collapseIdx);
    const addonIdx = headerSource.indexOf('data-testid="header-collapse-addon"', topBarCloseIdx);
    const composerIdx = headerSource.indexOf("{searchComposer}", collapseIdx);
    expect(collapseIdx).toBeGreaterThan(-1);
    expect(topBarCloseIdx).toBeGreaterThan(collapseIdx);
    // Page-owned phone navigation may sit after the top bar inside the
    // collapse row; the search composer must stay outside it.
    expect(addonIdx).toBeGreaterThan(topBarCloseIdx);
    expect(composerIdx).toBeGreaterThan(addonIdx);
  });

  it("provides one generic collapse host for every production phone header", () => {
    expect(composerSlotSource).toContain(
      'export const phoneHeaderCollapseAddonSlotId = "phone-header-collapse-addon-slot"',
    );
    expect(headerSource).toContain("phoneHeaderCollapseAddonSlotId");
    expect(headerSource).toContain("phoneHeaderCollapseAddonHost");
    expect(headerSource).toContain("setPhoneHeaderCollapseAddonRef");
    expect(headerSource).toContain("document.activeElement");
    expect(headerSource).toContain("new MutationObserver(clearIfFocusLeftHost)");
    expect(headerSource).toContain("queueMicrotask(clearHeaderFocus)");
    expect(headerSource).toContain('addonHost.addEventListener("focusin", handleFocusIn)');
    expect(headerSource).toContain('addonHost.addEventListener("focusout", handleFocusOut)');
    expect(headerSource).not.toContain("headerCollapseAddonSlotId?: string");
    expect(headerSource).toContain('data-testid="header-collapse-addon"');
    expect(headerSource).toContain('className="w-full min-w-0 max-w-full empty:hidden"');
    expect(headerSource).toContain(
      '"w-full min-w-0 max-w-full max-sm:flex max-sm:min-h-0 max-sm:flex-col max-sm:justify-end"',
    );
    // Addon host must be declared inside collapsingTopBar, not beside search.
    const collapseIdx = headerSource.indexOf('data-testid="universal-header-collapse"');
    const addonHostIdx = headerSource.indexOf('data-testid="header-collapse-addon"', collapseIdx);
    const collapsingClose = headerSource.indexOf("if (sticksAbovePhones)", collapseIdx);
    expect(addonHostIdx).toBeGreaterThan(collapseIdx);
    expect(addonHostIdx).toBeLessThan(collapsingClose);

    // One subtree is moved before paint on phones; sm+ and missing-host
    // fallbacks remain in normal flow. The observer survives shell remounts;
    // the tracked real DOM addon host owns portaled focus forwarding and
    // observes focused-child removal above.
    expect(phoneHeaderPortalSource).toContain("useLayoutEffect");
    expect(phoneHeaderPortalSource).toContain("createPortal(children, phoneHost)");
    expect(phoneHeaderPortalSource).toContain("phoneHeaderCollapseAddonSlotId");
    expect(phoneHeaderPortalSource).toContain('window.matchMedia("(max-width: 639px)")');
    expect(phoneHeaderPortalSource).toContain("new MutationObserver(sync)");

    // Therapy claims the same host through `ModeNavHeaderPortal`, the sibling
    // that resolves it at every width rather than only below the phone seam —
    // which is what lets the mode bar travel with the header on tablet and
    // desktop too. Same slot, same before-paint move, same observer discipline.
    //
    // Assert the whole chain, not just the absence of the legacy portal: Therapy
    // renders the shared bar, and the shared bar is what claims the slot. Checked
    // negatively alone, a `nav.tsx` that had dropped navigation entirely would
    // still pass. Therapy never names the portal itself — it delegates to
    // `ModeNav` — so the positive half of the assertion has to follow that hop.
    expect(registryModeNavSource).toContain("<ModeNav");
    expect(modeNavSource).toContain("<ModeNavHeaderPortal>{bar}</ModeNavHeaderPortal>");
    expect(registryModeNavSource).not.toContain("PhoneHeaderCollapsePortal");
    expect(modeNavPortalSource).toContain("phoneHeaderCollapseAddonSlotId");
    expect(modeNavPortalSource).toContain("createPortal(children, host)");
    expect(documentViewerSource).toContain("<PhoneHeaderCollapsePortal>");
    expect(documentViewerSource).toContain("data-document-sticky-header");
    expect(documentViewerSource).toContain("edge-glass-header");
    expect(documentViewerSource).toContain("max-sm:pt-2");
    // The differentials page reaches the slot through the shared header rather
    // than naming the portal itself, so the assertion follows that hop — the
    // same shape as the Therapy -> ModeNav delegation checked above. Asserting
    // only that the page no longer names the portal would pass for a page that
    // had dropped its navigation entirely.
    expect(differentialDetailSource).toContain("<InPageNavHeader");
    expect(differentialDetailSource).toContain('testIdPrefix="differential"');
    expect(inPageNavHeaderSource).toContain("<PhoneHeaderCollapsePortal>");
    expect(inPageNavHeaderSource).toContain("`${testIdPrefix}-detail-header`");
    // `relative`, not the older `max-sm:static`: the weighted segment track is
    // absolutely positioned against this header, so a static phone header would
    // let it escape to whichever ancestor happens to be positioned. `sm:sticky`
    // stays scoped to `sm+` because below that the portal hands the subtree to
    // the universal collapse row, which owns the motion.
    // z-20, not z-30: this bar is a DOM sibling of MasterSearchHeader (it
    // renders inside <main>, after the header), not nested inside its stacking
    // context, so an equal z-30 would win same-index DOM-order ties on desktop
    // and paint over (and swallow clicks meant for) the open Mode menu.
    expect(inPageNavHeaderSource).toContain("relative z-20 border-b");
    expect(inPageNavHeaderSource).toContain("inpage-nav-header");
    expect(inPageNavHeaderSource).toContain("sm:sticky sm:top-0");
    expect(inPageNavHeaderSource).not.toContain("max-sm:static sm:sticky sm:top-0");
    // One collapse owner: the shared header must never grow a scroll listener of
    // its own now that many pages mount it.
    expect(inPageNavHeaderSource).not.toContain('addEventListener("scroll"');
  });

  it("builds differential detail navigation from the default in-page template", () => {
    // docs/search-chrome-behaviour.md, "Default in-page navigation template":
    // back control, title + active-section subtitle behind a chevron disclosure,
    // ellipsis actions, and a weighted segment track on the header's bottom edge.
    // The slots live in the shared header; the page supplies the data for them.
    expect(inPageNavHeaderSource).toContain("`${testIdPrefix}-section-trigger`");
    expect(inPageNavHeaderSource).toContain("`${testIdPrefix}-actions-trigger`");
    expect(inPageNavHeaderSource).toContain("<DocumentSectionTrack sections={documentSections}");
    expect(inPageNavHeaderSource).toContain("<DocumentSectionList");
    expect(inPageNavHeaderSource).toContain("<ArrowLeft");
    expect(inPageNavHeaderSource).toContain("<ChevronDown");
    expect(inPageNavHeaderSource).toContain("<Ellipsis");
    // Discrete tab panels, so the page drives the active section itself rather
    // than scrolling into it.
    expect(differentialDetailSource).toContain("activeId={activeTab}");

    // Both sheets must be siblings of the portal, never inside it — a sheet
    // portaled into the collapse row is carried away when the chrome hides.
    const portalBlock = inPageNavHeaderSource.slice(
      inPageNavHeaderSource.indexOf("<PhoneHeaderCollapsePortal>"),
      inPageNavHeaderSource.indexOf("</PhoneHeaderCollapsePortal>"),
    );
    expect(portalBlock).not.toContain("<Sheet");
    expect(portalBlock).not.toContain("DocumentSectionList");

    // The labelled strip is the `sm+` affordance only; phones navigate from the
    // header disclosure and its sheet, so there is no strip to clip at 320px.
    //
    // Asserted as breakpoint behaviour rather than as the strip's exact class
    // string: this contract is about there being no second phone affordance,
    // and pinning the visual treatment made a restyle of the rail read as a
    // chrome-ownership regression.
    const tabRail = differentialDetailSource.slice(
      differentialDetailSource.indexOf('role="tablist"'),
      differentialDetailSource.indexOf('aria-label="Diagnosis sections"'),
    );
    expect(tabRail).toMatch(/className="hidden [^"]*\bsm:flex\b/);

    // The page must not grow a second scroll-hide owner for this chrome.
    expect(differentialDetailSource).not.toContain("useHideOnScroll");
    expect(differentialDetailSource).not.toContain("useDocumentSectionSpy");
  });

  it("gives the sticky chrome stack real travel against the viewport", () => {
    // A plain block around the stack is a containing block that leaves sticky
    // nowhere to stick. `contents` removes that box on GlobalSearchShell.
    expect(shellSource).toContain('className={mobileChromeVisible ? "contents" : "hidden lg:contents"}');
    expect(shellSource).not.toContain('mobileChromeVisible ? undefined : "hidden lg:block"');
    // Sticky pins the outer [top bar | search] stack below the wide-layout
    // safe-area spacer. Translating that whole stack would take the search
    // field off-screen. Overlay hosts still use max-sm:-translate-y-full —
    // strip that before asserting sticky collapse does not revive the sm:
    // translate path.
    expect(headerSource).toContain('data-testid="chrome-safe-area-top"');
    expect(headerSource.split('"phone-sticky-header-stack sm:contents"').length - 1).toBe(2);
    expect(headerSource).toContain('className="sm:sticky sm:top-[var(--safe-area-top)] sm:z-30"');
    expect(headerSource.replaceAll("max-sm:-translate-y-full", "")).not.toContain("sm:-translate-y-full");
    expect(headerSource).not.toContain('sticksAbovePhones && headerChromeHidden && "sm:-translate-y-full"');
  });

  it("uses one adaptive phone footer positioning owner", () => {
    expect(headerSource).toContain("phone-footer-layer");
    expect(documentViewerSource).toContain("phone-footer-layer document-viewer-composer");
    expect(calculatorSearchSource).not.toContain("phone-footer-layer");
  });

  it("exposes one stable diagnostic contract across each phone chrome owner", () => {
    for (const source of [shellSource, dashboardSource, documentViewerSource]) {
      expect(source).toContain("data-phone-scroll-owner");
      expect(source).toContain("data-phone-footer-owner");
      expect(source).toContain("data-phone-composer-reserve");
      expect(source).toContain("data-phone-chrome-transition");
    }
    expect(dashboardCoordinatorSource).toContain("useActiveScrollOwner(mainScrollRoot, resetKey)");
    expect(activeScrollOwnerSource).toContain('export type ActiveScrollOwner = "pending" | "main" | "document"');
    expect(activeScrollOwnerSource).toContain('window.matchMedia("(display-mode: standalone)")');
    expect(activeScrollOwnerSource).toContain("new ResizeObserver(update)");
    expect(activeScrollOwnerSource).toContain("new MutationObserver(update)");
  });

  it("portals every page-owned phone footer beside the standalone scroller", () => {
    expect(phoneFooterPortalSource).toContain("PhoneFooterLayerContext");
    expect(phoneFooterPortalSource).toContain('className="phone-footer-layer-host contents"');
    expect(phoneFooterPortalSource).toContain('data-testid="phone-footer-layer-host"');
    expect(phoneFooterPortalSource).toMatch(/\{children\}[\s\S]*phone-footer-layer-host/);
    expect(phoneFooterPortalSource).toContain("isPhone && host ? createPortal(children, host) : children");
    expect(phoneFooterPortalSource).toContain('window.matchMedia("(max-width: 639px)")');

    expect(phoneFooterPortalSource).toContain("export function PhoneFooterLayerFrame");
    expect(shellSource).toContain("<PhoneFooterLayerFrame");
    expect(dashboardSource).toContain("<PhoneFooterLayerFrame");
    expect(calculatorSearchSource).not.toContain("<PhoneFooterLayerPortal>");
    expect(documentSearchComposerSource).toContain("<PhoneFooterLayerPortal>");
    expect(documentViewerSource).toContain("<DocumentViewerSearchComposer");
    expect(differentialPresentationSource).toContain("<PhoneFooterLayerPortal>");
    expect(differentialPresentationSource).toContain('data-testid="differential-presentation-phone-footer"');
  });

  it("keeps calculator results on the shell's authoritative scroll decision", () => {
    expect(phoneFooterPortalSource).toContain("export function usePhoneFooterLayerScrollHidden");
    expect(shellSource).toContain("scrollHidden={chromeScrollHide.hidden}");
    expect(dashboardSource).toContain("scrollHidden={chromeScrollHidden}");
    expect(calculatorSearchSource).not.toContain("usePhoneFooterLayerScrollHidden");
    expect(calculatorSearchSource).not.toContain("useHideOnScroll");
  });

  it("releases the phone top safe-area with hidden chrome while retaining the wide inset", () => {
    // A fixed phone safe-area sibling survives the 0fr header collapse as an
    // opaque band. It must share the hidden state, while sm+ sticky chrome keeps
    // its safe-area offset independently.
    expect(headerSource).toContain('data-testid="chrome-safe-area-top"');
    expect(headerSource).toMatch(/headerChromeHidden\s*\?\s*"max-sm:h-0/);
    expect(headerSource).toMatch(/:\s*"max-sm:h-\[var\(--safe-area-top\)\]/);
    expect(headerSource).toContain("sm:h-[var(--safe-area-top)]");
    expect(headerSource).toContain("max-sm:transition-[height]");
    expect(headerSource).toContain('hideStrategy === "collapse" ? "pt-2" : "pt-[max(0.5rem,var(--safe-area-top))]"');
    expect(behaviourDocSource).toContain("`h-0` while hidden");
  });

  it("paints the visible top safe-area with the header surface, not the page background", () => {
    // While visible the spacer is the top of the header. `--background` there
    // drew a page-coloured status-bar band above the `--surface` bar on every
    // collapse-strategy mode, which answer mode (overlay, pads the inset in the
    // header itself) never showed.
    const spacerStart = headerSource.indexOf('data-testid="chrome-safe-area-top"');
    expect(spacerStart).toBeGreaterThan(-1);
    // Bound the window to this element so a later call site cannot satisfy or
    // break the assertion from outside the spacer.
    const safeAreaSpacer = headerSource.slice(spacerStart, headerSource.indexOf("/>", spacerStart));
    expect(safeAreaSpacer).toContain("bg-[color:var(--surface)]");
    expect(safeAreaSpacer).not.toContain("bg-[color:var(--background)]");
    expect(behaviourDocSource).toContain("paints `var(--surface)`");
  });

  it("keeps the header out of sticky positioning wherever its row collapses", () => {
    // Sticky pins the bar inside the viewport and fights the 1fr -> 0fr grid.
    expect(headerSource).toMatch(/sticksAbovePhones \|\| collapsesAtEveryWidth\s*\?\s*"relative"/);
  });

  it("counts the collapse budget only where the wrapper really collapses", () => {
    // Sticky hosts now collapse only the top-bar row (still `display: grid`), so
    // the budget correctly charges that height; non-grid wrappers stay at 0.
    expect(hookSource).toContain('window.getComputedStyle(collapse).display === "grid"');
    expect(hookSource).toContain('collapse.dataset.phoneMotion === "overlay"');
    expect(hookSource).toContain("!phoneOverlayMotion");
    expect(hookSource).toContain('collapseKind: headerRelease > 0 ? "in-flow"');
    expect(hookSource).toContain("document.querySelector('[data-testid=\"chrome-safe-area-top\"]')");
    expect(hookSource).toContain("window.matchMedia(phoneMediaQuery).matches");
    expect(hookSource).toContain("headerRelease + phoneSafeAreaRelease + reserveRelease");
  });

  it("only blurs the focused dock input for explicit outside scroll intent", () => {
    expect(hookSource).toContain('window.addEventListener("wheel", releaseComposerFocusOnOutsideScrollIntent');
    expect(hookSource).toContain('window.addEventListener("touchmove", releaseComposerFocusOnOutsideScrollIntent');
    expect(hookSource).toContain('window.addEventListener("pointerdown", releaseComposerFocusOnOutsideScrollIntent');
    expect(hookSource).toContain('window.addEventListener("keydown", releaseComposerFocusOnKeyboardScrollIntent');
    expect(hookSource).toContain('const composer = input.closest("form")');
    expect(hookSource).toContain('event.key !== "PageDown" && event.key !== "PageUp"');
    expect(hookSource).not.toMatch(/const offset = window\.scrollY;[\s\S]{0,300}?\.blur\(\)/);
  });

  it("rebases the reporter when a host swaps its scroll geometry", () => {
    // ClinicalDashboard toggling answer mode adds/removes <main>'s header
    // reserve; a carried-over offset spends the first post-switch scroll on a
    // spurious hide or reveal. Visibility is also bound to the key that
    // produced it so stale hidden chrome cannot paint before the effect runs.
    expect(hookSource).toContain("Object.is(visibility.resetKey, resetKey) ? visibility.hidden : false");
    expect(hookSource).toContain("}, [allowAllBreakpoints, commitHidden, resetKey]);");
  });

  it("holds transition anchoring through the final CSS frame", () => {
    expect(hookSource).toContain("reserveTransitionMs + reserveTransitionSettleMs");
  });

  it("keeps the bottom search dock a phone-only behaviour", () => {
    // The user-visible contract: the top bar hides everywhere, the footer
    // search bar hides on phones only. Both gates below require the phone layout.
    expect(headerSource).toContain(
      "const bottomComposerScrollHiddenActive = Boolean(hideOnScroll && phoneBottomSearchDockActive);",
    );
    expect(headerSource).toMatch(/const phoneBottomSearchDockActive =\s*\n\s*usesPhoneSearchLayout &&/);
    expect(headerSource).toContain("const usesPhoneFooterDock = usesBottomComposerPlacement && usesPhoneSearchLayout;");
  });

  it("documents tablet and desktop page ownership independently from the top bar", () => {
    expect(behaviourDocSource).toContain("Hide the top bar, not the search field");
    expect(behaviourDocSource).toContain("Top-bar hide/reveal is cross-breakpoint");
    expect(behaviourDocSource).toContain("Every production phone navigation header has one collapse owner");
    expect(behaviourDocSource).toContain("One transition, no jump");
    expect(behaviourDocSource).toContain("Do not sticky-position tablet or desktop result search");
    expect(behaviourDocSource).toContain("desktop-page-search-composer-slot");
    expect(behaviourDocSource).toContain("Release the phone top inset with collapsing chrome");
  });

  it("does not carry dock focus into GlobalSearchShell submitted result views", () => {
    // focus=1 + run=1 left the Forms/services dock focused, which pins both
    // chrome edges and freezes hide-on-scroll with the bottom white rail visible.
    expect(shellSource).toContain("focus: !trimmedQuery");
    expect(shellSource).toContain("queryInputAutoFocus={requestedFocus && !hasSubmittedModeSearch}");
    expect(shellSource).toContain("if (hasSubmittedModeSearch)");
    expect(shellSource).not.toContain("target.scrollTop > 8 && inputRef.current");
    expect(hookSource).toContain("releaseComposerFocusOnOutsideScrollIntent");
    expect(behaviourDocSource).toContain("Do not carry composer focus into submitted result views");
  });

  it("keeps sticky-stack search in normal flow and only self-stickies collapse-everywhere hosts", () => {
    // Double sticky (outer stack + composer top offset) overlays page controls
    // once the top bar collapses — that blocked the services decision rail.
    expect(headerSource).toContain("const stickySearchOwnedByOuterStack = sticksAbovePhones");
    // Bare `fixed` must not remain on sticky-stack composers (cascade fight).
    expect(headerSource).toMatch(/stickySearchOwnedByOuterStack\s*\?\s*"relative"/);
    expect(headerSource).toMatch(/stickySearchOwnedByOuterStack\s*\?\s*"relative"\s*:\s*cn\("fixed"/);
    expect(headerSource).toContain('stickySearchOwnedByOuterStack ? "relative z-20" : cn("sticky z-20"');
    // Dashboard collapse-everywhere composers still drop the 4.75rem clearance.
    expect(headerSource).toContain("const stickySearchClearsTopBar");
    expect(headerSource).toContain('hideStrategy === "collapse" && headerChromeHidden');
    expect(headerSource).toContain('"top-0 sm:top-0"');
  });
});
