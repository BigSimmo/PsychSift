"use client";

import { useEffect } from "react";

import { registerNavigationGuard } from "@/lib/navigation-guards";

const DEFAULT_DIRTY_STATE_MESSAGE = "You have unsaved changes. Leave without saving?";

/**
 * Tab-close, external navigation, and in-app shell navigation dirty-state guard.
 *
 * Attaches a `beforeunload` listener and registers a shell navigation guard strictly
 * and only when `isDirty` is true. Protects against accidental data loss when closing
 * the tab, reloading the page, following external links, or navigating via shell controls
 * while an unsaved clinical draft is present.
 *
 * Safe for SSR and test environments (`typeof window === "undefined"`).
 * Unbinds cleanly on unmount or when `isDirty` transitions to false, leaving
 * no `beforeunload` listener on window during client-side router navigation
 * (e.g. Next.js App Router `useRouter().push()`), preserving Back-Forward Cache (BFCache).
 */
export function useDirtyStateGuard(isDirty: boolean, message: string = DEFAULT_DIRTY_STATE_MESSAGE) {
  useEffect(() => {
    if (!isDirty || typeof window === "undefined") return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    const unregisterNavigationGuard = registerNavigationGuard(() => window.confirm(message));
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      unregisterNavigationGuard();
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isDirty, message]);
}
