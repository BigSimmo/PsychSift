import type { AppModeId } from "@/lib/app-modes";

/**
 * Each staff work mode's home page (and On Call Who's on, which shares that
 * home chrome). Until 7 Oct 2026 these were the only pages with the header
 * bell; the bell now shows on every staff work page (see
 * `staffWorkBellVisible`). Kept for anything that needs to know it is on a
 * mode home.
 *
 * First Nations, Psychiatry, Medicines, clinical search, and signed-out chrome
 * are not in this list.
 */
const STAFF_WORK_HOME_PATHS: Partial<Record<AppModeId, readonly string[]>> = {
  "my-day": ["/my-day"],
  roster: ["/roster"],
  // Admin's home is Today at /admin (work-mode redesign, owner request 6 Oct
  // 2026). Renewals, the old home, still counts as one.
  "my-work": ["/admin", "/admin/renewals"],
  teaching: ["/teaching"],
  cme: ["/cme"],
  "on-call": ["/on-call", "/on-call/whos-on"],
};

function normalisedPath(pathname: string): string {
  const path = pathname.split("?")[0] ?? pathname;
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path || "/";
}

/** True on the mode home (and On Call Who's on, which shares that home chrome). Not the bell's rule any more. */
export function isStaffWorkHomePath(modeId: AppModeId, pathname: string | null | undefined): boolean {
  const homes = STAFF_WORK_HOME_PATHS[modeId];
  if (!homes || !pathname) return false;
  return homes.includes(normalisedPath(pathname));
}

/**
 * The staff work modes whose pages carry the header bell: the same seven that
 * show AI Search, so the bell always sits just left of it. Clinical modes,
 * First Nations, Psychiatry, Medicines, and clinical search are not here.
 */
const STAFF_WORK_BELL_MODES: ReadonlySet<AppModeId> = new Set<AppModeId>([
  "my-day",
  "roster",
  "open-shifts",
  "my-work",
  "teaching",
  "cme",
  "on-call",
]);

/**
 * Pages inside a staff work mode that draw their own top bar, so the header
 * bell never shows there: the setup walkthrough and the help centre. Each
 * entry matches itself and everything below it.
 */
const STAFF_WORK_BELL_EXCLUDED_PATHS: readonly string[] = ["/my-day/setup", "/my-day/help"];

/** The Notifications page (new work mode). The bell there is shown as the current page. */
const NOTIFICATIONS_PATH = "/my-day/notifications";

function withinPath(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/**
 * Whether the header bell shows on this page (Josh, 7 Oct 2026): every page of
 * the staff work modes, just left of AI Search, except the setup walkthrough
 * and the help centre. Never on clinical modes, First Nations, Psychiatry,
 * Medicines, or clinical search. Sign-in is checked separately
 * (`needsYouBellVisibleForAuth`).
 */
export function staffWorkBellVisible(modeId: AppModeId, pathname: string | null | undefined): boolean {
  if (!STAFF_WORK_BELL_MODES.has(modeId) || !pathname) return false;
  const path = normalisedPath(pathname);
  return !STAFF_WORK_BELL_EXCLUDED_PATHS.some((root) => withinPath(path, root));
}

/** True on the Notifications page or anything below it. */
export function isNotificationsPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return withinPath(normalisedPath(pathname), NOTIFICATIONS_PATH);
}

/** The bell reads only for a signed-in member, or a local demo with no hosted auth. */
export function needsYouBellVisibleForAuth(status: string): boolean {
  return status === "authenticated" || status === "unconfigured";
}
