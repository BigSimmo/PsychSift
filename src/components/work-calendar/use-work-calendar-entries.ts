"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import { WORK_CALENDAR_SOURCES, type WorkCalendarSourceRead } from "@/components/work-calendar/sources";
import { mergeEntries, type WorkCalendarEntry } from "@/lib/work-calendar/entries";

/**
 * Everything on the reader's work calendar besides shifts (rotations, and any
 * source added to `WORK_CALENDAR_SOURCES`), merged and sorted.
 *
 * On for everyone. Each source still reads nothing where the launch switch
 * hides its screen, and then adds no entries.
 *
 * `status` is "loading" while any source is still loading and "ready" after.
 * A source that failed or is not available yet adds nothing: the calendar
 * views stay quiet about it, and the feature's own page says what went wrong.
 */
export type WorkCalendarStatus = "off" | "loading" | "ready";

export type WorkCalendarEntriesRead = {
  readonly status: WorkCalendarStatus;
  readonly entries: readonly WorkCalendarEntry[];
  /** Each source's own read, by source id. */
  readonly sources: Readonly<Record<string, WorkCalendarSourceRead>>;
  /** Reads every source that failed again. */
  readonly retry: () => void;
};

export function useWorkCalendarEntries(): WorkCalendarEntriesRead {
  // Rotations and course bookings are on for everyone, so the calendar is too.
  const enabled = true;
  // A static list, so every source hook runs in the same order on every render.
  const reads = WORK_CALENDAR_SOURCES.map((source) => source.read(enabled));
  // The lists are small. Keyed on their content, the merged list stays the same object until something changes.
  const signature = JSON.stringify(reads);
  // The latest reads, so the one retry function stays the same object across renders.
  const latest = useRef(reads);
  useEffect(() => {
    latest.current = reads;
  });
  const retry = useCallback(() => {
    for (const read of latest.current) if (read.status === "error") read.retry?.();
  }, []);
  return useMemo<WorkCalendarEntriesRead>(() => {
    const parsed = JSON.parse(signature) as WorkCalendarSourceRead[];
    const sources = Object.fromEntries(WORK_CALENDAR_SOURCES.map((source, index) => [source.id, parsed[index]!]));
    if (!enabled) return { status: "off", entries: [], sources, retry };
    const status: WorkCalendarStatus = parsed.some((read) => read.status === "loading") ? "loading" : "ready";
    return { status, entries: mergeEntries(parsed.map((read) => read.entries)), sources, retry };
  }, [enabled, signature, retry]);
}
