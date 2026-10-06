import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { sourceFrom, sourceSegment } from "./helpers/source-contract";

import { consolidatedModeHomeModeIds } from "@/lib/consolidated-mode-home-redirect";
import { appModeIds } from "@/lib/app-modes";
import { isInformationPage } from "@/lib/information-pages";

import {
  isAlwaysStandaloneShellPath,
  isDashboardModeHref,
  dashboardOwnedModeHomeModeId,
  isDashboardOwnedModeHomePath,
  isDictionaryCataloguePath,
  isStandaloneModeHomePath,
  standaloneModeHomePaths,
  shouldRenderClinicalDashboard,
  shouldRenderDashboardSearch,
  standaloneModeHomeHref,
} from "@/lib/search-route-ownership";

describe("shared-search route ownership", () => {
  it("keeps submitted searches in route-owned mode workflows", () => {
    for (const mode of [
      "services",
      "forms",
      "favourites",
      "differentials",
      "dsm",
      "specifiers",
      "formulation",
      "therapy-compass",
      "tools",
      "calculators",
      "on-call",
      "cme",
      "psychiatry",
      "my-work",
      "roster",
      "first-nations",
    ] as const) {
      expect(shouldRenderDashboardSearch({ hasSubmittedSearch: true, mode, pathname: `/${mode}` })).toBe(false);
    }
  });

  it("routes dashboard-owned submitted workflows to ClinicalDashboard", () => {
    expect(shouldRenderDashboardSearch({ hasSubmittedSearch: true, mode: "answer", pathname: "/" })).toBe(true);
    expect(
      shouldRenderDashboardSearch({ hasSubmittedSearch: true, mode: "documents", pathname: "/documents/search" }),
    ).toBe(true);
    expect(shouldRenderClinicalDashboard({ hasSubmittedSearch: false, mode: "answer", pathname: "/" })).toBe(true);
  });

  it("keeps the Sources catalogue route-owned before and after submission", () => {
    // `/sources` joined the consolidated modes when its four-card home was folded
    // into the shared one, so it renders nothing and cannot own a hero composer.
    // It stays always-standalone, because that is a prefix match covering
    // `/sources/search` and the rest of the namespace.
    expect(isStandaloneModeHomePath("/sources")).toBe(false);
    expect(isAlwaysStandaloneShellPath("/sources")).toBe(true);
    expect(shouldRenderClinicalDashboard({ hasSubmittedSearch: false, mode: "sources", pathname: "/sources" })).toBe(
      false,
    );
    expect(shouldRenderDashboardSearch({ hasSubmittedSearch: true, mode: "sources", pathname: "/sources" })).toBe(
      false,
    );
    expect(shouldRenderClinicalDashboard({ hasSubmittedSearch: true, mode: "sources", pathname: "/sources" })).toBe(
      false,
    );
  });

  it("never replaces an explicit medication detail or document-search mockup", () => {
    expect(
      shouldRenderClinicalDashboard({
        hasSubmittedSearch: true,
        mode: "prescribing",
        pathname: "/medications/acamprosate",
      }),
    ).toBe(false);
    expect(
      shouldRenderDashboardSearch({
        hasSubmittedSearch: true,
        mode: "documents",
        pathname: "/mockups/document-search/search",
      }),
    ).toBe(false);
  });

  it("classifies standalone mode homes from pathname alone", () => {
    // Favourites and Tools are the last two: every other mode's bare path redirects.
    for (const pathname of ["/favourites", "/tools"]) {
      expect(isStandaloneModeHomePath(pathname)).toBe(true);
    }
    // Documents, Sources and Medications all joined the redirecting modes. A path
    // that 307s never renders, so it can never own a hero composer — listing one
    // here could not take effect, only mislead.
    expect(isStandaloneModeHomePath("/documents")).toBe(false);
    expect(isStandaloneModeHomePath("/sources")).toBe(false);
    expect(isStandaloneModeHomePath("/medications")).toBe(false);
    expect(isStandaloneModeHomePath("/")).toBe(false);
    expect(isStandaloneModeHomePath("/services/crisis")).toBe(false);
    expect(isStandaloneModeHomePath("/dsm/search")).toBe(false);
  });

  it("classifies the dictionary catalogue as an in-flow composer owner", () => {
    expect(isDictionaryCataloguePath("/dictionary/search")).toBe(true);
    expect(isDictionaryCataloguePath("/dictionary/browse")).toBe(true);
    expect(isDictionaryCataloguePath("/dictionary/topics")).toBe(false);
    expect(isDictionaryCataloguePath("/dictionary/compare")).toBe(false);
    expect(isDictionaryCataloguePath("/dictionary/sources")).toBe(false);
    expect(isDictionaryCataloguePath("/dictionary/auditory-hallucination")).toBe(false);
    expect(isStandaloneModeHomePath("/dictionary/search")).toBe(false);
  });

  /*
   * Consolidated modes own no composer at their bare path.
   *
   * The ten consolidated modes no longer render a home of their own —
   * they redirect onto the one shared home at `/?mode=<id>`, whose composer the
   * dashboard owns. Claiming standalone ownership for a path that renders nothing
   * would reserve hero composer geometry on a route that never paints, so these
   * must classify false while their SUB-routes keep standalone shell treatment.
   */
  it("does not claim composer ownership for consolidated mode homes", () => {
    for (const modeId of consolidatedModeHomeModeIds) {
      expect(isStandaloneModeHomePath(`/${modeId}`)).toBe(false);
    }
    // Each namespace still needs the standalone shell for its own sub-routes.
    for (const modeId of consolidatedModeHomeModeIds) {
      expect(isAlwaysStandaloneShellPath(`/${modeId}`)).toBe(true);
    }
  });

  /*
   * `dashboardOwnedModeHomePaths` is intentionally empty now that Documents has
   * joined the consolidated modes (see `src/lib/search-route-ownership.ts`) — the
   * map and its two accessors stay in place, permanently inert, because
   * `global-search-shell.tsx` and `use-home-mode-seed.ts` still call them. Nothing
   * should resolve through this mechanism any more.
   */
  it("names no mode through the now-empty dashboard-owned-home map", () => {
    for (const pathname of [
      "/",
      "/tools",
      "/favourites",
      "/medications",
      "/documents",
      "/documents/search",
      "/?mode=documents",
    ]) {
      expect(dashboardOwnedModeHomeModeId(pathname), pathname).toBeNull();
      expect(isDashboardOwnedModeHomePath(pathname), pathname).toBe(false);
    }
  });

  // A standalone mode home renders its own body, so it must also skip the
  // searchParams gate: otherwise a submitted `?q=…&run=1` link mounts the
  // dashboard over that body. Psychiatry was added to the first list and missed
  // from the second, which this case now catches for any future mode.
  it("treats every standalone mode home as an always-standalone shell path", () => {
    for (const pathname of standaloneModeHomePaths) {
      expect(isAlwaysStandaloneShellPath(pathname), pathname).toBe(true);
    }
  });

  it("marks route-owned namespaced paths as always-standalone shell (no searchParams gate)", () => {
    expect(isAlwaysStandaloneShellPath("/forms")).toBe(true);
    expect(isAlwaysStandaloneShellPath("/favourites")).toBe(true);
    expect(isAlwaysStandaloneShellPath("/differentials/presentations/acute-confusion-encephalopathy")).toBe(true);
    expect(isAlwaysStandaloneShellPath("/medications/acamprosate")).toBe(true);
    expect(isAlwaysStandaloneShellPath("/tools")).toBe(true);
    expect(isAlwaysStandaloneShellPath("/sources")).toBe(true);
    // Documents' bare path is exact-match-only (`alwaysStandaloneShellExactPaths`),
    // not prefix-matched like every other entry here: it redirects and renders
    // nothing, so it needs the same Suspense-boundary protection as the rest of
    // this list, but its sub-routes (`/documents/search`, `/documents/[id]`) must
    // keep mounting ClinicalDashboard — a bare prefix entry would swallow those too.
    expect(isAlwaysStandaloneShellPath("/documents")).toBe(true);
    // `/` and Documents' sub-routes still need searchParams for the dashboard gate.
    expect(isAlwaysStandaloneShellPath("/")).toBe(false);
    expect(isAlwaysStandaloneShellPath("/documents/search")).toBe(false);
    expect(isAlwaysStandaloneShellPath("/documents/some-document-id")).toBe(false);
  });

  it("preserves the deliberate compact-hub and standalone Favourites workspace distinction", () => {
    const favouritesHubSource = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/favourites-hub.tsx"),
      "utf8",
    );
    const favouritesPageSource = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/favourites-command-library-page.tsx"),
      "utf8",
    );

    // The dashboard hub is a compact browse surface and keeps a ModeHomeHero.
    // The standalone route is the full command library and starts at its one h1
    // so its filters and saved-item controls stay above fold. Identity copy is
    // shared; structural equality between the two entry doors is not.
    expect(favouritesHubSource).toContain("Owner decision 2026-08-23");
    expect(favouritesHubSource).toContain("<ModeHomeHero");
    expect(favouritesHubSource).toContain("sharedHomePresentation.favourites");
    expect(favouritesPageSource).toContain("Owner decision 2026-08-23");
    expect(favouritesPageSource).not.toContain("ModeHomeHero");
    expect(favouritesPageSource).toContain("<h1");
    expect(favouritesPageSource).toContain("{sharedHomePresentation.favourites.title}");
  });

  it("classifies dashboard mode hrefs without parsing the destination page", () => {
    expect(isDashboardModeHref("/")).toBe(true);
    expect(isDashboardModeHref("/?mode=answer")).toBe(true);
    expect(isDashboardModeHref("/?mode=documents&focus=1")).toBe(true);
    expect(isDashboardModeHref("/documents/search")).toBe(true);
    expect(isDashboardModeHref("/documents/search?q=lithium&run=1")).toBe(true);
    expect(isDashboardModeHref("/services")).toBe(false);
    expect(isDashboardModeHref("/differentials?q=mania&run=1")).toBe(false);
    expect(isDashboardModeHref("/documents/searching")).toBe(false);
  });

  it("keeps shell mode-home detection pathname-gated (no searchMode∧pathname AND)", () => {
    const shellSource = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/global-search-shell.tsx"),
      "utf8",
    );
    expect(shellSource).toContain("isStandaloneModeHomePath(pathname)");
    expect(shellSource).not.toMatch(/searchMode === "services" && pathname === "\/services"/);
    // changeMode must not optimistic-set searchMode before navigation.
    // Dedicated modes return to their dedicated standalone home, while remaining modes
    // return to the shared home. A current query is carried only as a draft, never as
    // `run=1`; pending state still guards the push.
    expect(shellSource).toMatch(
      /function changeMode\(mode: AppModeId\) \{[\s\S]*?const carriedQuery = query\.trim\(\) \|\| requestedQuery\.trim\(\);[\s\S]*?const standaloneHome = standaloneModeHomeHref\(mode\);[\s\S]*?const href =\s*standaloneHome \?\?\s*appModeSelectionHref\(mode, \{[\s\S]*?query: carriedQuery \|\| undefined,[\s\S]*?router\.push\(href\);\n  \}/,
    );
    const changeMode = shellSource.slice(
      shellSource.indexOf("function changeMode("),
      shellSource.indexOf("function startNewAnswerChat("),
    );
    expect(changeMode).not.toContain("run: true");
    expect(shellSource).not.toMatch(
      /function changeMode\(mode: AppModeId\) \{[\s\S]*?setSearchMode\(mode\);[\s\S]*?router\.push/,
    );
    expect(shellSource).toContain("alreadyOnDestination");
    expect(shellSource).toContain("setPendingModeNavigation");
    // Blanket mode-equality early return would break same-mode home returns.
    expect(shellSource).not.toMatch(
      /function changeMode\(mode: AppModeId\) \{[\s\S]*?if \(mode === searchMode\) return;/,
    );
  });

  it("seeds always-standalone submitted params before the bridge hydrates", () => {
    const shellSource = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/global-search-shell.tsx"),
      "utf8",
    );
    expect(shellSource).toContain("function readInitialBrowserSubmittedSearchParamString()");
    expect(shellSource).toContain("window.location.search.slice(1)");
    expect(shellSource).toContain('params.get("run") === "1" && query ? search : ""');
    expect(shellSource).toMatch(
      /useSyncExternalStore\(\s*subscribeNoop,\s*readInitialBrowserSubmittedSearchParamString,\s*\(\) => "",\s*\)/,
    );
    expect(shellSource).toContain("searchParamString || browserSearchParamString");
  });

  it("resets shared phone scroll chrome when the pathname changes", () => {
    const shellSource = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/global-search-shell.tsx"),
      "utf8",
    );
    const hideSource = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/use-hide-on-scroll.ts"),
      "utf8",
    );
    expect(hideSource).toContain("const reset = useCallback");
    expect(hideSource).toMatch(/return \{ hidden: active && hidden, reportScroll, reset \}/);
    // Hide state resets via the reporter resetKey; scroll offset resets explicitly.
    expect(shellSource).toContain("useScrollHideReporter(false, true, pathname)");
    expect(shellSource).toMatch(/main\.scrollTop = 0[\s\S]*\}, \[pathname\]\)/);
  });

  it("reserves home and desktop geometry without inflating the header while the portal attaches", () => {
    const headerSource = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/master-search-header.tsx"),
      "utf8",
    );
    expect(headerSource).toContain("desktopComposerPortalFallback");
    expect(headerSource).toContain("homeComposerMediaEligible");
    expect(headerSource).toMatch(
      /const homePortalPending =\s*Boolean\(desktopHomeComposerSlotId\) && homeComposerMediaEligible && !desktopComposerPortalFallback/,
    );
    expect(headerSource).toContain("const portalPending = homePortalPending;");
    expect(headerSource).toMatch(
      /const isPageDesktopComposerPending =\s*isDefaultComposer && Boolean\(desktopPageComposerSlotId\) && !desktopComposerPortalFallback/,
    );
    expect(headerSource).toContain('isPageDesktopComposerPending && "sm:hidden"');
    expect(headerSource).toContain("setHomeComposerMediaEligible(mediaQuery.matches)");
    expect(headerSource).toContain("const portalFallbackDelayMs = 8_000");
    expect(headerSource).toContain("let portalFailureStartedAt: number | null = null");
    expect(headerSource).toContain("portalFailureStartedAt = null");
    expect(headerSource).toContain("portalFailureStartedAt ??= now");
    expect(headerSource).toContain("now - portalFailureStartedAt");
    expect(headerSource).not.toContain("portalRetryStartedAt");
    expect(headerSource).not.toContain("portalRetryCount");
    expect(headerSource).toMatch(
      /desktopComposerPortalActive && desktopComposerPortalHost\s*\?\s*null\s*:\s*portalPending\s*\?\s*null\s*:\s*renderSearchComposer\("default"\)/,
    );
    expect(headerSource).toContain("setDesktopComposerPortalFallback(true)");
  });

  it("waits for page-owned composer slots to hydrate before portal adoption", () => {
    const headerSource = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/master-search-header.tsx"),
      "utf8",
    );
    const slotSource = readFileSync(resolve(process.cwd(), "src/components/desktop-composer-portal-slot.tsx"), "utf8");
    const homeTemplateSource = readFileSync(resolve(process.cwd(), "src/components/mode-home-template.tsx"), "utf8");
    const favouritesPageSource = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/favourites-command-library-page.tsx"),
      "utf8",
    );
    const favouritesHubSource = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/favourites-hub.tsx"),
      "utf8",
    );
    const toolsPageSource = readFileSync(
      resolve(process.cwd(), "src/components/tools/tools-search-results-page.tsx"),
      "utf8",
    );
    const dictionaryCatalogueSource = readFileSync(
      resolve(process.cwd(), "src/components/dictionary/dictionary-catalogue-pages.tsx"),
      "utf8",
    );
    const shellSource = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/global-search-shell.tsx"),
      "utf8",
    );
    const globalsSource = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const composerLibSource = readFileSync(resolve(process.cwd(), "src/lib/mode-home-composer.ts"), "utf8");
    expect(composerLibSource).toContain('desktopComposerSlotReadyAttr = "data-composer-slot-ready"');
    expect(slotSource).toContain("desktopComposerSlotReadyAttr");
    expect(slotSource).toContain("useEffect");
    expect(headerSource).toContain("isDesktopComposerSlotReady(slot)");
    expect(headerSource).toContain("attributeFilter: [desktopComposerSlotReadyAttr]");
    expect(headerSource).toContain("setModeHomeComposerReservePending");
    expect(headerSource).toContain("searchComposerVisible");
    expect(composerLibSource).toContain('modeHomeComposerReserveAttr = "data-composer-reserve"');
    expect(homeTemplateSource).toContain(
      "data-[composer-reserve=pending]:min-h-[var(--spacing-mode-home-composer-phone)]",
    );
    expect(homeTemplateSource).toContain(
      "sm:data-[composer-reserve=pending]:min-h-[var(--spacing-mode-home-composer-wide)]",
    );
    expect(homeTemplateSource).toContain("[&:not(:empty)]:min-h-[var(--spacing-mode-home-composer-phone)]");
    expect(homeTemplateSource).not.toContain("mode-home-composer-slot hidden");

    // Bespoke mode homes (favourites and tools) satisfy Chrome Invariant 15
    // with pending reserve & min-h tokens at every width.
    for (const bespokeSource of [favouritesPageSource, favouritesHubSource, toolsPageSource]) {
      expect(bespokeSource).toContain("data-composer-reserve={modeHomeComposerReservePendingValue}");
      expect(bespokeSource).toContain(
        "data-[composer-reserve=pending]:min-h-[var(--spacing-mode-home-composer-phone)]",
      );
      expect(bespokeSource).toContain(
        "sm:data-[composer-reserve=pending]:min-h-[var(--spacing-mode-home-composer-wide)]",
      );
      expect(bespokeSource).toContain("[&:not(:empty)]:min-h-[var(--spacing-mode-home-composer-phone)]");
      expect(bespokeSource).toContain("sm:[&:not(:empty)]:min-h-[var(--spacing-mode-home-composer-wide)]");
    }
    // Dictionary catalogue portals the shared composer from sm up only. Phones
    // keep the usual compact dock, so this slot is hidden and must not reserve
    // the phone hero height.
    expect(dictionaryCatalogueSource).toContain('data-testid="dictionary-catalogue-composer"');
    expect(dictionaryCatalogueSource).toContain("data-composer-reserve={modeHomeComposerReservePendingValue}");
    expect(dictionaryCatalogueSource).toContain("mx-auto hidden w-full");
    expect(dictionaryCatalogueSource).toContain("sm:block");
    expect(dictionaryCatalogueSource).toContain(
      "sm:data-[composer-reserve=pending]:min-h-[var(--spacing-mode-home-composer-wide)]",
    );
    expect(dictionaryCatalogueSource).not.toContain(
      "data-[composer-reserve=pending]:min-h-[var(--spacing-mode-home-composer-phone)]",
    );
    // The catalogue is a RESULT view. It owns the slot ELEMENT only so the
    // composer lands under its mode nav, but the id and the reserve class must
    // stay the page ones: `placement` is derived from which slot id the shell
    // passes, and the home slot is what made this catalogue render the hero
    // ticker, Prompts rail and privacy line after PR #2639 gated them.
    expect(dictionaryCatalogueSource).toContain("id={desktopPageComposerSlotId}");
    expect(dictionaryCatalogueSource).toContain("desktop-page-composer-slot");
    expect(dictionaryCatalogueSource).not.toContain("modeHomeDesktopComposerSlotId");
    expect(dictionaryCatalogueSource).not.toContain("mode-home-composer-slot");
    // Exactly one element carries the page slot id: the shell suppresses its own
    // copy on this route, and the shell no longer hands the catalogue the home slot.
    expect(shellSource).toContain("shouldShowSearchComposer && !isStandaloneModeHome && !isDictionaryCatalogue ? (");
    expect(shellSource).toContain(
      "desktopHomeComposerSlotId={isStandaloneModeHome ? modeHomeDesktopComposerSlotId : undefined}",
    );
    expect(shellSource).not.toContain("isStandaloneModeHome || isDictionaryCatalogue ? modeHomeDesktopComposerSlotId");
    expect(dictionaryCatalogueSource).not.toContain("Clinical terms");
    expect(dictionaryCatalogueSource).not.toContain("Clinical dictionary");
    // Equal-layout padding and tracking grow at `sm`. `sm:w-72` clips
    // "Abbreviations" on mobile-webkit (scrollWidth 63 vs clientWidth 56).
    expect(dictionaryCatalogueSource).toContain(
      'data-testid="dictionary-scope-toggle" className="w-56 shrink-0 min-[360px]:w-64 sm:w-80"',
    );

    // Desktop page composer slot in GlobalSearchShell reserves height to avoid 0.118 CLS layout jump
    expect(shellSource).toContain("data-composer-reserve={modeHomeComposerReservePendingValue}");
    expect(shellSource).toContain("sm:data-[composer-reserve=pending]:min-h-[var(--spacing-mode-home-composer-wide)]");
    expect(shellSource).toContain("sm:[&:not(:empty)]:min-h-[var(--spacing-mode-home-composer-wide)]");

    // Unconditional always-on reserve would leave a permanent empty band when
    // the portal never adopts; pending/filled gating is the CLS-safe contract.
    expect(homeTemplateSource).not.toMatch(
      /mode-home-composer-slot block min-h-\[var\(--spacing-mode-home-composer-phone\)\]/,
    );
    // 162px: the settled phone composer block, measured across six mode homes.
    // It must equal that height, not merely be non-zero — a reserve short of the
    // settled height is what shifted the action/pill stacks on adoption, and a
    // reserve above it would leave a permanent empty band.
    expect(globalsSource).toContain("--spacing-mode-home-composer-phone: 10.125rem");
    expect(globalsSource).toContain("--spacing-mode-home-composer-wide: 5.5rem");
    expect(globalsSource).not.toContain("--spacing-page-composer-wide");
  });

  it("pre-reserves the measured narrow-desktop composer height while keeping its prompt rail on one line", () => {
    const globalsSource = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const tabletBandStart = globalsSource.indexOf("/* BEGIN tablet mode-home composer geometry */");
    const tabletBandEnd = globalsSource.indexOf("/* END tablet mode-home composer geometry */");

    expect(tabletBandStart).toBeGreaterThanOrEqual(0);
    expect(tabletBandEnd).toBeGreaterThan(tabletBandStart);
    const tabletBand = globalsSource.slice(tabletBandStart, tabletBandEnd);

    expect(tabletBand).toContain("@media (min-width: 640px) and (max-width: 1279.98px)");
    expect(tabletBand).toContain("--spacing-mode-home-composer-wide: 10rem");

    // The one-line rail is NOT part of the bounded band. It was, until
    // 2026-09-06, which left the rail free to wrap above 1280px — Specifiers was
    // the one mode whose prompts overflowed there, and its home stood 39px
    // taller than every other. The rule now applies at every width from 640px
    // up, and the band keeps only the reserve token it is actually about.
    const railStart = globalsSource.indexOf("/* BEGIN mode-home prompt rail one-line */");
    const railEnd = globalsSource.indexOf("/* END mode-home prompt rail one-line */");
    expect(railStart).toBeGreaterThanOrEqual(0);
    expect(railEnd).toBeGreaterThan(railStart);
    const railBlock = globalsSource.slice(railStart, railEnd);

    expect(railBlock).toContain("@media (min-width: 640px) {");
    expect(railBlock).not.toContain("max-width: 1279.98px");
    expect(railBlock).toContain(".smart-search-prompt-row .answer-suggestion-chips-scroll");
    expect(railBlock).toContain("flex-wrap: nowrap");
    expect(railBlock).toContain("overflow-x: auto");
    expect(tabletBand).not.toContain(".smart-search-prompt-row");

    // The reserve remains conditional on a pending or filled portal host, so a
    // hidden composer still owns zero height rather than a permanent tablet gap.
    const homeTemplateSource = readFileSync(resolve(process.cwd(), "src/components/mode-home-template.tsx"), "utf8");
    expect(homeTemplateSource).toContain("sm:data-[composer-reserve=pending]:min-h");
    expect(homeTemplateSource).toContain("sm:[&:not(:empty)]:min-h");
    expect(homeTemplateSource).not.toContain("sm:min-h-[var(--spacing-mode-home-composer-wide)]");
  });

  it("leaves the dashboard shell without eager chrome thrash", () => {
    const dashboardSource = readFileSync(resolve(process.cwd(), "src/components/ClinicalDashboard.tsx"), "utf8");
    expect(dashboardSource).toContain("isDashboardModeHref");
    // crossModeSearch still navigates out of the shell without rewriting local
    // chrome first: an eager setSearchMode flipped hero/dock for a frame before
    // ClinicalDashboard unmounted.
    expect(dashboardSource).toMatch(
      /function crossModeSearch\(mode: AppModeId, crossQuery: string\) \{[\s\S]*?if \(!isDashboardModeHref\(href\)\) \{[\s\S]*?router\.push\(href\);\n      return;/,
    );
  });

  it("keeps the mode pill from navigating while the shared home is showing", () => {
    const dashboardSource = readFileSync(resolve(process.cwd(), "src/components/ClinicalDashboard.tsx"), "utf8");
    const selectSearchMode = sourceFrom(dashboardSource, "function selectSearchMode(", {
      label: "selectSearchMode",
    });

    // Isolate the shared-home branch so the negative assertions below cannot be
    // satisfied by unrelated code further down selectSearchMode. The end marker
    // is an indentation depth, which is why it goes through the guarded helper:
    // unguarded, a reformat would turn every negative assertion below into a
    // vacuous pass rather than a failure.
    const sharedHomeBranch = sourceSegment(selectSearchMode, "if (showSharedHome) {", "\n    }", {
      label: "selectSearchMode shared-home branch",
    });

    // `/` is the single home page. On it the pill only retargets the composer:
    // rewrite `?mode=` in place, never push a route and never re-render the page.
    expect(sharedHomeBranch).toMatch(/window\.history\.replaceState\(null, "", appModeSelectionHref\(mode/);
    // replaceState only — a push would add a history entry per mode pick, so Back
    // would step back through picks instead of leaving home.
    expect(sharedHomeBranch).not.toContain("router.push");
    // The URL must own searchMode here: setting modeChangeFromUiRef would make the
    // URL-sync effect skip, and the pill would never update.
    expect(sharedHomeBranch).not.toContain("modeChangeFromUiRef.current = true");
    expect(sharedHomeBranch).not.toContain("setSearchMode(");
    // Off the shared home, the current query becomes a draft on `/`; it is not
    // submitted into the selected mode until the user explicitly asks.
    expect(selectSearchMode).toMatch(
      /const href = appModeSelectionHref\(mode, \{[\s\S]*?query: carriedQuery \|\| undefined/,
    );
    // Returning home must invalidate the in-flight search before clearing UI —
    // the dashboard stays mounted, so a late applySearchResult would otherwise
    // restore the old answer and rewrite run=1 over the draft home.
    const leaveResultsBranch = sourceSegment(
      selectSearchMode,
      "// Outside the shared home",
      "function handleFollowUpQuote",
      { label: "selectSearchMode leave-results branch" },
    );
    expect(leaveResultsBranch).toMatch(/stopSearch\(\);\s*clearModeResultState\(\);/);
    expect(
      sourceSegment(selectSearchMode, "function selectSearchMode(", "function handleFollowUpQuote", {
        label: "selectSearchMode before handleFollowUpQuote",
      }),
    ).not.toContain("crossModeSearch(mode, carriedQuery)");
    expect(dashboardSource).toContain('if (pathname === "/" && !submittedUrlRunRequested) return;');
    expect(dashboardSource).toContain("if (modeChangeFromUiRef.current && !submittedUrlModeMatchesActive) return;");
    // Ask-this / cross-mode into Answer must not depend solely on auto-run: the
    // dashboard stays mounted, so submit explicitly after pushing run=1.
    expect(dashboardSource).toMatch(
      /if \(mode === "answer" \|\| mode === "documents"\) \{[\s\S]*?void executeSearch\(crossQuery, mode/,
    );
    // showSharedHome lives in dashboard-mode-surface; ClinicalDashboard still
    // supplies mode via searchParams.get("mode") at the call site.
    const modeSurface = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/dashboard-mode-surface.ts"),
      "utf8",
    );
    expect(modeSurface).toMatch(
      /const showSharedHome = shouldShowSharedHome\(\{[\s\S]*?pathname,[\s\S]*?mode: input\.submittedUrlMode,[\s\S]*?submittedAnswerSearchActive,[\s\S]*?\}\);/,
    );
    expect(dashboardSource).toMatch(/submittedUrlMode:\s*searchParams\.get\("mode"\)/);
  });

  it("routes a submitted shared-composer search to the selected mode's own surface", () => {
    const dashboardSource = readFileSync(resolve(process.cwd(), "src/components/ClinicalDashboard.tsx"), "utf8");
    const ask = sourceFrom(dashboardSource, "async function ask(", {
      label: "ClinicalDashboard async function ask",
    });

    // Natural-language Smart search uses the same selected-mode route as a
    // keyword lookup. The shared composer must not divert it to Clinical Ask.
    expect(ask).toMatch(
      /const modeDestination = appModeHomeHref\(searchMode, \{[\s\S]*?run: true,[\s\S]*?\}\);[\s\S]*?if \(trimmedQuery && !isDashboardModeHref\(modeDestination\)\) \{[\s\S]*?router\.push\(modeDestination\);\n      return;/,
    );
    expect(ask).not.toContain("submitSmartSearch");
  });

  it("does not treat catalogue search docks as information pages", () => {
    const shellSource = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/global-search-shell.tsx"),
      "utf8",
    );
    // The shell suppresses the composer on every information page with no
    // per-mode exception, so the submitted docks must stay outside that set:
    // `isSlugDetail` excludes the reserved `search` suffix, which is what keeps
    // a submitted search refinable.
    expect(isInformationPage("/services/search")).toBe(false);
    expect(isInformationPage("/forms/search")).toBe(false);
    expect(isInformationPage("/services/13yarn")).toBe(true);
    expect(shellSource).toContain('from "@/lib/information-pages"');
    // A hand-rolled slug test in the shell is how that shared classification
    // would silently diverge from the predicate above.
    expect(shellSource).not.toMatch(/pathname\.startsWith\("\/services\/"\) && pathname !== "\/services"/);
  });

  it("keeps the auto-run gate unaffected by the now-empty dashboard-owned-home map", () => {
    const shellSource = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/global-search-shell.tsx"),
      "utf8",
    );
    // The gate still checks isDashboardOwnedModeHomePath as a defensive OR — it is
    // permanently false now, but removing the check would be a behavior change with
    // no test coverage, so the source keeps it and this test keeps proving why.
    expect(shellSource).toMatch(
      /autoRunSearch=\{\s*pathname === "\/" \|\| isDashboardOwnedModeHomePath\(pathname\) \? hasSubmittedModeSearch : true\s*\}/,
    );
    expect(isDashboardOwnedModeHomePath("/documents")).toBe(false);
    expect(isDashboardOwnedModeHomePath("/medications")).toBe(false);
    expect(isDashboardOwnedModeHomePath("/")).toBe(false);
    // Documents no longer mounts the dashboard at its own bare path at all —
    // it redirects before anything renders.
    expect(
      shouldRenderClinicalDashboard({ hasSubmittedSearch: false, mode: "documents", pathname: "/documents" }),
    ).toBe(false);
    // `/medications` and `/documents` are both always-standalone now; the dashboard
    // gate never sees either bare path.
    expect(isAlwaysStandaloneShellPath("/medications")).toBe(true);
    expect(isAlwaysStandaloneShellPath("/documents")).toBe(true);
  });

  it("sends the Documents settings landing view to the shared home, not the retired route", () => {
    const shellSource = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/global-search-shell.tsx"),
      "utf8",
    );
    expect(shellSource).toContain('router.replace(appModeSelectionHref("documents"), { scroll: false })');
    expect(shellSource).toContain('router.replace("/tools", { scroll: false })');
    expect(shellSource).not.toContain('router.replace("/documents", { scroll: false })');
    expect(shellSource).not.toContain("router.replace(`/?mode=${landingMode}`");
  });

  it("lets settings landing win over remembered-mode seeding on cold /", () => {
    const dashboardSource = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/use-home-mode-seed.ts"),
      "utf8",
    );
    const seedStart = dashboardSource.indexOf("Seed a cold `/` visit from the remembered mode.");
    expect(seedStart).toBeGreaterThan(-1);
    // Slice to end of file rather than a fixed window: the module is this hook and
    // its doc comment, and a character budget silently stops covering the effect
    // as soon as the comment grows.
    const seedEffect = dashboardSource.slice(seedStart);
    expect(seedEffect).toContain("landingModeForPreference(readAppPreferences().landing)");
    // replaceState, never a push: seeding must not add a history entry.
    expect(seedEffect).toMatch(/window\.history\.replaceState\(\s*null,\s*"",\s*appModeSelectionHref\(lastAppMode/);
    expect(seedEffect).not.toContain("router.push");
    // The rest of the URL rides along. Seeding only runs with no mode/query in the
    // URL, but `focus=1` and the scope/queryMode context can still be present, and
    // rewriting without them silently dropped them on a cold `/` visit.
    expect(seedEffect).toContain("readSearchNavigationContext(searchParams)");
    expect(seedEffect).toMatch(/focus: searchParams\.get\("focus"\) === "1"/);
    expect(seedEffect).toContain("scopeFilters: navigationContext.scopeFilters");
    expect(seedEffect).toContain("Settings landing view also wins over last-mode");
    // The hook also owns the `?mode=` sync and the dashboard-owned-home arrival
    // reset, so the dashboard hands it the pathname and the reset it needs.
    const dashboard = readFileSync(resolve(process.cwd(), "src/components/ClinicalDashboard.tsx"), "utf8");
    expect(dashboard).toContain("useHomeModeSeed({");
    for (const prop of ["pathname,", "searchParams,", "setSearchMode,", "stopSearch,", "clearModeResultState,"]) {
      expect(dashboard.slice(dashboard.indexOf("useHomeModeSeed({"))).toContain(prop);
    }
    // The dashboard must not keep a second `?mode=` sync of its own.
    expect(dashboard).not.toContain("lastSyncedSearchParamsRef.current = searchParamString");
  });

  it("resets composer, submission and result state when a dashboard-owned home is reached", () => {
    // `dashboardOwnedModeHomeModeId` always returns null now (the map it reads,
    // `dashboardOwnedModeHomePaths`, is empty since Documents joined the
    // consolidated modes), so `pathMode` below is permanently null and this effect
    // is currently unreachable via normal navigation. It stays — safe, harmless
    // dead code — in case a future mode needs this dashboard-owned-home shape
    // again; this test keeps proving the reset logic itself is still correct.
    expect(dashboardOwnedModeHomeModeId("/documents")).toBeNull();
    const source = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/use-home-mode-seed.ts"),
      "utf8",
    );
    const arrivalStart = source.indexOf("const previousPathnameRef");
    expect(arrivalStart).toBeGreaterThan(-1);
    const arrival = source.slice(arrivalStart, source.indexOf("Seed a cold `/` visit"));
    // `/documents/search` -> `/documents` and Answer -> `/documents` both keep the
    // dashboard mounted, so arriving at the home has to clear what came before it:
    // `modeSearchSubmitted` alone decides whether the home or results render.
    expect(arrival).toContain("stopSearchRef.current()");
    expect(arrival).toContain("clearModeResultState()");
    expect(arrival).toContain('setQuery("")');
    expect(arrival).toContain("setModeSearchSubmitted(false)");
    expect(arrival).toContain("setSearchMode(pathMode)");
    // The reset must not be conditional on the mode actually changing: arriving on
    // `/documents` from `/documents/search` keeps the same mode and stale results.
    expect(arrival).not.toContain("pathMode === searchMode");
    // Keyed on a pathname transition, so a search submitted from the home (query
    // string only) cannot wipe the results the visitor just asked for, and a cold
    // mount cannot clear a restored answer thread.
    expect(arrival).toContain("previousPathname === null || previousPathname === pathname");
  });

  it("keeps the phone composer rendered during SSR while preserving desktop layout reservation", () => {
    const headerSource = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/master-search-header.tsx"),
      "utf8",
    );
    // SSR and unknown media state must not blank out search for phone viewports
    expect(headerSource).not.toMatch(
      /const pagePortalPending =\s*Boolean\(desktopPageComposerSlotId\) && !usesPhoneSearchLayout/,
    );
    expect(headerSource).toMatch(
      /const isPageDesktopComposerPending =\s*isDefaultComposer && Boolean\(desktopPageComposerSlotId\) && !desktopComposerPortalFallback/,
    );
    expect(headerSource).toContain('isPageDesktopComposerPending && "sm:hidden"');
  });

  it("routes dedicated modes to their standalone homes and shared modes to null", () => {
    expect(standaloneModeHomeHref("tools")).toBe("/tools");
    expect(standaloneModeHomeHref("favourites")).toBe("/favourites");
    // `documents` and `prescribing` are NOT standalone homes, however much their bare paths
    // look like one: /documents 307s to the shared home via consolidatedModeHomePaths and
    // /medications 307s through its own proxy fast-path. Returning either would cost a
    // redirect round trip and drop the draft query, query mode and scope filters that
    // appModeSelectionHref carries — landing the user back on the shared home with their
    // context gone. isStandaloneModeHomePath already says both are false, above.
    expect(standaloneModeHomeHref("prescribing")).toBeNull();
    expect(standaloneModeHomeHref("documents")).toBeNull();
    expect(standaloneModeHomeHref("answer")).toBeNull();
    expect(standaloneModeHomeHref("services")).toBeNull();
    expect(standaloneModeHomeHref("forms")).toBeNull();
    expect(standaloneModeHomeHref("differentials")).toBeNull();
    expect(standaloneModeHomeHref("dsm")).toBeNull();
    expect(standaloneModeHomeHref("specifiers")).toBeNull();
    expect(standaloneModeHomeHref("formulation")).toBeNull();
    expect(standaloneModeHomeHref("therapy-compass")).toBeNull();
    expect(standaloneModeHomeHref("factsheets")).toBeNull();
    expect(standaloneModeHomeHref("dictionary")).toBeNull();
    expect(standaloneModeHomeHref("sources")).toBeNull();
    expect(standaloneModeHomeHref("calculators")).toBeNull();
  });

  // One source of truth: every href the helper hands back must be a path this module already
  // recognises as standalone. Without this, a mode could be pointed at a path that redirects
  // and nothing offline would notice.
  it("only ever returns a path standaloneModeHomePaths already owns", () => {
    for (const modeId of appModeIds) {
      const href = standaloneModeHomeHref(modeId);
      if (href === null) continue;
      expect(isStandaloneModeHomePath(href), `${modeId} -> ${href}`).toBe(true);
    }
  });
});
