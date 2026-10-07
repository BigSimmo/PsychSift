"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";

import { writeClassicWorkModePreference } from "@/components/work-mode-launch/use-classic-work-mode";
import type { LivePreviewFeatureId } from "@/lib/live-version/features";
import {
  LIVE_VERSION_COOKIE,
  LIVE_VERSION_EVERYONE,
  LIVE_VERSION_FALLBACK,
  LIVE_VERSION_NEWEST,
  type LiveVersion,
  type LiveVersionChoice,
} from "@/lib/live-version/live-version";

const LiveVersionContext = createContext<LiveVersion>(LIVE_VERSION_FALLBACK);

/** Mounted once by the search-app layout with the state the server resolved for this request. */
export function LiveVersionProvider({ liveVersion, children }: { liveVersion: LiveVersion; children: ReactNode }) {
  return <LiveVersionContext.Provider value={liveVersion}>{children}</LiveVersionContext.Provider>;
}

export function useLiveVersion(): LiveVersion {
  return useContext(LiveVersionContext);
}

/** True when this reader gets the preview feature (see `src/lib/live-version/features.ts`). */
export function useLivePreview(feature: LivePreviewFeatureId): boolean {
  void feature;
  return useContext(LiveVersionContext).newest;
}

/** Renders its children only in the newest version, else `fallback` (default nothing). */
export function LivePreview({
  feature,
  children,
  fallback = null,
}: {
  feature: LivePreviewFeatureId;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return useLivePreview(feature) ? children : fallback;
}

/** Browsers clamp cookie lifetimes to about 400 days. */
const CHOICE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/** Writes the tester's choice. Only the server decides whether it counts. */
export function writeLiveVersionChoice(choice: LiveVersionChoice): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${LIVE_VERSION_COOKIE}=${choice}; path=/; max-age=${CHOICE_MAX_AGE_SECONDS}; samesite=lax${secure}`;
}

/**
 * The Settings switch. Changing it reloads the page, so the server draws the
 * chosen version from the first paint and the proxy applies it to every route.
 */
export function useLiveVersionSwitch(): {
  available: boolean;
  choice: LiveVersionChoice;
  setChoice: (choice: LiveVersionChoice) => void;
} {
  const { available, newest } = useLiveVersion();
  const setChoice = useCallback((choice: LiveVersionChoice) => {
    writeLiveVersionChoice(choice);
    // The older "Hide new work screens" choice is superseded for a tester: tidy it away.
    writeClassicWorkModePreference(false);
    window.location.reload();
  }, []);
  return { available, choice: newest ? LIVE_VERSION_NEWEST : LIVE_VERSION_EVERYONE, setChoice };
}
