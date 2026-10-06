"use client";

import { Info, RefreshCw, TriangleAlert } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { cn } from "@/components/ui-primitives";
import { FATIGUE_RULE_SET } from "@/lib/roster/fatigue-rules-source";
import { hoursRestCheck, type HoursRestBreak, type HoursRestGauge } from "@/lib/roster/hours-rest-check";
import { formatSpanWords, longestRecentNightRun } from "@/lib/roster/shifts-overview";
import { WEEKDAYS, formatPerthDay, perthDateOf } from "@/lib/roster/shifts/perth-time";
import type { RosterDisplayShift as OnCallShift } from "@/lib/roster/team/team-view";

import { formatHours, kindOf } from "./roster-format";
import { RosterFootnote, RosterNote, RosterSectionHead, rosterOutlineButton } from "./roster-list";

/**
 * Hours and rest: the next 14 days against the signed agreement limits, drawn rather than
 * lectured. Any warning leads, in amber, with the clause's exact words. Every gauge puts its
 * limit at the same place on the track, so the eye scans one line; a figure past it turns amber.
 * Neutral words only: what the roster shows and the clause, never that anything is unlawful or
 * what to do. Loaded only when Hours & rest opens.
 *
 * With only part of the roster loaded every figure is a minimum ("at least"), breaks wait for the
 * whole roster, and the page says a warning could be missing. With the rules off nothing is
 * measured, and the page says that no warning does not mean within the limits.
 */

/** Where the limit mark sits on every gauge track, as a share of the track (`left-4/5` below). */
const LIMIT_AT = 0.8;
/**
 * The breaks chart runs to 4.8 times the minimum break (48 hours for a 10 hour minimum), so the
 * minimum line sits at a fixed place (`left-[calc(100%/4.8)]` below) whatever the signed figure.
 */
const BREAK_SCALE_FACTOR = 4.8;

/** A bar filled to `share` of its track, drawn in SVG so its width needs no inline style. */
function BarFill({ share, className }: { readonly share: number; readonly className: string }) {
  return (
    <svg aria-hidden="true" className="absolute inset-0 size-full overflow-visible">
      <rect width={`${share * 100}%`} height="100%" rx="3" className={className} />
    </svg>
  );
}

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

function Gauge({
  gauge,
  partial,
  warned,
}: {
  readonly gauge: HoursRestGauge;
  readonly partial: boolean;
  readonly warned: boolean;
}) {
  // Five nights can be within clause 15(6)(f)'s exception, which the signed check allows without
  // a warning; the nights gauge is over its limit only when that check warns.
  const over = gauge.value > gauge.limit && (gauge.rule !== "maxNightsInRow" || warned);
  const fill = Math.min(1, (gauge.value / gauge.limit) * LIMIT_AT);
  const label = GAUGE_LABEL[gauge.rule];
  const value = `${partial ? "at least " : ""}${gauge.unit === "hours" ? formatHours(gauge.value) : String(gauge.value)}`;
  return (
    <li
      className="relative grid gap-2 px-4 py-3 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[color:var(--border)] before:content-[''] first:before:hidden"
      data-testid={`roster-hours-rest-${gauge.rule}`}
      data-over={over ? "true" : undefined}
      aria-label={`${label.title}: ${value}. ${label.limit(gauge.limit)}, clause ${gauge.clause}.${over ? " Over the limit." : ""}`}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="grid min-w-0">
          <span className="text-base-minus font-semibold text-[color:var(--text-heading)]">{label.title}</span>
          <span className="text-xs text-[color:var(--text-muted)]">
            {label.limit(gauge.limit)} · clause {gauge.clause}
            {over ? <span className="text-[color:var(--warning-text)]"> · Over the limit</span> : null}
          </span>
        </div>
        <span
          className={cn(
            "nums shrink-0 whitespace-nowrap text-lg-minus font-semibold",
            over ? "text-[color:var(--warning-text)]" : "text-[color:var(--text-heading)]",
          )}
        >
          {value}
        </span>
      </div>
      <div
        aria-hidden="true"
        className="relative h-1.5 rounded-full bg-[color:color-mix(in_oklab,var(--text-heading)_7%,var(--surface-raised))]"
      >
        <BarFill share={fill} className={over ? "fill-[color:var(--warning)]" : "fill-[color:var(--mode-identity)]"} />
        <span className="absolute -inset-y-1.5 left-4/5 w-0.5 rounded-full bg-[color:var(--text-heading)]" />
      </div>
    </li>
  );
}

function BreakRow({ item, minBreakHours }: { readonly item: HoursRestBreak; readonly minBreakHours: number }) {
  const short = item.hours < minBreakHours;
  const width = Math.min(1, item.hours / (minBreakHours * BREAK_SCALE_FACTOR));
  const span =
    item.fromDate === item.toDate ? weekday(item.toDate) : `${weekday(item.fromDate)} to ${weekday(item.toDate)}`;
  return (
    <li
      className="relative grid min-h-12 grid-cols-[minmax(0,7.5rem)_minmax(2.5rem,1fr)_auto] items-center gap-3 px-4 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[color:var(--border)] before:content-[''] first:before:hidden"
      data-testid="roster-hours-rest-break"
      data-short={short ? "true" : undefined}
    >
      <span
        className={cn(
          "break-words text-sm",
          short ? "font-semibold text-[color:var(--warning-text)]" : "text-[color:var(--text-muted)]",
        )}
        aria-hidden="true"
      >
        {span}
      </span>
      {/* The bar carries the row's one spoken label; the words either side repeat it visually. */}
      <span
        role="img"
        aria-label={`${span}: ${formatHours(item.hours)} break${short ? `, under ${minBreakHours} hours` : ""}`}
        className="relative h-2"
      >
        <BarFill
          share={Math.max(width, 0.02)}
          className={
            short
              ? "fill-[color:var(--warning)]"
              : "fill-[color:color-mix(in_oklab,var(--mode-identity)_50%,var(--surface-raised))]"
          }
        />
        <span className="absolute -inset-y-1.5 left-[calc(100%/4.8)] border-l-[1.5px] border-dashed border-[color:var(--text-heading)]" />
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "nums whitespace-nowrap text-right text-base-minus font-semibold",
          short ? "text-[color:var(--warning-text)]" : "text-[color:var(--text-heading)]",
        )}
      >
        {formatHours(item.hours)}
        {short ? " · short" : ""}
      </span>
    </li>
  );
}

/** The rules the gauges and breaks do not draw, named when they found nothing. */
const UNDRAWN = [
  {
    rule: "restAfterNights",
    words: `rest after nights (${FATIGUE_RULE_SET.rules.restAfterNights.bands.map((band) => band.hours).join(" or ")} hours, clause ${FATIGUE_RULE_SET.rules.restAfterNights.clause})`,
  },
  {
    rule: "maxDaysBeforeTwoDaysOff",
    words: `${FATIGUE_RULE_SET.rules.maxDaysBeforeTwoDaysOff.hoursOff} hours free from all duty after ${FATIGUE_RULE_SET.rules.maxDaysBeforeTwoDaysOff.days} days' work (clause ${FATIGUE_RULE_SET.rules.maxDaysBeforeTwoDaysOff.clause})`,
  },
] as const;

export function RosterHoursRestCheck({
  shifts,
  now,
  partial = false,
  onRetry,
  offSummary,
  children,
}: {
  readonly shifts: readonly OnCallShift[];
  readonly now: Date;
  /** Only part of the roster loaded (a team roster failed), so every figure is a minimum. */
  readonly partial?: boolean;
  readonly onRetry?: () => void;
  /** What still shows while the rules are off: the fortnight's rostered hours. */
  readonly offSummary?: ReactNode;
  /** Extra time, drawn between the check and its footnote. */
  readonly children?: ReactNode;
}) {
  const check = useMemo(
    () =>
      hoursRestCheck(
        shifts.map((shift) => ({ id: shift.id, startsAt: shift.startsAt, endsAt: shift.endsAt, kind: kindOf(shift) })),
        now,
      ),
    [shifts, now],
  );
  const startsAt = useMemo(() => new Map(shifts.map((shift) => [shift.id, shift.startsAt])), [shifts]);
  // Includes a long run that ended before the window, whose rest the signed check cannot measure.
  const recentNights = useMemo(
    () =>
      longestRecentNightRun(
        shifts.map((shift) => ({
          id: shift.id,
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
          kind: kindOf(shift),
          place: null,
        })),
        now,
      ),
    [shifts, now],
  );

  if (!check.on) {
    return (
      <div className="grid min-w-0 gap-3" data-testid="roster-hours-rest-off">
        <RosterNote icon={Info}>
          <p>
            <span className="font-semibold text-[color:var(--text-heading)]">
              Hours and rest checks are off until the rules are signed off.
            </span>{" "}
            No warnings are shown, and that does not mean your roster is within the limits.
          </p>
        </RosterNote>
        {offSummary}
        {children}
      </div>
    );
  }

  const warned = new Set(check.warnings.map((warning) => warning.rule));
  // The signed check does not measure rest after a night run longer than its bands cover, so
  // rest after nights is not named as checked when such a run (or a nights warning) is present.
  const longestNights = check.gauges.find((gauge) => gauge.rule === "maxNightsInRow")?.value ?? 0;
  const restBands = FATIGUE_RULE_SET.rules.restAfterNights.bands;
  const coveredNights = restBands[restBands.length - 1]!.upToNights;
  const nightsUncovered = warned.has("maxNightsInRow") || Math.max(longestNights, recentNights) > coveredNights;
  const undrawn = UNDRAWN.filter(
    (item) => !warned.has(item.rule) && !(item.rule === "restAfterNights" && nightsUncovered),
  );

  return (
    <div className="grid min-w-0 gap-3" data-testid="roster-hours-rest">
      {partial ? (
        <>
          <RosterNote icon={Info} testId="roster-hours-rest-partial">
            <p>
              <span className="font-semibold text-[color:var(--text-heading)]">Only part of your roster loaded.</span>{" "}
              These figures are minimums. The real figures could be higher, and a warning could be missing.
            </p>
          </RosterNote>
          {onRetry ? (
            <button type="button" onClick={onRetry} className={rosterOutlineButton}>
              <RefreshCw aria-hidden="true" strokeWidth={1.6} className="size-icon-md text-[color:var(--text-muted)]" />
              Try again
            </button>
          ) : null}
        </>
      ) : null}

      {check.warnings.length ? (
        <div className="grid gap-2" data-testid="roster-hours-rest-warnings">
          {check.warnings.map((warning) => (
            <RosterNote key={`${warning.shiftId}-${warning.rule}`} icon={TriangleAlert} tone="warning">
              <p className="font-semibold text-[color:var(--text-heading)]">
                {startsAt.has(warning.shiftId)
                  ? `${formatPerthDay(perthDateOf(startsAt.get(warning.shiftId)!))}: `
                  : ""}
                {warning.words}
              </p>
              <p className="text-xs text-[color:var(--text-muted)]">
                Clause {warning.citation.clause}: “{warning.citation.quote}”
              </p>
              {warning.exception ? (
                <p className="text-xs text-[color:var(--text-muted)]">
                  Exception, clause {warning.exception.clause}: “{warning.exception.quote}”
                </p>
              ) : null}
            </RosterNote>
          ))}
        </div>
      ) : null}

      <section className="grid min-w-0 gap-3" aria-labelledby="roster-hours-rest-heading">
        <RosterSectionHead
          id="roster-hours-rest-heading"
          title="Next 14 days"
          right={
            <span className="nums text-sm text-[color:var(--text-muted)]">
              {formatSpanWords(check.start, check.end)}
            </span>
          }
        />
        <ul role="list" className={cn(modeModuleSurface, "shadow-none")} data-mode-identity="roster">
          {check.gauges.map((gauge) => (
            <Gauge key={gauge.rule} gauge={gauge} partial={partial} warned={warned.has(gauge.rule)} />
          ))}
        </ul>
      </section>

      <section className="grid min-w-0 gap-3" aria-labelledby="roster-hours-rest-breaks-heading">
        <RosterSectionHead
          id="roster-hours-rest-breaks-heading"
          title="Breaks between shifts"
          right={
            <span className="text-xs font-medium text-[color:var(--text-muted)]">
              Dashed line {check.minBreakHours} h
            </span>
          }
        />
        {partial ? (
          <RosterFootnote>Breaks are shown once your whole roster loads.</RosterFootnote>
        ) : check.breaks.length ? (
          <ul role="list" className={cn(modeModuleSurface, "shadow-none")} data-mode-identity="roster">
            {check.breaks.map((item) => (
              <BreakRow key={item.shiftId} item={item} minBreakHours={check.minBreakHours} />
            ))}
          </ul>
        ) : (
          <RosterFootnote>No breaks between worked shifts in the next 14 days.</RosterFootnote>
        )}
      </section>

      {nightsUncovered ? (
        <RosterFootnote testId="roster-hours-rest-nights-unchecked">
          Rest after more than {coveredNights} nights in a row isn&apos;t checked, because the signed rule only covers
          runs of up to {coveredNights}.
        </RosterFootnote>
      ) : null}

      {!partial && undrawn.length ? (
        <RosterFootnote testId="roster-hours-rest-also-checked">
          Also checked, nothing found: {undrawn.map((item) => item.words).join(" and ")}.
        </RosterFootnote>
      ) : null}

      {children}

      <RosterFootnote>
        Rostered hours only. Leave and on call from home are not counted as worked, and extra time is not counted, so
        your real hours may be higher. Limits from the {FATIGUE_RULE_SET.source.title}, clause 15.
      </RosterFootnote>
    </div>
  );
}
