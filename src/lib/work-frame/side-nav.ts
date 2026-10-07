import type { AppModeId } from "@/lib/app-modes";
import { WORK_AREAS, workAreaIdForPath, type WorkAreaId } from "@/lib/work-frame/areas";

/**
 * The work side menu and tablet rail (owner pick "Burger and rail", 7 Oct
 * 2026). On a phone the header's menu button opens a work side menu; from
 * 768 px a narrow rail sits down the left edge instead. Both list the same
 * seven work areas, in the order the mockup draws them, each with the number
 * of things waiting there. Classic readers keep the clinical sidebar.
 *
 * Open shifts is an inner area of Roster inside a page, but it is its own mode
 * in the mode picker, so it keeps its own row here too. Manage team and
 * Assessments are not modes, so they light their parent's row and add to its
 * count.
 */

export type WorkSideArea = {
  /** The area the row opens and is tinted for. */
  readonly id: WorkAreaId;
  /** The mode the row switches to, for its icon and the mode switch. */
  readonly modeId: AppModeId;
  readonly label: string;
  /** The rail is 84 px wide, so long names get a shorter label there. */
  readonly short: string;
  /** The area's first tab, where the row goes when no page of it was open before. */
  readonly href: string;
};

function entry(id: WorkAreaId, modeId: AppModeId, label: string, short = label): WorkSideArea {
  return { id, modeId, label, short, href: WORK_AREAS[id].tabs[0].href ?? "/my-day" };
}

export const WORK_SIDE_AREAS: readonly WorkSideArea[] = [
  entry("day", "my-day", "My Day"),
  entry("call", "on-call", "On Call"),
  entry("open", "open-shifts", "Open shifts", "Shifts"),
  entry("rost", "roster", "Roster"),
  entry("teach", "teaching", "Teaching"),
  entry("cpd", "cme", "CPD"),
  entry("admin", "my-work", "Admin"),
];

/** The row an area lights: an inner area that is not a mode lights its parent's row. */
export function workSideAreaId(areaId: WorkAreaId): WorkAreaId {
  if (WORK_SIDE_AREAS.some((entry) => entry.id === areaId)) return areaId;
  return WORK_AREAS[areaId].parent ?? areaId;
}

export type WorkSideCount = { readonly total: number; readonly overdue: number };

/** The minimal item shape the counts need, so this file does not depend on the feed. */
export type WorkSideCountItem = { readonly href: string; readonly overdue: boolean };

/**
 * Things waiting in each row's area. Every item counts once, under the area
 * whose page it opens, so the rows add up to the bell's total less anything
 * that opens a page outside the work areas (the notifications page itself).
 * Areas with nothing waiting are left out.
 */
export function workSideCounts(items: readonly WorkSideCountItem[]): Partial<Record<WorkAreaId, WorkSideCount>> {
  const counts: Partial<Record<WorkAreaId, { total: number; overdue: number }>> = {};
  for (const item of items) {
    const path = item.href.split(/[?#]/)[0] ?? item.href;
    if (path === "/my-day/alerts" || path.startsWith("/my-day/alerts/")) continue;
    const areaId = workAreaIdForPath(path);
    if (!areaId) continue;
    const row = workSideAreaId(areaId);
    const count = (counts[row] ??= { total: 0, overdue: 0 });
    count.total += 1;
    if (item.overdue) count.overdue += 1;
  }
  return counts;
}

/** The count as the row says it aloud: "3 waiting, 1 overdue". */
export function workSideCountLabel(count: WorkSideCount | undefined): string {
  if (!count || count.total === 0) return "";
  return count.overdue > 0 ? `${count.total} waiting, ${count.overdue} overdue` : `${count.total} waiting`;
}

/** What a badge shows: the number, capped so it fits the rail's pill. */
export function workSideBadgeText(total: number): string {
  return total > 99 ? "99+" : String(total);
}
