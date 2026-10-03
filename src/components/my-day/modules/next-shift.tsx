"use client";

import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { modeRaisedCard } from "@/components/mode-kit/recipes";
import { modeSecondaryText } from "@/components/mode-kit/type";
import type { RosterShiftsState } from "@/components/roster/use-roster-shifts";
import { cn } from "@/components/ui-primitives";
import { describeNextShift } from "@/lib/roster/shifts/next-shift";
import { perthTimeOf } from "@/lib/roster/shifts/perth-time";

/** An upcoming shift's ring fills over the 12 hours before it starts. */
const RING_LEAD_MS = 12 * 60 * 60 * 1000;
const RING_SIZE = 112;
const RING_STROKE = 9;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** "0:50" from a span of milliseconds, rounded to the nearest minute. */
export function formatHoursMinutes(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * Ring fraction (0 to 1). On now: how much of the shift has elapsed. Upcoming:
 * how much of the 12 hours before the start has passed (empty until 12 h out).
 */
export function shiftRingFraction(startsAt: string, endsAt: string, now: Date): number {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  const at = now.getTime();
  const fraction = at >= start ? (at - start) / (end - start) : (at - (start - RING_LEAD_MS)) / RING_LEAD_MS;
  return Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
}

function CountdownRing({
  fraction,
  figure,
  caption,
  label,
}: {
  fraction: number;
  figure: string;
  caption: string;
  label: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      data-testid="my-day-next-shift-ring"
      className="relative grid size-28 shrink-0 place-items-center"
    >
      <svg viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE}
          stroke="var(--border)"
        />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          stroke="var(--mode-identity)"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
        />
      </svg>
      <span aria-hidden="true" className="relative grid justify-items-center">
        <span className="font-mono text-2xl font-semibold nums text-[color:var(--text-heading)]">{figure}</span>
        <span className="text-2xs text-[color:var(--text-muted)]">{caption}</span>
      </span>
    </span>
  );
}

/**
 * The shift on now, or the next one, from the reader's own Roster (the state is
 * read once by `MyDayModules`). Renders nothing while loading, signed out,
 * failed, with no shift ahead, or when the shifts are only the sample doctor's
 * example (unless the data is demo mode). The ring follows the page's minute
 * clock and needs no animation.
 */
export function MyDayNextShift({ state, now }: { readonly state: RosterShiftsState; readonly now: Date }) {
  if (state.status !== "ready") return null;
  if (state.sample && !state.demoMode) return null;
  const next = describeNextShift(state.shifts, now);
  if (!next) return null;
  const { shift } = next;
  const when = next.onNow
    ? `On now · ends ${perthTimeOf(shift.endsAt)}`
    : next.when.replace(/^Starts/, "starts").replace(/^(Today|Tomorrow)/, (word) => word.toLowerCase());
  const headline = next.onNow ? shift.title : `${shift.title} · ${when}`;
  const place = shift.workplace ?? shift.location;
  const figure = formatHoursMinutes(
    next.onNow ? Date.parse(shift.endsAt) - now.getTime() : Date.parse(shift.startsAt) - now.getTime(),
  );
  const caption = next.onNow ? "left on shift" : "to on call";
  const ringLabel = `${figure} ${caption}`;
  return (
    <div data-testid="my-day-module-next-shift" className={cn(modeRaisedCard, "rounded-xl")}>
      <Link
        href="/roster"
        className={cn(
          focusRing,
          "grid min-h-12 grid-cols-[7rem_1fr] items-center gap-3.5 rounded-xl p-3.5 no-underline",
        )}
      >
        <CountdownRing
          fraction={shiftRingFraction(shift.startsAt, shift.endsAt, now)}
          figure={figure}
          caption={caption}
          label={ringLabel}
        />
        <span className="grid min-w-0 gap-1">
          <span className="break-words text-lg font-semibold leading-tight text-[color:var(--text-heading)]">
            {headline}
          </span>
          {next.onNow ? <span className={cn(modeSecondaryText, "break-words")}>{when}</span> : null}
          {place ? <span className={cn(modeSecondaryText, "break-words")}>{place}</span> : null}
        </span>
      </Link>
    </div>
  );
}
