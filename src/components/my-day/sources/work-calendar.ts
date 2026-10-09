"use client";

import { useMemo } from "react";

import { useWorkCalendarEntries } from "@/components/work-calendar/use-work-calendar-entries";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { isExampleRecord } from "@/lib/example-data/guards";
import type { MyDayItem, MyDaySourceMode, MyDaySourceResult } from "@/lib/my-day/model";
import { addDaysToDate } from "@/lib/roster/shifts/perth-time";
import { entryEdges, type WorkCalendarEntry } from "@/lib/work-calendar/entries";
import { zonedDateOf } from "@/lib/work-time/format";

/**
 * Work calendar entries for My Day (rotation preferences, owner request
 * 9 Oct 2026): the start and the last day of each rotation, and any other
 * source's entries (a booked course), from today to two weeks ahead. They are
 * dates to know, not tasks, so every item is "info".
 *
 * Example entries are left out, as for every other My Day source, so a
 * signed-in reader never sees an invented item as theirs and none reaches the
 * notification centre. Outside the rotation preferences preview the entries
 * list is empty and this adds nothing.
 */

/** How far ahead My Day lists a start or an end. */
export const MY_DAY_ENTRY_AHEAD_DAYS = 14;

/** The area that owns an entry kind: booked courses live in Admin, rotations in Roster. */
function modeOf(entry: WorkCalendarEntry): MyDaySourceMode {
  return entry.kind === "course" ? "my-work" : "roster";
}

function itemTitle(entry: WorkCalendarEntry, edge: "start" | "end"): string {
  if (entry.start === entry.end) return entry.title;
  return `${entry.title} ${edge === "start" ? "starts" : "ends"}`;
}

function itemDetail(entry: WorkCalendarEntry, edge: "start" | "end"): string | undefined {
  if (edge === "end") return `Last day${entry.location ? ` · ${entry.location}` : ""}`;
  if (entry.start === entry.end && entry.startTime) {
    return [entry.endTime ? `${entry.startTime} to ${entry.endTime}` : entry.startTime, entry.location]
      .filter(Boolean)
      .join(" · ");
  }
  return entry.detail || entry.location || undefined;
}

/** Starts and ends from `today` (a work-zone date) to two weeks ahead, as My Day items. */
export function workCalendarMyDayItems(entries: readonly WorkCalendarEntry[], today: string): MyDayItem[] {
  const real = entries.filter((entry) => !entry.isExample && !isExampleRecord(entry.id));
  return entryEdges(real, today, addDaysToDate(today, MY_DAY_ENTRY_AHEAD_DAYS)).map(
    ({ entry, edge, date }): MyDayItem => {
      const mode = modeOf(entry);
      const detail = itemDetail(entry, edge);
      return {
        id: `${mode}:calendar-${edge}:${entry.id}`,
        mode,
        title: itemTitle(entry, edge),
        ...(detail ? { detail } : {}),
        due: date,
        severity: "info",
        href: entry.href ?? (mode === "roster" ? "/roster" : "/admin"),
      };
    },
  );
}

const NO_ITEMS: readonly MyDayItem[] = [];

/**
 * The hook `useMyDayItems` adds to Roster's items. It never fails My Day: a
 * calendar source that is loading, failed or not available yet adds nothing,
 * and the feature's own page says why.
 */
export function useWorkCalendarMyDayItems({
  enabled,
  now,
}: {
  readonly enabled: boolean;
  readonly now: Date;
}): readonly MyDayItem[] {
  const calendar = useWorkCalendarEntries();
  const { zone } = useWorkTimeZone();
  const today = zonedDateOf(now, zone);
  return useMemo(
    () => (enabled && calendar.status === "ready" ? workCalendarMyDayItems(calendar.entries, today) : NO_ITEMS),
    [enabled, calendar.status, calendar.entries, today],
  );
}

/**
 * Roster's My Day result with the calendar items added, when Roster's own read
 * is ready and is the reader's own (never sample data). Otherwise unchanged.
 */
export function withWorkCalendarItems(result: MyDaySourceResult, items: readonly MyDayItem[]): MyDaySourceResult {
  if (!items.length || result.status !== "ready" || result.sample) return result;
  return { ...result, items: [...result.items, ...items] };
}
