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

const ORGANISER_PAGES: ReadonlySet<string> = new Set(["organise"]);
const ROSTER_TEAM_PAGES: ReadonlySet<string> = new Set(["team", "swaps"]);

export function modePageVisible(
  modeId: AppModeId,
  pageId: string,
  roles: readonly TeachingRole[],
  rosterTeam: boolean | null = rosterHasTeam,
): boolean {
  if (modeId === "teaching" && ORGANISER_PAGES.has(pageId))
    return roles.some((role) => role === "organiser" || role === "admin");
  if (modeId === "roster" && ROSTER_TEAM_PAGES.has(pageId)) return rosterTeam === true;
  return true;
}
