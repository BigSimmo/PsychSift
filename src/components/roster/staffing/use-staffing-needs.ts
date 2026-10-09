"use client";

import { useCallback, useEffect, useState } from "react";

import type { StaffingNeed } from "@/lib/roster/staffing/team-staffing";
import { sharedGet } from "@/lib/shared-get";

/**
 * The team's safe number: the cover needs its roster manager set, from the
 * member-safe staffing-needs read (counts only, never a name). `needs` is
 * undefined while reading and null when the read failed, so the screens can
 * say "couldn't be checked" instead of judging. Held in React state only.
 */
export function staffingNeedsUrl(serviceId: string): string {
  return `/api/roster/team/${encodeURIComponent(serviceId)}/staffing-needs`;
}

function isNeed(value: unknown): value is StaffingNeed {
  if (!value || typeof value !== "object") return false;
  const need = value as Record<string, unknown>;
  return (
    (need.weekday === null || typeof need.weekday === "number") &&
    (need.date === null || typeof need.date === "string") &&
    typeof need.kind === "string" &&
    (need.grade === null || typeof need.grade === "string") &&
    (need.siteId === null || typeof need.siteId === "string") &&
    typeof need.needed === "number"
  );
}

export function useStaffingNeeds(serviceId: string | null): {
  readonly needs: readonly StaffingNeed[] | null | undefined;
  readonly reload: () => void;
} {
  const [answer, setAnswer] = useState<{ url: string; needs: readonly StaffingNeed[] | null } | null>(null);
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  const url = serviceId ? staffingNeedsUrl(serviceId) : null;

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    void (async () => {
      let needs: readonly StaffingNeed[] | null = null;
      try {
        const response = await sharedGet(url, { signal: controller.signal });
        const payload = response.ok ? ((await response.json()) as { needs?: unknown }) : null;
        if (Array.isArray(payload?.needs) && payload.needs.every(isNeed)) needs = payload.needs;
      } catch (error) {
        if ((error as { name?: string })?.name === "AbortError") return;
      }
      if (!controller.signal.aborted) setAnswer({ url, needs });
    })();
    return () => controller.abort();
  }, [url, generation]);

  return { needs: url && answer?.url === url ? answer.needs : undefined, reload };
}
