"use client";

import { BedDouble, Phone } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { modeNameText, modeSecondaryText } from "@/components/mode-kit/type";
import { OnCallToolNavHeader } from "@/components/on-call/on-call-nav-header";
import { useRosterShifts, type MyShift } from "@/components/roster/use-roster-shifts";
import { cn, eyebrowText } from "@/components/ui-primitives";
import {
  ON_CALL_PULSE_HOURS,
  onCallPulseNights,
  onCallPulsePeak,
  type OnCallPulseNight,
} from "@/lib/on-call/call-counts";
import {
  onCallCallCountsStorageKey,
  onCallDeviceStateChangedEvent,
  onCallDeviceStoreChangedEvent,
} from "@/lib/on-call/device-state-keys";
import { fatigueWarnings } from "@/lib/roster/fatigue-rules";
import { FATIGUE_RULE_SET } from "@/lib/roster/fatigue-rules-source";
import { inferShiftKind, isWorkedKind } from "@/lib/roster/shift-kind";

/*
 * SHIFT PULSE: how the night is going for the doctor, not the patients.
 *
 * Two things, both from data the app already holds:
 *  - calls by hour, from the counts the call log keeps (counts only, never
 *    what a call was about); and
 *  - the rest before the next rostered shift, against the agreement's 10 hour
 *    break, shown only while the owner's signed fatigue rules are switched on.
 *
 * Breaks during the shift, "too tired to drive" and overtime capture are in
 * the mock-up but wait for the owner's sign-off of their agreement wording.
 */

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const events = [onCallDeviceStoreChangedEvent, onCallDeviceStateChangedEvent, "storage"] as const;
  for (const name of events) window.addEventListener(name, onChange);
  return () => {
    for (const name of events) window.removeEventListener(name, onChange);
  };
}

function readCounts(): string {
  try {
    return window.localStorage.getItem(onCallCallCountsStorageKey) ?? "";
  } catch {
    return "";
  }
}

const HOUR_MS = 3_600_000;

/** Four steps, so a busy hour reads at a glance and a quiet one still shows it was counted. */
function cellTone(count: number): string {
  if (count <= 0) return "bg-[color:color-mix(in_oklab,var(--border)_70%,transparent)]";
  if (count === 1) return "bg-[color:color-mix(in_oklab,var(--mode-identity)_30%,var(--surface-raised))]";
  if (count === 2) return "bg-[color:color-mix(in_oklab,var(--mode-identity)_60%,var(--surface-raised))]";
  return "bg-[color:var(--mode-identity)]";
}

function hourWords(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function CallsByHour({ nights }: { readonly nights: readonly OnCallPulseNight[] }) {
  const peak = onCallPulsePeak(nights);
  const total = nights.reduce((sum, night) => sum + night.counts.reduce((a, b) => a + b, 0), 0);
  return (
    <section
      aria-labelledby="on-call-pulse-calls-heading"
      className="grid min-w-0 gap-2"
      data-testid="on-call-pulse-calls"
    >
      <div className="flex items-baseline justify-between gap-3 px-3">
        <h2 id="on-call-pulse-calls-heading" className={eyebrowText}>
          Calls by hour
        </h2>
        <p className="text-xs font-semibold text-[color:var(--text-muted)]">Counts only</p>
      </div>
      <div className={cn(modeModuleSurface, "grid min-w-0 gap-3 p-3")}>
        {total === 0 ? (
          <p className={modeSecondaryText} data-testid="on-call-pulse-calls-empty">
            No calls noted after hours this week. Each call you note in the call log is counted here by its hour, and
            nothing else about it is kept.
          </p>
        ) : null}
        <table className="w-full table-fixed border-separate border-spacing-[3px]">
          <caption className="sr-only">
            Calls noted in each hour from 17:00 to 08:00, for tonight and the four nights before
          </caption>
          <thead>
            <tr>
              <th scope="col" className="w-14">
                <span className="sr-only">Night</span>
              </th>
              {ON_CALL_PULSE_HOURS.map((hour, i) => (
                <th key={hour} scope="col" className="p-0 text-2xs font-semibold text-[color:var(--text-muted)]">
                  {/* Every fourth hour is labelled; the rest stay readable to assistive technology. */}
                  <span aria-hidden={i % 4 === 0 ? undefined : true} className={i % 4 === 0 ? "" : "invisible"}>
                    {i % 4 === 0 ? String(hour).padStart(2, "0") : ""}
                  </span>
                  {i % 4 === 0 ? null : <span className="sr-only">{hourWords(hour)}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {nights.map((night) => (
              <tr key={night.label}>
                <th
                  scope="row"
                  className={cn(
                    "pr-1 text-left text-xs font-semibold",
                    night.label === "Tonight" ? "text-[color:var(--text-heading)]" : "text-[color:var(--text-muted)]",
                  )}
                >
                  {night.label}
                </th>
                {night.counts.map((count, i) => (
                  <td key={ON_CALL_PULSE_HOURS[i]} className="p-0">
                    <span
                      className={cn("block h-5 rounded-sm forced-colors:border", cellTone(count))}
                      title={`${hourWords(ON_CALL_PULSE_HOURS[i]!)}: ${count}`}
                    >
                      <span className="sr-only">
                        {hourWords(ON_CALL_PULSE_HOURS[i]!)}, {count === 1 ? "1 call" : `${count} calls`}
                      </span>
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <ul
            role="list"
            aria-label="Key"
            className="flex items-center gap-2 text-2xs font-semibold text-[color:var(--text-muted)]"
          >
            {[0, 1, 2, 3].map((n) => (
              <li key={n} className="inline-flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className={cn("inline-block size-3 rounded-sm forced-colors:border", cellTone(n))}
                />
                {n === 3 ? "3+" : n}
              </li>
            ))}
          </ul>
          {peak ? (
            <p className="text-xs font-semibold text-[color:var(--mode-identity)]" data-testid="on-call-pulse-peak">
              Busiest {peak}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

type RestView = {
  readonly hours: number;
  readonly from: string;
  readonly next: MyShift;
};

/** The rostered break this shift ends with: from the end of the current (or last) worked shift to the start of the next. */
function restBeforeNext(shifts: readonly MyShift[], now: Date): RestView | null {
  const worked = shifts
    .filter((shift) => isWorkedKind(shift.kind ?? inferShiftKind(shift)))
    .slice()
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const at = now.getTime();
  const current = worked.find((shift) => Date.parse(shift.startsAt) <= at && at < Date.parse(shift.endsAt));
  const last = current ?? [...worked].reverse().find((shift) => Date.parse(shift.endsAt) <= at);
  if (!last) return null;
  // A last shift more than a day ago says nothing about tonight's rest.
  if (!current && at - Date.parse(last.endsAt) > 24 * HOUR_MS) return null;
  const next = worked.find((shift) => Date.parse(shift.startsAt) >= Date.parse(last.endsAt) && shift.id !== last.id);
  if (!next) return null;
  const hours = (Date.parse(next.startsAt) - Date.parse(last.endsAt)) / HOUR_MS;
  if (!Number.isFinite(hours) || hours < 0) return null;
  return { hours, from: last.endsAt, next };
}

function perthWhen(iso: string, withDay: boolean): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Perth",
    weekday: withDay ? "short" : undefined,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const time = `${part("hour")}:${part("minute")}`;
  return withDay ? `${part("weekday")} ${time}` : time;
}

function RestCard({ rest }: { readonly rest: RestView }) {
  const rule = FATIGUE_RULE_SET.rules.minBreakHours;
  const short = rest.hours < rule.hours;
  const shown = Math.round(rest.hours * 10) / 10;
  // The bar runs to the next shift, or to twice the minimum when that is further, so the mark always shows.
  const span = Math.max(rest.hours, rule.hours * 2);
  const markAt = Math.min(100, (rule.hours / span) * 100);
  const fill = Math.min(100, (rest.hours / span) * 100);
  return (
    <section
      aria-labelledby="on-call-pulse-rest-heading"
      className="grid min-w-0 gap-2"
      data-testid="on-call-pulse-rest"
    >
      <h2 id="on-call-pulse-rest-heading" className={cn(eyebrowText, "px-3")}>
        Rest before your next shift
      </h2>
      <div className={cn(modeModuleSurface, "grid min-w-0 gap-3 p-3")}>
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <p className="min-w-0">
            <span className="nums text-2xl font-semibold text-[color:var(--text-heading)]">{shown} h</span>{" "}
            <span className={modeSecondaryText}>· next shift {perthWhen(rest.next.startsAt, true)}</span>
          </p>
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
              short
                ? "bg-[color:var(--warning-soft)] text-[color:var(--warning-text)]"
                : "bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]",
            )}
            data-testid="on-call-pulse-rest-chip"
          >
            {short ? `Under ${rule.hours} h` : `Over ${rule.hours} h`}
          </span>
        </div>
        {/* SVG attributes rather than inline styles: the bar's length is data, not a design token. */}
        <svg aria-hidden="true" className="block h-4 w-full overflow-visible" preserveAspectRatio="none">
          <rect x="0" y="4" width="100%" height="8" rx="4" className="fill-[color:var(--surface-subtle)]" />
          <rect
            x="0"
            y="4"
            width={`${fill}%`}
            height="8"
            rx="4"
            className={short ? "fill-[color:var(--warning)]" : "fill-[color:var(--mode-identity)]"}
          />
          <rect x={`${markAt}%`} y="0" width="2" height="16" rx="1" className="fill-[color:var(--text-heading)]" />
        </svg>
        <div className="flex justify-between gap-2 text-2xs font-semibold text-[color:var(--text-muted)]">
          <span>{perthWhen(rest.from, false)}</span>
          <span>{rule.hours} h minimum</span>
          <span>{perthWhen(rest.next.startsAt, true)}</span>
        </div>
        <p className={modeSecondaryText}>
          Clause {rule.clause}: &ldquo;{rule.quote}&rdquo; Your agreement may allow exceptions the roster cannot see.
        </p>
      </div>
    </section>
  );
}

export function OnCallShiftPulsePage() {
  const raw = useSyncExternalStore(subscribe, readCounts, () => undefined);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const roster = useRosterShifts();
  const nights = useMemo(
    () => (raw === undefined || now === null ? null : onCallPulseNights(raw || null, now)),
    [raw, now],
  );
  const rest = useMemo(() => {
    if (now === null || roster.status !== "ready" || roster.sample) return null;
    if (!fatigueWarnings([], undefined, undefined, now.getTime()).gate.on) return null;
    return restBeforeNext(roster.shifts, now);
  }, [now, roster.status, roster.sample, roster.shifts]);

  return (
    <>
      <OnCallToolNavHeader title="Shift pulse" testIdPrefix="on-call-pulse" />
      <InformationPageShell testId="on-call-pulse-main" width="narrow">
        <h1 className="sr-only">Shift pulse</h1>
        <div className="grid min-w-0 gap-5" data-mode-identity="on-call">
          {nights === null ? (
            <p role="status">Reading this phone&apos;s call counts…</p>
          ) : (
            <CallsByHour nights={nights} />
          )}
          {rest ? <RestCard rest={rest} /> : null}
          <nav aria-label="Related" className={cn(modeModuleSurface, "grid")}>
            <Link
              href="/on-call/call"
              className="flex min-h-13 items-center gap-3 px-3 no-underline"
              data-testid="on-call-pulse-call-log"
            >
              <span
                aria-hidden="true"
                className="grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
              >
                <Phone aria-hidden="true" className="size-icon-sm" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn(modeNameText, "block")}>Note a call</span>
                <span className={cn(modeSecondaryText, "block")}>Each one is counted here by its hour</span>
              </span>
            </Link>
            {rest === null ? null : (
              <Link
                href="/roster"
                className="flex min-h-13 items-center gap-3 border-t border-[color:var(--border)] px-3 no-underline"
                data-testid="on-call-pulse-roster"
              >
                <span
                  aria-hidden="true"
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
                >
                  <BedDouble aria-hidden="true" className="size-icon-sm" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn(modeNameText, "block")}>Your roster</span>
                  <span className={cn(modeSecondaryText, "block")}>Hours and rest across the fortnight</span>
                </span>
              </Link>
            )}
          </nav>
        </div>
      </InformationPageShell>
    </>
  );
}
