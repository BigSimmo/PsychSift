"use client";

import { useId } from "react";

import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { cn } from "@/components/ui-primitives";
import type { HoursSummary } from "@/lib/roster/hours";
import { WEEKDAYS } from "@/lib/roster/shifts/perth-time";

import { formatSpanWords } from "@/lib/roster/shifts-overview";

import { formatHours } from "./roster-format";
import { RosterSectionHead } from "./roster-list";

/**
 * This pay fortnight: rostered hours as fourteen bars, done ones solid and
 * coming ones hatched, a leave day marked "L" instead of a bar, and a dashed
 * line after today. Rostered hours, not pay. Bars are SVG so no size needs an
 * inline style.
 */

const BAR_SCALE_MIN = 12;

function letterOf(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!.charAt(0);
}

export function RosterFortnight({
  summary,
  today,
  leaveDates,
  extraHours,
  extraStatus,
  partial,
  payAnchored,
  onCallExcluded = false,
}: {
  readonly summary: HoursSummary;
  readonly today: string;
  readonly leaveDates: ReadonlySet<string>;
  readonly extraHours: number;
  readonly extraStatus: "loading" | "ready" | "error";
  /** Only part of the roster loaded, so every figure is a minimum. */
  readonly partial: boolean;
  /** The fortnight follows the doctor's pay anchor; without one it is just two weeks. */
  readonly payAnchored: boolean;
  /** On-call shifts fall in the fortnight but are not rostered hours, so the total says so. */
  readonly onCallExcluded?: boolean;
}) {
  const hatch = useId().replace(/:/g, "");
  const scale = Math.max(BAR_SCALE_MIN, ...summary.days.map((day) => day.hours));
  const atLeast = partial ? "at least " : "";
  const hasLeave = summary.days.some((day) => leaveDates.has(day.date));
  const extraWords =
    extraStatus === "loading"
      ? null
      : extraStatus === "error"
        ? "extra time not loaded"
        : extraHours > 0
          ? `plus ${formatHours(extraHours)} extra`
          : null;

  return (
    <section aria-labelledby="roster-fortnight-heading" className="grid gap-3" data-testid="roster-fortnight">
      <RosterSectionHead
        id="roster-fortnight-heading"
        title={payAnchored ? "This pay fortnight" : "This fortnight"}
        right={
          <span className="nums text-sm text-[color:var(--text-muted)]">
            {formatSpanWords(summary.start, summary.end)}
          </span>
        }
      />
      <div data-mode-identity="roster" className={cn(modeModuleSurface, "grid gap-3 p-4 shadow-none")}>
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="nums text-lg font-semibold text-[color:var(--text-heading)]">
            {atLeast}
            {formatHours(summary.totalHours)}
          </span>
          <span className="text-sm text-[color:var(--text-muted)]">rostered</span>
          {extraWords ? (
            <span className="nums ml-auto text-xs text-[color:var(--text-muted)]">{extraWords}</span>
          ) : null}
          {onCallExcluded ? (
            <span
              className="basis-full text-xs text-[color:var(--text-muted)]"
              data-testid="roster-fortnight-on-call-note"
            >
              On call isn&apos;t counted here.
            </span>
          ) : null}
        </p>
        <ul className="sr-only" aria-label={`Rostered hours each day, ${formatSpanWords(summary.start, summary.end)}`}>
          {summary.days.map((day) => (
            <li key={day.date}>
              {`${WEEKDAYS[new Date(`${day.date}T00:00:00Z`).getUTCDay()]} ${Number(day.date.slice(8, 10))}: ${
                leaveDates.has(day.date) && day.hours === 0
                  ? "leave"
                  : day.hours > 0
                    ? `${atLeast}${formatHours(day.hours)}`
                    : "no shift"
              }${day.date <= today ? "" : ", coming"}`}
            </li>
          ))}
        </ul>
        <div aria-hidden="true" className="grid h-20 grid-cols-14 items-end gap-1">
          <svg aria-hidden="true" className="absolute size-0">
            <defs>
              <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="3" height="5" className="fill-[color:var(--mode-identity-border)]" />
              </pattern>
            </defs>
          </svg>
          {summary.days.map((day) => {
            const done = day.date <= today;
            const leave = leaveDates.has(day.date) && day.hours === 0;
            const share = day.hours > 0 ? Math.max(day.hours / scale, 0.04) : 0;
            return (
              <span
                key={day.date}
                className={cn(
                  "relative grid h-full content-end justify-items-center gap-1",
                  day.date === today &&
                    "after:absolute after:-right-0.5 after:bottom-5 after:top-0 after:border-r after:border-dashed after:border-[color:var(--border-strong)] after:content-['']",
                )}
              >
                {leave ? (
                  <span className="text-2xs font-semibold text-[color:var(--text-muted)]">L</span>
                ) : (
                  <svg className="h-14 w-full max-w-4 overflow-visible">
                    {share > 0 ? (
                      <rect
                        y={`${(1 - share) * 100}%`}
                        width="100%"
                        height={`${share * 100}%`}
                        rx="2"
                        className={done ? "fill-[color:var(--mode-identity)]" : "stroke-[color:var(--mode-identity)]"}
                        fill={done ? undefined : `url(#${hatch})`}
                      />
                    ) : null}
                  </svg>
                )}
                <span className="text-2xs text-[color:var(--text-muted)]">{letterOf(day.date)}</span>
              </span>
            );
          })}
        </div>
        <p className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-[color:var(--text-muted)]">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-sm bg-[color:var(--mode-identity)]" />
            Done
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg aria-hidden="true" className="size-2.5">
              <rect
                x="0.5"
                y="0.5"
                width="9"
                height="9"
                rx="1.5"
                fill={`url(#${hatch})`}
                className="stroke-[color:var(--mode-identity)]"
              />
            </svg>
            Coming
          </span>
          {hasLeave ? <span>L leave</span> : null}
          <span className="ml-auto">Rostered hours</span>
        </p>
        <dl className="nums grid text-sm">
          {[
            ["Most in any 7 days this fortnight", `${atLeast}${formatHours(summary.maxHoursIn7Days)}`],
            ["Most days in a row this fortnight", `${atLeast}${summary.maxDaysInRow}`],
            [
              "Shortest break this fortnight",
              partial
                ? "shown once your whole roster loads"
                : summary.shortestBreakHours === null
                  ? "No breaks yet"
                  : formatHours(summary.shortestBreakHours),
            ],
          ].map(([term, value]) => (
            <div key={term} className="flex justify-between gap-3 border-t border-[color:var(--border)] py-2">
              <dt className="text-[color:var(--text-muted)]">{term}</dt>
              <dd className="text-right font-semibold text-[color:var(--text-heading)]">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
