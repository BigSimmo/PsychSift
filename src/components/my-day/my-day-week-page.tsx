"use client";

import { CalendarDays, ChevronRight, Clock, Info, TriangleAlert } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Fragment, useMemo, type ReactNode } from "react";

import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { focusRing } from "@/components/card-recipes";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { MyDayFrame } from "@/components/my-day/my-day-frame";
import { listNames } from "@/components/my-day/my-day-page-parts";
import { clashWithShifts } from "@/components/my-day/my-day-clash";
import { AreaIcon, DateBlock, QuietFoot, quietCard } from "@/components/my-day/my-day-quiet";
import { cmeRoutineItemsThrough } from "@/components/my-day/sources/cme";
import { useMyDayItems } from "@/components/my-day/use-my-day-items";
import { kindOf } from "@/components/roster/roster-format";
import { useRosterShifts, type MyShift } from "@/components/roster/use-roster-shifts";
import { perthDateKey } from "@/components/teaching/teaching-dates";
import type { SessionSummaryRead } from "@/components/teaching/teaching-reads";
import { relocatedEntryId, sessionHref } from "@/components/teaching/teaching-view-model";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { useTeachingWeek } from "@/components/teaching/use-teaching-week";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui-primitives";
import { appModeDefinition } from "@/lib/app-modes";
import type { CmeRoutine } from "@/lib/cme/routines";
import type { MyDayItem, MyDaySourceMode } from "@/lib/my-day/model";
import { dueCountsByDate } from "@/lib/my-day/dashboard";
import { hoursBars, kindsByDate as kindsByDateOf, mondayIndex } from "@/lib/my-day/figures";
import { mergeMyDayItems } from "@/lib/my-day/merge";
import { dayCode, perthWeekday, shiftTitle, weekdayTime } from "@/lib/my-day/quiet-figures";
import { myDayItemWeekDate, myDayWeekDates, myDayWeekDayLabel, myDayWeekRangeLabel } from "@/lib/my-day/week";
import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from "@/lib/reminders/settings";
import { SHIFT_KIND_LABEL, type ShiftKind } from "@/lib/roster/shift-kind";
import { addDaysToDate, formatPerthDay, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import { zonedDateOf } from "@/lib/work-time/format";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";

const SHIFT_BAR: Readonly<Record<ShiftKind, string>> = {
  day: "bg-[color:var(--work-shift-d)]",
  evening: "bg-[color:var(--work-shift-l)]",
  night: "bg-[color:var(--work-shift-n)]",
  on_call: "bg-[color:var(--work-shift-oc)]",
  leave: "bg-[color:var(--work-shift-al)]",
  other: "bg-[color:var(--work-shift-d)]",
};

function hoursText(value: number): string {
  return `${Number(value.toFixed(1))}`;
}

function StripDay({
  date,
  today,
  kinds,
  due,
  href,
}: {
  readonly date: string;
  readonly today: string;
  readonly kinds: readonly ShiftKind[] | null;
  readonly due: number;
  readonly href?: string;
}) {
  const code = kinds ? dayCode(kinds) : null;
  const off = kinds !== null && code === null;
  const isToday = date === today;
  const words = [
    kinds ? (kinds.length ? kinds.map((kind) => SHIFT_KIND_LABEL[kind]).join(" and ") : "Off") : "",
    due ? `${due} due` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const tile = cn(
    "relative grid min-h-13 content-center justify-items-center gap-0.5 rounded-xl border py-1.5 no-underline forced-colors:border",
    isToday
      ? "border-transparent bg-[color:var(--mode-identity)]"
      : "border-[color:var(--work-line)] bg-[color:var(--work-surface)]",
  );
  const inner = (
    <>
      <span className="sr-only">{words ? `${formatPerthDay(date)}: ${words}` : formatPerthDay(date)}</span>
      <span
        aria-hidden="true"
        className={cn(
          "text-3xs font-bold tracking-wider uppercase",
          isToday ? "text-[color:var(--mode-identity-contrast)]" : "text-[color:var(--text-muted)]",
        )}
      >
        {perthWeekday(date)}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "text-lg-minus leading-none font-bold nums",
          isToday
            ? "text-[color:var(--mode-identity-contrast)]"
            : off
              ? "text-[color:var(--text-muted)]"
              : "text-[color:var(--work-ink)]",
        )}
      >
        {Number(date.slice(8, 10))}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 h-0.75 w-[1.125rem] rounded-full forced-colors:bg-[CanvasText]",
          code ? (isToday ? "bg-[color:var(--mode-identity-contrast)]" : SHIFT_BAR[code]) : "bg-transparent",
        )}
      />
      {due ? (
        <span
          data-testid={`dash-week-due-${date}`}
          data-passed={date < today ? "" : undefined}
          aria-hidden="true"
          className={cn(
            "absolute top-1 right-1 size-1.5 rounded-full forced-colors:bg-[CanvasText]",
            date < today ? "bg-[color:var(--warning-text)]" : "bg-[color:var(--neutral-400)]",
          )}
        />
      ) : null}
    </>
  );
  return (
    <li
      className="grid min-w-0 gap-0.5 text-center"
      data-testid={`dash-week-tile-${date}`}
      data-kind={code ?? (off ? "off" : "none")}
      aria-current={isToday ? "date" : undefined}
    >
      {href ? (
        <Link href={href} className={cn(focusRing, tile)}>
          {inner}
        </Link>
      ) : (
        <span className={tile}>{inner}</span>
      )}
    </li>
  );
}

/** The signed-out sample, downloaded only when a signed-out visitor opens this page. */
const MyDayWeekSample = dynamic(
  () => import("@/components/my-day/my-day-sample-subpages").then((module) => module.MyDaySubpageSampleView),
  { ssr: false },
);

/**
 * My Day, Week: the next seven Perth days, one agenda card with a row group per day, gathering the
 * reader's own roster shifts, teaching sessions, CPD routines, recorded Admin
 * dates and every other dated My Day item. Read-only and stored nowhere: each
 * source is the hook its own mode already uses, and each row links to its mode.
 * A shift belongs to the day it starts, as on a printed roster.
 */
export function MyDayWeekPage({ now }: { now?: Date } = {}) {
  // Week is the list; the month lives in Calendar, one tab along, so there is one month view, not two
  // (usefulness audit, 11 Oct 2026). The page links to Calendar under the week.
  return (
    <MyDayFrame
      title="This week"
      testId="my-day-week"
      now={now}
      wide
      signedOutSample={{
        render: (at) => (
          <MyDayWeekSample now={at} testId="my-day-week-ready">
            {(sample) => (
              <MyDayWeekDays
                now={at}
                shifts={sample.sources.roster.shifts}
                sessions={sample.sources.teaching.ahead ?? []}
                items={sample.items}
                cmeRoutines={[]}
                reminders={DEFAULT_REMINDER_SETTINGS}
                rosterKnown
              />
            )}
          </MyDayWeekSample>
        ),
      }}
      subtitle={(at) => myDayWeekRangeLabel(perthDateOf(at))}
    >
      {(at) => <MyDayWeekBody now={at} />}
    </MyDayFrame>
  );
}

function MyDayWeekBody({ now }: { now: Date }) {
  const { zone } = useWorkTimeZone();
  const today = zonedDateOf(now, zone);
  const dates = useMemo(() => myDayWeekDates(today), [today]);
  const lastDate = dates[dates.length - 1]!;
  const range = useMemo(() => ({ from: today, to: lastDate }), [today, lastDate]);
  // Shifts from this Monday, so the hours line totals the same Monday-to-Sunday week as Hours.
  const rosterRange = useMemo(
    () => ({ from: addDaysToDate(today, -mondayIndex(today)), to: lastDate }),
    [today, lastDate],
  );

  const items = useMyDayItems({ enabled: true, now });
  const shifts = useRosterShifts(rosterRange);
  const teaching = useTeachingWeek(range, { demoMode: false }, now);
  const reminders = useAppPreferences().preferences.reminders;

  const loading =
    items.status === "loading" ||
    shifts.status === "loading" ||
    shifts.teamLoading ||
    teaching.status === "loading" ||
    teaching.status === "idle";

  const failed: string[] = items.sources
    .filter((source) => source.status === "failed")
    .map((source) => appModeDefinition(source.mode).label);
  if (shifts.status === "error" || shifts.status === "signed-out") failed.push("Roster shifts");
  if (shifts.teamMessage) failed.push("Team shifts");
  if (teaching.status === "offline" || teaching.status === "error" || teaching.status === "signed-out") {
    failed.push("Teaching sessions");
  }
  if (teaching.week?.relocatedUnavailable) failed.push("On Call teaching entries");
  const teachingUnavailable = teaching.status === "setup";

  // Example shifts belong to a sample doctor, never to the reader: leave them out unless this is a demo.
  const showShifts = shifts.status === "ready" && (!shifts.sample || shifts.demoMode);
  const sampleOmitted = shifts.status === "ready" && shifts.sample && !shifts.demoMode;

  if (loading) {
    return (
      <>
        <span role="status" className="sr-only">
          Loading your week
        </span>
        <div className="grid gap-5" data-testid="my-day-week-loading" aria-hidden="true">
          <ModeModuleSkeleton rows={2} twoLine eyebrow />
          <ModeModuleSkeleton rows={2} twoLine eyebrow />
        </div>
      </>
    );
  }

  const retry = () => {
    items.retry();
    void shifts.reload();
    teaching.retry();
  };

  const notices = (
    <>
      {failed.length > 0 ? (
        <div className="grid gap-2" data-testid="my-day-week-failed-notice">
          <ModeNotice tone="warning">{`Couldn't load: ${listNames(failed)}. Showing the rest.`}</ModeNotice>
          <div>
            <Button variant="secondary" onClick={retry}>
              Retry
            </Button>
          </div>
        </div>
      ) : null}
      {sampleOmitted ? (
        <ModeNotice testId="my-day-week-sample-notice">
          Roster is showing example shifts only, so your shifts aren&apos;t listed here.
        </ModeNotice>
      ) : null}
      {teachingUnavailable ? (
        <ModeNotice testId="my-day-week-teaching-unavailable">
          Teaching isn&apos;t available yet, so its sessions aren&apos;t shown.
        </ModeNotice>
      ) : null}
    </>
  );

  return (
    <div className="grid gap-2.5" data-testid="my-day-week-ready">
      <MyDayWeekDays
        notices={notices}
        now={now}
        shifts={showShifts ? shifts.shifts : []}
        sessions={teaching.week ? [...teaching.week.sessions, ...teaching.week.relocated] : []}
        items={items.items}
        cmeRoutines={items.cmeRoutines}
        reminders={reminders}
        rosterKnown={showShifts}
        hoursPartial={Boolean(shifts.teamMessage) || Boolean(shifts.teamRefreshing)}
      />
      {/* The one calendar is on for everyone, with no preview or launch gate. */}
      <Link
        href="/my-day/calendar"
        data-testid="my-day-week-calendar-link"
        className={cn(
          quietCard,
          focusRing,
          "flex min-h-12 min-w-0 items-center gap-2.5 px-3 py-2.5 text-inherit no-underline",
        )}
      >
        <AreaIcon mode="my-day" icon={CalendarDays} />
        <span className="grid min-w-0 flex-1">
          <span className="text-sm-minus font-bold text-[color:var(--work-ink)]">Open the full calendar</span>
          <span className="text-2xs text-[color:var(--text-muted)]">
            Shifts, leave, rotations, courses, teaching, CPD and Admin dates together
          </span>
        </span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[color:var(--text-muted)]" />
      </Link>
    </div>
  );
}

type AgendaEntry = {
  readonly key: string;
  /** The area that owns it: its colour is the dot before the title. */
  readonly identity: MyDaySourceMode;
  readonly title: string;
  /** `HH:MM`, "All day", or null when the thing has no time of day. */
  readonly time: string | null;
  /** When it is over (epoch ms), for greying finished rows; null when it has no end. */
  readonly endsAt: number | null;
  /** When it starts (epoch ms), for placing the now line; null when untimed. */
  readonly startsAt: number | null;
  readonly area: string;
  readonly detail: string | null;
  /** A state in words ("Date passed", "Cancelled"), in grey ink. */
  readonly state: string | null;
  /**
   * The status shape before the state word (Ward Flow review, 12 Oct 2026): a red triangle once a
   * date has passed, an amber dot when it is due soon, none for a plain word like "Cancelled".
   */
  readonly shape: "passed" | "soon" | null;
  /** A session that starts as on call ends, or runs across it: said in amber under the row. */
  readonly clash: string | null;
  readonly href: string;
  readonly testId: string;
};

/** "until 17:00", or "until Mon 08:00" when the shift ends on a later day. */
function untilWords(startsAt: string, endsAt: string): string {
  return perthDateOf(endsAt) === perthDateOf(startsAt)
    ? `until ${perthTimeOf(endsAt)}`
    : `until ${weekdayTime(endsAt)}`;
}

function shiftEntry(shift: MyShift): AgendaEntry {
  const kind = kindOf(shift);
  return {
    key: `shift:${shift.id}`,
    identity: "roster",
    title: shiftTitle(kind),
    time: kind === "leave" ? null : perthTimeOf(shift.startsAt),
    startsAt: kind === "leave" ? null : Date.parse(shift.startsAt),
    endsAt: Date.parse(shift.endsAt),
    area: "Roster",
    detail: kind === "leave" ? null : untilWords(shift.startsAt, shift.endsAt),
    state: null,
    shape: null,
    clash: null,
    href: "/roster/shifts",
    testId: `my-day-week-shift-${shift.id}`,
  };
}

function teachingEntry(session: SessionSummaryRead, shifts: readonly MyShift[]): AgendaEntry {
  const cancelled = session.status === "cancelled";
  return {
    key: `teaching:${session.occurrenceId}`,
    identity: "teaching",
    title: session.title,
    time: session.allDay ? "All day" : perthTimeOf(session.startsAt),
    startsAt: session.allDay ? null : Date.parse(session.startsAt),
    endsAt: Date.parse(session.endsAt),
    area: "Teaching",
    detail: [session.venue, session.isPresenter ? "you lead" : null].filter(Boolean).join(" · ") || null,
    state: cancelled ? "Cancelled" : null,
    shape: null,
    clash: cancelled || session.allDay ? null : clashWithShifts(shifts, session.startsAt, session.endsAt),
    href:
      sessionHref(session) ??
      `/teaching/week?week=${perthDateKey(session.startsAt)}#${onCallEntryAnchorId(relocatedEntryId(session.occurrenceId))}`,
    testId: `my-day-week-session-${session.occurrenceId}`,
  };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function itemEntry(item: MyDayItem): AgendaEntry {
  const overdue = item.severity === "overdue";
  const state = overdue
    ? item.mode === "my-work"
      ? "Date passed"
      : "Overdue"
    : item.severity === "soon"
      ? "Due soon"
      : null;
  const timed = item.due && !DATE_ONLY.test(item.due) ? item.due : null;
  return {
    key: item.id,
    identity: item.mode,
    title: item.title,
    time: timed ? perthTimeOf(timed) : null,
    startsAt: timed ? Date.parse(timed) : null,
    endsAt: null,
    area: appModeDefinition(item.mode).label,
    // The state already says the date has passed; a detail that repeats it is dropped.
    detail: item.detail && !(overdue && /passed|overdue/i.test(item.detail)) ? item.detail : null,
    state,
    shape: overdue ? "passed" : item.severity === "soon" ? "soon" : null,
    clash: null,
    href: item.href,
    testId: `my-day-item-${item.id}`,
  };
}

/** Timed entries first, in time order; entries with no time keep their order after them. */
function byTimeOfDay(entries: readonly AgendaEntry[]): AgendaEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const ta = a.entry.startsAt;
      const tb = b.entry.startsAt;
      if (ta !== null && tb !== null) return ta - tb || a.index - b.index;
      if (ta !== null) return -1;
      if (tb !== null) return 1;
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

function AgendaRow({ entry, done }: { readonly entry: AgendaEntry; readonly done: boolean }) {
  return (
    <li className="min-w-0">
      <Link
        href={entry.href}
        data-testid={entry.testId}
        data-done={done ? "" : undefined}
        className={cn(
          focusRing,
          "grid min-h-12 min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] items-baseline gap-x-2 rounded-md py-1.5 no-underline lg:grid-cols-1",
        )}
      >
        <span className="text-xs font-bold text-[color:var(--work-ink)] nums">{entry.time}</span>
        <span className="grid min-w-0">
          <span
            className={cn(
              "min-w-0 text-sm-minus leading-snug break-words",
              done ? "font-semibold text-[color:var(--text-muted)]" : "font-bold text-[color:var(--work-ink)]",
            )}
          >
            {entry.title}
          </span>
          <span className="flex min-w-0 items-baseline gap-1.5 text-2xs leading-snug text-[color:var(--text-muted)]">
            <span
              aria-hidden="true"
              data-mode-identity={entry.identity}
              className="size-1.5 shrink-0 -translate-y-px rounded-full bg-[color:var(--mode-identity)] forced-colors:bg-[CanvasText]"
            />
            <span className="min-w-0 break-words">
              {entry.area}
              {entry.state ? (
                <>
                  {" · "}
                  <span
                    data-late={entry.shape === "passed" ? "passed" : entry.shape === "soon" ? "" : undefined}
                    className="font-semibold text-[color:var(--work-ink-muted)]"
                  >
                    {entry.state}
                  </span>
                </>
              ) : null}
              {entry.detail ? ` · ${entry.detail}` : null}
            </span>
          </span>
          {entry.clash ? (
            <span
              className="mt-1 flex min-w-0 items-start gap-1.5 text-2xs font-semibold text-[color:var(--warning-text)]"
              data-testid={`my-day-week-clash-${entry.key}`}
            >
              <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{entry.clash}</span>
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

/** The line across today at the present minute, in My Day's colour. */
function NowLine({ now }: { readonly now: Date }) {
  return (
    <li
      aria-hidden="true"
      data-testid="my-day-week-now"
      className="flex min-h-7 items-center gap-2 text-2xs font-bold text-[color:var(--mode-identity)] nums"
    >
      <span>{`${perthTimeOf(now)} now`}</span>
      <span className="h-px min-w-0 flex-1 bg-[color:var(--mode-identity)] forced-colors:bg-[CanvasText]" />
    </li>
  );
}

/** Every row for one Perth date, in time order: the agenda's day, or the month's chosen day. */
function entriesOn(
  date: string,
  shifts: readonly MyShift[],
  sessions: readonly SessionSummaryRead[],
  items: readonly MyDayItem[],
  itemDate: (item: MyDayItem) => string | null,
): AgendaEntry[] {
  return byTimeOfDay([
    ...shifts.filter((shift) => perthDateOf(shift.startsAt) === date).map(shiftEntry),
    ...[...sessions]
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title))
      .filter((session) => perthDateKey(session.startsAt) === date)
      .map((session) => teachingEntry(session, shifts)),
    ...items.filter((item) => itemDate(item) === date).map(itemEntry),
  ]);
}

/**
 * Week: the seven days as a strip (the same codes as Today), then one card with
 * a date block per day and its timed rows, then a pointer to Roster. Drawn from
 * whatever shifts, sessions and items it is given: the reader's own, or the
 * signed-out sample.
 */
export function MyDayWeekDays({
  now,
  shifts,
  sessions,
  items,
  cmeRoutines,
  reminders,
  rosterKnown,
  hoursPartial = false,
  notices,
}: {
  readonly now: Date;
  readonly shifts: readonly MyShift[];
  readonly sessions: readonly SessionSummaryRead[];
  readonly items: readonly MyDayItem[];
  readonly cmeRoutines: readonly CmeRoutine[];
  readonly reminders: ReminderSettings;
  /** False when the roster did not load: the strip shows no false "off" and empty days say why. */
  readonly rosterKnown: boolean;
  /** Team shifts failed or are still refreshing: a partial roster cannot support an honest hours total. */
  readonly hoursPartial?: boolean;
  /** Notices drawn above the week strip. */
  readonly notices?: ReactNode;
}) {
  const { zone } = useWorkTimeZone();
  const today = zonedDateOf(now, zone);
  const dates = useMemo(() => myDayWeekDates(today), [today]);
  const lastDate = dates[dates.length - 1]!;
  const merged = useMemo(
    () => mergeMyDayItems([items, cmeRoutineItemsThrough(cmeRoutines, lastDate, now, reminders)]),
    [items, cmeRoutines, lastDate, now, reminders],
  );
  const entriesByDay = useMemo(
    () =>
      new Map(
        dates.map((date) => [
          date,
          entriesOn(date, shifts, sessions, merged, (item) => myDayItemWeekDate(item, today, lastDate)),
        ]),
      ),
    [shifts, sessions, merged, dates, today, lastDate],
  );
  const kindsByDate = useMemo(
    () => kindsByDateOf(shifts.map((shift) => ({ startsAt: shift.startsAt, kind: kindOf(shift) }))),
    [shifts],
  );
  const dueByDate = useMemo(() => dueCountsByDate(merged), [merged]);
  // The same rule as Hours (Roster's own summary): worked shifts only, never pay.
  const rosteredHours = useMemo(
    () =>
      // The Hours page's own week figure, so the two always agree.
      hoursBars(
        shifts.map((shift) => ({ startsAt: shift.startsAt, endsAt: shift.endsAt, kind: kindOf(shift) })),
        today,
        "week",
      ).totalHours,
    [shifts, today],
  );
  // An overnight shift that started the day before: an empty day says when it ends.
  const endsOn = (date: string): MyShift | undefined =>
    shifts.find(
      // A shift ending exactly at midnight belongs to the day before, as in summariseToday.
      (shift) =>
        kindOf(shift) !== "leave" &&
        perthDateOf(shift.startsAt) < date &&
        zonedDateOf(Date.parse(shift.endsAt) - 1, zone) === date,
    );
  const at = now.getTime();

  return (
    <div className="grid min-w-0 gap-2.5">
      {notices}
      {/* From 1024px the agenda below is seven day columns with their own dates, so the strip would repeat them. */}
      <ol role="list" className="grid grid-cols-7 gap-1 text-center lg:hidden" data-testid="my-day-week-strip">
        {dates.map((date) => (
          <StripDay
            key={date}
            date={date}
            today={today}
            kinds={rosterKnown ? (kindsByDate.get(date) ?? []) : null}
            due={dueByDate.get(date) ?? 0}
          />
        ))}
      </ol>

      <ul
        role="list"
        data-testid="my-day-week-agenda"
        className={cn(
          quietCard,
          "grid min-w-0 px-3 [&>li+li]:border-t [&>li+li]:border-[color:var(--work-line)]",
          // Desktop (usefulness audit, 11 Oct 2026): the week as seven day columns, not one long list.
          "lg:grid-cols-7 lg:px-0 lg:[&>li+li]:border-t-0 lg:[&>li+li]:border-l",
        )}
      >
        {dates.map((date) => {
          const entries = entriesByDay.get(date) ?? [];
          const isToday = date === today;
          const nowIndex = isToday ? entries.findIndex((entry) => entry.startsAt !== null && entry.startsAt > at) : -1;
          const ending = entries.length === 0 ? endsOn(date) : undefined;
          return (
            <li
              key={date}
              data-testid={`my-day-week-day-${date}`}
              className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2 py-2 lg:grid-cols-1 lg:content-start lg:gap-y-1 lg:px-2 lg:py-3"
            >
              <h2 className="sr-only">{myDayWeekDayLabel(date, today)}</h2>
              <span className="pt-1">
                <DateBlock number={Number(date.slice(8, 10))} word={perthWeekday(date)} today={isToday} />
              </span>
              {entries.length > 0 ? (
                <ul role="list" className="grid min-w-0">
                  {entries.map((entry, index) => (
                    <Fragment key={entry.key}>
                      {index === nowIndex ? <NowLine now={now} /> : null}
                      <AgendaRow
                        entry={entry}
                        done={(entry.endsAt ?? entry.startsAt ?? Number.POSITIVE_INFINITY) <= at}
                      />
                    </Fragment>
                  ))}
                  {isToday && nowIndex === -1 && entries.some((entry) => entry.startsAt !== null) ? (
                    <NowLine now={now} />
                  ) : null}
                </ul>
              ) : (
                <p
                  className="flex min-h-10 items-center text-xs text-[color:var(--text-muted)]"
                  data-testid={`my-day-week-empty-${date}`}
                >
                  {!rosterKnown
                    ? "Roster not loaded, so shifts are not shown"
                    : ending
                      ? `${shiftTitle(kindOf(ending))} ends ${perthTimeOf(ending.endsAt)} · nothing else on`
                      : "Nothing on"}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="grid min-w-0 gap-2.5 lg:grid-cols-2">
        {rosterKnown && !hoursPartial ? (
          // Hours left the main tabs (usefulness audit, 11 Oct 2026): one line here, over the same Monday-to-Sunday week as Hours.
          <Link
            href="/my-day/hours"
            data-testid="my-day-week-hours"
            className={cn(
              quietCard,
              focusRing,
              "flex min-h-12 min-w-0 items-center gap-2.5 px-3 py-2.5 text-inherit no-underline",
            )}
          >
            <AreaIcon mode="my-day" icon={Clock} />
            <span className="grid min-w-0 flex-1">
              <span className="text-sm-minus font-bold text-[color:var(--work-ink)] nums">
                {`${hoursText(rosteredHours)} h rostered this week`}
              </span>
              <span className="text-2xs text-[color:var(--text-muted)]">Hours by week and fortnight, not pay</span>
            </span>
            <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[color:var(--text-muted)]" />
          </Link>
        ) : null}
        <Link
          href="/roster"
          aria-label="Open Roster: all your shifts, swaps, leave and your team"
          data-testid="my-day-week-footer"
          className={cn(
            quietCard,
            focusRing,
            "flex min-h-12 min-w-0 items-center gap-2.5 px-3 py-2.5 text-inherit no-underline",
          )}
        >
          <AreaIcon mode="roster" icon={CalendarDays} />
          <span className="grid min-w-0 flex-1">
            <span className="text-sm-minus font-bold text-[color:var(--work-ink)]">All your shifts are in Roster</span>
            <span className="text-2xs text-[color:var(--text-muted)]">Swaps, leave and your team</span>
          </span>
          <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[color:var(--text-muted)]" />
        </Link>
      </div>
      <div className="px-1">
        <QuietFoot icon={Info}>From Roster, Teaching, CPD and Admin. Each item opens the page that owns it.</QuietFoot>
      </div>
    </div>
  );
}
