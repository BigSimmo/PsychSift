"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import type { AppModeId } from "@/lib/app-modes";
import type { WorkAreaId, WorkFrameActionId } from "@/lib/work-frame/areas";
import { EMPTY_WORK_TRAIL, visitWorkPage, type WorkTrail, type WorkVisit } from "@/lib/work-frame/back-trail";

/**
 * The little shared state of the work-mode frame, kept in memory for this tab.
 *
 * The top bar sits above every page's layout, so it cannot read the band's
 * React context. While a work frame is on the page the band publishes what the
 * mode pill should say here (the current page over the area name), and the pill
 * reads it. Nothing here is stored on the device or sent anywhere.
 */
export type WorkFramePill = {
  readonly modeId: AppModeId;
  /** The area's name, the pill's small line ("Roster", "Assessments"). */
  readonly area: string;
  /** The current page's name, the pill's big line ("Swaps"), or null for the area's own name. */
  readonly page: string | null;
};

let pill: WorkFramePill | null = null;
const pillListeners = new Set<() => void>();

function subscribePill(listener: () => void) {
  pillListeners.add(listener);
  return () => pillListeners.delete(listener);
}

export function setWorkFramePill(next: WorkFramePill | null): void {
  if (next === pill) return;
  if (next && pill && next.modeId === pill.modeId && next.area === pill.area && next.page === pill.page) return;
  pill = next;
  for (const listener of pillListeners) listener();
}

/** What the mode pill should say while a work frame is up, or null (server render, clinical modes). */
export function useWorkFramePill(): WorkFramePill | null {
  return useSyncExternalStore(
    subscribePill,
    () => pill,
    () => null,
  );
}

/* ------------------------------------------------------------------ actions */

const actions = new Map<WorkFrameActionId, () => void>();
const actionListeners = new Set<() => void>();
let actionVersion = 0;
/** An action asked for before its page opened; see `requestWorkFrameAction`. */
const PENDING_ACTION_MS = 8000;
let pendingAction: { readonly id: WorkFrameActionId; readonly at: number } | null = null;

function subscribeActions(listener: () => void) {
  actionListeners.add(listener);
  return () => actionListeners.delete(listener);
}

function notifyActions() {
  actionVersion += 1;
  for (const listener of actionListeners) listener();
}

/**
 * Offers one of the page's own actions in its area's More sheet (My Day's
 * Reminders and Customise, for example). The sheet lists the item only while a
 * page has registered it, so a More row never does nothing. Pass null to
 * withdraw it; it is withdrawn when the page closes.
 */
export function useWorkFrameAction(id: WorkFrameActionId, handler: (() => void) | null): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  const registered = handler !== null;
  useEffect(() => {
    if (!registered) return;
    const run = () => latest.current?.();
    actions.set(id, run);
    notifyActions();
    if (pendingAction?.id === id) {
      const fresh = Date.now() - pendingAction.at < PENDING_ACTION_MS;
      pendingAction = null;
      if (fresh) run();
    }
    return () => {
      if (actions.get(id) === run) {
        actions.delete(id);
        notifyActions();
      }
    };
  }, [id, registered]);
}

/** Bumps whenever an action is offered or withdrawn, so the sheet re-reads them. */
export function useWorkFrameActionsVersion(): number {
  return useSyncExternalStore(
    subscribeActions,
    () => actionVersion,
    () => 0,
  );
}

export function workFrameActionHandler(id: WorkFrameActionId): (() => void) | null {
  return actions.get(id) ?? null;
}

/**
 * Runs a page action now if a page offers it, or as soon as the page that
 * offers it opens (the side menu's Reminders, tapped away from My Day, goes
 * to My Day and opens its Reminders there). A request older than a few
 * seconds is dropped, so a slow or failed page load never opens a sheet later
 * out of nowhere.
 */

export function requestWorkFrameAction(id: WorkFrameActionId): void {
  const handler = actions.get(id);
  if (handler) {
    pendingAction = null;
    handler();
    return;
  }
  pendingAction = { id, at: Date.now() };
}

/* -------------------------------------------------------- side menu counts */

/**
 * What the side menu and rail show beside each area: things waiting there,
 * from the one notification feed. The reader publishes here, and null means
 * not known (signed out, still loading, offline or a failed read), when the
 * rows show no number rather than a wrong one.
 */
export type WorkSideCounts = Readonly<Partial<Record<string, { readonly total: number; readonly overdue: number }>>>;
export type WorkSideCountsState = {
  readonly areas: WorkSideCounts;
  /** Everything waiting, the bell's own number, for the Notifications row. */
  readonly total: number;
  readonly overdue: number;
  /** Reminders due today, for the Reminders row. */
  readonly reminders: number;
};

let sideCounts: WorkSideCountsState | null = null;
const sideCountListeners = new Set<() => void>();

function subscribeSideCounts(listener: () => void) {
  sideCountListeners.add(listener);
  return () => sideCountListeners.delete(listener);
}

export function setWorkSideCounts(next: WorkSideCountsState | null): void {
  if (next === sideCounts) return;
  if (next && sideCounts && JSON.stringify(next) === JSON.stringify(sideCounts)) return;
  sideCounts = next;
  for (const listener of sideCountListeners) listener();
}

export function useWorkSideCounts(): WorkSideCountsState | null {
  return useSyncExternalStore(
    subscribeSideCounts,
    () => sideCounts,
    () => null,
  );
}

/* --------------------------------------------------------- last page per area */

/**
 * The page last open in each top-level area, so an inner area's back arrow
 * returns to where you left its parent (navigation follow-up, owner request
 * 7 Oct 2026). Memory only for this tab: nothing is stored on the device.
 */
const lastPages = new Map<string, string>();

export function rememberWorkAreaPage(areaId: string, href: string): void {
  lastPages.set(areaId, href);
}

export function rememberedWorkAreaPage(areaId: string): string | null {
  return lastPages.get(areaId) ?? null;
}

/* ------------------------------------------------- where an inner area was opened from */

let trail: WorkTrail = EMPTY_WORK_TRAIL;
/**
 * When the phone's Back (or Forward) or a back arrow was last used, so the
 * next work page shown counts as a return. It lapses after a few seconds, so a
 * Back that changed only the address within a page never counts later.
 */
let returningAt: number | null = null;
const RETURN_WINDOW_MS = 5_000;
let listeningForBack = false;
const trailListeners = new Set<() => void>();

function subscribeTrail(listener: () => void) {
  trailListeners.add(listener);
  return () => trailListeners.delete(listener);
}

/** A back arrow was tapped: the page it opens keeps its own way back rather than pointing at the page left. */
export function markWorkReturn(): void {
  returningAt = Date.now();
}

/**
 * The frame calls this for every work page it draws, so an inner area knows
 * the work page it was opened from (`visitWorkPage`). Memory only for this tab.
 */
export function recordWorkPageVisit(visit: WorkVisit, inner: boolean): void {
  if (!listeningForBack && typeof window !== "undefined") {
    listeningForBack = true;
    window.addEventListener("popstate", markWorkReturn);
  }
  const returning = returningAt !== null && Date.now() - returningAt < RETURN_WINDOW_MS;
  returningAt = null;
  const next = visitWorkPage(trail, visit, { inner, returning });
  const originsChanged = next.origins !== trail.origins;
  trail = next;
  if (originsChanged) for (const listener of trailListeners) listener();
}

/** The work page an inner area was opened from, or null when opened fresh (it then goes back to its parent). */
export function useWorkAreaOrigin(areaId: WorkAreaId): WorkVisit | null {
  return useSyncExternalStore(
    subscribeTrail,
    () => trail.origins[areaId] ?? null,
    () => null,
  );
}

export function resetWorkTrailForTests(): void {
  trail = EMPTY_WORK_TRAIL;
  returningAt = null;
}

/* ------------------------------------------------------------- page's back */

let pageBackClaims = 0;
const pageBackListeners = new Set<() => void>();

function subscribePageBack(listener: () => void) {
  pageBackListeners.add(listener);
  return () => pageBackListeners.delete(listener);
}

/**
 * A step inside a page (a form, a report) draws its own back button to the
 * screen before it. While one is up, the frame's back arrow to the parent area
 * steps aside, so the top bar never shows two.
 */
export function useClaimWorkFrameBack(claimed: boolean): void {
  useEffect(() => {
    if (!claimed) return;
    pageBackClaims += 1;
    for (const listener of pageBackListeners) listener();
    return () => {
      pageBackClaims -= 1;
      for (const listener of pageBackListeners) listener();
    };
  }, [claimed]);
}

/** True while a page draws its own back button. */
export function usePageBackClaimed(): boolean {
  return useSyncExternalStore(
    subscribePageBack,
    () => pageBackClaims > 0,
    () => false,
  );
}
