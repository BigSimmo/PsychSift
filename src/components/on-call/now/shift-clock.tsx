"use client";

import { Clock } from "lucide-react";
import { useId } from "react";

import { WorkButton, WorkCard, WorkSectionLabel } from "@/components/mode-kit/work";
import { modeNumberText, modeSecondaryText } from "@/components/mode-kit/type";
import { cn } from "@/components/ui-primitives";
import { onCallDurationWords } from "@/lib/on-call/period-window";
import { ON_CALL_SHIFT_PERIOD_LABELS, type OnCallShiftContext } from "@/lib/on-call/shift-context";
import { perthTimeOf } from "@/lib/roster/shifts/perth-time";

const MINUTE_MS = 60_000;

const perthWeekday = new Intl.DateTimeFormat("en-AU", { weekday: "short", timeZone: "Australia/Perth" });

/** "Tue 21:00", in Perth time. */
function perthDayTime(iso: string): string {
  return `${perthWeekday.format(new Date(iso))} ${perthTimeOf(iso)}`;
}

export type OnCallShiftClock = {
  readonly periodLabel: string;
  readonly from: string;
  readonly until: string;
  readonly untilTime: string;
  readonly minutesLeft: number;
  readonly totalMinutes: number;
  /** Elapsed share of the shift, 0 to 100, whole numbers. */
  readonly percent: number;
  /** The shift's last hour: time to hand over. */
  readonly ending: boolean;
};

/**
 * The clock for the reader's own rostered shift, or null when no rostered
 * shift is on now. Only a roster shift has a real end time: a one-tap pick
 * and the wall clock are labels, never a duty (see `shift-context.ts`), so
 * neither gets a countdown.
 */
export function onCallShiftClock(context: OnCallShiftContext, now: Date): OnCallShiftClock | null {
  if (context.kind !== "roster") return null;
  const start = Date.parse(context.startsAt);
  const end = Date.parse(context.endsAt);
  const at = now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || at < start || at >= end) return null;
  const totalMinutes = Math.round((end - start) / MINUTE_MS);
  // Rounded up, so the last minute reads "1 min", never "0 min".
  const minutesLeft = Math.max(1, Math.ceil((end - at) / MINUTE_MS));
  const percent = Math.min(100, Math.max(0, Math.round(((at - start) / (end - start)) * 100)));
  return {
    periodLabel: ON_CALL_SHIFT_PERIOD_LABELS[context.period],
    from: perthDayTime(context.startsAt),
    until: perthDayTime(context.endsAt),
    untilTime: perthTimeOf(context.endsAt),
    minutesLeft,
    totalMinutes,
    percent,
    ending: context.phase === "end",
  };
}

/**
 * "Your shift" on Now (work-mode redesign idea 10, owner request 6 Oct 2026):
 * at 03:00 the question is how long until handover. One line, "Until 08:00 ·
 * 4 h 10 min left", a thin teal meter of the shift so far, and in the last hour
 * a way into Handover.
 *
 * It follows the reader's rostered shift only, and is not drawn at all without
 * one. Now's page clock already wakes on every minute, so the line and meter
 * move without a timer of their own. The meter never animates, so reduced
 * motion has nothing to stop.
 */
export function NowShiftClock({ context, now }: { readonly context: OnCallShiftContext; readonly now: Date }) {
  const headingId = useId();
  const clock = onCallShiftClock(context, now);
  if (!clock) return null;
  const left = onCallDurationWords(clock.minutesLeft);
  const spoken = `${left} left of your ${onCallDurationWords(clock.totalMinutes)} shift, ${clock.percent} percent done`;
  return (
    <section aria-labelledby={headingId} className="grid min-w-0 gap-2" data-testid="on-call-now-shift-clock">
      <div className="px-1">
        <WorkSectionLabel id={headingId} count="From your roster">
          {`Your shift · ${clock.periodLabel}`}
        </WorkSectionLabel>
      </div>
      <WorkCard padded>
        <div className="grid min-w-0 gap-2">
          <p
            className={cn(modeNumberText, "m-0 flex min-w-0 flex-wrap items-center gap-x-1.5 text-base-minus")}
            data-testid="on-call-now-shift-clock-line"
          >
            <Clock
              aria-hidden="true"
              strokeWidth={2}
              className="size-icon-sm shrink-0 text-[color:var(--mode-identity)]"
            />
            <span className="font-semibold text-[color:var(--text-heading)]">{`Until ${clock.untilTime}`}</span>
            <span className="text-[color:var(--text-muted)]">{`· ${left} left`}</span>
          </p>
          <div
            role="img"
            aria-label={spoken}
            className="h-1.5 overflow-hidden rounded-full bg-[color:var(--mode-identity-soft)] forced-colors:border forced-colors:border-[CanvasText]"
            data-testid="on-call-now-shift-clock-meter"
          >
            <span
              className="block h-full rounded-full bg-[color:var(--mode-identity)] forced-colors:bg-[Highlight]"
              style={{ width: `${clock.percent}%` }}
            />
          </div>
          <p
            aria-hidden="true"
            className={cn(modeNumberText, modeSecondaryText, "m-0 flex justify-between gap-3 text-xs")}
          >
            <span>{clock.from}</span>
            <span>{clock.until}</span>
          </p>
          {clock.ending ? (
            <div
              className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[color:var(--border)] pt-2"
              data-testid="on-call-now-shift-clock-handover"
            >
              <span className="text-sm font-semibold text-[color:var(--text-heading)]">Time to hand over</span>
              {/* A literal href: the route-reachability guard reads literal hrefs only. */}
              <WorkButton variant="tinted" href="/on-call/handover">
                Open handover
              </WorkButton>
            </div>
          ) : null}
        </div>
      </WorkCard>
    </section>
  );
}
