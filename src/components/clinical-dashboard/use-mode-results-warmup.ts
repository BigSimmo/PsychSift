"use client";

import { useEffect } from "react";

import type { AppModeId } from "@/lib/app-modes";

/**
 * Starts loading what a mode's results page needs while its home is still on screen,
 * so the first search does not pay for it after Enter.
 *
 * Only local work is warmed: the results surface's JavaScript chunk, and for
 * Medication the app's own catalogue route, which loads the medication list into the
 * server's short-lived catalogue cache. Nothing here sends a query, calls a paid or
 * model-backed service (no search, embedding or answer request), or stores anything.
 * What is warmed never changes which results a search returns or their order; it only
 * moves when the shared pieces are fetched.
 *
 * Each mode is warmed at most once per page load, after the browser goes idle, and
 * every failure is ignored: a warm-up that fails leaves the search exactly as it was.
 */

/**
 * The same URL `cross-mode-links` reads (`useMedicationCatalog(undefined, { fields: "index" })`),
 * so an anonymous warm-up also lands in the browser cache that reader uses. The slim index
 * projection keeps the warm-up small; the server-side catalogue read it triggers is the same
 * one a submitted search makes.
 */
export const medicationCatalogueWarmupUrl = "/api/medications?fields=index";

type ModeWarmup = () => void;

const modeWarmups: Partial<Record<AppModeId, ModeWarmup>> = {
  prescribing: () => {
    void import("@/components/clinical-dashboard/medication-prescribing-workspace").catch(() => undefined);
    if (typeof fetch === "function") {
      void fetch(medicationCatalogueWarmupUrl, { priority: "low" } as RequestInit).catch(() => undefined);
    }
  },
  documents: () => {
    // Chunk only. Document search is retrieval-backed, so there is no query-free data
    // request worth making here.
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
