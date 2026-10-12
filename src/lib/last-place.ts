/**
 * "Open where the doctor is" (site recommendations, 12 Oct 2026, item 1).
 *
 * The app remembers the last Work or Clinical page the doctor used, on this
 * device only, as a bare path: never the query string (which can carry search
 * text) and never the hash. A cold open of `/` then lands there instead of on
 * Clinical Answer, or on My Day while a rostered shift is running.
 *
 * Everything here is pure so the rules can be pinned by unit tests; the client
 * component in `src/components/last-place/` only feeds it browser facts.
 */

/** localStorage key holding the last page path. Device only; never synced. */
export const LAST_PLACE_STORAGE_KEY = "clinical-kb-last-place";

/** Where a running shift sends a cold open. */
export const ON_SHIFT_LANDING_PATH = "/my-day";

const MAX_PATH_LENGTH = 160;

/** Plain path segments only: letters, digits and the usual URL-safe marks. */
const SAFE_PATH = /^(?:\/[A-Za-z0-9._~-]+)+$/;

/**
 * Pages that make a poor first screen: a form part-way through, a results page
 * that needs its query (which is never stored), set-up flows, and the patient
 * safety plan, which belongs to one conversation rather than to "where I was".
 */
const SKIPPED_LAST_SEGMENTS = new Set(["new", "edit", "search", "setup"]);
const SKIPPED_PREFIXES = ["/safety-plan", "/mockups", "/api", "/auth"];

/**
 * The path to remember for a page, or null when the page should not replace
 * the remembered one. `/` (the Clinical home) is remembered as `/`: the mode
 * itself is already kept by `use-last-app-mode`.
 */
export function lastPlaceToRemember(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  if (pathname === "/") return "/";
  if (pathname.length > MAX_PATH_LENGTH || !SAFE_PATH.test(pathname)) return null;
  if (SKIPPED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return null;
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  if (SKIPPED_LAST_SEGMENTS.has(last)) return null;
  return pathname;
}

/** A stored value, checked again on the way out: storage outlives code changes. */
export function readLastPlace(stored: string | null | undefined): string | null {
  return lastPlaceToRemember(stored ?? null);
}

export type ColdLandingFacts = {
  /** The address the document was first loaded at (not the current one). */
  readonly entry: { readonly pathname: string; readonly search: string; readonly hash: string };
  /** PerformanceNavigationTiming.type for this document ("navigate", "reload", "back_forward", ...). */
  readonly navigationType: string | null;
  /** The page was opened from another page of this app (a link, or in-app history). */
  readonly cameFromApp: boolean;
  /** Settings "Default landing view" is set: that explicit choice wins. */
  readonly landingPreferenceSet: boolean;
};

/**
 * Whether this load of `/` is a cold open that may be sent elsewhere. Any query
 * (`?mode=`, `?q=`, `?focus=`), any hash, a reload, Back/Forward, or arriving
 * from inside the app keeps today's behaviour exactly.
 */
export function isColdHomeOpen(facts: ColdLandingFacts): boolean {
  if (facts.entry.pathname !== "/") return false;
  if (facts.entry.search !== "" && facts.entry.search !== "?") return false;
  if (facts.entry.hash !== "" && facts.entry.hash !== "#") return false;
  if (facts.navigationType !== null && facts.navigationType !== "navigate") return false;
  if (facts.cameFromApp) return false;
  if (facts.landingPreferenceSet) return false;
  return true;
}

/**
 * Where a cold open of `/` goes, or null to stay on `/` (Clinical, with the
 * remembered Clinical mode seeded as it is today).
 *
 * A running shift wins, then the last page. `routeVisible` filters out a Work
 * page this reader cannot open (the classic work mode hides new-only screens).
 */
export function coldLandingTarget({
  onShiftNow,
  lastPlace,
  routeVisible,
}: {
  readonly onShiftNow: boolean;
  readonly lastPlace: string | null;
  readonly routeVisible: (href: string) => boolean;
}): string | null {
  if (onShiftNow && routeVisible(ON_SHIFT_LANDING_PATH)) return ON_SHIFT_LANDING_PATH;
  if (!lastPlace || lastPlace === "/") return null;
  return routeVisible(lastPlace) ? lastPlace : null;
}
