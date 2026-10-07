"use client";

import { ChevronRight, Clock, FileText, Info, Lock, Moon, Phone, Shield, TriangleAlert, WifiOff } from "lucide-react";
import Link from "next/link";
import { useId, useState, useSyncExternalStore } from "react";

import { focusRing } from "@/components/card-recipes";
import { MY_DAY_QUICK_NOTE_LIMIT, useMyDayQuickNote } from "@/components/my-day/my-day-device-state";
import {
  AreaIcon,
  DateBlock,
  QuietFoot,
  QuietList,
  QuietRow,
  QuietSection,
  QuietTextLink,
  quietCard,
  quietPrimary,
} from "@/components/my-day/my-day-quiet";
import { hoursText, MyDaySegmented } from "@/components/my-day/my-day-today-cards";
import type { MyDayColleague } from "@/components/my-day/use-my-day-whos-on";
import { cn } from "@/components/ui-primitives";
import type { NewJobProgress } from "@/lib/admin/new-job-progress";
import type { CmeCategory } from "@/lib/cme/types";
import { WEEKDAY_LETTERS, type HoursBars, type RenewalRow } from "@/lib/my-day/figures";
import {
  daysBetween,
  durationWords,
  fullDate,
  perthWeekday,
  relativeDays,
  shortMonth,
  weekdayTime,
} from "@/lib/my-day/quiet-figures";
import { withMyDayReturn } from "@/lib/my-day/return-link";
import type { ShiftKind } from "@/lib/roster/shift-kind";
import { perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import type { SessionSummary } from "@/lib/teaching/model";

/*
 * The On shift (`?page=work`) and My records (`?page=me`) cards in the flat
 * work-mode design (work-mode redesign, owner request 6 Oct 2026): white
 * cards with hairline rows, small-capitals labels, and one filled button per
 * screen. Each takes data `MyDayDashboard` has already checked is real; a
 * card with no source is never drawn.
 */

/** "Tue 6 Oct". */
function dayMonth(date: string): string {
  return `${perthWeekday(date)} ${Number(date.slice(8, 10))} ${shortMonth(date)}`;
}

// ================================================================ On shift

/** A minute counter for a live "time left"; null on the server and the first paint, so nothing mismatches. */
function subscribeMinute(onChange: () => void): () => void {
  const timer = window.setInterval(onChange, 30_000);
  return () => window.clearInterval(timer);
}
const minuteNow = (): number | null => Math.floor(Date.now() / 60_000);
const serverMinute = (): number | null => null;

/**
 * Tonight's calls: time left out of the shift's length, and this phone's call
 * log as counts only. The notes themselves can hold patient details, so they
 * stay in On Call; this card says how many there are and opens it.
 */
export function CallsCard({
  total,
  open,
  handoverAt,
  shiftStartsAt = null,
}: {
  readonly total: number;
  readonly open: number;
  /** Tonight's on-call shift's end, the handover time (ISO), when there is one. */
  readonly handoverAt: string | null;
  /** That shift's start (ISO), when known: it draws the ring. */
  readonly shiftStartsAt?: string | null;
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
      className={cn(quietCard, "grid min-w-0 gap-3 px-3.5 py-3")}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
        <h2
          id="my-day-calls-heading"
          className="m-0 text-3xs font-bold tracking-widest text-[color:var(--text-muted)] uppercase"
        >
          {running ? "On call now" : handoverAt ? "On call tonight" : "Tonight's calls"}
        </h2>
        <span className="text-2xs font-semibold text-[color:var(--text-muted)]">Counts only · this phone</span>
      </div>
      {left && span !== null ? (
        <span className="sr-only">{`${left.spoken} left of ${durationWords(span).spoken}.`}</span>
      ) : null}
      <dl className="m-0 flex min-w-0 divide-x divide-[color:var(--work-line)]">
        {left ? <CallFigure label="Left" value={left.short} /> : null}
        <CallFigure label="Logged" value={String(total)} />
        <CallFigure label="Open" value={String(open)} warn={open > 0} />
        {handoverAt ? <CallFigure label="Handover" value={`${handoverDay}${perthTimeOf(handoverAt)}`} /> : null}
      </dl>
      <div className="grid grid-cols-2 gap-2">
        <Link
          href={withMyDayReturn("/on-call/call#on-call-call-log-heading")}
          data-testid="my-day-calls-log"
          className={cn(quietPrimary, "bg-[color:var(--mode-identity)] text-[color:var(--mode-identity-contrast)]")}
        >
          <Phone aria-hidden="true" className="size-3.5" />
          Log a call
        </Link>
        <Link
          href={withMyDayReturn("/on-call/handover")}
          data-testid="my-day-calls-handover"
          className={cn(
            focusRing,
            "inline-flex min-h-12 items-center justify-center gap-1.5 rounded-full border border-[color:var(--work-line-strong)] bg-[color:var(--work-surface)] px-4 text-sm font-bold text-[color:var(--work-ink)] no-underline",
          )}
        >
          <FileText aria-hidden="true" className="size-3.5" />
          Handover
        </Link>
      </div>
    </section>
  );
}

function CallFigure({
  label,
  value,
  warn = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly warn?: boolean;
}) {
  return (
    <div className="grid min-w-0 flex-1 justify-items-center gap-0.5 px-1 text-center">
      <dt className="text-2xs font-semibold text-[color:var(--text-muted)]">{label}</dt>
      <dd
        className={cn(
          "m-0 text-lg-minus leading-tight font-bold nums",
          warn ? "text-[color:var(--warning-text)]" : "text-[color:var(--work-ink)]",
        )}
      >
        {value}
      </dd>
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

/** The numbers the reader pinned on Admin's Help: one row each, with a round call button. */
export function PinnedNumbersCard({
  numbers,
  offline = false,
}: {
  readonly numbers: readonly PinnedNumber[];
  /** Offline: these came from the list already loaded, and a phone number still rings. */
  readonly offline?: boolean;
}) {
  return (
    <QuietSection
      title="Pinned numbers"
      variant="rows"
      testId="my-day-card-pinned-numbers"
      count={offline ? "Still work offline" : undefined}
      aside={<QuietTextLink href={withMyDayReturn("/admin/help")}>All numbers</QuietTextLink>}
    >
      <QuietList>
        {numbers.map((number) => (
          <QuietRow
            key={number.key}
            lead={<AreaIcon mode="my-work" icon={offline ? WifiOff : Phone} />}
            title={number.title}
            subtitle={[number.detail, number.display].filter(Boolean).join(" · ")}
            end={
              <a
                href={number.tel ?? withMyDayReturn(number.href)}
                aria-label={number.tel ? `Call ${number.title}, ${number.display}` : `Open ${number.title}`}
                data-mode-identity="on-call"
                className={cn(focusRing, "grid size-12 place-items-center rounded-full no-underline before:hidden")}
              >
                <span className="grid size-9 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)] forced-colors:border">
                  <Phone aria-hidden="true" className="size-4" strokeWidth={2} />
                </span>
              </a>
            }
          />
        ))}
      </QuietList>
    </QuietSection>
  );
}

/** Two letters for an avatar chip ("Dr Demo B" gives "DB"). Decorative. */
function initials(name: string): string {
  const words = name
    .replace(/^(dr|prof|mr|mrs|ms)\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

/** Colleagues on now on the reader's team: role first, then the name. */
export function WhosOnCard({ colleagues }: { readonly colleagues: readonly MyDayColleague[] }) {
  return (
    <QuietSection
      title="Who's on now"
      variant="rows"
      testId="my-day-card-whos-on"
      aside={<QuietTextLink href={withMyDayReturn("/roster")}>Roster</QuietTextLink>}
    >
      <QuietList>
        {colleagues.slice(0, 8).map((person) => (
          <QuietRow
            key={person.id}
            lead={
              <span
                aria-hidden="true"
                data-mode-identity="roster"
                className="grid size-7.5 shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-3xs font-bold text-[color:var(--mode-identity)] forced-colors:border"
              >
                {initials(person.name)}
              </span>
            }
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

/** The next session the reader presents, as one row with a date tile. */
export function NextTalkCard({ session, today }: { readonly session: SessionSummary; readonly today: string }) {
  return (
    <QuietSection
      title="Next talk"
      variant="rows"
      testId="my-day-card-next-talk"
      aside={<QuietTextLink href={withMyDayReturn("/teaching")}>Teaching</QuietTextLink>}
    >
      <QuietList>
        <TalkRow session={session} today={today} />
      </QuietList>
    </QuietSection>
  );
}

const rowTitleLink = cn(
  focusRing,
  "-my-3 inline-flex min-h-12 items-center rounded-sm text-[color:var(--work-ink)] no-underline hover:underline",
);

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
      lead={<DateBlock number={Number(date.slice(8, 10))} word={perthWeekday(date)} mode="teaching" />}
      title={
        <Link href={withMyDayReturn(`/teaching/session/${session.occurrenceId}`)} className={rowTitleLink}>
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

/** An ordinary day's On shift page: the next talk and the next on call, soonest first. */
export function ComingUpCard({
  talk,
  onCall,
  today,
}: {
  readonly talk: SessionSummary | null;
  readonly onCall: { readonly startsAt: string; readonly endsAt: string } | null;
  readonly today: string;
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
                  mode="on-call"
                />
              }
              title={
                <Link href={withMyDayReturn("/roster")} className={rowTitleLink}>
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
    <QuietSection title="Coming up" variant="rows" testId="my-day-card-coming-up">
      <QuietList>{rows.map((row) => row.node)}</QuietList>
    </QuietSection>
  );
}

/** The last line on On shift during on call: where the call notes are, and when they go. */
export function CallNotesFoot() {
  return (
    <QuietFoot icon={Lock}>
      Call notes stay in On Call. They are deleted when the shift ends and when you sign out.
    </QuietFoot>
  );
}

// ================================================================ My records

/** "New job in 4 weeks", "New job starts today", "New job started Mon 5 Oct". */
function newJobTitle(job: NewJobProgress, today: string): string {
  if (job.startsOn === today) return "New job starts today";
  if (job.startsOn < today) return `New job started ${dayMonth(job.startsOn)}`;
  const days = daysBetween(today, job.startsOn);
  if (days < 7) return days === 1 ? "New job starts tomorrow" : `New job in ${days} days`;
  const weeks = Math.max(1, job.weeksAway);
  return `New job in ${weeks} ${weeks === 1 ? "week" : "weeks"}`;
}

/** The New job countdown: date tile, how far off, how many own steps are ticked, a meter. Opens New job. */
function NewJobRow({ job, today }: { readonly job: NewJobProgress; readonly today: string }) {
  const fraction = job.total > 0 ? job.done / job.total : 0;
  const title = newJobTitle(job, today);
  const progress = job.total > 0 ? `${job.done} of ${job.total} done` : "No steps of your own yet";
  return (
    <li className="min-w-0 p-0!" data-testid="my-day-glance-new-job">
      <Link
        href={withMyDayReturn("/admin/new-job")}
        className={cn(focusRing, "flex min-h-14 min-w-0 items-center gap-2.5 px-3 py-2 text-inherit no-underline")}
      >
        <DateBlock number={Number(job.startsOn.slice(8, 10))} word={shortMonth(job.startsOn)} mode="my-work" />
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="text-sm-minus leading-tight font-bold break-words text-[color:var(--work-ink)]">
            {title}
          </span>
          <span className="text-2xs break-words text-[color:var(--text-muted)]">
            {job.nextStep ? `${progress} · next: ${job.nextStep}` : progress}
          </span>
          {job.total > 0 ? (
            <svg
              aria-hidden="true"
              role="presentation"
              data-mode-identity="my-work"
              className="block h-1.5 w-full overflow-hidden rounded-full"
            >
              <rect width="100%" height="6" className="fill-[color:var(--work-wash)] forced-colors:fill-[Canvas]" />
              <rect
                width={`${Math.round(fraction * 100)}%`}
                height="6"
                className="fill-[color:var(--mode-identity)] forced-colors:fill-[CanvasText]"
              />
            </svg>
          ) : null}
          <span className="sr-only">{`${Math.round(fraction * 100)} percent of your New job steps done.`}</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-[color:var(--text-muted)]" />
      </Link>
    </li>
  );
}

/** Next leave, next renewal, this week's hours and the New job countdown, one row each. */
export function GlanceCard({
  leave,
  renewal,
  weekHours = null,
  newJob = null,
  today,
}: {
  readonly leave: { readonly start: string } | null;
  readonly renewal: RenewalRow | null;
  /** Rostered hours this week, when the roster has any. */
  readonly weekHours?: number | null;
  /** Hidden without a start date. */
  readonly newJob?: NewJobProgress | null;
  readonly today: string;
}) {
  return (
    <QuietSection title="At a glance" variant="rows" testId="my-day-card-glance">
      <QuietList>
        {newJob ? <NewJobRow job={newJob} today={today} /> : null}
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
        {weekHours !== null ? (
          <QuietRow
            testId="my-day-glance-hours"
            lead={<AreaIcon mode="roster" icon={Clock} />}
            title="Hours this week"
            subtitle={`${hoursText(weekHours)} h rostered · Roster`}
            end={<QuietTextLink href="/my-day/hours">Hours</QuietTextLink>}
          />
        ) : null}
      </QuietList>
    </QuietSection>
  );
}

/** A shift kind's bar fill: the work-mode shift-code tokens. */
const SHIFT_FILL: Readonly<Record<ShiftKind, string>> = {
  day: "fill-[color:var(--work-shift-d)]",
  evening: "fill-[color:var(--work-shift-l)]",
  night: "fill-[color:var(--work-shift-n)]",
  on_call: "fill-[color:var(--work-shift-oc)]",
  leave: "fill-[color:var(--work-shift-al)]",
  other: "fill-[color:var(--work-shift-d)]",
};

/**
 * Bars with an average line, drawn in one SVG so heights are attributes, not
 * styles. With `kinds`, each bar takes the colour of the shift worked that day.
 */
export function HoursChart({
  bars,
  letters,
  kinds,
}: {
  readonly bars: HoursBars;
  readonly letters: readonly string[];
  readonly kinds?: ReadonlyMap<string, readonly ShiftKind[]> | null;
}) {
  const max = Math.max(12, ...bars.days.map((day) => day.hours));
  const width = 100;
  const height = 60;
  const gap = bars.days.length > 7 ? 1.6 : 3;
  const barWidth = (width - gap * (bars.days.length - 1)) / bars.days.length;
  const avgY = bars.averageWorkedDay ? height - (bars.averageWorkedDay / max) * height : null;
  return (
    <div className="grid gap-1" aria-hidden="true">
      <div className="flex justify-between text-3xs font-semibold text-[color:var(--text-muted)] nums">
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
          className="stroke-[color:var(--work-line)]"
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
                className="fill-[color:var(--work-line-strong)]"
              />
            );
          }
          const barHeight = Math.max(3, (day.hours / max) * height);
          const kind = kinds?.get(day.date)?.find((candidate) => candidate !== "leave" && candidate !== "on_call");
          return (
            <rect
              key={day.date}
              x={x}
              y={height - barHeight}
              width={barWidth}
              height={barHeight}
              rx="0.8"
              className={cn(
                kind ? SHIFT_FILL[kind] : "fill-[color:var(--mode-identity)]",
                "forced-colors:fill-[CanvasText]",
              )}
              data-hours={day.hours}
              data-kind={kind}
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
            className="stroke-[color:var(--text-muted)]"
          />
        ) : null}
      </svg>
      <div className="flex justify-between gap-0.5">
        {letters.map((letter, index) => (
          <span key={index} className="flex-1 text-center text-3xs font-semibold text-[color:var(--text-muted)]">
            {letter}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Monday-first weekday letters for a run of dates. */
export function weekdayLetters(days: HoursBars["days"]): readonly string[] {
  return days.map((day) => WEEKDAY_LETTERS[(new Date(`${day.date}T00:00:00Z`).getUTCDay() + 6) % 7] ?? "");
}

/** Hours worked from the reader's roster: this week or the fortnight. Facts only. */
export function HoursCard({
  week,
  fortnight,
  weekShifts,
  fortnightShifts,
}: {
  readonly week: HoursBars;
  readonly fortnight: HoursBars;
  /** How many worked shifts each window holds. */
  readonly weekShifts: number;
  readonly fortnightShifts: number;
}) {
  const [span, setSpan] = useState<"week" | "fortnight">("week");
  const bars = span === "week" ? week : fortnight;
  const count = span === "week" ? weekShifts : fortnightShifts;
  return (
    <div data-mode-identity="roster" className="min-w-0">
      <QuietSection
        title="Hours worked"
        testId="my-day-card-hours"
        aside={
          <MyDaySegmented
            label="Period"
            size="sm"
            value={span}
            onChange={setSpan}
            testId="my-day-hours-switch"
            options={[
              ["week", "Week"],
              ["fortnight", "Fortnight"],
            ]}
          />
        }
      >
        <p className="m-0 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-xs font-semibold text-[color:var(--text-muted)]">
            <span className="mr-1 text-2xl-minus font-bold tracking-tight text-[color:var(--work-ink)] nums">
              {`${hoursText(bars.totalHours)} h`}
            </span>
            {`rostered · ${count} ${count === 1 ? "shift" : "shifts"}`}
          </span>
          <span className="text-2xs font-semibold text-[color:var(--text-muted)]">
            {`${Number(bars.start.slice(8, 10))} ${shortMonth(bars.start)} to ${Number(bars.end.slice(8, 10))} ${shortMonth(bars.end)}`}
          </span>
        </p>
        <p className="sr-only">
          {bars.days
            .filter((day) => day.hours > 0)
            .map((day) => `${fullDate(day.date)} ${hoursText(day.hours)} hours`)
            .join(", ")}
        </p>
        <HoursChart bars={bars} letters={weekdayLetters(bars.days)} />
        <QuietFoot icon={Info}>
          From your roster, not pay. On call and leave are not counted. Rest and fatigue warnings stay off until the
          rules are signed off.
        </QuietFoot>
        <div>
          <QuietTextLink href="/my-day/hours" testId="my-day-hours-open">
            All hours
          </QuietTextLink>
        </div>
      </QuietSection>
    </div>
  );
}

/** A credential's status tag: Lapsed (red), days to go when close (neutral), Current (green). */
function credentialTag(
  date: string,
  today: string,
): { readonly text: string; readonly tone: "red" | "neutral" | "green" } {
  if (date < today) return { text: "Lapsed", tone: "red" };
  const days = daysBetween(today, date);
  if (days <= 60) return { text: days === 0 ? "Today" : `${days} ${days === 1 ? "day" : "days"}`, tone: "neutral" };
  return { text: "Current", tone: "green" };
}

const TAG_TONE = {
  red: "bg-[color:var(--danger-bg)] text-[color:var(--danger-text)]",
  neutral: "bg-[color:var(--work-wash)] text-[color:var(--text-muted)]",
  green: "bg-[color:var(--success-bg)] text-[color:var(--success-text)]",
} as const;

/** Admin's recorded dates, one row each with a status tag. Dates only: no registration numbers are kept here. */
export function CredentialsCard({ rows, today }: { readonly rows: readonly RenewalRow[]; readonly today: string }) {
  return (
    <QuietSection
      title="Credentials"
      variant="rows"
      testId="my-day-card-credentials"
      aside={<QuietTextLink href={withMyDayReturn("/admin/renewals")}>Admin</QuietTextLink>}
    >
      <ul
        role="list"
        className="m-0 grid min-w-0 list-none p-0 [&>li+li]:border-t [&>li+li]:border-[color:var(--work-line)]"
      >
        {rows.map((row) => {
          const passed = row.date < today;
          const tag = credentialTag(row.date, today);
          return (
            <li key={row.entryId} className="min-w-0">
              <Link
                href={withMyDayReturn(row.href)}
                className={cn(
                  focusRing,
                  "flex min-h-12 min-w-0 items-center gap-2.5 px-3 py-2 text-inherit no-underline",
                )}
              >
                <AreaIcon mode="my-work" icon={passed ? TriangleAlert : Shield} tone={passed ? "red" : undefined} />
                <span className="grid min-w-0 flex-1">
                  <span className="text-sm-minus leading-tight font-bold break-words text-[color:var(--work-ink)]">
                    {row.title}
                  </span>
                  <span
                    className={cn(
                      "text-2xs break-words",
                      passed ? "font-bold text-[color:var(--danger-text)]" : "text-[color:var(--text-muted)]",
                    )}
                  >
                    {`${passed ? "Date passed" : "Recorded date"} ${Number(row.date.slice(8, 10))} ${shortMonth(row.date)} ${row.date.slice(0, 4)}`}
                  </span>
                </span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-3xs font-bold", TAG_TONE[tag.tone])}>
                  {tag.text}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="px-3.5 pb-2.5">
        <QuietFoot icon={Lock}>Dates from Admin. No registration numbers are kept on My Day.</QuietFoot>
      </div>
    </QuietSection>
  );
}

const MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"] as const;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * CPD by month: the year's figure, the hours logged each month (this month
 * marked), a dashed line at the month's share of the target, and the
 * straight-line estimate for the year.
 */
export function CpdMonthCard({
  byMonth,
  loggedHours,
  targetHours,
  projected,
  closed = false,
  currentMonth,
}: {
  readonly byMonth: readonly number[];
  readonly byCategory?: Readonly<Record<CmeCategory, number>>;
  readonly loggedHours: number;
  readonly targetHours: number;
  readonly projected: number | null;
  /** The CPD year has been closed: no estimate is drawn. */
  readonly closed?: boolean;
  /** 0 = January. */
  readonly currentMonth: number;
}) {
  const pace = targetHours > 0 ? targetHours / 12 : null;
  const max = Math.max(1, pace ?? 0, ...byMonth);
  const most = byMonth.reduce((best, hours, index) => (hours > (byMonth[best] ?? 0) ? index : best), 0);
  const height = 50;
  const paceY = pace !== null ? height - (pace / max) * height : null;
  return (
    <div data-mode-identity="cme" className="min-w-0">
      <QuietSection
        title="CPD by month"
        testId="my-day-card-cpd-month"
        aside={<QuietTextLink href={withMyDayReturn("/cme")}>Open CPD</QuietTextLink>}
      >
        <p className="m-0 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-xs font-semibold text-[color:var(--text-muted)]">
            <span className="mr-1 text-2xl-minus font-bold tracking-tight text-[color:var(--work-ink)] nums">
              {hoursText(loggedHours)}
            </span>
            {`of ${hoursText(targetHours)} h this year`}
          </span>
          {(byMonth[most] ?? 0) > 0 ? (
            <span className="text-2xs font-semibold text-[color:var(--text-muted)] nums">{`most ${hoursText(byMonth[most] ?? 0)} h · ${MONTH_NAMES[most]}`}</span>
          ) : null}
        </p>
        <div aria-hidden="true" className="relative">
          <div className="grid grid-cols-12 gap-1">
            {MONTH_LETTERS.map((letter, index) => {
              const hours = byMonth[index] ?? 0;
              const barHeight = hours > 0 ? Math.max(4, (hours / max) * height) : 1;
              return (
                <span key={index} className="grid justify-items-center gap-1">
                  <svg
                    viewBox={`0 0 10 ${height}`}
                    preserveAspectRatio="none"
                    className="block h-14 w-full overflow-visible"
                  >
                    <rect
                      x="0"
                      y={height - barHeight}
                      width="10"
                      height={barHeight}
                      rx="0.8"
                      className={cn(
                        hours === 0
                          ? "fill-[color:var(--work-line-strong)]"
                          : index === currentMonth
                            ? "fill-[color:var(--mode-identity)]"
                            : "fill-[color:var(--mode-identity-border)]",
                        "forced-colors:fill-[CanvasText]",
                      )}
                    />
                    {paceY !== null ? (
                      <line
                        x1="-1"
                        x2="11"
                        y1={paceY}
                        y2={paceY}
                        strokeWidth="1"
                        strokeDasharray="2 2"
                        vectorEffect="non-scaling-stroke"
                        className="stroke-[color:var(--text-muted)]"
                      />
                    ) : null}
                  </svg>
                  <span
                    className={cn(
                      "text-3xs",
                      index === currentMonth
                        ? "font-bold text-[color:var(--mode-identity)]"
                        : "font-semibold text-[color:var(--text-muted)]",
                    )}
                  >
                    {letter}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
        <p className="sr-only">
          {byMonth
            .map((hours, index) => (hours > 0 ? `${MONTH_NAMES[index]}: ${hoursText(hours)} hours` : null))
            .filter(Boolean)
            .join(", ")}
        </p>
        <QuietFoot icon={Info}>
          {projected !== null
            ? `At this rate, about ${projected} h by 31 Dec. This is a straight-line estimate from what you have logged.${pace !== null ? ` Dashed line is the pace for ${hoursText(targetHours)} h.` : ""}`
            : closed
              ? "This CPD year is closed. The hours above are final."
              : "No hours logged yet this year."}
        </QuietFoot>
      </QuietSection>
    </div>
  );
}

/** A note on this device only, for this account. Never sent anywhere. */
export function QuickNoteCard() {
  const [note, setNote] = useMyDayQuickNote();
  const fieldId = useId();
  const hintId = useId();
  return (
    <QuietSection
      title="Quick note"
      testId="my-day-card-quick-note"
      aside={<span className="text-2xs font-semibold text-[color:var(--text-muted)]">This device only</span>}
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
        className="min-h-14 w-full resize-y rounded-lg border border-[color:var(--work-line-strong)] bg-[color:var(--work-surface)] px-3 py-2.5 text-sm text-[color:var(--work-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus)] forced-colors:border"
      />
      <div id={hintId}>
        <QuietFoot icon={TriangleAlert}>
          Never write patient names or details here. Deleted when you sign out.
        </QuietFoot>
      </div>
    </QuietSection>
  );
}
