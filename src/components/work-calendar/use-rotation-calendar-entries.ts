"use client";

import { useMemo } from "react";

import { useRotations } from "@/components/roster/rotations/use-rotations";
import type { WorkCalendarSourceRead } from "@/components/work-calendar/sources";
import { useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { rotationCalendarEntries, type WorkCalendarEntry } from "@/lib/work-calendar/entries";

const OFF: WorkCalendarSourceRead = { status: "off", entries: [] };

/**
 * The work calendar source for rotation preferences: the reader's published
 * placements, one whole-day entry per term, from the one rotations data hook.
 * With Roster's example data on these are the example rounds (ids `example:`).
 * With `enabled` false the rotations hook reads nothing.
 */
export function useRotationCalendarEntries(calendar: boolean): WorkCalendarSourceRead {
  // Each entry links to its round's page, so where the launch switch hides that page there are no entries.
  const visible = useWorkModeRouteVisible();
  const enabled = calendar && visible("/roster/rotations");
  const rotations = useRotations({ enabled });
  // The rounds are rebuilt on each read, so the list is kept the same object while its content is the same.
  const signature = JSON.stringify(
    enabled && rotations.status === "ready" ? rotationCalendarEntries(rotations.mine) : [],
  );
  const entries = useMemo(() => JSON.parse(signature) as WorkCalendarEntry[], [signature]);
  if (!enabled) return OFF;
  if (rotations.status !== "ready") return { status: rotations.status, entries };
  return { status: "ready", entries };
}
