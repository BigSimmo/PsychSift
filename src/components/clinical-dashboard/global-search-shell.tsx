"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  type CSSProperties,
  type ReactNode,
  type UIEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import dynamic from "next/dynamic";

import { SettingsStateProvider } from "@/components/clinical-dashboard/SettingsStateProvider";
import {
  clearLegacyRecentQueries,
  demoRecentQueryOwnerId,
  loadRecentQueries,
  recentQueriesChangeEvent,
} from "@/lib/recent-query-storage";
import { PatientProfileProvider } from "@/components/clinical-dashboard/patient-profile-context";
import { SearchCommandProvider } from "@/components/clinical-dashboard/search-command-context";
import {
  ClinicalDesktopSidebar,
  ClinicalMobileSidebar,
  ClinicalSidebarContent,
  deriveSidebarIdentity,
} from "@/components/clinical-dashboard/ClinicalSidebar";
import { landingModeForPreference, readAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { useFavouritesAccess } from "@/components/clinical-dashboard/use-favourites-access";
import { MasterSearchHeader } from "@/components/clinical-dashboard/master-search-header";
import { PhoneFooterLayerFrame } from "@/components/clinical-dashboard/phone-footer-layer-portal";
import { PageSecondaryNavigation } from "@/components/page-secondary-navigation";
import { LazyWorkSideCounts, LazyWorkSideMenu } from "@/components/work-frame/lazy-work-side-nav";
import { useWorkRailShown, useWorkSideNav, WorkRail, workSideCurrentArea } from "@/components/work-frame/work-rail";
import { useActiveScrollOwner } from "@/components/clinical-dashboard/use-active-scroll-owner";
import {
  isPageOwnedComposerRoute,
  resolveMobileComposerReserve,
  resolveShellVisibleMobileComposerReserve,
} from "@/components/clinical-dashboard/mobile-composer-reserve";
import { usePhoneOverlayChromeReserve } from "@/components/clinical-dashboard/use-phone-overlay-chrome-reserve";
import {
  readChromeCollapseMetrics,
  useDocumentScrollHideReporter,
  useReserveTransitionMarker,
  useScrollHideReporter,
} from "@/components/clinical-dashboard/use-hide-on-scroll";
import { ModeHomeRouteLoading } from "@/components/mode-home-page-skeleton";
import { useSidebarCollapsed } from "@/components/clinical-dashboard/use-sidebar-collapsed";
import {
  loadSettingsDialog,
  prefetchAccountDialog,
  SidebarAccountSetupDialog,
  SidebarSettingsDialog,
} from "@/components/clinical-dashboard/lazy-sidebar-dialogs";
import { LazyGuideDialog, loadGuideDialog } from "@/components/clinical-dashboard/lazy-guide-dialog";
import { useSettingsGuideFlow } from "@/components/clinical-dashboard/use-settings-guide-flow";
import { cn, LoadingPanel } from "@/components/ui-primitives";
import {
  appModeDefinition,
  appModeHomeHref,
  appModeSelectionHref,
  isAppModeId,
  isAppModeVisible,
  visibleAppModeDefinitions,
  type AppModeId,
} from "@/lib/app-modes";
import { useLastAppMode } from "@/components/clinical-dashboard/use-last-app-mode";
import { focusComposerInput } from "@/components/clinical-dashboard/focus-composer-input";
import { ClinicalAskWorkspace } from "@/components/clinical-dashboard/clinical-dashboard-lazy";
import { isClinicalAskModeId, type ClinicalAskModeId } from "@/lib/clinical-ask/contracts";
import { clinicalAskWorkspaceVisible } from "@/components/clinical-dashboard/use-clinical-ask-shell-state";
import type { ClinicalAskShellBindings } from "@/components/clinical-dashboard/clinical-ask-shell-bindings";

// Namespaced mode homes share this client shell but never render the dashboard
// body — keep ClinicalDashboard out of their parse/eval path until `/` needs it.
const ClinicalDashboard = dynamic(
  () => import("@/components/ClinicalDashboard").then((mod) => ({ default: mod.ClinicalDashboard })),
  { ssr: true, loading: () => <ModeHomeRouteLoading /> },
);

const ClinicalAskShellBindingsLayer = dynamic(
  () =>
    import("@/components/clinical-dashboard/clinical-ask-shell-bindings").then((m) => m.ClinicalAskShellBindingsLayer),
  { ssr: false },
);

const ClinicalAskAnswerSurface = dynamic(
  () => import("@/components/clinical-dashboard/clinical-ask-answer-surface").then((m) => m.ClinicalAskAnswerSurface),
  { ssr: false, loading: () => <LoadingPanel label="Loading Clinical Ask response" /> },
);

const inactiveClinicalAskShellBindings = {
  clinicalAskSession: {
    mode: null,
    response: null,
    submitted: false,
    clear: () => undefined,
  },
  clinicalAskOnline: true,
  runModeClinicalAsk: () => undefined,
} as ClinicalAskShellBindings;
import { isLocalNoAuthMode, resolveClientDemoMode } from "@/lib/client-env";
import { documentsSearchHref } from "@/lib/document-flow-routes";
import { isInformationPage } from "@/lib/information-pages";
import { DesktopComposerPortalSlot } from "@/components/desktop-composer-portal-slot";
import {
  desktopPageComposerSlotId,
  differentialsMobileCompareAddonSlotId,
  therapyCompareAddonSlotId,
  modeHomeComposerReservePendingValue,
  modeHomeDesktopComposerSlotId,
} from "@/lib/mode-home-composer";
import { readSearchNavigationContext, type SearchNavigationOptions } from "@/lib/search-navigation-context";
import { isTherapyPhoneDockRoute, readTherapyCompareSlugCount } from "@/lib/therapy-compass-navigation";
import {
  isAlwaysStandaloneShellPath,
  isDashboardOwnedModeHomePath,
  isDictionaryCataloguePath,
  isStandaloneModeHomePath,
  shouldRenderClinicalDashboard,
  shouldRenderDashboardSearch,
  standaloneModeHomeHref,
} from "@/lib/search-route-ownership";
import type { SearchScopeFilters } from "@/lib/search-scope";
import { useAuthSession } from "@/lib/supabase/client";
import type { ClinicalQueryMode } from "@/lib/types";

const mockupQueryModeOptions: Array<{ value: ClinicalQueryMode; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "monitoring_schedule", label: "Monitoring" },
  { value: "dose_threshold_lookup", label: "Dose / thresholds" },
  { value: "contraindications_cautions", label: "Cautions" },
  { value: "escalation_criteria", label: "Escalation" },
  { value: "required_documentation", label: "Documentation" },
  { value: "compare_guidance", label: "Compare" },
];
// Re-apply focus shortly after the first frame to survive initial hydration remounts.
const focusHydrationRetryDelayMs = 300;
type GlobalSearchShellProps = {
  children: ReactNode;
  clinicalAskAvailableModeIds?: readonly ClinicalAskModeId[];
  initialMode?: AppModeId;
  availableModeIds?: readonly AppModeId[];
  desktopSearchPlacement?: "default" | "hero";
  /** Override the phone placement for a standalone mode home's shared composer. */
  mobileHomeComposerPlacement?: "hero" | "footer";
  /** Hide the shared search composer on routes that provide their own search surface. */
  searchComposerVisible?: boolean;
  /** Keep the global header/search while allowing a route to use the full desktop canvas. */
  hideDesktopSidebar?: boolean;
  /** Render only the mockup content when a design board needs a clean canvas. */
  chromeVisible?: boolean;
  /** Hide the shared mobile header when a route owns its phone navigation. */
  mobileChromeVisible?: boolean;
  /** Optional custom fallback for the Suspense boundary. Defaults to ModeHomeRouteLoading on the home route. */
  fallback?: ReactNode;
};

type PendingModeNavigation = {
  mode: AppModeId;
  pathname: string;
  /** Destination search string (no leading `?`) so same-pathname homes wait for query clear. */
  searchParamString: string;
  /** URL at the moment the mode push was issued — used to detect superseding navigations. */
  sourcePathname: string;
  sourceSearchParamString: string;
};

export function GlobalSearchShell(props: GlobalSearchShellProps) {
  const pathname = usePathname() ?? "/";

  return <GlobalSearchShellRoute {...props} pathname={pathname} />;
}

function GlobalSearchShellRoute(props: GlobalSearchShellProps & { pathname: string }) {
  const { pathname } = props;

  // Pathname-only gate: never wrap always-standalone routes in the outer
  // useSearchParams Suspense. That nested the route segment (loading.tsx + page)
  // inside an incomplete streaming `S:` boundary and left a persistent hidden
  // duplicate page-root data-testid under CI load.
  if (isAlwaysStandaloneShellPath(pathname)) {
    return (
      <PatientProfileProvider>
        <GlobalStandaloneSearchShellClient {...props} />
      </PatientProfileProvider>
    );
  }

  return (
    <Suspense
      fallback={
        props.fallback ?? (
          // A neutral placeholder — do NOT render props.children here. The client
          // body below also renders {children} inside `#main-content`, and echoing
          // them in the fallback duplicated the page subtree (two `#main-content`
          // and two `data-testid` on medication/forms/services pages) whenever the
          // fallback and resolved content briefly coexisted. A route-agnostic mode-home
          // skeleton (the same one `loading.tsx` shows during navigation) reserves the
          // layout so the first frame reads as "loading" instead of a blank background.
          <div className="flex min-h-0 flex-col bg-[color:var(--background)] text-[color:var(--text)] sm:min-h-dvh">
            <ModeHomeRouteLoading />
          </div>
        )
      }
    >
      <PatientProfileProvider>
        <GlobalSearchShellDashboardGate {...props} />
      </PatientProfileProvider>
    </Suspense>
  );
}

function GlobalSearchShellDashboardGate(props: GlobalSearchShellProps) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const searchParams = useSearchParams();
  const landingPreferenceAppliedRef = useRef(false);
  useEffect(() => {
    if (landingPreferenceAppliedRef.current) return;
    landingPreferenceAppliedRef.current = true;
    if (pathname !== "/") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") || params.get("q")?.trim() || params.get("query")?.trim() || params.get("run") === "1") {
      return;
    }
    // Settings "Default landing view" → Documents now lands on the shared home
    // with Documents preselected, same as any other consolidated mode — there is
    // no separate Documents Start-here surface to navigate to any more.
    const landingMode = landingModeForPreference(readAppPreferences().landing);
    if (landingMode === "documents") {
      router.replace(appModeSelectionHref("documents"), { scroll: false });
      return;
    }
    if (landingMode === "tools") {
      router.replace("/tools", { scroll: false });
    }
  }, [pathname, router]);
  const initialMode = props.initialMode ?? "answer";
  const visibleShellModes = visibleAppModeDefinitions().filter(
    (mode) => !props.availableModeIds?.length || props.availableModeIds.includes(mode.id),
  );
  const fallbackMode = visibleShellModes[0]?.id ?? initialMode;
  const initialSearchMode =
    props.availableModeIds?.length && !props.availableModeIds.includes(initialMode) ? fallbackMode : initialMode;
  const requestedMode = searchParams.get("mode");
  const resolvedSearchMode =
    isAppModeId(requestedMode) &&
    isAppModeVisible(requestedMode) &&
    (!props.availableModeIds?.length || props.availableModeIds.includes(requestedMode))
      ? requestedMode
      : initialSearchMode;
  const requestedQuery = (searchParams.get("q") ?? searchParams.get("query") ?? "").trim();
  const hasSubmittedModeSearch = searchParams.get("run") === "1" && requestedQuery.length > 0;
  const rendersClinicalDashboard = shouldRenderClinicalDashboard({
    hasSubmittedSearch: hasSubmittedModeSearch,
    mode: resolvedSearchMode,
    pathname,
  });

  // PatientProfileProvider already wraps this gate in GlobalSearchShell.
  // SettingsStateProvider keeps dashboard settings/drawer state extracted for the
  // ClinicalDashboard tree only.
  if (rendersClinicalDashboard) {
    return (
      <SettingsStateProvider>
        <ClinicalDashboard
          initialSearchMode={resolvedSearchMode}
          initialQuery={requestedQuery}
          focusSearch={searchParams.get("focus") === "1"}
          // Dashboard-owned mode homes mount ClinicalDashboard with nothing
          // submitted. Keystroke drafts must not auto-run there — same contract
          // as bare `/` — or every composer edit fires `/api/search`. No mode
          // currently uses this path (`dashboardOwnedModeHomePaths` is empty
          // since Documents' bare path became a redirect), but the check stays
          // ready for the next mode shaped this way.
          autoRunSearch={pathname === "/" || isDashboardOwnedModeHomePath(pathname) ? hasSubmittedModeSearch : true}
          clinicalAskAvailableModeIds={props.clinicalAskAvailableModeIds}
        />
      </SettingsStateProvider>
    );
  }

  return <GlobalStandaloneSearchShellClient {...props} />;
}

function subscribeNoop() {
  return () => undefined;
}

/**
 * Isolates `useSearchParams()` so the standalone shell body (and route children)
 * are not descendants of that Suspense boundary. Client-only via
 * useSyncExternalStore so SSR never calls `useSearchParams` on always-standalone
 * routes (avoids an outer incomplete `S:` boundary wrapping the page segment).
 */
function ShellSearchParamsBridge({ onParamString }: { onParamString: (value: string) => void }) {
  const ready = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  if (!ready) return null;
  return <ShellSearchParamsBridgeInner onParamString={onParamString} />;
}

function ShellSearchParamsBridgeInner({ onParamString }: { onParamString: (value: string) => void }) {
  const searchParams = useSearchParams();
  const paramString = searchParams.toString();
  useLayoutEffect(() => {
    onParamString(paramString);
  }, [onParamString, paramString]);
  return null;
}

function readInitialBrowserSubmittedSearchParamString(): string {
  if (typeof window === "undefined") return "";
  const search = window.location.search.startsWith("?") ? window.location.search.slice(1) : window.location.search;
  const params = new URLSearchParams(search);
  const query = (params.get("q") ?? params.get("query") ?? "").trim();
  return params.get("run") === "1" && query ? search : "";
}

function GlobalStandaloneSearchShellClient(props: GlobalSearchShellProps) {
  // Empty until the bridge resolves — matches SSR/hydration, then syncs. Keeps
  // `{children}` outside the useSearchParams Suspense (no nested S: page clone).
  const [searchParamString, setSearchParamString] = useState("");
  // Hard loads of always-standalone submitted routes need the browser query
  // before the Suspense-delayed bridge hydrates, otherwise the shell briefly
  // paints the mode-home hero before snapping to the submitted bottom dock.
  const browserSearchParamString = useSyncExternalStore(
    subscribeNoop,
    readInitialBrowserSubmittedSearchParamString,
    () => "",
  );
  const effectiveSearchParamString = searchParamString || browserSearchParamString;
  return (
    <>
      <Suspense fallback={null}>
        <ShellSearchParamsBridge onParamString={setSearchParamString} />
      </Suspense>
      <GlobalStandaloneSearchShellBody {...props} searchParamString={effectiveSearchParamString} />
    </>
  );
}

function GlobalStandaloneSearchShellBody({
  children,
  initialMode = "answer",
  availableModeIds,
  desktopSearchPlacement = "default",
  mobileHomeComposerPlacement = "hero",
  searchComposerVisible = true,
  clinicalAskAvailableModeIds,
  hideDesktopSidebar = false,
  chromeVisible = true,
  mobileChromeVisible = true,
  searchParamString,
}: GlobalSearchShellProps & { searchParamString: string }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const searchParams = useMemo(() => new URLSearchParams(searchParamString), [searchParamString]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [mainElement, setMainElement] = useState<HTMLDivElement | null>(null);
  // The header hides at every breakpoint; only the phone bottom dock stays
  // phone-gated (MasterSearchHeader keeps that behind its own phone layout
  // check). Browser phones and sm+ use document scrolling; standalone phones
  // keep #main-content as the bounded app scroller, so both sources feed one
  // reporter.
  // resetKey=pathname clears carried-over hide state across shared mode homes.
  const chromeScrollHide = useScrollHideReporter(false, true, pathname);
  const reportChromeScrollHideRef = useRef(chromeScrollHide.reportScroll);
  const [bottomComposerHidden, setBottomComposerHidden] = useState(false);
  const [bottomComposerHiddenPathname, setBottomComposerHiddenPathname] = useState(pathname);
  // Render-time reset (not an effect): pathname-only mode homes share one scroller,
  // so a carried-over hidden dock pad would open the next mode mid-collapse.
  if (pathname !== bottomComposerHiddenPathname) {
    setBottomComposerHiddenPathname(pathname);
    setBottomComposerHidden(false);
  }
  const reserveTransitioning = useReserveTransitionMarker(bottomComposerHidden, pathname);
  const chromeTransitioning = useReserveTransitionMarker(chromeScrollHide.hidden, pathname);
  const activeScrollOwner = useActiveScrollOwner(mainElement, pathname);
  useDocumentScrollHideReporter(chromeScrollHide.reportScroll, mainElement, inputRef);
  // Phones overlay the header, so content owns a constant top clearance beneath
  // it. Published as a measured height because the collapse row grows with
  // portaled page navigation, and read as a fixed reserve so hide/reveal moves
  // no layout.
  usePhoneOverlayChromeReserve();
  useEffect(() => {
    reportChromeScrollHideRef.current = chromeScrollHide.reportScroll;
  }, [chromeScrollHide.reportScroll]);
  // Mode homes share one shell scroller. Reset scroll when the route changes so
  // /services → /dsm does not open mid-page with a stuck offset.
  useEffect(() => {
    const main = document.getElementById("main-content");
    if (main instanceof HTMLElement) main.scrollTop = 0;
    window.scrollTo(0, 0);
  }, [pathname]);
  const visibleShellModes = useMemo(() => {
    const modes = visibleAppModeDefinitions();
    if (!availableModeIds?.length) return modes;
    const allowedModeIds = new Set<AppModeId>(availableModeIds);
    return modes.filter((mode) => allowedModeIds.has(mode.id));
  }, [availableModeIds]);
  const fallbackMode = visibleShellModes[0]?.id ?? initialMode;
  const initialSearchMode =
    availableModeIds?.length && !availableModeIds.includes(initialMode) ? fallbackMode : initialMode;
  const requestedFocus = searchParams.get("focus") === "1";
  const requestedRun = searchParams.get("run") === "1";
  const currentUrlHasQuery = searchParams.has("q") || searchParams.has("query");
  const requestedQuery = (searchParams.get("q") ?? searchParams.get("query") ?? "").trim();
  const requestedMode = searchParams.get("mode");
  // Mode resolved from the URL (?mode=), falling back to this shell's default when
  // the param is missing, unknown, or not offered here. Seeds the initial mode and
  // re-syncs it after a navigation.
  const resolvedSearchMode =
    isAppModeId(requestedMode) &&
    isAppModeVisible(requestedMode) &&
    (!availableModeIds?.length || availableModeIds.includes(requestedMode))
      ? requestedMode
      : initialSearchMode;
  const [query, setQuery] = useState(requestedQuery);
  const [, setLastAppMode] = useLastAppMode();
  // Previous URL snapshot for during-render sync (React "adjusting state when a
  // prop changes"). Pathname must be tracked separately: with the shared
  // `(search-app)` layout, /services → /dsm keeps an empty query string, and a
  // params-only gate would leave searchMode stuck on the previous mode.
  const [syncedSearchParamString, setSyncedSearchParamString] = useState(searchParamString);
  const [syncedPathname, setSyncedPathname] = useState(pathname);
  const [searchMode, setSearchMode] = useState<AppModeId>(resolvedSearchMode);
  const [pendingModeNavigation, setPendingModeNavigation] = useState<PendingModeNavigation | null>(null);
  const [queryMode, setQueryMode] = useState<ClinicalQueryMode>(
    () => readSearchNavigationContext(searchParams).queryMode,
  );
  const [scopeFilters, setScopeFilters] = useState<SearchScopeFilters>(
    () => readSearchNavigationContext(searchParams).scopeFilters,
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useSidebarCollapsed();
  const [guideOpen, setGuideOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const searchCommandContextValue = useMemo(
    () => ({
      query,
      modeId: searchMode,
    }),
    [query, searchMode],
  );
  const auth = useAuthSession();
  const sidebarIdentity = useMemo(() => deriveSidebarIdentity(auth.session?.user.email), [auth.session?.user.email]);
  const hasSubmittedModeSearch = requestedRun && requestedQuery.length > 0;
  const isDocumentCommandSearchView = pathname === "/documents/search" && requestedQuery.length > 0;
  const useCompactBottomSearch = hasSubmittedModeSearch || isDocumentCommandSearchView;
  const differentialsCompareAddonActive =
    searchMode === "differentials" &&
    // `/differentials` is absent on purpose: it redirects to the shared home, so a
    // branch naming it can never be true and would only read as live ownership.
    (pathname === "/differentials/diagnoses" || pathname === "/differentials/search");
  // The therapy compare tray docks above the phone search pill. The claim is
  // gated on the URL actually carrying a set, not merely on being on a therapy
  // route: the dock reserve inflates on CLAIM, so claiming with an empty tray
  // would open a blank band under a row that renders nothing.
  const therapyCompareAddonActive =
    searchMode === "therapy-compass" &&
    isTherapyPhoneDockRoute(pathname) &&
    pathname !== "/therapy-compass/compare" &&
    readTherapyCompareSlugCount(searchParams) > 0;
  const clinicalAskMode =
    isClinicalAskModeId(searchMode) && clinicalAskAvailableModeIds?.includes(searchMode) ? searchMode : null;
  // No shell-owned route claims the Patient details dock addon. `/medications`
  // is a standalone mode home (composer in the hero, no dock to portal into),
  // and `/medications/[slug]` already opens the same sheet from its own nav
  // header — a dock pill there would be a second entry point to one
  // destination. The pill lives on the dashboard-owned prescribing results
  // view; see ClinicalDashboard.
  // Registry and local decision-support modes own their submitted-search views on their
  // standalone routes; the shell must not swap them to the dashboard. On the
  // home route the dashboard always renders, so these exclusions only apply
  // to the standalone pages.
  const rendersDashboardSearch = shouldRenderDashboardSearch({
    hasSubmittedSearch: hasSubmittedModeSearch,
    mode: resolvedSearchMode,
    pathname,
  });
  // Pathname-only: do not require searchMode === route. changeMode used to set
  // searchMode before router.push landed, which made isStandaloneModeHome false
  // for one frame (dock reserve + 200ms padding transition = choppy resize).
  const isStandaloneModeHome = !hasSubmittedModeSearch && !rendersDashboardSearch && isStandaloneModeHomePath(pathname);
  const isDictionaryCatalogue = isDictionaryCataloguePath(pathname);
  const isDifferentialPresentationWorkflow = pathname.startsWith("/differentials/presentations/");
  const shouldShowDesktopSidebar = !hideDesktopSidebar;
  // Work pages for readers on the new work mode get the work side menu (phone)
  // and the narrow work rail (768 px up) in place of the clinical sidebar
  // (owner pick "Burger and rail", 7 Oct 2026). The rail never widens, so it
  // reads as collapsed for the layout's width.
  const workSideNav = useWorkSideNav(searchMode);
  const workRailShown = useWorkRailShown();
  const workSideArea = workSideNav ? workSideCurrentArea(searchMode, pathname) : null;
  // The counts reader stays mounted once the phone menu has opened on a work
  // page, so reopening the menu never fetches the feed again.
  const [workMenuOpened, setWorkMenuOpened] = useState(false);
  if (workSideNav && mobileMenuOpen && !workMenuOpened) setWorkMenuOpened(true);
  const effectiveSidebarCollapsed = isDifferentialPresentationWorkflow || workSideNav ? true : sidebarCollapsed;
  const effectiveSidebarWidth = shouldShowDesktopSidebar ? (effectiveSidebarCollapsed ? "5.25rem" : "20rem") : "0px";
  const isInfoPage = isInformationPage(pathname);
  // Information pages are read surfaces: the record has already been found, so a
  // composer there is chrome you cannot use without leaving the page. No mode is
  // an exception and no breakpoint is — the phone dock, the tablet/desktop page
  // slot and the reserve all follow this one flag. Services, Forms and
  // Medication record pages used to opt back in through
  // `isToolDetailWithFooterSearch`; that exception is gone. Catalogue result
  // docks (`/services/search`, `/forms/search`) keep their composer because
  // `isSlugDetail` excludes the reserved `search` suffix, not because of any
  // route named here.
  const shouldShowSearchComposer =
    searchComposerVisible && pathname !== "/tools" && !isDifferentialPresentationWorkflow && !isInfoPage;
  // `/tools` owns its catalogue controls rather than a shared composer. Keep
  // the sidebar's cross-guide search usable by returning to Answer first.
  const openSidebarSearch = pathname === "/tools" ? () => startNewAnswerChat() : () => focusComposerInput(inputRef);
  const heroOwnsPhoneComposer = isStandaloneModeHome && mobileHomeComposerPlacement === "hero";
  // This flag controls sm+ padding for standalone mode homes. Tools has no
  // shared composer, so it cannot reserve floating-composer space. Phone
  // clearance is resolved separately from heroOwnsPhoneComposer below.
  // Dictionary catalogue keeps the usual compact phone dock; sm+ still
  // portals into the page-owned slot it renders under its mode nav, so it needs
  // no floating-composer clearance either.
  const reservesFloatingComposer = shouldShowSearchComposer && !isStandaloneModeHome && !isDictionaryCatalogue;
  // Most standalone mode homes keep the in-flow hero pill at every width. Tools
  // deliberately has no shared composer. Document viewer routes own their own
  // floating composer, so
  // the shell keeps only a small pad and lets DocumentViewer manage clearance.
  // Release the large bottom reserve only when the phone bottom composer is
  // actually hidden (MasterSearchHeader's bottomComposerHidden). Header-only
  // scroll-hide, pinned compare addons, open menus/sheets, and composer focus
  // keep the full reserve so content does not slide under a still-visible dock.
  // Safari's bottom safe-area inset includes its translucent browser toolbar.
  // Reusing that inset after the app composer hides recreates a toolbar-sized
  // blank band, so the hidden state intentionally keeps no artificial content
  // pad. Interactive composer chrome still receives the full inset above.
  const mobileComposerReserve = resolveMobileComposerReserve(
    bottomComposerHidden,
    resolveShellVisibleMobileComposerReserve({
      shouldShowSearchComposer,
      pageOwnedComposerRoute: isPageOwnedComposerRoute(pathname),
      heroOwnsPhoneComposer,
      searchMode,
      differentialsCompareAddonActive,
      therapyCompareAddonActive,
    }),
  );

  // Re-derive mode/query from the URL when the search string or pathname changes
  // (a real navigation). Do this during render — not in an effect — so the shared
  // `(search-app)` shell does not paint one frame with a stale searchMode after
  // pathname-only moves like /services → /dsm. React discards this render and
  // immediately re-renders with the updated state (see "adjusting state when a
  // prop changes"). Typing never changes the URL, so a URL-gated sync cannot
  // clobber in-progress input; the initial mount is a no-op because synced*
  // state is seeded from the current URL.
  if (searchParamString !== syncedSearchParamString || pathname !== syncedPathname) {
    setSyncedSearchParamString(searchParamString);
    setSyncedPathname(pathname);
    setSearchMode(resolvedSearchMode);
    setQuery(currentUrlHasQuery ? requestedQuery : "");
    const nextSearchContext = readSearchNavigationContext(new URLSearchParams(searchParamString));
    setQueryMode(nextSearchContext.queryMode);
    setScopeFilters(nextSearchContext.scopeFilters);
  }

  // Imperative mode-menu navigation does not have Link's immediate pending UI:
  // Next keeps the previous RSC page visible while it waits for the destination
  // payload. Replace that stale page with the neutral route skeleton as soon as
  // a mode is chosen, then release it when the destination lands — or when any
  // other committed URL change supersedes the in-flight mode push (Back, New
  // chat, sidebar link, a second mode pick). Destination checks include the
  // query string so same-pathname returns (e.g. `/services?q=&run=1` → `/services`)
  // keep the skeleton until the home URL actually commits; mode is still checked
  // for `/` modes such as Answer, Documents, and Medication.
  if (pendingModeNavigation) {
    const reachedDestination =
      pathname === pendingModeNavigation.pathname &&
      resolvedSearchMode === pendingModeNavigation.mode &&
      searchParamString === pendingModeNavigation.searchParamString;
    const supersededWhilePending =
      pathname !== pendingModeNavigation.sourcePathname ||
      searchParamString !== pendingModeNavigation.sourceSearchParamString;
    if (reachedDestination || supersededWhilePending) {
      setPendingModeNavigation(null);
    }
  }

  useEffect(() => {
    if (!pendingModeNavigation) return undefined;
    // A failed/blocked client navigation must not strand the application behind
    // a permanent loading surface. Normal prefetched mode switches clear this as
    // soon as the URL lands; this is only a conservative recovery path.
    const timeout = window.setTimeout(() => setPendingModeNavigation(null), 10_000);
    return () => window.clearTimeout(timeout);
  }, [pendingModeNavigation]);

  useEffect(() => {
    // Submitted result views must not keep the dock focused. Composer focus
    // pins both chrome edges (keyboard safety), which is what left Forms /
    // services search stuck with a visible header + bottom white rail while
    // scrolling results. Match ClinicalDashboard: focus only the empty/home
    // composer, and blur once a run=1 result view is showing.
    if (hasSubmittedModeSearch) {
      if (document.activeElement === inputRef.current) inputRef.current?.blur();
      return undefined;
    }
    if (!requestedFocus) return undefined;
    const focusInput = () => {
      // The focus=1 hydration retry (rAF + 300ms) can land after a user/test opens
      // the app-mode menu. Re-focusing the composer then blurs the menu wrapper and
      // blur-dismiss closes it before a mode option can be chosen.
      // Guard both: open menu DOM (activeElement is often <body> mid-transition) and
      // any intentional focus already moved off the composer.
      if (document.getElementById("app-mode-menu")) return;
      // Do not reclaim composer focus while a modal Sheet is open (Sources /
      // Guide / filters). The focus=1 hydration retry otherwise races sheet
      // autofocus and can leave the Find field unfocused in UI smoke.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && active !== inputRef.current) {
        return;
      }
      inputRef.current?.focus({ preventScroll: true });
    };
    const frame = window.requestAnimationFrame(focusInput);
    const timeout = window.setTimeout(focusInput, focusHydrationRetryDelayMs);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [pathname, requestedFocus, searchParamString, hasSubmittedModeSearch]);

  // Recent queries are owner-scoped session state (2026-07-13 audit, finding 4):
  // the legacy unscoped localStorage value could resurface another account's
  // clinical queries on a shared workstation, so it is deleted, never read.
  const clientDemoMode = resolveClientDemoMode({
    explicitDemoMode: process.env.NEXT_PUBLIC_DEMO_MODE === "true",
    authUnavailableFallback: !auth.isConfigured,
    localNoAuthMode: isLocalNoAuthMode(),
  });
  const { favouritesAccessible, accountSetupOpen, accountSetupIntent, openAccountSetup, closeAccountSetup } =
    useFavouritesAccess(auth.status === "authenticated", clientDemoMode);
  const recentQueriesOwnerId = auth.session?.user.id ?? (clientDemoMode ? demoRecentQueryOwnerId : null);

  useEffect(() => {
    clearLegacyRecentQueries();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      if (!cancelled) setRecentQueries(loadRecentQueries(recentQueriesOwnerId));
    };
    const frame = window.requestAnimationFrame(reload);
    window.addEventListener(recentQueriesChangeEvent, reload);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener(recentQueriesChangeEvent, reload);
    };
  }, [recentQueriesOwnerId]);

  function prefetchApplications() {
    router.prefetch("/tools");
    if (favouritesAccessible) router.prefetch("/favourites");
    router.prefetch("/differentials");
    router.prefetch("/dsm");
    router.prefetch("/specifiers");
    router.prefetch("/formulation");
    router.prefetch("/factsheets");
  }

  function openGuide() {
    setSettingsOpen(false);
    closeAccountSetup();
    setMobileMenuOpen(false);
    setGuideOpen(true);
  }

  function openSettings() {
    setGuideOpen(false);
    closeAccountSetup();
    setMobileMenuOpen(false);
    setSettingsOpen(true);
  }

  function openAccountProfile() {
    setGuideOpen(false);
    setMobileMenuOpen(false);
    if (sidebarIdentity.signedIn) {
      closeAccountSetup();
      setSettingsOpen(true);
      return;
    }
    setSettingsOpen(false);
    openAccountSetup("default");
  }

  const {
    settingsInitialFocus,
    openGuideFromSettings,
    closeGuideWithRestore,
    openSettingsWithDefaultFocus,
    openAccountProfileWithDefaultFocus,
  } = useSettingsGuideFlow({
    openGuide,
    closeGuide: () => setGuideOpen(false),
    openSettings,
    openAccountProfile,
    setSettingsOpen,
  });

  function navigateToMode(mode: AppModeId, options: SearchNavigationOptions = {}) {
    const nextOptions = { queryMode, scopeFilters, ...options };
    if (mode === "documents" && options.query?.trim()) {
      router.push(documentsSearchHref(nextOptions));
      return;
    }
    router.push(appModeHomeHref(mode, nextOptions));
  }

  function submitSearch(queryOverride?: string) {
    const trimmedQuery = (queryOverride ?? query).trim();
    navigateToMode(searchMode, {
      query: trimmedQuery || undefined,
      run: Boolean(trimmedQuery),
      // Running a search must not carry focus into the result dock — that pin
      // disables hide-on-scroll for both chrome edges.
      focus: !trimmedQuery,
    });
  }

  function changeMode(mode: AppModeId) {
    if (mode === "favourites" && !favouritesAccessible) {
      setGuideOpen(false);
      setSettingsOpen(false);
      setMobileMenuOpen(false);
      openAccountSetup("favourites");
      return;
    }
    setLastAppMode(mode);

    // Dedicated modes return to their dedicated standalone home. Remaining modes
    // return to the shared home. Preserve any current query as an unsubmitted draft,
    // but omit `run=1`; only an explicit submit may open the selected mode's
    // dedicated search/results surface.
    const carriedQuery = query.trim() || requestedQuery.trim();
    const standaloneHome = standaloneModeHomeHref(mode);
    const href =
      standaloneHome ??
      appModeSelectionHref(mode, {
        query: carriedQuery || undefined,
        queryMode,
        scopeFilters,
      });
    const destination = new URL(href, window.location.origin);
    const destinationSearch = destination.search.startsWith("?") ? destination.search.slice(1) : destination.search;
    const alreadyOnDestination = pathname === destination.pathname && searchParamString === destinationSearch;

    setMobileMenuOpen(false);

    if (alreadyOnDestination) {
      // Re-selecting the current mode while a different mode push is in flight
      // must cancel the pending skeleton and re-affirm the current home so the
      // in-flight navigation does not leave the user on the wrong page.
      if (pendingModeNavigation && pendingModeNavigation.mode !== mode) {
        setPendingModeNavigation(null);
        router.push(href);
      }
      return;
    }

    setQuery("");
    // Let the URL sync (render-time) own searchMode. Optimistic setSearchMode
    // before pathname updates was the namespaced mode-switch reserve flip.
    setPendingModeNavigation({
      mode,
      pathname: destination.pathname,
      searchParamString: destinationSearch,
      sourcePathname: pathname,
      sourceSearchParamString: searchParamString,
    });
    router.push(href);
  }

  function startNewAnswerChat(clearClinicalAsk: () => void = () => undefined) {
    clearClinicalAsk();
    setQuery("");
    setMobileMenuOpen(false);
    setQueryMode("auto");
    setScopeFilters({});
    // URL sync sets searchMode after navigation; avoid eager chrome thrash.
    router.push(appModeHomeHref("answer", { focus: true }));
  }

  function pickRecentQuery(recentQuery: string) {
    setMobileMenuOpen(false);
    navigateToMode(searchMode, { query: recentQuery, focus: false, run: true });
  }

  function crossModeSearch(mode: AppModeId, crossQuery: string) {
    if (mode === "favourites" && !favouritesAccessible) {
      setGuideOpen(false);
      setSettingsOpen(false);
      setMobileMenuOpen(false);
      openAccountSetup("favourites");
      return;
    }
    setQuery(crossQuery);
    setMobileMenuOpen(false);
    navigateToMode(mode, { query: crossQuery, focus: false, run: true });
  }

  function handleMainScroll(event: UIEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    chromeScrollHide.reportScroll({
      offset: target.scrollTop,
      maxOffset: Math.max(0, target.scrollHeight - target.clientHeight),
      ...readChromeCollapseMetrics(target),
      source: target,
    });
  }

  const mainRefCallback = (node: HTMLDivElement | null) => {
    setMainElement(node);
  };

  // Page canvases can become nested scrollers when `overflow-x-hidden` pairs with
  // a flex height cap (overflow-y becomes auto per CSS). Capture descendant scroll
  // so the phone dock/header still hide while users scroll results.
  useEffect(() => {
    const main = mainElement;
    if (!main) return undefined;

    const onScrollCapture = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !main.contains(target)) return;
      if (target.scrollHeight <= target.clientHeight + 1) return;
      reportChromeScrollHideRef.current({
        offset: target.scrollTop,
        maxOffset: Math.max(0, target.scrollHeight - target.clientHeight),
        // Collapsing chrome releases layout into nested scrollers too (their
        // flex height cap grows with the shell), so the same budget applies.
        ...readChromeCollapseMetrics(main),
        source: target,
      });
    };

    main.addEventListener("scroll", onScrollCapture, { capture: true, passive: true });
    return () => main.removeEventListener("scroll", onScrollCapture, { capture: true });
  }, [mainElement, chromeVisible]);

  const renderSearchShellChrome = ({ clinicalAskSession, runModeClinicalAsk }: ClinicalAskShellBindings) => {
    const startNewChat = () => startNewAnswerChat(clinicalAskSession.clear);
    const stageClinicalAskDraft = (draft: string) => {
      setQuery(draft);
      focusComposerInput(inputRef);
    };
    const submitSearchFromComposer = (queryOverride?: string) => submitSearch(queryOverride);
    const returnToSearch = () => {
      clinicalAskSession.clear();
      setQuery("");
      const alreadyOnPrivateSearchUrl =
        !searchParams.has("q") && !searchParams.has("query") && searchParams.get("run") !== "1";
      if (!alreadyOnPrivateSearchUrl) router.replace(appModeHomeHref(searchMode, { focus: true }));
      focusComposerInput(inputRef);
    };
    const clinicalAskFailure =
      clinicalAskMode && clinicalAskSession.mode === clinicalAskMode && clinicalAskSession.response?.state === "failed"
        ? clinicalAskSession.response
        : null;
    if (!chromeVisible) {
      return (
        <div className="min-h-dvh bg-[color:var(--background)] text-[color:var(--text)]">
          <div
            id="main-content"
            tabIndex={-1}
            className="min-h-dvh min-w-0 overflow-x-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--focus)]"
          >
            {children}
          </div>
        </div>
      );
    }

    return (
      <div
        className={cn(
          // Browser phones stay in normal flow so Safari sees document scrolling
          // and can minimize its own chrome. Standalone mode is bounded by the
          // shared display-mode contract without returning to a fixed root.
          "phone-viewport-shell sm:min-h-dvh bg-[color:var(--background)] text-[color:var(--text)]",
          shouldShowDesktopSidebar && "md:grid md:grid-cols-[5.25rem_minmax(0,1fr)]",
          // Sidebar collapse snaps by design (#1489) — see the matching note in
          // ClinicalDashboard. Do not re-add the grid-track transition here.
          shouldShowDesktopSidebar &&
            (effectiveSidebarCollapsed ? "lg:grid-cols-[5.25rem_minmax(0,1fr)]" : "lg:grid-cols-[20rem_minmax(0,1fr)]"),
        )}
        style={
          {
            "--clinical-sidebar-width": effectiveSidebarWidth,
            "--clinical-sidebar-width-md": shouldShowDesktopSidebar ? "5.25rem" : "0px",
            "--mobile-composer-reserve": mobileComposerReserve,
          } as CSSProperties
        }
      >
        {shouldShowDesktopSidebar ? (
          <div className="hidden md:block">
            <div className="sticky top-0 flex h-dvh min-h-0">
              {workSideNav ? (
                <WorkRail
                  identity={sidebarIdentity}
                  currentArea={workSideArea}
                  onOpenSettings={openSettingsWithDefaultFocus}
                />
              ) : (
                <ClinicalDesktopSidebar
                  collapsed={effectiveSidebarCollapsed}
                  collapseLocked={isDifferentialPresentationWorkflow}
                  recentQueries={recentQueries}
                  identity={sidebarIdentity}
                  activeMode={searchMode}
                  showAccountLibrary={favouritesAccessible}
                  onCollapsedChange={setSidebarCollapsed}
                  onNewChat={startNewChat}
                  onPickRecent={pickRecentQuery}
                  onOpenSettings={openSettingsWithDefaultFocus}
                  onOpenAccount={openAccountProfileWithDefaultFocus}
                  onPrefetchSettings={loadSettingsDialog}
                  onPrefetchAccount={prefetchAccountDialog}
                  onPrefetchApplications={prefetchApplications}
                  onOpenSearch={openSidebarSearch}
                  onSelectMode={changeMode}
                />
              )}
            </div>
          </div>
        ) : null}

        <PhoneFooterLayerFrame
          className="phone-viewport-frame flex min-w-0 flex-col sm:min-h-dvh"
          scrollHidden={chromeScrollHide.hidden}
        >
          {/*
          `contents` at every visible breakpoint: the chrome wrapper pins itself
          to the viewport top, and a plain block here would be a header-height
          containing block that leaves that sticky rule no travel (the header
          then reports revealed while remaining above the viewport).
        */}
          <div className={mobileChromeVisible ? "contents" : "hidden lg:contents"}>
            <MasterSearchHeader
              demoMode={clientDemoMode}
              documents={[]}
              documentTotal={0}
              query={query}
              searchMode={searchMode}
              loading={pendingModeNavigation !== null}
              selectedDocumentIds={[]}
              queryMode={queryMode}
              scopeFilters={scopeFilters}
              realDataReady
              onQueryChange={setQuery}
              onSearchModeChange={changeMode}
              canAccessFavourites={favouritesAccessible}
              onRequestAccountSetup={() => {
                setGuideOpen(false);
                setSettingsOpen(false);
                setMobileMenuOpen(false);
                openAccountSetup("favourites");
              }}
              onAsk={submitSearchFromComposer}
              onClearQuery={() => {
                setQuery("");
                if (isStandaloneModeHome || searchMode === "calculators") {
                  navigateToMode(searchMode, { focus: true });
                }
              }}
              onClearScope={() => undefined}
              onQueryModeChange={setQueryMode}
              onScopeFiltersChange={setScopeFilters}
              onToggleScope={() => undefined}
              onOpenEvidence={() => navigateToMode("answer", { focus: true })}
              onNewChat={startNewChat}
              showDesktopNewChat={!shouldShowDesktopSidebar}
              onOpenMobileSidebar={() => setMobileMenuOpen(true)}
              queryModeOptions={mockupQueryModeOptions}
              queryInputRef={inputRef}
              recentQueries={recentQueries}
              onPickRecent={pickRecentQuery}
              onCrossModeSearch={crossModeSearch}
              mobileSearchPlacement="bottom"
              mobileHomeComposerPlacement={mobileHomeComposerPlacement}
              // Every phone dock is the compact single-row pill so content keeps
              // maximum screen space (mode homes and result views alike).
              mobileBottomSearchVariant="compact"
              mobileBottomSearchAddonSlotId={
                differentialsCompareAddonActive
                  ? differentialsMobileCompareAddonSlotId
                  : therapyCompareAddonActive
                    ? therapyCompareAddonSlotId
                    : undefined
              }
              mobileBottomSearchAddonKind={
                differentialsCompareAddonActive
                  ? "differentials-compare"
                  : therapyCompareAddonActive
                    ? "therapy-compare"
                    : undefined
              }
              desktopSearchPlacement={desktopSearchPlacement === "hero" && isStandaloneModeHome ? "hero" : "default"}
              showPhoneSuggestionTickerOnHome={isStandaloneModeHome || (pathname === "/" && !hasSubmittedModeSearch)}
              searchComposerVisible={shouldShowSearchComposer}
              desktopHomeComposerSlotId={isStandaloneModeHome ? modeHomeDesktopComposerSlotId : undefined}
              // The dictionary catalogue is a RESULT view, not a mode home, so it
              // takes the page slot like every other results page. It was wired to
              // the home slot back when the two were one slot; once #2639 gated the
              // ticker, Prompts rail and privacy line on `placement === "desktop-home"`,
              // that stale wiring was the only reason a catalogue still carried the
              // hero stack. The slot element itself stays page-owned (rendered by
              // DictionaryCataloguePage under the mode nav), so the shell renders no
              // second element with this id — see the slot render site below.
              desktopPageComposerSlotId={
                shouldShowSearchComposer && !isStandaloneModeHome ? desktopPageComposerSlotId : undefined
              }
              // Most standalone homes keep the in-flow hero pill at every width.
              // Tools suppresses the shared composer at every breakpoint.
              heroComposerBreakpoint={mobileHomeComposerPlacement === "footer" ? "sm-up" : "all"}
              // Phones: #main-content owns vertical scroll, so hide-on-scroll
              // collapses the top bar to hand space back to content.
              // Tablet and desktop portal search into normal page flow. The outer
              // sticky stack therefore owns only the auto-hiding top bar.
              hideOnScroll={{
                strategy: "collapse",
                // Phones always overlay — every route, with no exception. The
                // collapse mechanism is a 1fr -> 0fr grid on the header row plus
                // a height transition on `chrome-safe-area-top`, so every hide
                // handed layout back to the scroller and content slid up under
                // the animation — three animated heights per gesture, which reads
                // as choppy and moves the reader's place on the page. Measured on
                // the last two collapse routes before they were migrated:
                // `/therapy-compass/pathways` moved content 147px and
                // `/differentials/diagnoses/*` 137px per hide, against 0px on
                // every overlay route. Overlay translates the whole stack instead
                // and charges zero released top geometry
                // (`readChromeCollapseMetrics`), so content geometry never
                // changes. `--phone-overlay-chrome-h` reserves the constant
                // clearance beneath it.
                phoneMotion: "overlay",
                wide: "sticky",
                scrollHidden: chromeScrollHide.hidden,
              }}
              onBottomComposerHiddenChange={setBottomComposerHidden}
              queryInputAutoFocus={requestedFocus && !hasSubmittedModeSearch}
            />
          </div>

          <div
            id="main-content"
            ref={mainRefCallback}
            tabIndex={-1}
            onScroll={handleMainScroll}
            data-bottom-composer-hidden={bottomComposerHidden ? "true" : undefined}
            data-reserve-transitioning={reserveTransitioning ? "true" : undefined}
            data-chrome-transitioning={chromeTransitioning ? "true" : undefined}
            data-phone-scroll-owner={activeScrollOwner}
            data-phone-footer-owner={
              heroOwnsPhoneComposer
                ? "hero"
                : isPageOwnedComposerRoute(pathname)
                  ? "page"
                  : shouldShowSearchComposer
                    ? "shell"
                    : "none"
            }
            data-phone-composer-reserve={mobileComposerReserve}
            data-phone-chrome-transition={reserveTransitioning || chromeTransitioning ? "active" : "idle"}
            className={cn(
              // Browser phones use overflow-x: clip so CSS cannot silently turn
              // overflow-y: visible into an element scroller. Standalone mode
              // overrides this semantic surface to the bounded app scrollport.
              // sm+ keeps document ownership for sticky page descendants.
              //
              // `sm:grow`, not a `calc(100dvh - <chrome estimate>)` floor. This
              // element is already a flex child of `.phone-viewport-frame`
              // (`flex flex-col sm:min-h-dvh`), so growing into the frame's free
              // space ends it exactly at the viewport bottom whatever chrome sits
              // above it. A subtracted estimate cannot: `--shell-header-h` (4rem)
              // covers the header's inner bar plus `pb-2` but NOT its own
              // `pt-[max(0.5rem,var(--safe-area-top))]`, so the old floor
              // overshot by 8px on every route — and by 57px on routes that also
              // mount the `header-collapse-addon` nav row, whose height no static
              // token knows. Both left a permanent sliver of scroll on pages with
              // nothing to scroll. Growth is exact and cannot drift again.
              // Default `flex-shrink` is safe here: `min-height: auto` on a flex
              // item stops it compressing below its content, so tall pages still
              // extend the frame and scroll the document as before.
              "phone-scroll-surface min-w-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--focus)] max-sm:flex-1 sm:grow sm:overflow-x-clip",
              // sm+: static desktop clearance; use var(--safe-area-bottom) so tests
              // can simulate insets without depending on env() in Chromium.
              !reservesFloatingComposer
                ? "sm:pb-8"
                : searchMode === "answer"
                  ? "sm:pb-[calc(9rem+var(--safe-area-bottom))]"
                  : useCompactBottomSearch
                    ? "sm:pb-8"
                    : "sm:pb-[calc(9rem+var(--safe-area-bottom))] lg:pb-8",
            )}
          >
            {/*
            Phone dock clearance lives on this inner pad (not #main-content):
            padding on the scrollport itself is omitted from scrollHeight in some
            flex/overflow combinations. The inner block box includes padding in
            its height, so end-of-page content clears the visible dock.

            At sm+ this pad is also the box page shells fill. `min-h-full`
            resolves against #main-content — definite now that it grows into the
            frame — and is border-box, so #main-content's own `sm:pb-8` stays
            outside the 100%. Page shells therefore ask for `sm:grow` instead of
            `calc(100dvh - var(--shell-header-h))`: that estimate knew neither the
            header's top pad, nor the nav row on addon routes, nor this
            scrollport's bottom padding, and over-reserved by 40-273px on a tall
            window — scroll range on pages whose content had already ended.
          */}
            <div
              data-testid="mobile-composer-reserve-pad"
              className="max-sm:pt-[var(--phone-overlay-chrome-h)] max-sm:pb-[var(--mobile-composer-reserve)] sm:flex sm:min-h-full sm:flex-col"
            >
              {/* The dictionary catalogue renders this same slot id itself, under
                  its own mode nav and above the Filter band, so the shell must not
                  emit a second element carrying it — one id, one portal host. */}
              {shouldShowSearchComposer && !isStandaloneModeHome && !isDictionaryCatalogue ? (
                <DesktopComposerPortalSlot
                  id={desktopPageComposerSlotId}
                  data-testid="desktop-page-search-composer-slot"
                  data-composer-reserve={modeHomeComposerReservePendingValue}
                  className="desktop-page-composer-slot hidden sm:block sm:min-h-0 sm:data-[composer-reserve=pending]:min-h-[var(--spacing-mode-home-composer-wide)] sm:[&:not(:empty)]:min-h-[var(--spacing-mode-home-composer-wide)]"
                />
              ) : null}
              {/*
              Shared mode navigation. It self-suppresses on clean mode homes, on
              Therapy Compass, and on every information page — those own their
              in-page navigation through `InPageNavHeader`, which is also why
              this no longer renders an "On this page" section bar of its own.
              Rendered in normal flow so it never contends with the universal
              collapsing header or page-flow search chrome; an adopted mode's bar
              portals itself into the header from there and leaves this wrapper
              empty.
            */}
              {!pendingModeNavigation ? (
                <PageSecondaryNavigation
                  modeId={searchMode}
                  pathname={pathname}
                  hasSubmittedSearch={hasSubmittedModeSearch}
                  searchParamString={searchParamString}
                />
              ) : null}
              {/* Paint RSC mode-home HTML immediately. A ClientHydrationBoundary here
                blanked every standalone mode until JS mounted (hard-load LCP hit). */}
              <SearchCommandProvider value={searchCommandContextValue}>
                {clinicalAskFailure ? (
                  <section className="clinical-ask-workspace" aria-label="Clinical Ask workspace">
                    <ClinicalAskAnswerSurface
                      response={clinicalAskFailure}
                      question={clinicalAskSession.submittedQuestion || clinicalAskSession.draft}
                      onRetry={() =>
                        runModeClinicalAsk(clinicalAskSession.submittedQuestion || clinicalAskSession.draft)
                      }
                      onReturnToSearch={returnToSearch}
                    />
                  </section>
                ) : clinicalAskWorkspaceVisible(clinicalAskSession, clinicalAskMode) ? (
                  <ClinicalAskWorkspace
                    onDraftChange={stageClinicalAskDraft}
                    onRun={runModeClinicalAsk}
                    onReturnToSearch={returnToSearch}
                  />
                ) : pendingModeNavigation ? (
                  <div
                    aria-busy="true"
                    data-testid="mode-navigation-loading"
                    className="sm:flex sm:min-h-0 sm:flex-1 sm:flex-col"
                  >
                    <span className="sr-only">Loading {appModeDefinition(pendingModeNavigation.mode).label}</span>
                    <ModeHomeRouteLoading />
                  </div>
                ) : (
                  children
                )}
              </SearchCommandProvider>
            </div>
          </div>
        </PhoneFooterLayerFrame>

        <LazyGuideDialog open={guideOpen} onClose={closeGuideWithRestore} />
        <SidebarSettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          identity={sidebarIdentity}
          onSignOut={async () => {
            clinicalAskSession.clear();
            await auth.signOut();
          }}
          onOpenGuide={openGuideFromSettings}
          onPrefetchGuide={loadGuideDialog}
          initialFocus={settingsInitialFocus}
        />
        <SidebarAccountSetupDialog open={accountSetupOpen} onClose={closeAccountSetup} intent={accountSetupIntent} />
        <LazyWorkSideCounts active={workSideNav && (workRailShown || workMenuOpened)} />
        {workSideNav ? (
          <LazyWorkSideMenu
            open={mobileMenuOpen}
            onOpenChange={setMobileMenuOpen}
            identity={sidebarIdentity}
            currentArea={workSideArea}
            onOpenSettings={openSettingsWithDefaultFocus}
            onSignOut={async () => {
              clinicalAskSession.clear();
              await auth.signOut();
            }}
            clinical={
              <ClinicalSidebarContent
                showHeader={false}
                recentQueries={recentQueries}
                identity={sidebarIdentity}
                activeMode={searchMode}
                showAccountLibrary={favouritesAccessible}
                onNewChat={startNewChat}
                onPickRecent={pickRecentQuery}
                onOpenSettings={openSettingsWithDefaultFocus}
                onOpenAccount={openAccountProfileWithDefaultFocus}
                onPrefetchSettings={loadSettingsDialog}
                onPrefetchAccount={prefetchAccountDialog}
                onPrefetchApplications={prefetchApplications}
                onOpenSearch={openSidebarSearch}
                onSelectMode={changeMode}
                onNavigate={() => setMobileMenuOpen(false)}
              />
            }
          />
        ) : (
          <ClinicalMobileSidebar
            open={mobileMenuOpen}
            hiddenFrom="md"
            recentQueries={recentQueries}
            identity={sidebarIdentity}
            activeMode={searchMode}
            showAccountLibrary={favouritesAccessible}
            onOpenChange={setMobileMenuOpen}
            onNewChat={startNewChat}
            onPickRecent={pickRecentQuery}
            onOpenSettings={openSettingsWithDefaultFocus}
            onOpenAccount={openAccountProfileWithDefaultFocus}
            onPrefetchSettings={loadSettingsDialog}
            onPrefetchAccount={prefetchAccountDialog}
            onPrefetchApplications={prefetchApplications}
            onOpenSearch={openSidebarSearch}
            onSelectMode={changeMode}
          />
        )}
      </div>
    );
  };

  if (clinicalAskMode) {
    return (
      <ClinicalAskShellBindingsLayer accountId={auth.session?.user.id} clinicalAskMode={clinicalAskMode} query={query}>
        {renderSearchShellChrome}
      </ClinicalAskShellBindingsLayer>
    );
  }

  return renderSearchShellChrome(inactiveClinicalAskShellBindings);
}
