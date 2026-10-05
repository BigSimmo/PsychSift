import { useSyncExternalStore } from "react";

import type { AppModeId } from "@/lib/app-modes";
import type { TeachingRole } from "@/lib/teaching/model";

/*
 * The reader's Teaching roles, in memory for this tab only, so the pages sheet
 * can hide Organise from anyone who organises nowhere. A convenience, not a
 * control: the server refuses organiser actions whatever this says. Empty on
 * the server and until a Teaching read lands, so Organise appears only once a
 * role says it should.
 *
 * Roster uses the same in-tab store for "has an enabled team": Team and Swaps
 * stay hidden until a roster team read confirms membership. Direct URLs still
 * open and show their empty states.
 */
const EMPTY: readonly TeachingRole[] = [];
let current: readonly TeachingRole[] = EMPTY;
const listeners = new Set<() => void>();

export function setTeachingRoles(roles: readonly TeachingRole[]): void {
  const next = [...new Set(roles)].sort();
  if (next.join() === current.join()) return;
  current = next.length === 0 ? EMPTY : next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTeachingRoles(): readonly TeachingRole[] {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => EMPTY,
  );
}

/** null = not yet known (hide Team/Swaps); true once an enabled team is confirmed. */
let rosterHasTeam: boolean | null = null;
const rosterListeners = new Set<() => void>();

export function setRosterHasEnabledTeam(hasTeam: boolean): void {
  if (rosterHasTeam === hasTeam) return;
  rosterHasTeam = hasTeam;
  for (const listener of rosterListeners) listener();
}

function subscribeRoster(listener: () => void) {
  rosterListeners.add(listener);
  return () => {
    rosterListeners.delete(listener);
  };
}

export function useRosterHasEnabledTeam(): boolean | null {
  return useSyncExternalStore(
    subscribeRoster,
    () => rosterHasTeam,
    () => null,
  );
}

/**
 * Open shifts uses the same in-tab store for "may post": Post stays hidden
 * until an Open shifts read confirms the reader manages a Roster team. A
 * convenience, not a control: the server refuses posting whatever this says,
 * and the direct URL still opens and shows its own empty state.
 *
 * null = not yet known (hide Post); true once poster rights are confirmed.
 */
let openShiftsIsPoster: boolean | null = null;
const openShiftsListeners = new Set<() => void>();

export function setOpenShiftsIsPoster(isPoster: boolean): void {
  if (openShiftsIsPoster === isPoster) return;
  openShiftsIsPoster = isPoster;
  for (const listener of openShiftsListeners) listener();
  // The page lists (mode band tabs, top-bar page sheet) recompute only when
  // the Teaching roles snapshot changes identity, and read the poster flag
  // through `modePageVisible`'s default argument. Re-issue that snapshot with
  // a new identity (same roles) so those lists pick the change up at once.
  current = current.length === 0 ? [] : [...current];
  for (const listener of listeners) listener();
}

function subscribeOpenShifts(listener: () => void) {
  openShiftsListeners.add(listener);
  return () => {
    openShiftsListeners.delete(listener);
  };
}

export function useOpenShiftsIsPoster(): boolean | null {
  return useSyncExternalStore(
    subscribeOpenShifts,
    () => openShiftsIsPoster,
    () => null,
  );
}

const ORGANISER_PAGES: ReadonlySet<string> = new Set(["organise"]);
const OPEN_SHIFTS_POSTER_PAGES: ReadonlySet<string> = new Set(["open-shifts-post"]);
const ROSTER_TEAM_PAGES: ReadonlySet<string> = new Set(["team", "swaps"]);

export function modePageVisible(
  modeId: AppModeId,
  pageId: string,
  roles: readonly TeachingRole[],
  rosterTeam: boolean | null = rosterHasTeam,
  openShiftsPoster: boolean | null = openShiftsIsPoster,
): boolean {
  if (modeId === "teaching" && ORGANISER_PAGES.has(pageId))
    return roles.some((role) => role === "organiser" || role === "admin");
  if (modeId === "roster" && ROSTER_TEAM_PAGES.has(pageId)) return rosterTeam === true;
  if (modeId === "open-shifts" && OPEN_SHIFTS_POSTER_PAGES.has(pageId)) return openShiftsPoster === true;
  return true;
}
