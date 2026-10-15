import { useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { appModeSelectionHref, isAppModeId, isAppModeVisible } from "@/lib/app-modes";
import { dashboardOwnedModeHomeModeId, ownPageModeHomeHref } from "@/lib/search-route-ownership";
import { DEFAULT_APP_MODE } from "@/components/clinical-dashboard/use-last-app-mode";
import { landingModeForPreference, readAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { readSearchNavigationContext } from "@/lib/search-navigation-context";
import type { AppModeId } from "@/lib/app-modes";
import type { SearchScopeFilters } from "@/lib/search-scope";
import type { ClinicalQueryMode } from "@/lib/types";

/**
 * Everything that maps the URL onto the dashboard's mode state, in one place:
 * the `?mode=` sync, the dashboard-owned mode-home pathname sync, and cold-`/`
 * seeding from the remembered mode. They share the same reset and the same
 * ordering constraints, so keeping them apart only made the ordering implicit.
 */
export function useHomeModeSeed({
  pathname,
  searchParams,
  lastAppMode,
  setSearchMode,
  setQuery,
  setQueryMode,
  setScopeFilters,
  setModeSearchSubmitted,
  setLoading,
  setError,
  setAnswerProgress,
  clearModeResultState,
  focusComposerInput,
  stopSearch,
  modeChangeFromUiRef,
  searchModeRef,
  lastSyncedSearchParamsRef,
}: {
  pathname: string | null;
  searchParams: ReadonlyURLSearchParams;
  lastAppMode: AppModeId;
  setSearchMode: (mode: AppModeId) => void;
  setQuery: Dispatch<SetStateAction<string>>;
  setQueryMode: Dispatch<SetStateAction<ClinicalQueryMode>>;
  setScopeFilters: Dispatch<SetStateAction<SearchScopeFilters>>;
  /** Also records the submitted query, so a later composer edit cannot pass for a submission. */
  setModeSearchSubmitted: (submitted: boolean, submittedText?: string) => void;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setAnswerProgress: Dispatch<SetStateAction<string | null>>;
  clearModeResultState: () => void;
  focusComposerInput: (retainTarget?: boolean) => void;
  stopSearch: () => void;
  modeChangeFromUiRef: MutableRefObject<boolean>;
  /** The mode the dashboard currently holds; read, never a dependency. */
  searchModeRef: MutableRefObject<AppModeId>;
  lastSyncedSearchParamsRef: MutableRefObject<string>;
}) {
  const homeModeSeededRef = useRef(false);
  // `stopSearch` is redeclared every render, so it is read through a ref rather
  // than taken as an effect dependency — the arrival reset must not re-fire just
  // because an unrelated render produced a new function identity.
  const stopSearchRef = useRef(stopSearch);
  useEffect(() => {
    stopSearchRef.current = stopSearch;
  });

  useEffect(() => {
    const searchParamString = searchParams.toString();
    if (lastSyncedSearchParamsRef.current === searchParamString) return;
    lastSyncedSearchParamsRef.current = searchParamString;
    const nextSearchContext = readSearchNavigationContext(new URLSearchParams(searchParamString));
    setQueryMode(nextSearchContext.queryMode);
    setScopeFilters(nextSearchContext.scopeFilters);
    // A UI-originated change (mode pill, submit, New chat) raises the flag before
    // it moves the URL, and always moves it to the mode it has just set itself.
    // The flag is one-shot: whichever URL change arrives next consumes it, a
    // `run=1` result URL included. Leaving it raised past a result URL let the
    // *next* change — a sidebar shortcut, Back — be mistaken for a UI change and
    // skipped, with the address bar on one mode and the page on another.
    const changedFromUi = modeChangeFromUiRef.current;
    modeChangeFromUiRef.current = false;
    if (searchParams.get("run") === "1") return;

    const mode = searchParams.get("mode");
    if (!isAppModeId(mode) || !isAppModeVisible(mode)) return;

    // Trust the flag only when the URL names the mode the UI already holds. A
    // mismatch means this change did not come from the UI, however the flag was
    // left, so the URL owns the mode.
    if (changedFromUi && mode === searchModeRef.current) return;

    const nextQuery = (searchParams.get("q") ?? searchParams.get("query") ?? "").trim();
    const shouldFocusComposer = searchParams.get("focus") === "1";
    const hasUrlQuery = searchParams.has("q") || searchParams.has("query");
    const frame = window.requestAnimationFrame(() => {
      if (mode === "differentials") clearModeResultState();
      setSearchMode(mode);
      if (hasUrlQuery) setQuery(nextQuery);
      setModeSearchSubmitted(false);
      setLoading(false);
      setError(null);
      setAnswerProgress(null);
      if (shouldFocusComposer) focusComposerInput(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    searchParams,
    clearModeResultState,
    focusComposerInput,
    lastSyncedSearchParamsRef,
    modeChangeFromUiRef,
    searchModeRef,
    setAnswerProgress,
    setError,
    setLoading,
    setModeSearchSubmitted,
    setQuery,
    setQueryMode,
    setScopeFilters,
    setSearchMode,
  ]);

  /*
   * The same gap on a dashboard-owned mode home. `/documents` names its mode
   * through the pathname rather than `?mode=`, so the `?mode=` sync above returns
   * early on it — and the dashboard stays mounted across a client navigation onto
   * it, unlike `/tools`, `/favourites` and `/medications`, which are always-
   * standalone and remount. Nothing read the pathname, so clicking Documents in
   * the sidebar moved the URL while the header, composer placeholder and
   * highlight stayed on the mode the visitor came from; a full page load looked
   * correct, which is what kept it hidden. Only reachable once `/?mode=<id>`
   * became a real destination.
   *
   * Arriving at a home is a reset, not just a mode flip: without it `/documents`
   * kept the previous mode's composer text, submitted flag and results, so
   * `/documents/search` -> `/documents` and Answer -> `/documents` both rendered
   * stale results where the home belongs (`modeSearchSubmitted` gates the home).
   * That is why the reset runs even when the mode is already correct, and why it
   * aborts in flight work first — the dashboard stays mounted, so a late
   * applySearchResult would otherwise repaint the results this just cleared.
   *
   * Keyed on a real pathname transition rather than on every render: a search
   * submitted from the Documents home changes only the query string, and a reset
   * that fired on that would wipe the results the visitor just asked for. The
   * first run is a mount, where nothing is stale and an answer thread restored
   * from localStorage must survive.
   *
   * Deferred a frame to match the `?mode=` sync and to satisfy the repo's ban on
   * a bare setState in an effect.
   */
  const previousPathnameRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pathname) return;
    const previousPathname = previousPathnameRef.current;
    previousPathnameRef.current = pathname;
    if (previousPathname === null || previousPathname === pathname) return;
    const pathMode = dashboardOwnedModeHomeModeId(pathname);
    if (!pathMode) return;
    if (searchParams.has("mode")) return;
    const frame = window.requestAnimationFrame(() => {
      stopSearchRef.current();
      clearModeResultState();
      setQuery("");
      setModeSearchSubmitted(false);
      setLoading(false);
      setSearchMode(pathMode);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname, searchParams, clearModeResultState, setLoading, setModeSearchSubmitted, setQuery, setSearchMode]);

  /**
   * Seed a cold `/` visit from the remembered mode. `?mode=` always wins — it is
   * the SSR source of truth, so a reloaded or shared link server-renders the right
   * placeholder with no hydration flip. This only fills the gap when the URL says
   * nothing, and does it with replaceState: no history entry, no server round trip,
   * and only the placeholder changes (never composer geometry).
   *
   * Seeds at most once per mount, and never reads `searchMode`. Both matter: in-app
   * actions change the mode on `/` without touching the URL (openDocumentsDrawer
   * does exactly that), so a re-firing effect would rewrite `?mode=` back to the
   * remembered mode and silently undo them.
   *
   * Settings landing view also wins over last-mode: when landing is Documents or
   * Tools the shell navigates to those homes, and seeding `?mode=` here would
   * race that redirect and leave the landing preference ignored.
   */
  useEffect(() => {
    if (pathname !== "/") {
      homeModeSeededRef.current = false;
      return;
    }
    if (homeModeSeededRef.current) return;
    if (searchParams.has("mode") || searchParams.has("q") || searchParams.has("query")) return;
    homeModeSeededRef.current = true;
    if (landingModeForPreference(readAppPreferences().landing)) return;
    if (lastAppMode === DEFAULT_APP_MODE) return;
    // A remembered Work or dashboard mode (CPD, On Call…) has nothing to search,
    // so seeding it here painted an empty search page under that mode's name
    // every time `/` opened cold, from the logo or after an update reload. `/`
    // is the clinical home: leave it on the default mode.
    if (ownPageModeHomeHref(lastAppMode)) return;
    // Carry the rest of the URL through. Seeding only runs when the URL names no
    // mode or query, but `focus=1` and the scope/queryMode context can still be
    // present — rewriting without them silently dropped a requested composer
    // focus and any scoped-search context on a cold `/` visit.
    const navigationContext = readSearchNavigationContext(searchParams);
    window.history.replaceState(
      null,
      "",
      appModeSelectionHref(lastAppMode, {
        focus: searchParams.get("focus") === "1",
        queryMode: navigationContext.queryMode,
        scopeFilters: navigationContext.scopeFilters,
        scopeRef: navigationContext.scopeRef,
      }),
    );
  }, [pathname, searchParams, lastAppMode]);
}
