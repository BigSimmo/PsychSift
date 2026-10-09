"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";

import { WORK_MODE_LAUNCH_FALLBACK, type WorkModeLaunch } from "@/lib/work-mode-launch/launch";
import { workModeRouteHidden } from "@/lib/work-mode-launch/routes";

const WorkModeLaunchContext = createContext<WorkModeLaunch>(WORK_MODE_LAUNCH_FALLBACK);

/** Mounted once by the search-app layout with the state the server resolved for this request. */
export function WorkModeLaunchProvider({ launch, children }: { launch: WorkModeLaunch; children: ReactNode }) {
  return <WorkModeLaunchContext.Provider value={launch}>{children}</WorkModeLaunchContext.Provider>;
}

export function useWorkModeLaunch(): WorkModeLaunch {
  return useContext(WorkModeLaunchContext);
}

/** True when this reader gets the new work-mode frame and screens. */
export function useNewWorkMode(): boolean {
  return useContext(WorkModeLaunchContext).newWorkMode;
}

/**
 * Returns a filter for links: `visible(href)` is false for a new-only screen on the
 * classic work mode.
 * Use it for More items, Today cards, Notification sources and search results.
 */
export function useWorkModeRouteVisible(): (href: string) => boolean {
  const launch = useContext(WorkModeLaunchContext);
  return useCallback((href: string) => !workModeRouteHidden(href, launch), [launch]);
}

/** Renders its children only in the new work mode, else `fallback` (default nothing). */
export function NewWorkModeOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return useNewWorkMode() ? children : fallback;
}
