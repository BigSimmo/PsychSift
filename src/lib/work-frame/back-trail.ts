import type { WorkAreaId } from "@/lib/work-frame/areas";

/**
 * Where an inner area's back arrow goes (work mode improvements, 8 Oct 2026).
 *
 * Notifications, Open shifts, Manage team and Assessments sit inside a parent
 * area, and their back arrow used to go to that parent whatever the reader had
 * come from: the bell tapped on Roster still went back to My Day. Now an inner
 * area remembers the work page it was opened from and goes back there, named
 * ("Back to Roster"). Opened fresh (a typed address, a reload), it has no such
 * page and falls back to its parent as before.
 *
 * Memory only for this tab, like the parent's last page: nothing is stored on
 * the device or sent anywhere, and it holds only area ids and page addresses.
 */

/** One work page shown: its area and its page address (null when the page is not one of the area's own). */
export interface WorkVisit {
  readonly areaId: WorkAreaId;
  readonly href: string | null;
}

export interface WorkTrail {
  /** The work page shown last. */
  readonly last: WorkVisit | null;
  /** For each inner area, the work page it was opened from. */
  readonly origins: Readonly<Partial<Record<WorkAreaId, WorkVisit>>>;
}

export const EMPTY_WORK_TRAIL: WorkTrail = { last: null, origins: {} };

/**
 * The trail after one more work page is shown.
 *
 * Entering an inner area from another area's page makes that page its way
 * back. Moving between the inner area's own pages keeps it. Coming back into
 * an inner area (the phone's Back, or a back arrow from a page it opened) also
 * keeps the one it had rather than taking the page just left, so two inner
 * areas never send the reader back and forth between each other.
 */
export function visitWorkPage(
  trail: WorkTrail,
  visit: WorkVisit,
  { inner, returning }: { readonly inner: boolean; readonly returning: boolean },
): WorkTrail {
  const previous = trail.last;
  const moved: WorkTrail = { last: visit, origins: trail.origins };
  if (!inner || returning || previous === null || previous.areaId === visit.areaId) return moved;
  return { last: visit, origins: { ...trail.origins, [visit.areaId]: previous } };
}
