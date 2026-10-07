"use client";

import { useCallback } from "react";

import { useWorkModeLaunch } from "@/components/work-mode-launch/work-mode-launch-provider";
import { WORK_MODE_CLASSIC_PREFERENCE, WORK_MODE_PREFERENCE_COOKIE } from "@/lib/work-mode-launch/launch";

/** Browsers clamp cookie lifetimes to about 400 days. */
const PREFERENCE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/**
 * Writes or clears the device's "classic work mode" preference. It is a display
 * choice for this device, not a person's data, so it is not cleared at sign-out.
 */
export function writeClassicWorkModePreference(classic: boolean): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = classic
    ? `${WORK_MODE_PREFERENCE_COOKIE}=${WORK_MODE_CLASSIC_PREFERENCE}; path=/; max-age=${PREFERENCE_MAX_AGE_SECONDS}; samesite=lax${secure}`
    : `${WORK_MODE_PREFERENCE_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`;
}

/**
 * The Settings switch behind "Use the classic work mode": the instant rollback.
 * `available` is false for anyone the new work mode is not yet offered to, who has
 * only the classic work mode and so nothing to switch. Changing it reloads the page so
 * the server draws the chosen mode.
 */
export function useClassicWorkMode(): {
  available: boolean;
  classic: boolean;
  setClassic: (classic: boolean) => void;
} {
  const launch = useWorkModeLaunch();
  const setClassic = useCallback((classic: boolean) => {
    writeClassicWorkModePreference(classic);
    window.location.reload();
  }, []);
  return { available: launch.choiceAvailable, classic: launch.classicPreferred, setClassic };
}
