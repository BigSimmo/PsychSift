"use client";

import { useMemo } from "react";

import { ModeNotice } from "@/components/mode-kit/notice";
import { modeInsetHairline, modeModuleSurface } from "@/components/mode-kit/recipes";
import { modeNameText, modeNumberText, modeSecondaryText } from "@/components/mode-kit/type";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { FATIGUE_RULE_SET } from "@/lib/roster/fatigue-rules-source";
import { hoursRestCheck, type HoursRestBreak, type HoursRestGauge } from "@/lib/roster/hours-rest-check";
import { WEEKDAYS, formatPerthDay, perthDateOf } from "@/lib/roster/shifts/perth-time";
import type { RosterDisplayShift as OnCallShift } from "@/lib/roster/team/team-view";

import { formatDateSpan, formatHours, kindOf } from "./roster-format";

/**
 * Hours and rest: the next 14 days against the signed agreement limits, drawn rather than
 * lectured. Every gauge puts its limit at the same place on the track, so the eye scans one
 * line; a figure past it turns amber. Neutral words only: what the roster shows and the clause,
 * never that anything is unlawful or what to do. Loaded only when the Hours view opens.
 */

/** Where the limit mark sits on every gauge track, as a share of the track. */
const LIMIT_AT = 0.8;
/** The breaks chart runs to two days, so the 10 hour line sits clearly left of most breaks. */
const BREAK_SCALE_HOURS = 48;

const GAUGE_LABEL: Record<HoursRestGauge["rule"], { title: string; limit: (limit: number) => string }> = {
  maxHours7d: { title: "Most in any 7 days", limit: (limit) => `Limit ${limit} h` },
  maxHours14d: { title: "Most in any 14 days", limit: (limit) => `Limit ${limit} h` },
  maxShiftHours: { title: "Longest shift", limit: (limit) => `Limit ${limit} h in a row` },
  maxShiftHoursAfterNoon: {
    title: "Longest shift starting after noon",
    limit: (limit) => `Limit ${limit} h in a row`,
  },
  maxNightsInRow: { title: "Nights in a row", limit: (limit) => `Usually no more than ${limit}` },
};

function weekday(date: string): string {
  return `${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!} ${Number(date.slice(8, 10))}`;
}

function Gauge({ gauge }: { readonly gauge: HoursRestGauge }) {
  const over = gauge.value > gauge.limit;
  const fill = Math.min(1, (gauge.value / gauge.limit) * LIMIT_AT);
  const label = GAUGE_LABEL[gauge.rule];
  const value = gauge.unit === "hours" ? formatHours(gauge.value) : String(gauge.value);
  return (
    <li
      className={cn(modeInsetHairline, "grid gap-2 px-3 py-3")}
      data-testid={`roster-hours-rest-${gauge.rule}`}
      data-over={over ? "true" : undefined}
    >
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <div className="grid min-w-0">
          <span className={modeNameText}>{label.title}</span>
          <span className={cn(modeSecondaryText, "text-xs")}>
            {label.limit(gauge.limit)} · clause {gauge.clause}
          </span>
        </div>
        <span
          className={cn(
            modeNumberText,
            "text-lg-minus shrink-0",
            over ? "text-[color:var(--warning-text)]" : "text-[color:var(--text-heading)]",
          )}
        >
          {value}
        </span>
      </div>
      <div aria-hidden="true" className="relative h-2 rounded-full bg-[color:var(--surface-inset)]">
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            over ? "bg-[color:var(--warning)]" : "bg-[color:var(--tone-purple)]",
          )}
          style={{ width: `${fill * 100}%` }}
        />
        <span
          className="absolute -inset-y-1 w-0.5 rounded-full bg-[color:var(--text-heading)]"
          style={{ left: `${LIMIT_AT * 100}%` }}
        />
      </div>
    </li>
  );
}

function BreakRow({ item, minBreakHours }: { readonly item: HoursRestBreak; readonly minBreakHours: number }) {
  const short = item.hours < minBreakHours;
  const width = Math.min(1, item.hours / BREAK_SCALE_HOURS);
  const span =
    item.fromDate === item.toDate ? weekday(item.toDate) : `${weekday(item.fromDate)} to ${weekday(item.toDate)}`;
  return (
    <li
      className={cn(modeInsetHairline, "grid grid-cols-[7.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 px-3 py-2.5")}
      data-testid="roster-hours-rest-break"
      data-short={short ? "true" : undefined}
      aria-label={`${span}: ${formatHours(item.hours)} break${short ? `, under ${minBreakHours} hours` : ""}`}
    >
      <span className={cn(modeSecondaryText, "truncate")} aria-hidden="true">
        {span}
      </span>
      <span aria-hidden="true" className="relative h-2.5">
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            short
              ? "bg-[color:var(--warning)]"
              : "bg-[color:var(--tone-purple-soft)] border border-[color:var(--tone-purple-border)]",
          )}
          style={{ width: `${Math.max(width, 0.02) * 100}%` }}
        />
        <span
          className="absolute -inset-y-1 border-l border-dashed border-[color:var(--text-heading)]"
          style={{ left: `${(minBreakHours / BREAK_SCALE_HOURS) * 100}%` }}
        />
      </span>
      <span
        aria-hidden="true"
        className={cn(
          modeNumberText,
          "text-right text-sm",
          short ? "text-[color:var(--warning-text)]" : "text-[color:var(--text-heading)]",
        )}
      >
        {formatHours(item.hours)}
      </span>
    </li>
  );
}

export function RosterHoursRestCheck({ shifts, now }: { readonly shifts: readonly OnCallShift[]; readonly now: Date }) {
  const check = useMemo(
    () =>
      hoursRestCheck(
        shifts.map((shift) => ({ id: shift.id, startsAt: shift.startsAt, endsAt: shift.endsAt, kind: kindOf(shift) })),
        now,
      ),
    [shifts, now],
  );

  const startsAt = useMemo(() => new Map(shifts.map((shift) => [shift.id, shift.startsAt])), [shifts]);

  if (!check.on) {
    return (
      <ModeNotice testId="roster-hours-rest-off">
        Hours and rest checks stay off until the rules are signed off.
      </ModeNotice>
    );
  }

  return (
    <div className="grid min-w-0 gap-5" data-testid="roster-hours-rest">
      <section className="grid min-w-0 gap-2" aria-labelledby="roster-hours-rest-heading">
        <div className="flex min-w-0 items-baseline justify-between gap-3 px-3">
          <h2 id="roster-hours-rest-heading" className={eyebrowText}>
            Against your agreement
          </h2>
          <span className={cn(modeSecondaryText, "text-xs")}>
            Next 14 days · {formatDateSpan(check.start, check.end)}
          </span>
        </div>
        <ul role="list" className={modeModuleSurface}>
          {check.gauges.map((gauge) => (
            <Gauge key={gauge.rule} gauge={gauge} />
          ))}
        </ul>
      </section>

      <section className="grid min-w-0 gap-2" aria-labelledby="roster-hours-rest-breaks-heading">
        <div className="flex min-w-0 items-baseline justify-between gap-3 px-3">
          <h2 id="roster-hours-rest-breaks-heading" className={eyebrowText}>
            Breaks between shifts
          </h2>
          <span className={cn(modeSecondaryText, "text-xs")}>Dashed line: {check.minBreakHours} h minimum</span>
        </div>
        {check.breaks.length ? (
          <ul role="list" className={modeModuleSurface}>
            {check.breaks.map((item) => (
              <BreakRow key={item.shiftId} item={item} minBreakHours={check.minBreakHours} />
            ))}
          </ul>
        ) : (
          <p className={cn(modeSecondaryText, "px-3")}>No breaks between worked shifts in the next 14 days.</p>
        )}
      </section>

      {check.warnings.length ? (
        <section
          className="grid min-w-0 gap-2"
          aria-label="What the roster shows"
          data-testid="roster-hours-rest-warnings"
        >
          {check.warnings.map((warning) => (
            <ModeNotice key={`${warning.shiftId}-${warning.rule}`} tone="warning">
              <span className="grid gap-1">
                <span>
                  {startsAt.has(warning.shiftId)
                    ? `${formatPerthDay(perthDateOf(startsAt.get(warning.shiftId)!))}: `
                    : ""}
                  {warning.words}
                </span>
                <span className="text-xs text-[color:var(--text-muted)]">
                  Clause {warning.citation.clause}: “{warning.citation.quote}”
                  {warning.exception
                    ? ` Exception, clause ${warning.exception.clause}: “${warning.exception.quote}”`
                    : ""}
                </span>
              </span>
            </ModeNotice>
          ))}
        </section>
      ) : null}

      <p className={cn(modeSecondaryText, "px-3 text-xs")}>
        Rostered hours only. Leave and on call from home are not counted as worked. Limits from the{" "}
        {FATIGUE_RULE_SET.source.title}, clause 15.
      </p>
    </div>
  );
}
