import type { AppModeId } from "@/lib/app-modes";

/**
 * Staff work homes that show the header bell. Inner section pages of the same
 * mode keep Search my work and do not get a second round control.
 *
 * First Nations, Psychiatry, Medicines, clinical search, and signed-out chrome
 * are not in this list.
 */
const STAFF_WORK_HOME_PATHS: Partial<Record<AppModeId, readonly string[]>> = {
  "my-day": ["/my-day"],
  roster: ["/roster"],
  "my-work": ["/admin/renewals"],
  teaching: ["/teaching"],
  cme: ["/cme"],
  "on-call": ["/on-call", "/on-call/whos-on"],
};

function normalisedPath(pathname: string): string {
  const path = pathname.split("?")[0] ?? pathname;
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path || "/";
}

/** True on the mode home (and On Call Who's on, which shares that home chrome). */
export function isStaffWorkHomePath(modeId: AppModeId, pathname: string | null | undefined): boolean {
  const homes = STAFF_WORK_HOME_PATHS[modeId];
  if (!homes || !pathname) return false;
  return homes.includes(normalisedPath(pathname));
}

/** The bell reads only for a signed-in member, or a local demo with no hosted auth. */
export function needsYouBellVisibleForAuth(status: string): boolean {
  return status === "authenticated" || status === "unconfigured";
}
