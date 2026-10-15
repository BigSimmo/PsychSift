import { isAppModeId } from "@/lib/app-modes";
import { ownPageModeHomeHref } from "@/lib/search-route-ownership";

const legacyModePaths = {
  favourites: "/favourites",
  differentials: "/differentials",
  specifiers: "/specifiers",
  dsm: "/dsm/search",
  formulation: "/formulation/search",
} as const;

/**
 * Modes whose `/?mode=…` alias redirects unconditionally, submitted or not.
 *
 * Tools is the only one, and it differs from the map above because it has no shared
 * home to fall back to: `shouldShowSharedHome` excludes `tools` outright, so
 * `/?mode=tools` used to render a second, hub-shaped launcher instead. That gave Tools
 * two different surfaces depending on how a clinician arrived — the mode pill served
 * the hub, every other link served the canonical directory at `/tools`. The hub's one
 * unique feature, its verb shortcut row, moved to `/tools`
 * (`components/tools/tool-quick-actions.tsx`), so this alias now has nothing of its own
 * left to show and forwards.
 *
 * Unconditional on purpose: unlike the submitted-only map above, there is no state in
 * which rendering `/` for `mode=tools` is correct.
 */
const aliasOnlyModePaths = {
  tools: "/tools",
} as const;

/** Parameters only the shared search home reads, dropped when a mode forwards to its own page. */
const searchHomeOnlyParams = ["mode", "q", "run", "focus"] as const;

type LegacyHomeRequestUrl = Pick<URL, "pathname" | "searchParams" | "toString">;

/**
 * Early proxy redirect for a few modes that used to live only as `/?mode=…`
 * aliases. `/` is now the shared home for every mode, so bare `/?mode=…` must
 * stay on `/` with that mode preselected. Only a *submitted* deep link
 * (`q` plus `run=1`) still hops to the mode's own search surface — matching
 * `src/app/(search-app)/page.tsx`.
 */
export function legacyHomeRedirectUrl(requestUrl: LegacyHomeRequestUrl, method: string) {
  if ((method !== "GET" && method !== "HEAD") || requestUrl.pathname !== "/") return null;

  const mode = requestUrl.searchParams.get("mode");

  const aliasOnlyPath = mode ? aliasOnlyModePaths[mode as keyof typeof aliasOnlyModePaths] : undefined;
  if (aliasOnlyPath) {
    const aliasDestination = new URL(requestUrl.toString());
    aliasDestination.pathname = aliasOnlyPath;
    aliasDestination.hash = "";
    // `mode` is consumed by the destination pathname; everything else (a query, a
    // submitted `run=1`, navigation context) rides along, because `/tools` reads the
    // same query string the alias carried.
    aliasDestination.searchParams.delete("mode");
    return aliasDestination;
  }

  // A mode with nothing to search has no shared home: `/?mode=cme` showed an
  // empty CPD search box whose query went nowhere. Send it to the mode's own
  // page. `mode` is consumed by the pathname and the search-home parameters
  // have nowhere to go, but the page's own state (a CPD `year`, a Roster or
  // My Day `view`, a Psychiatry `page`) rides along.
  const ownPage = isAppModeId(mode) ? ownPageModeHomeHref(mode) : null;
  if (ownPage) {
    const ownPageDestination = new URL(requestUrl.toString());
    ownPageDestination.pathname = ownPage;
    for (const consumed of searchHomeOnlyParams) ownPageDestination.searchParams.delete(consumed);
    ownPageDestination.hash = "";
    return ownPageDestination;
  }

  const destinationPath = mode ? legacyModePaths[mode as keyof typeof legacyModePaths] : undefined;
  if (!destinationPath) return null;

  const query = requestUrl.searchParams.get("q")?.trim();
  const run = requestUrl.searchParams.get("run") === "1";
  // Shared-home contract: selection-only URLs render `/`. Submitted results
  // still resolve to the standalone mode surface.
  if (!query || !run) return null;

  const destination = new URL(requestUrl.toString());
  destination.pathname = destinationPath;
  destination.hash = "";

  // Carry the incoming query string rather than rebuilding it. Rebuilding kept only
  // q/focus/run, so `queryMode`, `scope.*` and `scopeRef` were already gone by the time
  // `consolidatedModeHomeTarget` ran for differentials/specifiers — the redirect whose own
  // contract is that "every other query parameter rides along untouched". The visitor got
  // unscoped, auto-mode results for a link that was scoped, with nothing to indicate the
  // narrower context had been dropped (2026-09-02 audit, L9).
  //
  // `mode` is the one parameter that must not travel: it is consumed by the destination
  // pathname, and forwarding it would let this URL arrive at the next redirect naming a
  // different mode than the path it was sent to.
  destination.searchParams.delete("mode");
  // Normalised, so the destination is identical for every spelling of the same link: the
  // trimmed query, a single `run=1` however many the caller sent, and `focus` as a flag
  // whose only truthy spelling is "1".
  destination.searchParams.set("q", query);
  if (requestUrl.searchParams.get("focus") === "1") destination.searchParams.set("focus", "1");
  else destination.searchParams.delete("focus");
  destination.searchParams.set("run", "1");

  return destination;
}
