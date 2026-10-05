"use client";

import { ChevronRight, Phone, Plus } from "lucide-react";
import Link from "next/link";
import { useId, useState, useSyncExternalStore } from "react";

import { focusRing } from "@/components/card-recipes";
import { DashCard } from "@/components/dashboard-kit/dash-card";
import { ProgressRing } from "@/components/dashboard-kit/rings";
import { DashAvatar, DashTag } from "@/components/dashboard-kit/icon-chip";
import { dashFigure, dashLink, dashMuted, dashTile } from "@/components/dashboard-kit/recipes";
import { DashSegmented } from "@/components/dashboard-kit/segmented";
import { MY_DAY_QUICK_NOTE_LIMIT, useMyDayQuickNote } from "@/components/my-day/my-day-device-state";
import { cn } from "@/components/ui-primitives";
import type { MyDayColleague } from "@/components/my-day/use-my-day-whos-on";
import {
  heatLevel,
  initialsOf,
  shortDayMonth,
  WEEKDAY_LETTERS,
  type HoursBars,
  type RenewalRow,
} from "@/lib/my-day/figures";
import { withMyDayReturn } from "@/lib/my-day/return-link";
import { formatPerthDay, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import type { SessionSummary } from "@/lib/teaching/model";

/*
 * The Work and Me pages' cards, on the dashboard kit. Each takes data that
 * `MyDayDashboard` has already checked is real; a card with no source is
 * never drawn.
 */

function hoursText(value: number): string {
  return `${Number(value.toFixed(1))}`;
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
 * Tonight's calls: counts only. The notes themselves can hold patient
 * details, so they stay on the Call page; this card says how many there are
 * and opens it. It carries On Call's teal, as the mode's own pages do.
 */
export function CallsCard({
  total,
  open,
  clearsAt,
  handoverAt,
  shiftStartsAt = null,
  onHide,
}: {
  readonly total: number;
  readonly open: number;
  /** When this shift's notes are wiped (epoch ms). */
  readonly clearsAt: number | null;
  /** The running on-call shift's end, the handover time (ISO), when there is one. */
  readonly handoverAt: string | null;
  /** That shift's start (ISO), when known: it draws the ring and the progress line. */
  readonly shiftStartsAt?: string | null;
  readonly onHide?: () => void;
}) {
  const minute = useSyncExternalStore(subscribeMinute, minuteNow, serverMinute);
  const nowMs = minute === null ? null : minute * 60_000;
  const endMs = handoverAt ? Date.parse(handoverAt) : null;
  const startMs = shiftStartsAt ? Date.parse(shiftStartsAt) : null;
  const leftMs = nowMs !== null && endMs !== null ? Math.max(0, endMs - nowMs) : null;
  const leftMinutes = leftMs === null ? null : Math.ceil(leftMs / 60_000);
  const span = startMs !== null && endMs !== null && endMs > startMs ? endMs - startMs : null;
  const elapsed = span !== null && nowMs !== null && startMs !== null ? (nowMs - startMs) / span : null;
  const clamped = elapsed === null ? null : Math.min(1, Math.max(0, elapsed));
  const handoverDayNote =
    handoverAt && nowMs !== null && perthDateOf(handoverAt) !== perthDateOf(new Date(nowMs))
      ? ` ${formatPerthDay(perthDateOf(handoverAt)).split(" ")[0] ?? ""}`
      : "";
  const stat = "grid min-w-0 content-center justify-items-start gap-0.5 px-3 first:pl-0";
  return (
    <div data-mode-identity="on-call" className="contents">
      <DashCard
        title="Tonight's calls"
        onHide={onHide}
        testId="my-day-card-calls"
        className="gap-3"
        aside={
          <span className="inline-flex items-center text-3xs normal-case tracking-normal text-[color:var(--dash-muted)]">
            On this device
          </span>
        }
      >
        <div className="flex items-center gap-3">
          {leftMinutes !== null ? (
            <ProgressRing
              fraction={clamped ?? 0}
              size={88}
              strokeWidth={7}
              stroke="stroke-[color:var(--mode-identity)]"
              track="stroke-[color:var(--dash-line)]"
              testId="my-day-calls-ring"
            >
              <span className={cn(dashFigure, "text-lg text-[color:var(--dash-ink)]")}>
                {`${Math.floor(leftMinutes / 60)}:${String(leftMinutes % 60).padStart(2, "0")}`}
              </span>
              <span className="mt-0.5 text-3xs font-dash-title text-[color:var(--dash-muted)]">left</span>
            </ProgressRing>
          ) : null}
          <dl className="m-0 flex min-w-0 flex-1 items-stretch divide-x divide-[color:var(--dash-line)]">
            <div className={stat}>
              <dd className={cn(dashFigure, "m-0 text-2xl text-[color:var(--dash-ink)]")}>{total}</dd>
              <dt className="text-xs text-[color:var(--dash-muted)]">{total === 1 ? "call" : "calls"}</dt>
            </div>
            <div className={stat}>
              <dd className={cn(dashFigure, "m-0 text-2xl text-[color:var(--dash-ink)]")}>{open}</dd>
              <dt className="text-xs text-[color:var(--dash-muted)]">open</dt>
            </div>
            {handoverAt ? (
              <div className={stat}>
                <dd className={cn(dashFigure, "m-0 text-2xl text-[color:var(--dash-ink)]")}>
                  {perthTimeOf(handoverAt)}
                </dd>
                <dt className="text-xs text-[color:var(--dash-muted)]">{`handover${handoverDayNote}`}</dt>
              </div>
            ) : null}
          </dl>
        </div>
        {clamped !== null && startMs !== null && handoverAt && nowMs !== null ? (
          <div aria-hidden="true" className="grid gap-1">
            <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="block h-2 w-full overflow-visible">
              <rect x="0" y="1.5" width="100" height="3" rx="1.5" className="fill-[color:var(--dash-line)]" />
              <rect
                x="0"
                y="1.5"
                width={(clamped * 100).toFixed(2)}
                height="3"
                rx="1.5"
                className="fill-[color:var(--mode-identity)] forced-colors:fill-[CanvasText]"
              />
            </svg>
            <div className="flex justify-between text-3xs font-dash-title text-[color:var(--dash-muted)] nums">
              <span>{perthTimeOf(new Date(startMs))}</span>
              <span>{`now ${perthTimeOf(new Date(nowMs))}`}</span>
              <span>{perthTimeOf(handoverAt)}</span>
            </div>
          </div>
        ) : null}
        <p className={dashMuted}>
          {`${clearsAt ? `Notes clear at ${perthTimeOf(new Date(clearsAt))}. ` : ""}Notes stay on the Call page.`}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Link
            href={withMyDayReturn("/on-call/call#on-call-call-log-heading")}
            data-testid="my-day-calls-log"
            className={cn(
              focusRing,
              "inline-flex min-h-12 items-center justify-center gap-1.5 rounded-xl bg-[color:var(--dash-ink)] px-3 font-dash-title text-base-minus text-[color:var(--dash-page)] no-underline forced-colors:border",
            )}
          >
            <Plus aria-hidden="true" className="size-icon-md" />
            Log a call
          </Link>
          <Link
            href={withMyDayReturn("/on-call/call#on-call-handover-heading")}
            data-testid="my-day-calls-handover"
            className={cn(
              focusRing,
              "inline-flex min-h-12 items-center justify-center rounded-xl border border-[color:var(--dash-line-strong)] bg-[color:var(--dash-raised)] px-3 font-dash-title text-base-minus text-[color:var(--dash-ink)] no-underline forced-colors:border",
            )}
          >
            Handover
          </Link>
        </div>
      </DashCard>
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

/** The numbers the reader pinned on Admin's Help: one full-width row each, with a call button. */
export function PinnedNumbersCard({
  numbers,
  onHide,
}: {
  readonly numbers: readonly PinnedNumber[];
  readonly onHide?: () => void;
}) {
  return (
    <div data-mode-identity="on-call" className="contents">
      <DashCard
        title="Pinned numbers"
        onHide={onHide}
        testId="my-day-card-pinned-numbers"
        aside={
          <Link
            href={withMyDayReturn("/admin/help")}
            className={cn(focusRing, dashLink, "-my-3 inline-flex min-h-12 items-center rounded-md px-1")}
          >
            All numbers
          </Link>
        }
      >
        <ul role="list" className="grid divide-y divide-[color:var(--dash-line)]">
          {numbers.map((number, index) => (
            <li key={number.key} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-1.5">
              <DashAvatar
                initials={initialsOf(number.title)}
                tint={AVATAR_TINTS[index % AVATAR_TINTS.length] ?? "blue"}
              />
              <span className="grid min-w-0">
                <span className="truncate font-dash-title text-base-minus text-[color:var(--dash-ink)]">
                  {number.title}
                </span>
                {number.detail ? (
                  <span className="truncate text-xs text-[color:var(--dash-muted)]">{number.detail}</span>
                ) : null}
              </span>
              <span className="flex items-center gap-2">
                <span className="font-dash-title text-sm nums text-[color:var(--dash-blue)]">{number.display}</span>
                <a
                  href={number.tel ?? withMyDayReturn(number.href)}
                  aria-label={number.tel ? `Call ${number.title}, ${number.display}` : `Open ${number.title}`}
                  className={cn(focusRing, "grid size-12 place-items-center rounded-full no-underline")}
                >
                  <span
                    aria-hidden="true"
                    className="grid size-10 place-items-center rounded-full border border-[color:var(--dash-line-strong)] text-[color:var(--mode-identity)] forced-colors:border"
                  >
                    <Phone aria-hidden="true" className="size-icon-md" />
                  </span>
                </a>
              </span>
            </li>
          ))}
        </ul>
      </DashCard>
    </div>
  );
}

const AVATAR_TINTS = ["blue", "green", "amber"] as const;

/** Colleagues on now on the reader's team, in a row that scrolls sideways. */
export function WhosOnCard({
  colleagues,
  onHide,
}: {
  readonly colleagues: readonly MyDayColleague[];
  readonly onHide?: () => void;
}) {
  return (
    <DashCard
      title="Who's on now"
      onHide={onHide}
      testId="my-day-card-whos-on"
      aside={
        <Link
          href={withMyDayReturn("/roster")}
          className={cn(focusRing, dashLink, "-my-3 inline-flex min-h-12 items-center rounded-md px-1")}
        >
          Roster
        </Link>
      }
    >
      <ul
        role="list"
        className="-mx-3 flex snap-x scroll-px-3 gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {colleagues.slice(0, 8).map((person, index) => (
          <li
            key={person.id}
            className={cn(
              dashTile,
              "grid w-28 shrink-0 snap-start content-start justify-items-center gap-0.5 rounded-2xl px-2 py-3 text-center",
            )}
          >
            <DashAvatar initials={initialsOf(person.name)} tint={AVATAR_TINTS[index % AVATAR_TINTS.length] ?? "blue"} />
            <span className="mt-1 break-words font-dash-title text-sm leading-tight text-[color:var(--dash-ink)]">
              {person.name}
            </span>
            {person.grade ? <span className="text-xs text-[color:var(--dash-muted)]">{person.grade}</span> : null}
            <span className="font-dash-title text-xs nums text-[color:var(--dash-blue)]">{`till ${perthTimeOf(person.endsAt)}`}</span>
          </li>
        ))}
      </ul>
    </DashCard>
  );
}

/** The next session the reader presents. */
export function NextTalkCard({
  session,
  today,
  onHide,
}: {
  readonly session: SessionSummary;
  readonly today: string;
  readonly onHide?: () => void;
}) {
  const date = perthDateOf(session.startsAt);
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const when = days === 0 ? "today" : days === 1 ? "tomorrow" : formatPerthDay(date);
  const month = shortDayMonth(date).split(" ")[1] ?? "";
  return (
    <div data-mode-identity="teaching" className="contents">
      <DashCard title="Next talk" showTitle={false} onHide={onHide} testId="my-day-card-next-talk">
        <Link
          href={withMyDayReturn(`/teaching/session/${session.occurrenceId}`)}
          className={cn(
            focusRing,
            "-m-1 grid min-h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl p-1 no-underline",
          )}
        >
          <span
            aria-hidden="true"
            className="grid w-12 overflow-hidden rounded-xl border border-[color:var(--dash-line)] bg-[color:var(--dash-raised)] text-center forced-colors:border"
          >
            <span className="bg-[color:var(--mode-identity)] py-0.5 text-3xs font-dash-figure uppercase tracking-widest text-[color:var(--mode-identity-contrast)]">
              {month}
            </span>
            <span className={cn(dashFigure, "py-1 text-xl text-[color:var(--dash-ink)]")}>
              {Number(date.slice(8, 10))}
            </span>
          </span>
          <span className="grid min-w-0 gap-0.5">
            <span className="break-words font-dash-title text-base-minus leading-tight text-[color:var(--dash-ink)]">
              {session.title}
            </span>
            <span className="text-sm text-[color:var(--dash-muted)]">
              {`Next talk · ${when} ${perthTimeOf(session.startsAt)}${session.venue ? ` · ${session.venue}` : ""}`}
            </span>
          </span>
          <ChevronRight aria-hidden="true" className="size-icon-md text-[color:var(--dash-faint)]" />
        </Link>
      </DashCard>
    </div>
  );
}

// ================================================================ Me

/** Bars with an average line, drawn in one SVG so heights are attributes, not styles. */
function HoursChart({ bars, letters }: { readonly bars: HoursBars; readonly letters: readonly string[] }) {
  const gradientId = useId();
  const nightId = useId();
  const max = Math.max(12, ...bars.days.map((day) => day.hours));
  const width = 100;
  const height = 60;
  const gap = bars.days.length > 7 ? 1.2 : 2.4;
  const barWidth = (width - gap * (bars.days.length - 1)) / bars.days.length;
  const avgY = bars.averageWorkedDay ? height - (bars.averageWorkedDay / max) * height : null;
  return (
    <div className="grid gap-1" aria-hidden="true">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block h-20 w-full overflow-visible">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" className="[stop-color:var(--dash-blue-2)]" />
            <stop offset="1" className="[stop-color:var(--dash-blue)]" />
          </linearGradient>
          <linearGradient id={nightId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" className="[stop-color:var(--dash-night-2)]" />
            <stop offset="1" className="[stop-color:var(--dash-night)]" />
          </linearGradient>
        </defs>
        {bars.days.map((day, index) => {
          const x = index * (barWidth + gap);
          if (!(day.hours > 0)) {
            return (
              <rect
                key={day.date}
                x={x}
                y={height - 2}
                width={barWidth}
                height="2"
                rx="1"
                className="fill-[color:var(--dash-line)]"
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
              rx="1.6"
              fill={`url(#${day.night ? nightId : gradientId})`}
              className="forced-colors:fill-[CanvasText]"
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
            strokeWidth="0.4"
            strokeDasharray="1.5 1"
            vectorEffect="non-scaling-stroke"
            className="stroke-[color:var(--dash-faint)]"
          />
        ) : null}
      </svg>
      <div className="flex justify-between gap-0.5">
        {letters.map((letter, index) => (
          <span key={index} className="flex-1 text-center text-3xs font-dash-title text-[color:var(--dash-faint)]">
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
  onHide,
}: {
  readonly week: HoursBars;
  readonly fortnight: HoursBars;
  readonly onHide?: () => void;
}) {
  const [span, setSpan] = useState<"week" | "fortnight">("week");
  const bars = span === "week" ? week : fortnight;
  const letters = bars.days.map(
    (day) => WEEKDAY_LETTERS[(new Date(`${day.date}T00:00:00Z`).getUTCDay() + 6) % 7] ?? "",
  );
  return (
    <DashCard
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
      <p className="flex flex-wrap items-baseline gap-x-2 text-[color:var(--dash-ink)]">
        <span className={cn(dashFigure, "text-3xl-minus")}>{`${hoursText(bars.totalHours)} h`}</span>
        <span className="text-sm text-[color:var(--dash-muted)]">
          {`${span === "week" ? "this week" : "this fortnight"} · from your roster`}
        </span>
      </p>
      <p className="sr-only">
        {bars.days
          .filter((day) => day.hours > 0)
          .map((day) => `${formatPerthDay(day.date)} ${hoursText(day.hours)} hours`)
          .join(", ")}
      </p>
      <HoursChart bars={bars} letters={letters} />
      {bars.averageWorkedDay ? (
        <p className="text-right text-3xs font-dash-title text-[color:var(--dash-faint)]">
          {`Dashed line: ${hoursText(bars.averageWorkedDay)} h average per day worked`}
        </p>
      ) : null}
      <p className={dashMuted}>Rest and fatigue warnings stay off until the rules are signed off.</p>
    </DashCard>
  );
}

const HEAT: Readonly<Record<0 | 1 | 2 | 3, string>> = {
  0: "bg-[color:var(--dash-line)]",
  1: "bg-[color:var(--dash-blue-tint-2)]",
  2: "bg-[color:var(--dash-blue-2)]",
  3: "bg-[color:var(--dash-blue)]",
};

/** Four weeks of rostered hours per day as a heat map, today outlined. */
export function MonthGlanceCard({
  glance,
  today,
  onHide,
}: {
  readonly glance: HoursBars;
  readonly today: string;
  readonly onHide?: () => void;
}) {
  return (
    <DashCard
      title="Month at a glance"
      onHide={onHide}
      testId="my-day-card-month-glance"
      aside={
        <span className="font-dash-title text-2xs uppercase tracking-widest text-[color:var(--dash-faint)]">
          4 weeks
        </span>
      }
    >
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_LETTERS.map((letter, index) => (
          <span
            key={index}
            aria-hidden="true"
            className="text-center text-3xs font-dash-title text-[color:var(--dash-faint)]"
          >
            {letter}
          </span>
        ))}
        {glance.days.map((day) => (
          <span
            key={day.date}
            role="img"
            aria-label={`${formatPerthDay(day.date)}: ${day.hours > 0 ? `${hoursText(day.hours)} hours` : "no hours"}${day.date === today ? " (today)" : ""}`}
            data-level={heatLevel(day.hours)}
            className={cn(
              "aspect-[1.7] rounded-md forced-colors:border",
              HEAT[heatLevel(day.hours)],
              day.date === today && "outline-2 outline-offset-1 outline-[color:var(--dash-ink)]",
            )}
          />
        ))}
      </div>
      <div aria-hidden="true" className="flex items-center justify-end gap-1 text-2xs text-[color:var(--dash-muted)]">
        Less
        {([0, 1, 2, 3] as const).map((level) => (
          <span key={level} className={cn("size-3 rounded-sm", HEAT[level])} />
        ))}
        More hours
      </div>
      <p className={dashMuted}>Hours worked each day, from your roster. Today is outlined.</p>
    </DashCard>
  );
}

const WALLET = ["dash-wallet-blue", "dash-wallet-green", "dash-wallet-blue"] as const;

/** Admin's recorded dates as cards to swipe through. Wording follows Admin: a recorded date, never a standing. */
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
    <DashCard title="Credentials wallet" onHide={onHide} testId="my-day-card-credentials">
      <ul
        role="list"
        className="-mx-3 flex snap-x snap-mandatory scroll-px-3 gap-2.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {rows.map((row, index) => {
          const passed = row.date < today;
          return (
            <li key={row.entryId} className="grid w-50 shrink-0 snap-start">
              <Link
                href={withMyDayReturn(row.href)}
                className={cn(
                  focusRing,
                  passed ? "dash-wallet-amber" : WALLET[index % WALLET.length],
                  "grid min-h-30 content-between gap-2 rounded-2xl p-3 text-[color:var(--dash-hero-ink)] no-underline shadow-[var(--dash-shadow)] forced-colors:border",
                )}
              >
                <span className="text-3xs font-dash-figure uppercase tracking-widest opacity-85">Admin</span>
                <span className="break-words font-dash-figure text-base leading-tight">{row.title}</span>
                <span className="flex flex-wrap justify-between gap-x-2 text-xs font-dash-title opacity-90">
                  <span>{passed ? "Date passed" : "Recorded date"}</span>
                  <span className="nums">{`${passed ? "" : "to "}${shortDayMonth(row.date)} ${row.date.slice(0, 4)}`}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </DashCard>
  );
}

const MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"] as const;

/** CPD hours per month this year, the current month in full blue, with the pace projection. */
export function CpdMonthCard({
  byMonth,
  loggedHours,
  targetHours,
  projected,
  currentMonth,
  onHide,
}: {
  readonly byMonth: readonly number[];
  readonly loggedHours: number;
  readonly targetHours: number;
  readonly projected: number | null;
  /** 0 = January. */
  readonly currentMonth: number;
  readonly onHide?: () => void;
}) {
  const max = Math.max(1, ...byMonth);
  const height = 50;
  return (
    <DashCard
      title="CPD by month"
      onHide={onHide}
      testId="my-day-card-cpd-month"
      aside={
        <span className="font-dash-title text-2xs uppercase tracking-widest text-[color:var(--dash-faint)] nums">
          {`${hoursText(loggedHours)} / ${hoursText(targetHours)} h`}
        </span>
      }
    >
      <div className="grid grid-cols-12 gap-1" aria-hidden="true">
        {MONTH_LETTERS.map((letter, index) => {
          const hours = byMonth[index] ?? 0;
          const barHeight = hours > 0 ? Math.max(4, (hours / max) * height) : 3;
          return (
            <span key={index} className="grid justify-items-center gap-1">
              <svg viewBox={`0 0 10 ${height}`} preserveAspectRatio="none" className="block h-14 w-full">
                <rect
                  x="0"
                  y={height - barHeight}
                  width="10"
                  height={barHeight}
                  rx="2.5"
                  className={
                    hours === 0
                      ? "fill-[color:var(--dash-line)]"
                      : index === currentMonth
                        ? "fill-[color:var(--dash-blue)]"
                        : "fill-[color:var(--dash-blue-tint-2)]"
                  }
                />
              </svg>
              <span
                className={cn(
                  "text-3xs font-dash-title",
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
          .map((hours, index) => (hours > 0 ? `${MONTH_LETTERS[index]}: ${hoursText(hours)} hours` : null))
          .filter(Boolean)
          .join(", ")}
      </p>
      <p className={dashMuted}>
        {projected !== null
          ? `On pace for ${projected} h by 31 Dec at your current rate.`
          : "No hours logged yet this year."}
      </p>
    </DashCard>
  );
}

/** A note on this device only, for this account. Never sent anywhere. */
export function QuickNoteCard({ onHide }: { readonly onHide?: () => void }) {
  const [note, setNote] = useMyDayQuickNote();
  const fieldId = useId();
  const hintId = useId();
  return (
    <DashCard
      title="Quick note"
      onHide={onHide}
      testId="my-day-card-quick-note"
      aside={<DashTag tint="green">On this device only</DashTag>}
    >
      <label htmlFor={fieldId} className="sr-only">
        Quick note
      </label>
      <textarea
        id={fieldId}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={MY_DAY_QUICK_NOTE_LIMIT}
        rows={3}
        aria-describedby={hintId}
        data-testid="my-day-quick-note"
        placeholder="A reminder for yourself"
        className="min-h-24 w-full resize-y rounded-xl border border-[color:var(--dash-line)] bg-[color:var(--dash-raised)] p-2.5 text-base-minus text-[color:var(--dash-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)] forced-colors:border"
      />
      <p id={hintId} className={dashMuted}>
        No patient names or details here.
      </p>
    </DashCard>
  );
}
