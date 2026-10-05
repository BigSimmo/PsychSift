"use client";

import { Check, Clock, Coffee, Link2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { modeSecondaryText } from "@/components/mode-kit/type";
import { onCallActionLink, onCallFilledButton, onCallLeadingIcon } from "@/components/on-call/kit/calm";
import { OnCallGroupedList, OnCallRow } from "@/components/on-call/kit/grouped-list";
import { OnCallToolNavHeader } from "@/components/on-call/on-call-nav-header";
import { useRosterShifts, type MyShift } from "@/components/roster/use-roster-shifts";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { endOnCallBreak, onCallBreaksFrom, startOnCallBreak, type OnCallBreak } from "@/lib/on-call/break-log";
import {
  ON_CALL_PULSE_HOURS,
  onCallPulseNights,
  onCallPulsePeak,
  type OnCallPulseNight,
} from "@/lib/on-call/call-counts";
import {
  onCallBreaksStorageKey,
  onCallCallCountsStorageKey,
  onCallDeviceStateChangedEvent,
  onCallDeviceStoreChangedEvent,
} from "@/lib/on-call/device-state-keys";
import { formatOnCallDate, formatOnCallTime } from "@/lib/on-call/display-dates";
import { fatigueWarnings } from "@/lib/roster/fatigue-rules";
import { FATIGUE_RULE_SET, FATIGUE_RULES_SIGN_OFF } from "@/lib/roster/fatigue-rules-source";
import { inferShiftKind, isWorkedKind } from "@/lib/roster/shift-kind";

/*
 * SHIFT PULSE (mock-up v10 s-14): how the night is going for the doctor, not
 * the patients. Everything here comes from data the app already holds:
 *  - breaks, from this phone's own break times (start and end only, dropped
 *    16 hours later and at sign-out). The page counts breaks; it never says
 *    how many are owed, because that agreement rule is not in the signed set;
 *  - calls by hour, from the counts the call log keeps (counts only, never
 *    what a call was about);
 *  - the rest before the next rostered shift, against the agreement's 10 hour
 *    break, shown only while the owner's signed fatigue rules are switched on;
 *  - a way to the roster when the shift ran over.
 *
 * "Too tired to drive" (a taxi home under the agreement) and overtime capture
 * are in the mock-up but wait for the owner's sign-off of that agreement
 * wording, so neither is drawn.
 */

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const events = [onCallDeviceStoreChangedEvent, onCallDeviceStateChangedEvent, "storage"] as const;
  for (const name of events) window.addEventListener(name, onChange);
  return () => {
    for (const name of events) window.removeEventListener(name, onChange);
  };
}

function readKey(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
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

type ShiftNow = {
  /** The worked shift running now, if any. */
  readonly current: MyShift | null;
  /** The current shift, or the last one that ended within a day. */
  readonly last: MyShift | null;
  readonly worked: readonly MyShift[];
};

function shiftNow(shifts: readonly MyShift[], now: Date): ShiftNow {
  const worked = shifts
    .filter((shift) => isWorkedKind(shift.kind ?? inferShiftKind(shift)))
    .slice()
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const at = now.getTime();
  const current = worked.find((shift) => Date.parse(shift.startsAt) <= at && at < Date.parse(shift.endsAt)) ?? null;
  const ended = [...worked].reverse().find((shift) => Date.parse(shift.endsAt) <= at) ?? null;
  // A last shift more than a day ago says nothing about tonight.
  const recent = ended && at - Date.parse(ended.endsAt) <= 24 * HOUR_MS ? ended : null;
  return { current, last: current ?? recent, worked };
}

// ---------------------------------------------------------------- breaks

function BreaksCard({ breaks, shift }: { readonly breaks: readonly OnCallBreak[]; readonly shift: MyShift | null }) {
  const running = breaks.find((entry) => entry.endedAt === null) ?? null;
  const taken = breaks.length;
  const lastEnded = [...breaks].reverse().find((entry) => entry.endedAt !== null) ?? null;
  const title = running
    ? `On a break since ${formatOnCallTime(running.startedAt)}`
    : lastEnded
      ? `Last break ended ${formatOnCallTime(lastEnded.endedAt)}`
      : "No break noted yet";
  return (
    <section
      aria-labelledby="on-call-pulse-breaks-heading"
      className="grid min-w-0 gap-3"
      data-testid="on-call-pulse-breaks"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "grid size-16 shrink-0 place-items-center rounded-full border-4 forced-colors:border",
            running ? "border-[color:var(--mode-identity)]" : "border-[color:var(--surface-wash)]",
          )}
          data-testid="on-call-pulse-breaks-count"
        >
          <span className="grid justify-items-center leading-none">
            <span className="nums text-lg-minus font-semibold text-[color:var(--text-heading)]">{taken}</span>
            <span className="text-2xs text-[color:var(--text-muted)]">{taken === 1 ? "break" : "breaks"}</span>
          </span>
        </span>
        <div className="grid min-w-0 gap-0.5">
          <p id="on-call-pulse-breaks-heading" className={cn(eyebrowText, "nums")}>
            {shift ? `${perthWhen(shift.startsAt, true)} – ${perthWhen(shift.endsAt, true)}` : "This shift"}
          </p>
          <p
            aria-live="polite"
            className="text-lg-minus font-semibold leading-6 text-[color:var(--text-heading)]"
            data-testid="on-call-pulse-breaks-title"
          >
            {title}
          </p>
          <p className={modeSecondaryText}>Start and end times only, kept on this phone for this shift.</p>
        </div>
      </div>
      {taken > 0 ? (
        <ul role="list" aria-label="Breaks this shift" className="flex min-w-0 flex-wrap gap-2">
          {breaks.map((entry, index) => (
            <li
              key={entry.startedAt}
              className={cn(
                "nums inline-flex min-h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm forced-colors:border",
                entry.endedAt
                  ? "border-[color:var(--border)] text-[color:var(--text-muted)]"
                  : "border-[color:var(--text-heading)] font-semibold text-[color:var(--text-heading)]",
              )}
            >
              {entry.endedAt ? (
                <Check aria-hidden="true" className="size-icon-xs shrink-0" />
              ) : (
                <Coffee aria-hidden="true" className="size-icon-xs shrink-0" />
              )}
              {entry.endedAt
                ? `Break ${index + 1} · ${formatOnCallTime(entry.startedAt)}–${formatOnCallTime(entry.endedAt)}`
                : `Break ${index + 1} · since ${formatOnCallTime(entry.startedAt)}`}
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <button
          type="button"
          onClick={() => {
            const since = shift ? new Date(shift.startsAt) : null;
            if (running) endOnCallBreak(new Date(), since);
            else startOnCallBreak(new Date(), since);
          }}
          className={cn(onCallFilledButton, focusRing, "min-w-40")}
          data-testid="on-call-pulse-break-toggle"
        >
          <Coffee aria-hidden="true" className="size-icon-sm" />
          {running ? "End break" : "Start break"}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- calls by hour

function CallsByHour({ nights }: { readonly nights: readonly OnCallPulseNight[] }) {
  // The four nights before tonight, as Now's Shift pulse card counts them, so the two never disagree.
  const peak = onCallPulsePeak(nights.slice(1));
  const total = nights.reduce((sum, night) => sum + night.counts.reduce((a, b) => a + b, 0), 0);
  return (
    <section
      aria-labelledby="on-call-pulse-calls-heading"
      className="grid min-w-0 gap-2"
      data-testid="on-call-pulse-calls"
    >
      <div className="flex min-h-12 min-w-0 flex-wrap items-center justify-between gap-x-3 px-1">
        <h2 id="on-call-pulse-calls-heading" className={eyebrowText}>
          Calls by hour
        </h2>
        <p className="text-xs font-semibold text-[color:var(--text-muted)]">counts only, kept a week</p>
      </div>
      {total === 0 ? (
        <div className="grid gap-1 px-1">
          <p className={modeSecondaryText} data-testid="on-call-pulse-calls-empty">
            No calls noted between 17:00 and 08:00 this week. Each call you note in the call log is counted here by its
            hour, and nothing else about it is kept.
          </p>
          <Link
            href="/on-call#log-a-call"
            className={cn(onCallActionLink, focusRing)}
            data-testid="on-call-pulse-call-log"
          >
            Note a call
          </Link>
        </div>
      ) : null}
      <table className="w-full table-fixed border-separate border-spacing-[3px]">
        <caption className="sr-only">
          Calls noted in each hour from 17:00 to 08:00, for tonight and the four nights before
        </caption>
        <colgroup>
          <col className="w-16" />
        </colgroup>
        <thead className="sr-only">
          <tr>
            <th scope="col">Night</th>
            {ON_CALL_PULSE_HOURS.map((hour) => (
              <th key={hour} scope="col">
                {hourWords(hour)}
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
                    className={cn("block h-4 rounded-sm forced-colors:border", cellTone(count))}
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
        <tfoot aria-hidden="true">
          <tr>
            <td />
            {ON_CALL_PULSE_HOURS.map((hour, i) =>
              i % 4 === 0 ? (
                <td
                  key={hour}
                  colSpan={Math.min(4, ON_CALL_PULSE_HOURS.length - i)}
                  className="nums pt-1 text-left text-2xs font-semibold text-[color:var(--text-muted)]"
                >
                  {hourWords(hour)}
                </td>
              ) : null,
            )}
          </tr>
        </tfoot>
      </table>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-1">
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
          <p className="nums text-xs font-semibold text-[color:var(--text-heading)]" data-testid="on-call-pulse-peak">
            Busiest {peak.replace(" to ", "–")} on your last 4 nights
          </p>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- rest

type RestView = {
  readonly hours: number;
  readonly from: string;
  readonly next: MyShift;
};

/** The rostered break this shift ends with: from the end of the current (or last) worked shift to the start of the next. */
function restBeforeNext(shift: ShiftNow): RestView | null {
  const { last, worked } = shift;
  if (!last) return null;
  const next = worked.find(
    (candidate) => Date.parse(candidate.startsAt) >= Date.parse(last.endsAt) && candidate.id !== last.id,
  );
  if (!next) return null;
  const hours = (Date.parse(next.startsAt) - Date.parse(last.endsAt)) / HOUR_MS;
  if (!Number.isFinite(hours) || hours < 0) return null;
  return { hours, from: last.endsAt, next };
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
      <h2 id="on-call-pulse-rest-heading" className={cn(eyebrowText, "flex min-h-12 items-center px-1")}>
        Rest before your next shift
      </h2>
      <div className="grid min-w-0 gap-2 px-1">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="grid min-w-0 gap-0.5">
            <p className="nums text-2xl font-semibold text-[color:var(--text-heading)]">{shown} h</p>
            <p className={modeSecondaryText}>{`Next shift ${perthWhen(rest.next.startsAt, true)}, from your Roster`}</p>
          </div>
          <p
            className={cn(
              "shrink-0 pt-2 text-xs font-semibold",
              short ? "text-[color:var(--warning-text)]" : "text-[color:var(--text-heading)]",
            )}
            data-testid="on-call-pulse-rest-chip"
          >
            {short ? `Under ${rule.hours} h` : `Over ${rule.hours} h`}
          </p>
        </div>
        {/* SVG attributes rather than inline styles: the bar's length is data, not a design token. */}
        <svg aria-hidden="true" className="block h-3 w-full overflow-visible" preserveAspectRatio="none">
          <rect x="0" y="4" width="100%" height="4" rx="2" className="fill-[color:var(--surface-wash)]" />
          <rect
            x="0"
            y="4"
            width={`${fill}%`}
            height="4"
            rx="2"
            className={short ? "fill-[color:var(--warning)]" : "fill-[color:var(--mode-identity)]"}
          />
          <rect x={`${markAt}%`} y="0" width="2" height="12" rx="1" className="fill-[color:var(--text-heading)]" />
        </svg>
        <div className="nums flex justify-between gap-2 text-2xs font-semibold text-[color:var(--text-muted)]">
          <span>{`${perthWhen(rest.from, true)} · ${rule.hours} h minimum`}</span>
          <span>{perthWhen(rest.next.startsAt, true)}</span>
        </div>
        <p className="text-xs text-[color:var(--text-muted)]">
          Clause {rule.clause}: &ldquo;{rule.quote}&rdquo; Your agreement may allow exceptions the roster cannot see.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- page

export function OnCallShiftPulsePage() {
  const counts = useSyncExternalStore(
    subscribe,
    () => readKey(onCallCallCountsStorageKey),
    () => undefined,
  );
  const breaksRaw = useSyncExternalStore(
    subscribe,
    () => readKey(onCallBreaksStorageKey),
    () => undefined,
  );
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const roster = useRosterShifts();
  const nights = useMemo(
    () => (counts === undefined || now === null ? null : onCallPulseNights(counts || null, now)),
    [counts, now],
  );
  // Roster's example roster (a doctor with no shifts of their own) is never a real shift here.
  const shift = useMemo(() => {
    if (now === null || roster.status !== "ready" || roster.sample) return null;
    return shiftNow(roster.shifts, now);
  }, [now, roster.status, roster.sample, roster.shifts]);
  const gateOn = useMemo(
    () => (now === null ? false : fatigueWarnings([], undefined, undefined, now.getTime()).gate.on),
    [now],
  );
  const rest = shift && gateOn ? restBeforeNext(shift) : null;
  const breaks = useMemo(
    () =>
      now === null || breaksRaw === undefined || roster.status === "loading"
        ? null
        : onCallBreaksFrom(breaksRaw || null, now, shift?.current ? new Date(shift.current.startsAt) : null),
    [breaksRaw, now, shift, roster.status],
  );
  const signedAt = FATIGUE_RULES_SIGN_OFF.signedAt;

  return (
    <>
      <OnCallToolNavHeader title="Shift pulse" testIdPrefix="on-call-pulse" />
      <InformationPageShell testId="on-call-pulse-main" width="narrow">
        <h1 className="sr-only">Shift pulse</h1>
        <div className="mt-2 grid min-w-0 gap-5" data-mode-identity="on-call">
          {breaks === null || now === null ? (
            <p role="status">Reading this phone&apos;s break times…</p>
          ) : (
            <BreaksCard breaks={breaks} shift={shift?.current ?? null} />
          )}
          {nights === null ? (
            <p role="status">Reading this phone&apos;s call counts…</p>
          ) : (
            <CallsByHour nights={nights} />
          )}
          {rest ? <RestCard rest={rest} /> : null}
          {shift?.last ? (
            <OnCallGroupedList testId="on-call-pulse-overtime">
              <OnCallRow
                title={`Stayed past ${perthWhen(shift.last.endsAt, false)}?`}
                subtitle="Your shifts and hours are in Roster"
                leading={<Clock aria-hidden="true" strokeWidth={1.5} className={onCallLeadingIcon} />}
                href="/roster"
                testId="on-call-pulse-roster"
              />
            </OnCallGroupedList>
          ) : null}
          {rest && signedAt ? (
            <p
              className="flex min-w-0 items-start gap-1.5 px-1 text-xs text-[color:var(--text-muted)]"
              data-testid="on-call-pulse-rules"
            >
              <Link2 aria-hidden="true" className="mt-0.5 size-icon-xs shrink-0" />
              <span>
                {`Rest rule: ${FATIGUE_RULE_SET.source.title}, clause ${FATIGUE_RULE_SET.rules.minBreakHours.clause}. Signed off ${formatOnCallDate(signedAt)}. Breaks are counted here, not checked against the agreement.`}
              </span>
            </p>
          ) : null}
        </div>
      </InformationPageShell>
    </>
  );
}
