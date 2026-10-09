import type { AppModeId } from "@/lib/app-modes";

/**
 * Decides whether a submitted shared-composer search belongs to the dashboard
 * or to the route that is already mounted. This is deliberately a pure routing
 * boundary: it does not parse URLs, fetch data, or depend on React state.
 */
const routeOwnedSubmittedSearchModes = new Set<AppModeId>([
  "services",
  "forms",
  "favourites",
  "differentials",
  "dsm",
  "specifiers",
  "formulation",
  "therapy-compass",
  "factsheets",
  "dictionary",
  "sources",
  "tools",
  "calculators",
  "on-call",
  "cme",
  "psychiatry",
  "my-work",
  "roster",
  "first-nations",
  "my-day",
  "medicines",
  "open-shifts",
]);

/**
 * Exact pathnames that own an in-flow hero composer (no phone bottom dock).
 * Derived from the URL alone so an optimistic mode-state update during
 * navigation cannot flip the shell into dock reserve mid-transition.
 */
export const standaloneModeHomePaths = [
  // The four modes that still own a home of their own. Every other mode uses the
  // shared home at `/?mode=<id>`, whose composer the dashboard owns; their bare
  // paths redirect and render nothing to reserve geometry for
  // (`consolidatedModeHomePaths`, plus `/medications` through its own bespoke
  // proxy fast-path).
  //
  // `/medications` and `/sources` were both listed here after they began
  // redirecting, which could never take effect: detection is pathname-only, and
  // no render happens at a path that 307s. `/sources` rendered a four-card home
  // until that home was folded into the shared one; `/medications` has redirected
  // on both branches since its own consolidation, as this file already says below.
  "/favourites",
  "/tools",
  // On Call's dashboard, which replaced its redirect stub. It qualifies on the
  // same test as the two above: its path
  // renders a body. It matters more here than for either of them, because this
  // mode declares no search surface — without it the mode pill would retarget a
  // composer On Call has nowhere to send.
  "/on-call",
  // CME's dashboard, for exactly the reason On Call's is here: its path renders
  // a body, and the mode declares no search surface, so without it the mode pill
  // would retarget a composer CME has nowhere to send.
  "/cme",
  // Psychiatry's dashboard of section links, for the same reason again.
  "/psychiatry",
  // The Medicines & tools dashboard, Psychiatry's twin, for the same reason.
  "/medicines",
  // Admin's Today page, where Admin opens, and Renewals, for the same reason again.
  "/admin",
  "/admin/renewals",
  // Roster's dashboard (Today), for the same reason: it declares no search
  // surface, so without it the mode pill would retarget a composer Roster has
  // nowhere to send.
  "/roster",
  // First Nations' home, for the same reason again: no results surface, so
  // without it the mode pill would retarget a composer this mode never reads.
  "/first-nations",
  // Teaching's dashboard, for the same reason again.
  "/teaching",
  // My Day's merged list, for the same reason again: no results surface.
  "/my-day",
  // Open shifts' Browse list, for Roster's reason: no results surface.
  "/open-shifts",
] as const;

/**
 * Mode homes whose body is rendered by ClinicalDashboard rather than by their own
 * page component. They must mount the dashboard even with nothing submitted, which
 * `pathname === "/"` alone would not cover.
 *
 * Empty now that Documents is consolidated: its bare path redirects to the
 * shared home at `/?mode=documents` (`consolidatedModeHomePaths`) instead of
 * being dashboard-owned in place, so it no longer belongs here. The map and its
 * two accessors below stay — `global-search-shell.tsx` and
 * `use-home-mode-seed.ts` still call them — as intentionally inert until a
 * future mode needs this shape again.
 *
 * `/medications` is intentionally absent: it now redirects (via its own bespoke
 * proxy fast-path, not this map — see `medicationsHomeTarget()` in `src/proxy.ts`)
 * rather than rendering a body at all. Listing it here would never take effect (the
 * shell short-circuits always-standalone paths before the dashboard gate) and would
 * wrongly imply keystroke auto-run should follow the documents-home contract.
 */
const dashboardOwnedModeHomePaths = {} as const satisfies Record<string, AppModeId>;

/**
 * The dedicated home a mode owns, or `null` when it belongs to the shared home.
 *
 * Deliberately limited to the two paths in `standaloneModeHomePaths` above. It is tempting to
 * add `documents` and `prescribing` here, because both have a bare path that looks like a home —
 * but `/documents` 307s to `/?mode=documents` (`consolidatedModeHomePaths`) and `/medications`
 * 307s through its own proxy fast-path, as the comment on `dashboardOwnedModeHomePaths` says.
 * Returning either would send the mode pill on a redirect round trip AND drop the draft query,
 * query mode and scope filters that `appModeSelectionHref` carries, landing the user on the
 * shared home they were already on with their context lost. A mode belongs here only once its
 * path renders a body.
 */
export function standaloneModeHomeHref(mode: AppModeId): string | null {
  switch (mode) {
    case "tools":
      return "/tools";
    case "favourites":
      return "/favourites";
    // The dashboard at `/on-call`. Selecting this mode navigates there rather
    // than pointing the shared home's composer at it: the mode has no results
    // surface to submit into, so a retargeted composer would accept a query and
    // land the reader on a page that ignores it.
    case "on-call":
      return "/on-call";
    // The dashboard at `/cme`, on the same reasoning as On Call above: no
    // results surface, so a retargeted composer would accept a query and land
    // the reader on a page that ignores it.
    case "cme":
      return "/cme";
    // The Psychiatry dashboard at `/psychiatry`, on the same reasoning: it is a
    // page of links to the sections it gathers, with no results surface.
    case "psychiatry":
      return "/psychiatry";
    // The Medicines & tools dashboard, Psychiatry's twin.
    case "medicines":
      return "/medicines";
    // Admin opens on Today, its first tab (work-mode redesign, owner request
    // 6 Oct 2026). It has no search results surface.
    case "my-work":
      return "/admin";
    // The Roster dashboard (Today) at `/roster`, on the same reasoning as On
    // Call above: no results surface, so a retargeted composer would accept a
    // query and land the reader on a page that ignores it.
    case "roster":
      return "/roster";
    // The First Nations dashboard at `/first-nations`, on the same reasoning:
    // no results surface, so a retargeted composer would accept a query and
    // land the reader on a page that ignores it.
    case "first-nations":
      return "/first-nations";
    // The Teaching dashboard at `/teaching`, likewise with no results surface.
    case "teaching":
      return "/teaching";
    // My Day's merged list at `/my-day`, likewise with no results surface.
    case "my-day":
      return "/my-day";
    // Open shifts' Browse list at `/open-shifts`, likewise with no results surface.
    case "open-shifts":
      return "/open-shifts";
    default:
      return null;
  }
}

export function isStandaloneModeHomePath(pathname: string): boolean {
  return standaloneModeHomePaths.includes(pathname as (typeof standaloneModeHomePaths)[number]);
}

/**
 * Dictionary catalogue owns the desktop in-flow composer slot (under mode
 * nav, above the Filter band). Phones keep the usual compact bottom dock.
 * Pathname-only so a submitted `?q=` cannot move the desktop composer into
 * the generic page slot above mode nav.
 *
 * `/dictionary/browse` redirects onto `/dictionary/search`; keep both so the
 * brief pre-redirect frame cannot paint the wrong slot.
 */
export function isDictionaryCataloguePath(pathname: string): boolean {
  return pathname === "/dictionary/search" || pathname === "/dictionary/browse";
}

/** Exact pathnames that mount ClinicalDashboard for an unsubmitted mode home. */
export function isDashboardOwnedModeHomePath(pathname: string): boolean {
  return Object.hasOwn(dashboardOwnedModeHomePaths, pathname);
}

/**
 * The mode a dashboard-owned mode home represents, or null.
 *
 * These homes carry no `?mode=` in the URL — the pathname alone says which mode
 * they are — so the dashboard's `?mode=` sync cannot see them. It stays mounted
 * across a client navigation onto one, which is why the mode has to be read from
 * the pathname or it silently keeps whichever mode the visitor arrived from.
 */
export function dashboardOwnedModeHomeModeId(pathname: string): AppModeId | null {
  return Object.hasOwn(dashboardOwnedModeHomePaths, pathname)
    ? dashboardOwnedModeHomePaths[pathname as keyof typeof dashboardOwnedModeHomePaths]
    : null;
}

/**
 * Pathnames that never mount ClinicalDashboard, regardless of `?mode=` / `?run=`.
 * Used to keep `{children}` out of a `useSearchParams()` Suspense boundary so the
 * route segment is not streamed as a nested incomplete `S:` template inside the
 * shell boundary (duplicate page-root `data-testid`s under CI load).
 */
const alwaysStandaloneShellPathPrefixes = [
  "/services",
  "/forms",
  "/favourites",
  "/differentials",
  "/dsm",
  "/specifiers",
  "/formulation",
  "/factsheets",
  "/dictionary",
  "/sources",
  "/therapy-compass",
  "/medications",
  "/calculators",
  "/tools",
  "/on-call",
  "/cme",
  "/psychiatry",
  "/medicines",
  "/admin",
  "/roster",
  "/first-nations",
  "/teaching",
  "/my-day",
  "/open-shifts",
] as const;

/**
 * Exact paths that never mount ClinicalDashboard, unlike the prefixes above.
 *
 * `/documents` is the only entry. Every other mode in this list is consolidated
 * across its whole namespace, so a prefix match is correct for it. Documents is
 * different: only its bare path is consolidated (redirects to `/?mode=documents`)
 * — `/documents/search` and `/documents/[id]` stay dashboard-owned and must keep
 * rendering ClinicalDashboard in place. Adding `/documents` to the prefix list
 * above would also match `/documents/search`, silently breaking document search
 * results (covered by an `@critical`-tagged Playwright test), so it gets its own
 * exact-match list instead.
 */
const alwaysStandaloneShellExactPaths = ["/documents"] as const;

export function isAlwaysStandaloneShellPath(pathname: string): boolean {
  return (
    alwaysStandaloneShellExactPaths.includes(pathname as (typeof alwaysStandaloneShellExactPaths)[number]) ||
    alwaysStandaloneShellPathPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  );
}

/** Dashboard-owned hrefs stay on `/` with `?mode=`, or the submitted documents search route. */
export function isDashboardModeHref(href: string): boolean {
  if (href === "/" || href.startsWith("/?")) return true;
  // Submitted document searches still render ClinicalDashboard; treat them as
  // in-shell so cross-mode navigation can sync searchMode/query before push.
  const path = href.split(/[?#]/, 1)[0] ?? href;
  return path === "/documents/search";
}

export function shouldRenderDashboardSearch({
  hasSubmittedSearch,
  mode,
  pathname,
}: {
  hasSubmittedSearch: boolean;
  mode: AppModeId;
  pathname: string;
}) {
  return (
    hasSubmittedSearch && !routeOwnedSubmittedSearchModes.has(mode) && !pathname.startsWith("/mockups/document-search")
  );
}

export function shouldRenderClinicalDashboard({
  hasSubmittedSearch,
  mode,
  pathname,
}: {
  hasSubmittedSearch: boolean;
  mode: AppModeId;
  pathname: string;
}) {
  const isMedicationDetailRoute = /^\/medications\/[^/]+$/.test(pathname);
  return (
    !isMedicationDetailRoute &&
    (pathname === "/" ||
      isDashboardOwnedModeHomePath(pathname) ||
      shouldRenderDashboardSearch({ hasSubmittedSearch, mode, pathname }))
  );
}
