"use client";

import { useEffect, useState } from "react";

/**
 * Teaching's own count of sessions given but not yet logged as CPD, or null
 * when it is unknown (not asked, the endpoint failed, or nothing is waiting).
 * Teaching remains the owner of the count; CPD only reads it.
 */
export function useCmeTeachingUnloggedCount(enabled = true): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    async function loadCount() {
      try {
        const response = await fetch("/api/teaching?view=unlogged-count", {
          method: "GET",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const value: unknown = await response.json();
        const nextCount =
          value && typeof value === "object" && "count" in value ? (value as { count: unknown }).count : null;
        if (
          !controller.signal.aborted &&
          typeof nextCount === "number" &&
          Number.isSafeInteger(nextCount) &&
          nextCount > 0
        ) {
          setCount(nextCount);
        }
      } catch {
        // The Teaching endpoint is optional until its separate mode is connected.
      }
    }
    void loadCount();
    return () => controller.abort();
  }, [enabled]);

  return count;
}
