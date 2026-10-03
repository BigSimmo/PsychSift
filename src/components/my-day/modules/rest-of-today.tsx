"use client";

import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import type { RosterShiftsState } from "@/components/roster/use-roster-shifts";
import type { SessionSummaryRead } from "@/components/teaching/teaching-reads";
import { sessionHref } from "@/components/teaching/teaching-view-model";
import { cn, eyebrowText } from "@/components/ui-primitives";
import type { MyDayItem } from "@/lib/my-day/model";
import { describeNextShift } from "@/lib/roster/shifts/next-shift";
import { perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";

export type RestOfTodayChip = {
  readonly id: string;
  readonly at: number;
  readonly label: string;
  readonly href: string;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Today's remaining dated things, in Perth time, soonest first: My Day items
 * whose due carries a time, the next roster shift if it starts today, and the
 * next teaching session if it is today. Date-only items have no time, so they
 * are left out.
 */
export function restOfTodayChips(input: {
  readonly items: readonly MyDayItem[];
  readonly roster: RosterShiftsState;
  readonly session: SessionSummaryRead | null;
  readonly now: Date;
}): RestOfTodayChip[] {
  const { items, roster, session, now } = input;
  const today = perthDateOf(now);
  const chips: RestOfTodayChip[] = [];
  const add = (id: string, instant: string, label: string, href: string) => {
    const at = Date.parse(instant);
    if (Number.isNaN(at) || at < now.getTime() || perthDateOf(instant) !== today) return;
    chips.push({ id, at, label, href });
  };
  for (const item of items) {
    if (item.due && !DATE_ONLY.test(item.due)) add(`item:${item.id}`, item.due, item.title, item.href);
  }
  if (roster.status === "ready" && (!roster.sample || roster.demoMode)) {
    const next = describeNextShift(roster.shifts, now);
    if (next && !next.onNow) add("shift", next.shift.startsAt, `${next.shift.title} starts`, "/roster");
  }
  if (session && !session.allDay) {
    add(`teaching:${session.occurrenceId}`, session.startsAt, session.title, sessionHref(session) ?? "/teaching");
  }
  return chips.sort((a, b) => a.at - b.at);
}

/** A scrolling row of time chips; the next one is highlighted. Renders nothing when there are none. */
export function MyDayRestOfToday({ chips }: { readonly chips: readonly RestOfTodayChip[] }) {
  if (chips.length === 0) return null;
  return (
    <section
      aria-labelledby="my-day-rest-of-today-heading"
      className="grid min-w-0 gap-2"
      data-testid="my-day-module-rest-of-today"
    >
      <h2 id="my-day-rest-of-today-heading" className={cn(eyebrowText, "px-3")}>
        Rest of today
      </h2>
      <ul role="list" className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-3 pb-1">
        {chips.map((chip, index) => (
          <li key={chip.id} className="snap-start">
            <Link
              href={chip.href}
              data-testid={`my-day-rest-chip-${index}`}
              data-next={index === 0 ? "true" : undefined}
              className={cn(
                focusRing,
                "grid min-h-12 min-w-28 max-w-48 content-center gap-0.5 rounded-lg border px-3 py-2 no-underline",
                index === 0
                  ? "border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)]"
                  : "border-[color:var(--border)] bg-[color:var(--surface)]",
              )}
            >
              <span className="font-mono text-sm-minus font-medium nums text-[color:var(--text-heading)]">
                {perthTimeOf(new Date(chip.at))}
                {index === 0 ? <span className="sr-only"> (next)</span> : null}
              </span>
              <span className="break-words text-sm-minus text-[color:var(--text-muted)]">{chip.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
