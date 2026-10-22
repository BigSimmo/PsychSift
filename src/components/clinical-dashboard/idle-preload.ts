"use client";

import { useEffect } from "react";

type IdleWindow = Window & {
  requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * Warm closed-by-default sub-surfaces (menus, drawers) once the page is idle, so their
 * modules leave the home page's load/hydration path but are ready before first open.
 */
export function useIdlePreload(load: () => Promise<unknown>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const idleWindow = window as IdleWindow;
    const run = () => void load().catch(() => undefined);
    if (typeof idleWindow.requestIdleCallback === "function") {
      const handle = idleWindow.requestIdleCallback(run, { timeout: 8000 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(run, 4000);
    return () => window.clearTimeout(timer);
  }, [load, enabled]);
}
