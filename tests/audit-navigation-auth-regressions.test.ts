import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET as redirectApplications, HEAD as headApplications } from "@/app/applications/route";
import {
  canRunDashboardSearch,
  shouldShowDashboardDegradedNotice,
} from "@/components/clinical-dashboard/document-manager-contracts";
import { resolveDifferentialCompareHandoff } from "@/lib/differentials";
import { legacyHomeRedirectUrl } from "@/lib/legacy-home-redirect";
import { sourceSegment } from "./helpers/source-contract";

function source(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const clinicalDashboardSource = source("src/components/ClinicalDashboard.tsx");
const dashboardDocumentActionsSource = source("src/components/clinical-dashboard/use-dashboard-document-actions.ts");
const dashboardModeSurfaceSource = source("src/components/clinical-dashboard/dashboard-mode-surface.ts");
const masterSearchHeaderSource = source("src/components/clinical-dashboard/master-search-header.tsx");
const universalAlsoMatchesSource = source("src/components/clinical-dashboard/universal-search-also-matches.tsx");
const universalCommandSurfaceSource = source("src/components/clinical-dashboard/universal-search-command-surface.tsx");
const globalSearchShellSource = source("src/components/clinical-dashboard/global-search-shell.tsx");

describe("audit navigation and auth regressions", () => {
  it("fails demo search closed and exposes the degraded notice when local identity is unsafe", () => {
    const capability = {
      explicitDemoMode: true,
      canUsePublicSearchApis: false,
      canUseDegradedLocalSearchApis: false,
      canUseNonProductionDemoFallback: false,
      canAttemptDeployedPublicSearch: false,
    };

    const unsafeCanRunSearch = canRunDashboardSearch({ ...capability, localProjectReady: false });
    expect(unsafeCanRunSearch).toBe(false);
    expect(
      shouldShowDashboardDegradedNotice({ isOnline: true, apiUnavailable: true, canRunSearch: unsafeCanRunSearch }),
    ).toBe(true);

    const safeCanRunSearch = canRunDashboardSearch({ ...capability, localProjectReady: true });
    expect(safeCanRunSearch).toBe(true);
    expect(
      shouldShowDashboardDegradedNotice({ isOnline: true, apiUnavailable: true, canRunSearch: safeCanRunSearch }),
    ).toBe(false);
  });

  it("keeps the tappable phone suggestion ticker connected to standalone homes", () => {
    expect(globalSearchShellSource).toContain('isStandaloneModeHome || (pathname === "/" && !hasSubmittedModeSearch)');
    // Favourites alone opts out of the ticker (owner decision 2026-09-30).
    expect(masterSearchHeaderSource).toContain(
      'showPhoneSuggestionTicker={showPhoneSuggestionTickerOnHome && searchMode !== "favourites"}',
    );
    expect(universalCommandSurfaceSource).toContain('data-testid="smart-search-phone-ticker"');
    expect(universalCommandSurfaceSource).toContain("onClick={() => onPickExample(resolvedTickerExample)}");
    expect(universalCommandSurfaceSource).toContain("examples.includes(heldTickerExample)");
    expect(universalCommandSurfaceSource).toContain("onQueryChange(example);");
  });
  it("redirects exact legacy route handlers at request time while retaining useful query state", () => {
    const applications = redirectApplications(
      new NextRequest("https://clinical-kb.test/applications?q=acute+care&tag=one&tag=two"),
    );
    expect(applications.status).toBe(307);
    expect(applications.headers.get("location")).toBe("/tools?q=acute+care&tag=one&tag=two");

    // `/differentials/compare` is a real page (no competing route.ts). Same-
    // presentation/bare selections redirect into a catalogue workflow; the
    // page source must keep that handoff via next/navigation redirect().
    const compareHandoff = resolveDifferentialCompareHandoff(["DELIRIUM", "unknown", "delirium"], "acute confusion");
    expect(compareHandoff.kind).toBe("presentation");
    expect(compareHandoff.href).toBe(
      "/differentials/presentations/acute-confusion-encephalopathy?q=acute+confusion&ids=delirium",
    );
    const comparePage = source("src/app/(search-app)/differentials/compare/page.tsx");
    expect(comparePage).toContain('from "next/navigation"');
    expect(comparePage).toContain("resolveDifferentialCompareHandoff");
    expect(comparePage).toContain("redirect(handoff.href)");
    expect(comparePage).not.toContain("NextResponse");

    // `/medications` is a real Medication mode home (no blanket 307). Submitted
    // deep links (`q` + `run=1`) still redirect to the dashboard prescribing
    // results surface so old bookmarks keep working.
    const medicationsPage = source("src/app/(search-app)/medications/page.tsx");
    expect(medicationsPage).toContain('appModeHomeHref("prescribing"');
    expect(medicationsPage).toContain("run: true");
    expect(medicationsPage).toContain("readSearchNavigationContext");
    expect(medicationsPage).toContain("redirect(");
    expect(medicationsPage).not.toContain('redirect("/?mode=prescribing")');
    const applicationsRequest = new NextRequest("https://clinical-kb.test/applications?q=lithium");
    const applicationsGet = redirectApplications(applicationsRequest);
    const applicationsHead = headApplications(applicationsRequest);
    expect(applicationsHead.status).toBe(applicationsGet.status);
    expect(applicationsHead.headers.get("location")).toBe("/tools?q=lithium");
    expect(applicationsHead.headers.get("location")).toBe(applicationsGet.headers.get("location"));
  });

  it.each([
    ["dsm", "major depressive", "/dsm/search?q=major+depressive&focus=1&run=1"],
    ["formulation", "I keep going over it", "/formulation/search?q=I+keep+going+over+it&focus=1&run=1"],
  ])("redirects submitted %s searches before the streamed page renders", (mode, query, expected) => {
    const submitted = new URL("https://clinical-kb.test/");
    submitted.search = new URLSearchParams({ mode, q: query, focus: "1", run: "1" }).toString();
    expect(legacyHomeRedirectUrl(submitted, "GET")?.toString()).toBe(`https://clinical-kb.test${expected}`);
    expect(legacyHomeRedirectUrl(new URL(`https://clinical-kb.test/?mode=${mode}`), "GET")).toBeNull();
    expect(legacyHomeRedirectUrl(submitted, "POST")).toBeNull();
  });

  it("only redirects submitted root legacy mode aliases, leaving bare /?mode= on the shared home", () => {
    // Selection-only (no q+run=1) must stay on `/` so the shared-home contract
    // covers favourites/differentials/specifiers the same as every other mode.
    expect(
      legacyHomeRedirectUrl(
        new URL("https://clinical-kb.test/?mode=favourites&q=+lithium+&focus=1&run=0&extra=drop"),
        "GET",
      ),
    ).toBeNull();
    expect(
      legacyHomeRedirectUrl(new URL("https://clinical-kb.test/?mode=specifiers&focus=1&unexpected=drop"), "GET"),
    ).toBeNull();
    expect(legacyHomeRedirectUrl(new URL("https://clinical-kb.test/?mode=favourites"), "GET")).toBeNull();

    const differentials = legacyHomeRedirectUrl(
      new URL("https://clinical-kb.test/?mode=differentials&q=acute+confusion&run=1&run=0&extra=drop"),
      "HEAD",
    );
    const favouritesSubmitted = legacyHomeRedirectUrl(
      new URL("https://clinical-kb.test/?mode=favourites&q=+lithium+&focus=1&run=1&extra=drop"),
      "GET",
    );
    // `q` is trimmed, a duplicated `run` collapses to one, `mode` is consumed by the
    // pathname — and every other parameter rides along (see the case below).
    expect(differentials?.toString()).toBe("https://clinical-kb.test/differentials?q=acute+confusion&run=1&extra=drop");
    expect(favouritesSubmitted?.toString()).toBe(
      "https://clinical-kb.test/favourites?q=lithium&focus=1&run=1&extra=drop",
    );
    expect(legacyHomeRedirectUrl(new URL("https://clinical-kb.test/?mode=favourites"), "POST")).toBeNull();
    expect(legacyHomeRedirectUrl(new URL("https://clinical-kb.test/?mode=answer"), "GET")).toBeNull();
    expect(source("src/proxy.ts")).toContain("legacyHomeRedirectUrl(request.nextUrl, request.method)");
  });

  // Tools is the one alias that forwards whether or not the URL is submitted. It has no
  // shared home to fall back to (`shouldShowSharedHome` excludes `tools`), so `/?mode=tools`
  // used to render a second, hub-shaped launcher and Tools had two surfaces depending on how
  // the clinician arrived. The hub's verb shortcut row moved to `/tools`, so the alias has
  // nothing of its own left to show.
  it("forwards the tools alias to the canonical directory whether or not it is submitted", () => {
    expect(legacyHomeRedirectUrl(new URL("https://clinical-kb.test/?mode=tools"), "GET")?.toString()).toBe(
      "https://clinical-kb.test/tools",
    );
    expect(
      legacyHomeRedirectUrl(
        new URL("https://clinical-kb.test/?mode=tools&q=medications&focus=1&run=1#detail"),
        "GET",
      )?.toString(),
    ).toBe("https://clinical-kb.test/tools?q=medications&focus=1&run=1");
    // A non-navigation method still falls through, same as every other alias.
    expect(legacyHomeRedirectUrl(new URL("https://clinical-kb.test/?mode=tools"), "POST")).toBeNull();
  });

  // This redirect used to rebuild the destination from scratch (`destination.search = ""`,
  // then only q/focus/run re-added), so `queryMode` and the scope filters were already gone
  // one hop before `consolidatedModeHomeTarget` — whose own doc promises "every other query
  // parameter rides along untouched" — ran for differentials/specifiers. The clinician saw
  // unscoped, auto-mode results for a link they had scoped, with no error (2026-09-02 audit,
  // L9).
  it("carries queryMode and scope filters through the legacy /?mode= redirect", () => {
    const scoped = legacyHomeRedirectUrl(
      new URL(
        "https://clinical-kb.test/?mode=specifiers&q=+mixed+features+&run=1&queryMode=compare_guidance&scope.source=raanzcp&scopeRef=doc-42&focus=0",
      ),
      "GET",
    );

    expect(scoped).not.toBeNull();
    const destination = new URL(scoped!.toString());
    expect(destination.pathname).toBe("/specifiers");
    expect(destination.searchParams.get("q")).toBe("mixed features");
    expect(destination.searchParams.get("run")).toBe("1");
    expect(destination.searchParams.get("queryMode")).toBe("compare_guidance");
    expect(destination.searchParams.get("scope.source")).toBe("raanzcp");
    expect(destination.searchParams.get("scopeRef")).toBe("doc-42");
    // `mode` is consumed by the destination pathname and must not travel: forwarding it would
    // let `/?mode=specifiers&…` arrive at the consolidated redirect claiming another mode.
    expect(destination.searchParams.has("mode")).toBe(false);
    // `focus` is a flag, not a value: anything but "1" is absence, as before.
    expect(destination.searchParams.has("focus")).toBe(false);
  });

  it("closes the master mode menu when focus leaves its wrapper", () => {
    const focusLeaveContract = sourceSegment(
      masterSearchHeaderSource,
      "ref={modeMenuRef}",
      'className="relative z-[60]',
      { label: "master mode-menu focus boundary" },
    );

    expect(focusLeaveContract).toContain("onBlur={(event) => {");
    expect(focusLeaveContract).toContain("if (usesPhoneSearchLayout) return;");
    expect(focusLeaveContract).toContain("const nextFocusedElement = event.relatedTarget;");
    expect(focusLeaveContract).toContain("event.currentTarget.contains(nextFocusedElement)");
    expect(focusLeaveContract).toContain("closeModeMenu();");
    // Shared close helper must cancel the pending mode-menu focus rAF (ArrowDown open path).
    expect(masterSearchHeaderSource).toContain("cancelModeMenuFocus();");
    expect(masterSearchHeaderSource).toContain("modeMenuFocusRafRef.current = window.requestAnimationFrame(() => {");
  });

  it("opens the master mode menu as a phone bottom sheet below the phone layout gate", () => {
    expect(masterSearchHeaderSource).toContain('testId="app-mode-menu-sheet"');
    expect(masterSearchHeaderSource).toContain("enabled: modeMenuOpen && !usesPhoneSearchLayout");
    // The desktop popover now has two levels — the mode list and, one step in,
    // the current mode's own sections — so the single desktop branch became two,
    // each still behind the same phone-layout gate. What this line pins is the
    // gate, not the arity: a desktop popover that renders below the gate is the
    // regression, and both branches must carry it.
    const desktopPopoverBranches = [
      ...masterSearchHeaderSource.matchAll(/\{!usesPhoneSearchLayout && modeMenuOpen[^?]*\? \(/g),
    ];
    expect(desktopPopoverBranches).toHaveLength(2);
    expect(masterSearchHeaderSource).toContain(
      '{!usesPhoneSearchLayout && modeMenuOpen && modeSheetView === "sections" ? (',
    );
    expect(masterSearchHeaderSource).toContain(
      '{!usesPhoneSearchLayout && modeMenuOpen && modeSheetView === "modes" ? (',
    );
    // The desktop trigger now opens a searchable grouped dialog (not a plain
    // menu), so it always announces `dialog` regardless of phone layout.
    expect(masterSearchHeaderSource).toContain('aria-haspopup="dialog"');
    expect(masterSearchHeaderSource).toContain('mobilePlacement="bottom"');
    expect(masterSearchHeaderSource).toContain(
      'contentClassName="max-h-[calc(100dvh-0.75rem)] rounded-t-3xl bg-[color:var(--surface-lux)] sm:max-w-md sm:rounded-2xl"',
    );
    expect(masterSearchHeaderSource).toMatch(/usesPhoneSearchLayout\s*\?\s*"min-h-14\b[\s\S]*:\s*"min-h-12\b/);
    expect(masterSearchHeaderSource).toContain("phoneLayoutGateRef");
    // Hydration-safe: do not read matchMedia in useState (SSR/client mismatch → React #418).
    expect(masterSearchHeaderSource).toContain(
      "const [usesPhoneSearchLayout, setUsesPhoneSearchLayout] = useState(false);",
    );
    // The searchable desktop dialog reuses this same live matchMedia read to
    // decide whether to reset `modeMenuQuery` before the rAF-scheduled focus
    // (see `openModeMenuWithFocus`/`toggleModeMenu`), so it is now bound to a
    // local first and passed to the setter rather than called inline twice.
    expect(masterSearchHeaderSource).toContain("const phoneLayout = currentUsesPhoneSearchLayout();");
    expect(masterSearchHeaderSource).toContain("setUsesPhoneSearchLayout(phoneLayout);");
  });

  it("prefetches only the mode a user focuses or points at", () => {
    const modeOption = sourceSegment(
      masterSearchHeaderSource,
      "function renderModeMenuOption(",
      "function renderModeMenuOptions()",
      { label: "mode-menu option prefetch" },
    );
    const openModeMenuWithFocus = sourceSegment(
      masterSearchHeaderSource,
      "function openModeMenuWithFocus(",
      "function toggleModeMenu(",
      { label: "mode-menu focus-open prefetch" },
    );
    const toggleModeMenu = sourceSegment(
      masterSearchHeaderSource,
      "function toggleModeMenu(",
      "function handleModeTriggerKeyDown(",
      { label: "mode-menu toggle prefetch" },
    );

    expect(masterSearchHeaderSource).toContain("function prefetchModeSelection(modeId: AppModeId)");
    expect(masterSearchHeaderSource).toContain(
      "const href = standaloneModeHomeHref(modeId) ?? appModeSelectionHref(modeId)",
    );
    expect(masterSearchHeaderSource).toContain("router.prefetch(href,");
    expect(masterSearchHeaderSource).toContain("onInvalidate:");
    expect(modeOption).toContain("onFocus={() => prefetchModeSelection(mode.id)}");
    expect(modeOption).toContain("onPointerEnter={() => prefetchModeSelection(mode.id)}");
    // Menu-open paths warm only the highlighted option — never every visible home.
    expect(openModeMenuWithFocus).toContain("prefetchModeSelection(highlighted.id)");
    expect(toggleModeMenu).toContain("prefetchModeSelection(highlighted.id)");
    expect(masterSearchHeaderSource).not.toContain("function prefetchModeSelections(");
    expect(masterSearchHeaderSource).not.toContain("visibleAppModeOptions.forEach((mode) => router.prefetch");
    expect(masterSearchHeaderSource).not.toContain(
      "new Set(visibleAppModeOptions.map((mode) => appModeHomeHref(mode.id)))",
    );
  });

  it("runs cross-mode search on submission at every width, so a closed tray can state its count", () => {
    // `prescribing` was excluded here while the panel mounted ABOVE the medication
    // results; the mount moved below them, so the mode is no longer suppressed and
    // the gate is plain submission. tests/ui-stress.spec.ts pins the panel's
    // position under those results.
    //
    // The narrow-screen deferral this contract used to pin is gone deliberately.
    // Waiting for the click meant the phone header could only say "Tap to open"
    // and the tray was still rendered when nothing was behind it — a blind door.
    // The lookup is eager at every width and an empty tray is dropped instead.
    expect(universalAlsoMatchesSource).toContain("const searchActive = submissionActive;");
    expect(universalAlsoMatchesSource).not.toContain('modeId !== "prescribing"');
    expect(universalAlsoMatchesSource).not.toContain('(isWide || modeId === "answer" || expanded)');
    // The header now says pending / a count / nothing found. The "Tap to open"
    // arm it replaced survives only in the comment above the searchActive gate,
    // which is why this pins the expression rather than searching for the string.
    expect(universalAlsoMatchesSource).toContain(
      'const headerMeta = searchPending ? "Searching…" : matchCount > 0 ? matchCountLabel(matchCount) : "No other matches";',
    );
    expect(universalAlsoMatchesSource).toContain("enabled: trimmedQuery.length >= 2 && searchActive");
    expect(universalAlsoMatchesSource).toContain('if (modeId === "answer" && currentGroups.length === 0) return null;');
    expect(universalAlsoMatchesSource).toContain("if (!searchPending && currentGroups.length === 0) return null;");
    expect(universalAlsoMatchesSource).toContain("const [viewportReady, setViewportReady] = useState(false);");
    expect(universalAlsoMatchesSource).toContain("setViewportReady(true);");
    // The panel status is a three-way now — pending / a count / nothing found —
    // because one fixed string announced "No additional matches" over a grid of
    // populated mode cards. The pending arm is the one this contract is about.
    expect(universalAlsoMatchesSource).toMatch(/const panelStatus = searchPending\s*\n?\s*\? "Searching other modes"/);
    // Since #3PW9TY the empty message has two arms, and the contract is about which one
    // speaks. "No additional matches" is a claim about the catalogue's contents; a catalogue
    // that could not be read has no contents to report, and saying there are none is the
    // silent-absence failure the 2026-09-16 outage was. The fixed sentence survives as the
    // honest-empty arm only.
    expect(universalAlsoMatchesSource).toContain("const emptyMessage = catalogueDegraded");
    expect(universalAlsoMatchesSource).toContain(
      'withCatalogueDegradedNotice("No additional matches in other modes", true)',
    );
    expect(universalAlsoMatchesSource).toContain(': "No additional matches in other modes.";');
  });

  it("mounts Answer-mode also-matches only after generation completes", () => {
    const alsoMatchesGate = sourceSegment(
      dashboardModeSurfaceSource,
      "const showUniversalAlsoMatches =",
      "const showDesktopHomeComposer =",
      { label: "also-matches visibility gate" },
    );
    expect(alsoMatchesGate).toContain('activeModeResultKind === "tools"');
    expect(alsoMatchesGate).toContain('activeModeResultKind === "favourites"');
    expect(alsoMatchesGate).toContain('activeModeResultKind === "answer" && Boolean(answer) && !loading');
    expect(alsoMatchesGate).not.toContain(
      'activeModeResultKind === "answer" || activeModeResultKind === "tools" || activeModeResultKind === "favourites"',
    );
  });

  it("gates private polling and mutations on local readiness plus authenticated status", () => {
    const privateCapabilityContract = sourceSegment(
      clinicalDashboardSource,
      "const canUsePrivateApis =",
      "const canRunSearch =",
      { label: "private API capability" },
    );
    expect(privateCapabilityContract).toContain("const canUsePrivateApis =");
    expect(privateCapabilityContract).toContain(
      'localNoAuthMode || localDevCanAttemptPrivateApis || authStatus === "authenticated"',
    );

    const pollingContract = sourceSegment(
      clinicalDashboardSource,
      "if (!nextDemoMode && !canUsePrivateApis) {",
      "const shouldRefreshWorkState =",
      { label: "private polling capability" },
    );
    expect(pollingContract).toContain("if (!nextDemoMode && !canUsePrivateApis) {");
    expect(pollingContract).toContain("setDocuments([]);");
    expect(pollingContract).toContain("return;");

    // The label mutation moved out of ClinicalDashboard with the other per-document actions; the
    // dashboard must still hand it the same private-API capability.
    expect(clinicalDashboardSource).toContain("useDashboardDocumentActions({");
    expect(clinicalDashboardSource).toMatch(/useDashboardDocumentActions\(\{[\s\S]*?canUsePrivateApis,[\s\S]*?\}\)/);
    const labelMutationContract = sourceSegment(
      dashboardDocumentActionsSource,
      "const mutateDocumentLabel =",
      "const handleDocumentDeleted =",
      { label: "private label mutation" },
    );
    expect(labelMutationContract).toContain("if (!canUsePrivateApis) return false;");

    const indexingAdministrationContract = sourceSegment(
      clinicalDashboardSource,
      "const openLibraryHealthTarget = useCallback(",
      "// The dashboard renders directly on",
      { label: "private indexing administration" },
    );
    expect(indexingAdministrationContract).toContain("if (!canUseAdministrativeApis) {");

    // Guard text alone would pass even if the guard fell through to the drawer-opening calls, so
    // pin the ORDER: the early return has to precede every administrative state change, and the
    // non-administrator branch must reach none of them.
    const guardIndex = indexingAdministrationContract.indexOf("if (!canUseAdministrativeApis) {");
    const earlyReturnIndex = indexingAdministrationContract.indexOf("return;", guardIndex);
    expect(earlyReturnIndex, "the administrator guard must return, not just warn").toBeGreaterThan(guardIndex);

    const deniedBranch = indexingAdministrationContract.slice(guardIndex, earlyReturnIndex);
    expect(deniedBranch).not.toContain("setIndexingAdminDrawerOpen(true)");
    expect(deniedBranch).not.toContain("setIndexingAdminMobileTab");
    expect(deniedBranch).not.toContain('setDocumentsDrawerMode("admin")');

    for (const administrativeCall of [
      "settingsState.setIndexingAdminDrawerOpen(true);",
      'settingsState.setIndexingAdminMobileTab("jobs");',
      'settingsState.setDocumentsDrawerMode("admin");',
    ]) {
      const callIndex = indexingAdministrationContract.indexOf(administrativeCall);
      expect(callIndex, `${administrativeCall} must exist in the administrator path`).toBeGreaterThan(-1);
      expect(callIndex, `${administrativeCall} must sit after the non-administrator early return`).toBeGreaterThan(
        earlyReturnIndex,
      );
    }

    // Rendering is gated on the same capability, so losing access mid-session cannot leave jobs,
    // batches or quality data painted from component state.
    expect(clinicalDashboardSource).toContain("{settingsState.indexingAdminDrawerOpen && canUseAdministrativeApis ? (");
  });

  it("defers the applications route prefetch until sidebar intent", () => {
    expect(clinicalDashboardSource).not.toContain("window.setTimeout(prefetchApplications, 250)");

    const desktopSidebar = sourceSegment(clinicalDashboardSource, "<ClinicalDesktopSidebar", "<PhoneFooterLayerFrame", {
      label: "desktop sidebar prefetch wiring",
    });
    const mobileSidebar = sourceSegment(clinicalDashboardSource, "<ClinicalMobileSidebar", "</PhoneFooterLayerFrame>", {
      label: "mobile sidebar prefetch wiring",
    });
    expect(desktopSidebar).toContain("onPrefetchApplications={prefetchApplications}");
    expect(mobileSidebar).toContain("onPrefetchApplications={prefetchApplications}");
  });

  it("keeps private indexing administration associated without exposing uploads", () => {
    const indexingAdminDrawerSource = source("src/components/clinical-dashboard/indexing-admin-drawer.tsx");
    expect(indexingAdminDrawerSource).toContain('aria-label="Indexing administration sections"');
    expect(indexingAdminDrawerSource).toContain('role="tab"');
    expect(indexingAdminDrawerSource).toContain("aria-selected={active}");
    expect(indexingAdminDrawerSource).toContain("aria-controls={tab.panelId}");
    expect(indexingAdminDrawerSource).toContain("tabIndex={active ? 0 : -1}");
    expect(indexingAdminDrawerSource).toContain('role={indexingAdminUsesDesktopRegions ? "region" : "tabpanel"}');
    for (const tab of ["setup", "jobs", "quality"]) {
      expect(indexingAdminDrawerSource).toContain(`"dashboard-indexing-admin-tab-${tab}"`);
    }
    for (const section of ["setup", "indexing", "quality"]) {
      expect(indexingAdminDrawerSource).toContain(`id="dashboard-${section}-section-heading"`);
    }
    // The viewport-driven region/tabpanel role is wired through the extracted hook, whose
    // media-query subscription carries the guard with it.
    expect(clinicalDashboardSource).toContain("useIndexingAdminDesktopLayout()");
    // Assert the EXPORTED hook's return wires the media-query subscription through
    // useSyncExternalStore with the () => false server snapshot, and that the call closes
    // right after that snapshot. Scoping to the exported function body (not the whole file)
    // plus the `return` anchor and trailing `)` means a stale/disconnected call elsewhere, a
    // comment or string, a present-but-unused helper, a dropped SSR fallback, or a mutated
    // snapshot such as `() => false || getUploadDesktopLayoutSnapshot()` all fail the guard.
    const indexingAdminDesktopHookSource = source(
      "src/components/clinical-dashboard/use-indexing-admin-desktop-layout.ts",
    );
    const useIndexingAdminDesktopLayoutBody = sourceSegment(
      indexingAdminDesktopHookSource,
      "export function useIndexingAdminDesktopLayout(",
      "}",
      { label: "indexing admin desktop layout hook" },
    );
    expect(useIndexingAdminDesktopLayoutBody).toMatch(
      /return\s+useSyncExternalStore\(\s*subscribeToIndexingAdminDesktopLayout,\s*getIndexingAdminDesktopLayoutSnapshot,\s*\(\)\s*=>\s*false\s*,?\s*\)\s*;?\s*$/,
    );
    // The source contract prevents the old effect/setState viewport pattern from returning.
    expect(indexingAdminDesktopHookSource).not.toContain("useEffect");
    expect(indexingAdminDesktopHookSource).not.toContain("useState");
    expect(indexingAdminDesktopHookSource).not.toContain("setIndexingAdminUsesDesktopRegions");
    expect(clinicalDashboardSource).not.toContain("UploadPanel");
    expect(clinicalDashboardSource).not.toContain('type="file"');
  });
});
