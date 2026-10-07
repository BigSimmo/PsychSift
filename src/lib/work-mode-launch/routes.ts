/**
 * Which work-mode routes the launch switch hides (see `launch.ts`).
 *
 * `NEW_WORK_MODE_ROUTES` are screens that exist only in the new work mode. A
 * reader on the classic work mode gets the ordinary 404 for them, so nothing
 * links into a half-launched screen. Sample and example data is not decided
 * here: that is the example-data switch's job.
 *
 * An entry matches its path and everything below it, on whole segments
 * (`/admin/pay` matches `/admin/pay/2026` but not `/admin/payslip`). An entry with
 * `query` also needs every listed search parameter to carry that value.
 *
 * Adding a new-only screen means adding it here. The proxy enforces the
 * list on every request, so a route cannot forget to call a gate.
 */

export type WorkModeRouteEntry = {
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  /** Who owns the screen, for the next person reading the list. */
  readonly owner: string;
};

export const NEW_WORK_MODE_ROUTES: readonly WorkModeRouteEntry[] = [
  // Junior doctor features (round 2).
  { path: "/admin/contract", owner: "junior-features" },
  { path: "/admin/leave", owner: "junior-features" },
  { path: "/admin/new-job/starter", owner: "junior-features" },
  { path: "/admin/new-job/ready", owner: "junior-features" },
  { path: "/roster/sick", owner: "junior-features" },
  { path: "/roster/staffing", owner: "junior-features" },
  { path: "/on-call/first-week", owner: "junior-features" },
  { path: "/on-call/whos-on/roster", owner: "junior-features" },
  { path: "/cme/cpd-home", owner: "junior-features" },
  { path: "/cme/applications", owner: "junior-features" },
  { path: "/my-day/profile/agreement", owner: "junior-features" },
  { path: "/teaching/term/folder", owner: "junior-features" },
  { path: "/teaching/assessments", query: { view: "inbox" }, owner: "junior-features" },
  { path: "/teaching/assessments", query: { view: "overview" }, owner: "junior-features" },
  // Missing screens (wiring).
  { path: "/my-day/alerts/earlier", owner: "wiring" },
  { path: "/cme/evidence", owner: "wiring" },
  { path: "/cme/export", owner: "wiring" },
  { path: "/teaching/assessments/record", owner: "wiring" },
  { path: "/teaching/assessments/help", owner: "wiring" },
  { path: "/teaching/assessments/export", owner: "wiring" },
  { path: "/admin/requests", owner: "wiring" },
  { path: "/admin/sharing", owner: "wiring" },
  { path: "/admin/documents", owner: "wiring" },
  { path: "/admin/pay", owner: "wiring" },
  { path: "/admin/tax", owner: "wiring" },
  // Favourites.
  { path: "/my-day/favourites", owner: "favourites" },
  // Setup walkthrough and help centre.
  { path: "/my-day/setup", owner: "walkthrough-help" },
  { path: "/my-day/help", owner: "walkthrough-help" },
];

function pathMatches(pathname: string, entryPath: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return path === entryPath || path.startsWith(`${entryPath}/`);
}

function queryMatches(search: URLSearchParams, query: WorkModeRouteEntry["query"]): boolean {
  if (!query) return true;
  return Object.entries(query).every(([key, value]) => search.get(key) === value);
}

export function matchesWorkModeRoute(
  entries: readonly WorkModeRouteEntry[],
  pathname: string,
  search: URLSearchParams = new URLSearchParams(),
): boolean {
  return entries.some((entry) => pathMatches(pathname, entry.path) && queryMatches(search, entry.query));
}

/**
 * Whether this reader must not reach this URL. `href` may carry a query string.
 * Used by the proxy (as a 404) and by the frame and pages to hide links.
 */
export function workModeRouteHidden(href: string, launch: { readonly newWorkMode: boolean }): boolean {
  const queryStart = href.indexOf("?");
  const pathname = (queryStart === -1 ? href : href.slice(0, queryStart)).split("#")[0] ?? href;
  const search = new URLSearchParams(queryStart === -1 ? "" : href.slice(queryStart + 1).split("#")[0]);
  return !launch.newWorkMode && matchesWorkModeRoute(NEW_WORK_MODE_ROUTES, pathname, search);
}
