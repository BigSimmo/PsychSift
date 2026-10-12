"use client";

import { useEffect } from "react";

import type { AppModeId } from "@/lib/app-modes";

/**
 * Starts loading what a mode's results page needs while its home is still on screen,
 * so the first search does not pay for it after Enter.
 *
 * Only the results surface's JavaScript chunk is warmed. No data request is made: the
 * medication catalogue route shares the search rate limit, so a background fetch from
 * every home visit could use up the allowance a real search needs. Nothing here sends a
 * query, calls a paid or model-backed service, or stores anything.
 * What is warmed never changes which results a search returns or their order; it only
 * moves when the shared pieces are fetched.
 *
 * Each mode is warmed at most once per page load, after the browser goes idle, and
 * every failure is ignored: a warm-up that fails leaves the search exactly as it was.
 */

type ModeWarmup = () => void;

const modeWarmups: Partial<Record<AppModeId, ModeWarmup>> = {
  prescribing: () => {
    void import("@/components/clinical-dashboard/medication-prescribing-workspace").catch(() => undefined);
  },
  documents: () => {
    void import("@/components/clinical-dashboard/document-search-results").catch(() => undefined);
  },
};

const warmedModes = new Set<AppModeId>();

/** Runs a mode's warm-up once per page load. Exported for tests. */
export function warmModeResults(modeId: AppModeId) {
  const warmup = modeWarmups[modeId];
  if (!warmup || warmedModes.has(modeId)) return false;
  warmedModes.add(modeId);
  warmup();
  return true;
}

/** Test seam: forget which modes were warmed. */
export function resetModeResultsWarmupForTests() {
  warmedModes.clear();
}

type IdleWindow = Window & {
  requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export function useModeResultsWarmup(modeId: AppModeId) {
  useEffect(() => {
    if (!modeWarmups[modeId] || warmedModes.has(modeId)) return;
    const idleWindow = window as IdleWindow;
    if (typeof idleWindow.requestIdleCallback === "function") {
      const handle = idleWindow.requestIdleCallback(() => warmModeResults(modeId), { timeout: 2000 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(() => warmModeResults(modeId), 600);
    return () => window.clearTimeout(timer);
  }, [modeId]);
}
