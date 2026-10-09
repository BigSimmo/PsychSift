"use client";

import Link from "next/link";

import { WorkDateRow, WorkTag } from "@/components/mode-kit/work";
import { cn } from "@/components/ui-primitives";
import { addDaysToDate, formatPerthDay } from "@/lib/roster/shifts/perth-time";
import {
  entriesOverlapping,
  entryEdges,
  type WorkCalendarEdge,
  type WorkCalendarEntry,
} from "@/lib/work-calendar/entries";

/**
 * Roster month's calendar entries besides shifts (rotation preferences, owner
 * request 9 Oct 2026; mockup `S.month`): a band above the grid naming the
 * rotation the viewed month is in, and rows for "Coming up". Entries come from
 * `useWorkCalendarEntries`, which is empty for readers outside the preview.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
/** How far ahead "Coming up" lists a start or an end. */
export const ROSTER_ENTRY_AHEAD_DAYS = 42;

const dayMonth = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
/** The first part of a rotation's line, e.g. "Term 1". */
const firstPart = (detail: string | undefined) => detail?.split(" · ")[0] ?? "";

function lastDayOfMonth(month: string): string {
  const [year, monthIndex] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  return new Date(Date.UTC(year, monthIndex, 0)).toISOString().slice(0, 10);
}

/**
 * The rotations the viewed month (`YYYY-MM`) is in: the one on today in this
 * month, else those overlapping it, at most two (a term changing mid-month).
 */
export function monthRotations(
  entries: readonly WorkCalendarEntry[],
  month: string,
  today: string,
): WorkCalendarEntry[] {
  const overlapping = entriesOverlapping(
    entries.filter((entry) => entry.kind === "rotation"),
    `${month}-01`,
    lastDayOfMonth(month),
  );
  if (today.startsWith(month)) {
    const current = overlapping.filter((entry) => entry.start <= today && entry.end >= today);
    if (current.length) return current.slice(0, 2);
  }
  return overlapping.slice(0, 2);
}

/** The day markers: what begins on each date from `from` to `to`, e.g. "Consultation liaison starts". */
export function entryStartsByDate(
  entries: readonly WorkCalendarEntry[],
  from: string,
  to: string,
): Map<string, string[]> {
  const starts = new Map<string, string[]>();
  for (const edge of entryEdges(entries, from, to)) {
    if (edge.edge !== "start" || edge.entry.kind !== "rotation") continue;
    starts.set(edge.date, [...(starts.get(edge.date) ?? []), `${edge.entry.title} starts`]);
  }
  return starts;
}

/** Starts and ends from today, for Coming up. At most three. */
export function comingEntryEdges(entries: readonly WorkCalendarEntry[], today: string): WorkCalendarEdge[] {
  return entryEdges(entries, today, addDaysToDate(today, ROSTER_ENTRY_AHEAD_DAYS)).slice(0, 3);
}

/** The band above the grid (mockup `.rp-band`): a soft tinted bar, a dot, the rotation and its term. */
export function RosterRotationBand({
  entries,
  month,
}: {
  readonly entries: readonly WorkCalendarEntry[];
  readonly month: string;
}) {
  if (!entries.length) return null;
  return (
    <ul className="m-0 grid list-none gap-1.5 p-0" data-testid="roster-month-rotation" aria-label="Your rotation">
      {entries.map((entry) => {
        const term = firstPart(entry.detail);
        const startsLater = entry.start > `${month}-01`;
        const when = startsLater ? `from ${dayMonth(entry.start)}` : `to ${dayMonth(entry.end)}`;
        const line = [term, when].filter(Boolean).join(" · ");
        const content = (
          <>
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[color:var(--mode-identity)]" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[color:var(--text-heading)]">
              {entry.title}
            </span>
            <span className="nums shrink-0 text-2xs font-semibold text-[color:var(--text-muted)]">{line}</span>
          </>
        );
        const className = cn(
          "flex min-h-12 min-w-0 items-center gap-2 rounded-lg border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] px-3 py-2 no-underline",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--mode-identity)]",
        );
        const label = `Rotation: ${entry.title}${term ? `, ${term}` : ""}, ${startsLater ? `from ${formatPerthDay(entry.start)}` : `until ${formatPerthDay(entry.end)}`}`;
        return (
          <li key={entry.id}>
            {entry.href ? (
              <Link href={entry.href} aria-label={label} className={className}>
                {content}
              </Link>
            ) : (
              <span aria-label={label} role="group" className={className}>
                {content}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const KIND_TAG: Readonly<Record<string, string>> = { rotation: "Rotation", course: "Course" };

/** One Coming up row: "Consultation liaison starts", or its end. */
export function RosterEntryEdgeRow({ edge }: { readonly edge: WorkCalendarEdge }) {
  const { entry, date } = edge;
  const weekday = formatPerthDay(date).split(" ")[0] ?? "";
  const tag = KIND_TAG[entry.kind];
  const row = {
    month: weekday,
    day: Number(date.slice(8, 10)),
    title: `${entry.title} ${edge.edge === "start" ? "starts" : "ends"}`,
    sub: edge.edge === "start" ? entry.detail || formatPerthDay(date) : `Last day · ${formatPerthDay(date)}`,
    end: tag ? <WorkTag tone={edge.edge === "start" ? "mode" : "neutral"}>{tag}</WorkTag> : undefined,
    testId: `roster-month-edge-${edge.edge}`,
  };
  return entry.href ? <WorkDateRow {...row} href={entry.href} /> : <WorkDateRow {...row} />;
}
