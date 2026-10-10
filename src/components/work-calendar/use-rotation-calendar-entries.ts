"use client";

import { useMemo } from "react";

import { useLivePreview } from "@/components/live-version/live-version-provider";
import { useRotations } from "@/components/roster/rotations/use-rotations";
import type { WorkCalendarSourceRead } from "@/components/work-calendar/sources";
import { useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { rotationCalendarEntries, rotationDeadlineEntries, type WorkCalendarEntry } from "@/lib/work-calendar/entries";

const OFF: WorkCalendarSourceRead = { status: "off", entries: [] };

/**
 * The work calendar source for rotation preferences: the reader's published
 * placements, one whole-day entry per term, and the closing time of any round
 * still taking their preferences, from the one rotations data hook.
 * With Roster's example data on these are the example rounds (ids `example:`).
 * With `enabled` false the rotations hook reads nothing.
 */
export function useRotationCalendarEntries(calendar: boolean): WorkCalendarSourceRead {
  // The calendar is on for either preview, so this source checks its own.
  const preview = useLivePreview("rotation-preferences");
  // Each entry links to its round's page, so where the launch switch hides that page there are no entries.
  const visible = useWorkModeRouteVisible();
  const enabled = calendar && preview && visible("/roster/rotations");
  const rotations = useRotations({ enabled });
  const { zone } = useWorkTimeZone();
  // The rounds are rebuilt on each read, so the list is kept the same object while its content is the same.
  const signature = JSON.stringify(
    enabled && rotations.status === "ready"
      ? [...rotationCalendarEntries(rotations.mine), ...rotationDeadlineEntries(rotations.mine, zone)]
      : [],
  );
  const entries = useMemo(() => JSON.parse(signature) as WorkCalendarEntry[], [signature]);
  if (!enabled) return OFF;
  if (rotations.status !== "ready") return { status: rotations.status, entries, retry: rotations.retry };
  return { status: "ready", entries, retry: rotations.retry };
}
