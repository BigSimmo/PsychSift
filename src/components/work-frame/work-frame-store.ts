"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import type { AppModeId } from "@/lib/app-modes";
import type { WorkFrameActionId } from "@/lib/work-frame/areas";

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
