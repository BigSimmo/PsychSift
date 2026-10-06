"use client";

import { useEffect, useMemo } from "react";

import { useTeachingResource, type TeachingResourceStatus } from "@/components/teaching/use-teaching-resource";
import { demoRelocatedTeaching, demoTeachingWeek } from "@/lib/teaching/demo-programme";
import type { TeachingWeekResponse } from "@/lib/teaching/model";
import { setTeachingRoles } from "@/lib/teaching/page-visibility";

/*
 * One stretch of the programme. Demo mode never calls the API. A signed-out
 * reader sees the demo only after "Open the demo", which turns on the Teaching
 * sample (`src/lib/teaching/sample.ts`) and arrives here as `demoMode`. A real
 * read also publishes the reader's roles for the pages sheet (U2), and a
 * signed-out read clears them.
 */
export type TeachingDemo = "off" | "demo-mode";
export type TeachingWeekState = {
  status: TeachingResourceStatus;
  week: TeachingWeekResponse | null;
  demo: TeachingDemo;
  retry: () => void;
};

export function useTeachingWeek(
  range: { from: string; to: string } | null,
  options: { demoMode: boolean },
  now: Date | null,
): TeachingWeekState {
  const { from, to } = range ?? { from: null, to: null };
  const url =
    from && to && !options.demoMode ? `/api/teaching?${new URLSearchParams({ view: "week", from, to })}` : null;
  const resource = useTeachingResource<TeachingWeekResponse>(url);
  const wantsDemo = options.demoMode;
  const demoWeek = useMemo<TeachingWeekResponse | null>(
    () =>
      wantsDemo && from && to && now
        ? {
            ...demoTeachingWeek({ from, to }, now),
            // The made-up reader keeps one weekly session in On Call, so the "From On Call" row shows.
            relocated: demoRelocatedTeaching({ from, to }, now),
            relocatedUnavailable: false,
          }
        : null,
    [wantsDemo, from, to, now],
  );

  useEffect(() => {
    if (options.demoMode) setTeachingRoles(["organiser", "admin"]);
    else if (resource.status === "ready" && resource.data)
      setTeachingRoles(resource.data.teams.map((team) => team.role));
    else if (resource.status === "signed-out" || resource.status === "loading") setTeachingRoles([]);
  }, [options.demoMode, resource.status, resource.data]);

  if (wantsDemo) {
    return {
      status: demoWeek ? "ready" : "loading",
      week: demoWeek,
      demo: "demo-mode",
      retry: resource.retry,
    };
  }
  return { status: resource.status, week: resource.data, demo: "off", retry: resource.retry };
}
