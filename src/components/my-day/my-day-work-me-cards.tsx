"use client";

import { Info, Lock, Moon, Phone, Shield, TriangleAlert, Users } from "lucide-react";
import Link from "next/link";
import { useId, useState, useSyncExternalStore } from "react";

import { focusRing } from "@/components/card-recipes";
import { DashSegmented } from "@/components/dashboard-kit/segmented";
import { MY_DAY_QUICK_NOTE_LIMIT, useMyDayQuickNote } from "@/components/my-day/my-day-device-state";
import {
  AreaIcon,
  DateBlock,
  QuietFoot,
  QuietList,
  QuietRing,
  QuietRow,
  QuietSection,
  QuietTextLink,
  quietLink,
  quietPrimary,
} from "@/components/my-day/my-day-quiet";
import { CpdSummary, hoursText } from "@/components/my-day/my-day-today-cards";
import type { MyDayColleague } from "@/components/my-day/use-my-day-whos-on";
import { cn } from "@/components/ui-primitives";
import type { CmeCategory } from "@/lib/cme/types";
import { WEEKDAY_LETTERS, type HoursBars, type RenewalRow } from "@/lib/my-day/figures";
import {
  durationWords,
  fullDate,
  perthWeekday,
  relativeDays,
  shortMonth,
  weekdayTime,
} from "@/lib/my-day/quiet-figures";
import { withMyDayReturn } from "@/lib/my-day/return-link";
import { perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import type { SessionSummary } from "@/lib/teaching/model";

/*
 * The Work and Me pages' cards, in My Day's quiet style: flat sections with a
 * small label, hairline rows, and one filled button per screen. Each takes
 * data that `MyDayDashboard` has already checked is real; a card with no
 * source is never drawn.
 */

/** "Tue 6 Oct". */
function dayMonth(date: string): string {
  return `${perthWeekday(date)} ${Number(date.slice(8, 10))} ${shortMonth(date)}`;
}

// ================================================================ Work

/** A minute counter for a live "time left"; null on the server and the first paint, so nothing mismatches. */
function subscribeMinute(onChange: () => void): () => void {
  const timer = window.setInterval(onChange, 30_000);
  return () => window.clearInterval(timer);
}
const minuteNow = (): number | null => Math.floor(Date.now() / 60_000);
const serverMinute = (): number | null => null;

/**
 * The on-call panel: time left out of the shift's length, and this device's
 * call log as counts only. The notes themselves can hold patient details, so
 * they stay in On Call; this panel says how many there are and opens it.
 */
export function CallsCard({
  total,
  open,
  handoverAt,
  shiftStartsAt = null,
  onHide,
}: {
  readonly total: number;
  readonly open: number;
  /** Tonight's on-call shift's end, the handover time (ISO), when there is one. */
  readonly handoverAt: string | null;
  /** That shift's start (ISO), when known: it draws the ring. */
  readonly shiftStartsAt?: string | null;
  readonly onHide?: () => void;
}) {
  const minute = useSyncExternalStore(subscribeMinute, minuteNow, serverMinute);
  const nowMs = minute === null ? null : minute * 60_000;
  const endMs = handoverAt ? Date.parse(handoverAt) : null;
  const startMs = shiftStartsAt ? Date.parse(shiftStartsAt) : null;
  const span = startMs !== null && endMs !== null && endMs > startMs ? endMs - startMs : null;
  const running = nowMs !== null && startMs !== null && endMs !== null && nowMs >= startMs && nowMs < endMs;
  const left = running && endMs !== null && nowMs !== null ? durationWords(endMs - nowMs) : null;
  const handoverDay =
    handoverAt && nowMs !== null && perthDateOf(handoverAt) !== perthDateOf(new Date(nowMs))
      ? `${perthWeekday(handoverAt)} `
      : "";
  return (
    <section
      data-mode-identity="on-call"
      aria-labelledby="my-day-calls-heading"
      data-testid="my-day-card-calls"
      className="relative grid min-w-0 gap-3.5 rounded-xl border border-[color:var(--dash-line)] bg-[color:var(--dash-raised)] p-4 forced-colors:border"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2
          id="my-day-calls-heading"
          className="text-2xs font-dash-title uppercase tracking-wider text-[color:var(--dash-faint)]"
        >
          {running ? "On call now" : handoverAt ? "On call tonight" : "Tonight's calls"}
        </h2>
        <span className={cn("text-xs text-[color:var(--dash-muted)]", onHide && "mr-10")}>
          Counts only · this device
        </span>
        {onHide ? (
          <button
            type="button"
            onClick={onHide}
            aria-label="Hide Tonight's calls"
            data-testid="my-day-hide-calls"
            className={cn(focusRing, "absolute top-1 right-1 grid size-12 place-items-center rounded-full")}
          >
            <span aria-hidden="true" className="text-base text-[color:var(--dash-muted)]">
              ×
            </span>
          </button>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center gap-4">
        {left && span !== null && endMs !== null && nowMs !== null ? (
          <QuietRing fraction={(endMs - nowMs) / span} mode="on-call" testId="my-day-calls-ring">
            <span className="grid justify-items-center">
              <span className="max-w-16 text-sm font-dash-title leading-tight text-[color:var(--dash-ink)] nums">
                {left.short}
              </span>
              <span className="text-2xs text-[color:var(--dash-faint)]">{`left of ${durationWords(span).short}`}</span>
            </span>
          </QuietRing>
        ) : null}
        {left && span !== null && endMs !== null && nowMs !== null ? (
          <span className="sr-only">{`${left.spoken} left of ${durationWords(span).spoken}.`}</span>
        ) : null}
        <dl className="m-0 grid min-w-0 flex-1 gap-1">
          <CallFigure label="Calls logged" value={String(total)} />
          <CallFigure label="Still open" value={String(open)} />
          {handoverAt ? <CallFigure label="Handover" value={`${handoverDay}${perthTimeOf(handoverAt)}`} /> : null}
        </dl>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <Link
          href={withMyDayReturn("/on-call/call#on-call-call-log-heading")}
          data-testid="my-day-calls-log"
          className={cn(quietPrimary, "bg-[color:var(--dash-blue)] text-[color:var(--dash-page)] forced-colors:border")}
        >
          <Phone aria-hidden="true" className="size-icon-sm" />
          Log a call
        </Link>
        <Link href={withMyDayReturn("/on-call/handover")} data-testid="my-day-calls-handover" className={quietLink}>
          Handover
        </Link>
      </div>
    </section>
  );
}

function CallFigure({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm text-[color:var(--dash-muted)]">
      <dt className="min-w-0">{label}</dt>
      <dd className="m-0 font-dash-title text-[color:var(--dash-ink)] nums">{value}</dd>
    </div>
  );
}

export interface PinnedNumber {
  readonly key: string;
  readonly title: string;
  readonly display: string;
  readonly tel: string | null;
  readonly href: string;
  /** A small line under the name (a Help entry's detail), when there is one. */
  readonly detail?: string | null;
}

/** The numbers the reader pinned on Admin's Help: one row each, with an outlined call button. */
export function PinnedNumbersCard({
  numbers,
  onHide,
}: {
  readonly numbers: readonly PinnedNumber[];
  readonly onHide?: () => void;
}) {
  return (
    <QuietSection
      title="Pinned numbers"
      onHide={onHide}
      testId="my-day-card-pinned-numbers"
      aside={<QuietTextLink href={withMyDayReturn("/admin/help")}>All numbers</QuietTextLink>}
    >
      <QuietList>
        {numbers.map((number) => (
          <QuietRow
            key={number.key}
            title={number.title}
            subtitle={[number.detail, number.display].filter(Boolean).join(" · ")}
            end={
              <a
                href={number.tel ?? withMyDayReturn(number.href)}
                aria-label={number.tel ? `Call ${number.title}, ${number.display}` : `Open ${number.title}`}
                className={cn(
                  focusRing,
                  "grid size-12 place-items-center rounded-full border border-[color:var(--dash-line-strong)] text-[color:var(--dash-ink)] no-underline forced-colors:border",
                )}
              >
                <Phone aria-hidden="true" className="size-icon-sm" strokeWidth={1.6} />
              </a>
            }
          />
        ))}
      </QuietList>
    </QuietSection>
  );
}

/** Colleagues on now on the reader's team: role first, then the name. */
export function WhosOnCard({
  colleagues,
  onHide,
}: {
  readonly colleagues: readonly MyDayColleague[];
  readonly onHide?: () => void;
}) {
  return (
    <QuietSection
      title="Who's on now"
      onHide={onHide}
      testId="my-day-card-whos-on"
      aside={<QuietTextLink href={withMyDayReturn("/roster")}>Roster</QuietTextLink>}
    >
      <QuietList>
        {colleagues.slice(0, 8).map((person) => (
          <QuietRow
            key={person.id}
            lead={<AreaIcon icon={Users} />}
            title={person.grade ?? person.name}
            subtitle={[person.grade ? person.name : null, `until ${perthTimeOf(person.endsAt)}`]
              .filter(Boolean)
              .join(" · ")}
          />
        ))}
      </QuietList>
    </QuietSection>
  );
}

/** The next session the reader presents, as one row with a date block. */
export function NextTalkCard({
  session,
  today,
  onHide,
}: {
  readonly session: SessionSummary;
  readonly today: string;
  readonly onHide?: () => void;
}) {
  return (
    <QuietSection
      title="Next talk"
      onHide={onHide}
      testId="my-day-card-next-talk"
      aside={<QuietTextLink href={withMyDayReturn("/teaching")}>Teaching</QuietTextLink>}
    >
      <QuietList>
        <TalkRow session={session} today={today} />
      </QuietList>
    </QuietSection>
  );
}

function TalkRow({
  session,
  today,
  area = false,
}: {
  readonly session: SessionSummary;
  readonly today: string;
  readonly area?: boolean;
}) {
  const date = perthDateOf(session.startsAt);
  const day = date === today ? "Today" : relativeDays(date, today) === "tomorrow" ? "Tomorrow" : dayMonth(date);
  return (
    <QuietRow
      lead={<DateBlock number={Number(date.slice(8, 10))} word={perthWeekday(date)} />}
      title={
        <Link
          href={withMyDayReturn(`/teaching/session/${session.occurrenceId}`)}
          className={cn(
            focusRing,
            "-my-3 inline-flex min-h-12 items-center rounded-sm text-[color:var(--dash-ink)] no-underline hover:underline",
          )}
        >
          {session.title}
        </Link>
      }
      subtitle={[
        day,
        perthTimeOf(session.startsAt),
        session.venue,
        session.isPresenter ? "you lead" : null,
        area ? "Teaching" : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    />
  );
}

/** An ordinary day's Work page: the next talk and the next on call, soonest first. */
export function ComingUpCard({
  talk,
  onCall,
  today,
  onHide,
}: {
  readonly talk: SessionSummary | null;
  readonly onCall: { readonly startsAt: string; readonly endsAt: string } | null;
  readonly today: string;
  readonly onHide?: () => void;
}) {
  const rows = [
    talk ? { at: Date.parse(talk.startsAt), node: <TalkRow key="talk" session={talk} today={today} area /> } : null,
    onCall
      ? {
          at: Date.parse(onCall.startsAt),
          node: (
            <QuietRow
              key="on-call"
              lead={
                <DateBlock
                  number={Number(perthDateOf(onCall.startsAt).slice(8, 10))}
                  word={perthWeekday(onCall.startsAt)}
                />
              }
              title={
                <Link
                  href={withMyDayReturn("/roster")}
                  className={cn(
                    focusRing,
                    "-my-3 inline-flex min-h-12 items-center rounded-sm text-[color:var(--dash-ink)] no-underline hover:underline",
                  )}
                >
                  Your next on call
                </Link>
              }
              subtitle={`${weekdayTime(onCall.startsAt)} to ${weekdayTime(onCall.endsAt)} · ${relativeDays(perthDateOf(onCall.startsAt), today)} · Roster`}
            />
          ),
        }
      : null,
  ]
    .filter((row): row is { readonly at: number; readonly node: React.JSX.Element } => row !== null)
    .sort((a, b) => a.at - b.at);
  return (
    <QuietSection title="Coming up" onHide={onHide} testId="my-day-card-coming-up">
      <QuietList>{rows.map((row) => row.node)}</QuietList>
    </QuietSection>
  );
}

/** The last line on Work during on call: where the call notes are, and when they go. */
export function CallNotesFoot() {
  return (
    <QuietFoot icon={Lock}>
      Call notes stay in On Call. They are deleted when the shift ends and when you sign out.
    </QuietFoot>
  );
}

// ================================================================ Me

/** Next leave and next renewal, one row each. */
export function GlanceCard({
  leave,
  renewal,
  today,
  onHide,
}: {
  readonly leave: { readonly start: string } | null;
  readonly renewal: RenewalRow | null;
  readonly today: string;
  readonly onHide?: () => void;
}) {
  return (
    <QuietSection title="At a glance" onHide={onHide} testId="my-day-card-glance">
      <QuietList>
        {leave ? (
          <QuietRow
            testId="my-day-glance-leave"
            lead={<AreaIcon mode="roster" icon={Moon} />}
            title="Next leave"
            subtitle={`${dayMonth(leave.start)} · ${relativeDays(leave.start, today)} · Roster`}
          />
        ) : null}
        {renewal ? (
          <QuietRow
            testId="my-day-glance-renewal"
            lead={<AreaIcon mode="my-work" icon={Shield} />}
            title="Next renewal"
            subtitle={`${renewal.title} · ${Number(renewal.date.slice(8, 10))} ${shortMonth(renewal.date)} · ${relativeDays(renewal.date, today)}`}
            end={<QuietTextLink href={withMyDayReturn(renewal.href)}>Admin</QuietTextLink>}
          />
        ) : null}
      </QuietList>
    </QuietSection>
  );
}

/** Bars with an average line, drawn in one SVG so heights are attributes, not styles. */
function HoursChart({ bars, letters }: { readonly bars: HoursBars; readonly letters: readonly string[] }) {
  const max = Math.max(12, ...bars.days.map((day) => day.hours));
  const width = 100;
  const height = 60;
  const gap = bars.days.length > 7 ? 1.6 : 3;
  const barWidth = (width - gap * (bars.days.length - 1)) / bars.days.length;
  const avgY = bars.averageWorkedDay ? height - (bars.averageWorkedDay / max) * height : null;
  return (
    <div className="grid gap-1" aria-hidden="true">
      <div className="flex justify-between text-2xs text-[color:var(--dash-faint)] nums">
        <span>{`${hoursText(max)} h`}</span>
        {bars.averageWorkedDay ? <span>{`average ${hoursText(bars.averageWorkedDay)} h`}</span> : null}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block h-24 w-full overflow-visible">
        <line
          x1="0"
          x2={width}
          y1="0"
          y2="0"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          className="stroke-[color:var(--dash-line)]"
        />
        {bars.days.map((day, index) => {
          const x = index * (barWidth + gap);
          if (!(day.hours > 0)) {
            return (
              <rect
                key={day.date}
                x={x}
                y={height - 1}
                width={barWidth}
                height="1"
                className="fill-[color:var(--dash-line-strong)]"
              />
            );
          }
          const barHeight = Math.max(3, (day.hours / max) * height);
          return (
            <rect
              key={day.date}
              x={x}
              y={height - barHeight}
              width={barWidth}
              height={barHeight}
              rx="0.8"
              className="fill-[color:var(--mode-identity)] opacity-75 forced-colors:fill-[CanvasText]"
              data-hours={day.hours}
            />
          );
        })}
        {avgY !== null ? (
          <line
            x1="0"
            x2={width}
            y1={avgY}
            y2={avgY}
            strokeWidth="1"
            strokeDasharray="3 2"
            vectorEffect="non-scaling-stroke"
            className="stroke-[color:var(--dash-muted)]"
          />
        ) : null}
      </svg>
      <div className="flex justify-between gap-0.5">
        {letters.map((letter, index) => (
          <span key={index} className="flex-1 text-center text-2xs text-[color:var(--dash-faint)]">
            {letter}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Hours worked from the reader's roster: this week or the fortnight. Facts only. */
export function HoursCard({
  week,
  fortnight,
  weekShifts,
  fortnightShifts,
  onHide,
}: {
  readonly week: HoursBars;
  readonly fortnight: HoursBars;
  /** How many worked shifts each window holds. */
  readonly weekShifts: number;
  readonly fortnightShifts: number;
  readonly onHide?: () => void;
}) {
  const [span, setSpan] = useState<"week" | "fortnight">("week");
  const bars = span === "week" ? week : fortnight;
  const count = span === "week" ? weekShifts : fortnightShifts;
  const letters = bars.days.map(
    (day) => WEEKDAY_LETTERS[(new Date(`${day.date}T00:00:00Z`).getUTCDay() + 6) % 7] ?? "",
  );
  return (
    <div data-mode-identity="roster" className="min-w-0">
      <QuietSection
        title="Hours worked"
        onHide={onHide}
        testId="my-day-card-hours"
        aside={
          <DashSegmented
            label="Period"
            value={span}
            onChange={setSpan}
            testId="my-day-hours-switch"
            options={[
              { value: "week", label: "Week" },
              { value: "fortnight", label: "Fortnight" },
            ]}
          />
        }
      >
        <p className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 pt-1">
          <span className="text-sm text-[color:var(--dash-muted)]">
            <span className="mr-1 text-2xl-minus font-dash-title text-[color:var(--dash-ink)] nums">
              {`${hoursText(bars.totalHours)} h`}
            </span>
            {`rostered · ${count} ${count === 1 ? "shift" : "shifts"}`}
          </span>
          <span className="text-sm text-[color:var(--dash-muted)]">
            {`${Number(bars.start.slice(8, 10))} ${shortMonth(bars.start)} to ${Number(bars.end.slice(8, 10))} ${shortMonth(bars.end)}`}
          </span>
        </p>
        <p className="sr-only">
          {bars.days
            .filter((day) => day.hours > 0)
            .map((day) => `${fullDate(day.date)} ${hoursText(day.hours)} hours`)
            .join(", ")}
        </p>
        <HoursChart bars={bars} letters={letters} />
        <QuietFoot icon={Info}>
          From your roster, not pay. On call and leave are not counted. Rest and fatigue warnings stay off until the
          rules are signed off.
        </QuietFoot>
      </QuietSection>
    </div>
  );
}

/** Admin's recorded dates, one small card each. Dates only: no registration numbers are kept here. */
export function CredentialsCard({
  rows,
  today,
  onHide,
}: {
  readonly rows: readonly RenewalRow[];
  readonly today: string;
  readonly onHide?: () => void;
}) {
  return (
    <QuietSection
      title="Credentials"
      onHide={onHide}
      testId="my-day-card-credentials"
      aside={<QuietTextLink href={withMyDayReturn("/admin/renewals")}>Admin</QuietTextLink>}
    >
      <ul
        role="list"
        className="-mx-3 flex snap-x snap-mandatory scroll-px-3 gap-2.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {rows.map((row) => {
          const passed = row.date < today;
          return (
            <li key={row.entryId} className="grid w-56 shrink-0 snap-start">
              <Link
                href={withMyDayReturn(row.href)}
                className={cn(
                  focusRing,
                  "grid min-h-24 content-between gap-2 rounded-xl border border-[color:var(--dash-line)] bg-[color:var(--dash-raised)] p-3.5 no-underline forced-colors:border",
                )}
              >
                <span className="break-words text-base-minus text-[color:var(--dash-ink)]">{row.title}</span>
                <span
                  className={cn(
                    "text-sm",
                    passed ? "font-medium text-[color:var(--dash-amber)]" : "text-[color:var(--dash-muted)]",
                  )}
                >
                  {`${passed ? "Date passed" : "Recorded date"} ${Number(row.date.slice(8, 10))} ${shortMonth(row.date)} ${row.date.slice(0, 4)}`}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <QuietFoot icon={Lock}>Dates from Admin. No registration numbers are kept on My Day.</QuietFoot>
    </QuietSection>
  );
}

const MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"] as const;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * CPD this year on Me: the same ring and types as Today, then the hours
 * logged each month and the straight-line estimate.
 */
export function CpdMonthCard({
  byMonth,
  byCategory,
  loggedHours,
  targetHours,
  projected,
  closed = false,
  currentMonth,
  onHide,
}: {
  readonly byMonth: readonly number[];
  readonly byCategory: Readonly<Record<CmeCategory, number>>;
  readonly loggedHours: number;
  readonly targetHours: number;
  readonly projected: number | null;
  /** The CPD year has been closed: no estimate is drawn. */
  readonly closed?: boolean;
  /** 0 = January. */
  readonly currentMonth: number;
  readonly onHide?: () => void;
}) {
  const max = Math.max(1, ...byMonth);
  const most = byMonth.reduce((best, hours, index) => (hours > (byMonth[best] ?? 0) ? index : best), 0);
  const height = 50;
  return (
    <div data-mode-identity="cme" className="min-w-0">
      <QuietSection
        title="CPD this year"
        onHide={onHide}
        testId="my-day-card-cpd-month"
        aside={<QuietTextLink href={withMyDayReturn("/cme")}>Open CPD</QuietTextLink>}
      >
        <CpdSummary loggedHours={loggedHours} targetHours={targetHours} byCategory={byCategory} />
        <div className="flex justify-between gap-3 pt-1 text-sm text-[color:var(--dash-muted)]">
          <span>Hours logged each month</span>
          {(byMonth[most] ?? 0) > 0 ? (
            <span className="nums">{`most ${hoursText(byMonth[most] ?? 0)} h · ${MONTH_NAMES[most]}`}</span>
          ) : null}
        </div>
        <div className="grid grid-cols-12 gap-1" aria-hidden="true">
          {MONTH_LETTERS.map((letter, index) => {
            const hours = byMonth[index] ?? 0;
            const barHeight = hours > 0 ? Math.max(4, (hours / max) * height) : 1;
            return (
              <span key={index} className="grid justify-items-center gap-1">
                <svg viewBox={`0 0 10 ${height}`} preserveAspectRatio="none" className="block h-14 w-full">
                  <rect
                    x="0"
                    y={height - barHeight}
                    width="10"
                    height={barHeight}
                    rx="0.8"
                    className={
                      hours === 0
                        ? "fill-[color:var(--dash-line-strong)]"
                        : "fill-[color:var(--mode-identity)] forced-colors:fill-[CanvasText]"
                    }
                  />
                </svg>
                <span
                  className={cn(
                    "text-2xs",
                    index === currentMonth ? "text-[color:var(--dash-ink)]" : "text-[color:var(--dash-faint)]",
                  )}
                >
                  {letter}
                </span>
              </span>
            );
          })}
        </div>
        <p className="sr-only">
          {byMonth
            .map((hours, index) => (hours > 0 ? `${MONTH_NAMES[index]}: ${hoursText(hours)} hours` : null))
            .filter(Boolean)
            .join(", ")}
        </p>
        <QuietFoot icon={Info}>
          {projected !== null
            ? `At this rate, about ${projected} h by 31 Dec. This is a straight-line estimate from what you have logged.`
            : closed
              ? "This CPD year is closed. The hours above are final."
              : "No hours logged yet this year."}
        </QuietFoot>
      </QuietSection>
    </div>
  );
}

/** A note on this device only, for this account. Never sent anywhere. */
export function QuickNoteCard({ onHide }: { readonly onHide?: () => void }) {
  const [note, setNote] = useMyDayQuickNote();
  const fieldId = useId();
  const hintId = useId();
  return (
    <QuietSection
      title="Quick note"
      onHide={onHide}
      testId="my-day-card-quick-note"
      aside={<span className="text-xs text-[color:var(--dash-muted)]">This device only</span>}
    >
      <label htmlFor={fieldId} className="sr-only">
        Quick note
      </label>
      <textarea
        id={fieldId}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={MY_DAY_QUICK_NOTE_LIMIT}
        rows={2}
        aria-describedby={hintId}
        data-testid="my-day-quick-note"
        placeholder="A reminder for yourself"
        className="min-h-14 w-full resize-y rounded-lg border border-[color:var(--dash-line-strong)] bg-[color:var(--dash-raised)] px-3 py-2.5 text-base-minus text-[color:var(--dash-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)] forced-colors:border"
      />
      <div id={hintId}>
        <QuietFoot icon={TriangleAlert}>
          Never write patient names or details here. Deleted when you sign out.
        </QuietFoot>
      </div>
    </QuietSection>
  );
}
