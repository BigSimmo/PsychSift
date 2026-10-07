"use client";

import { CalendarDays, ChevronRight, Info, TriangleAlert } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Fragment, useMemo, useState, type ReactNode } from "react";

import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { focusRing } from "@/components/card-recipes";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { MyDayFrame } from "@/components/my-day/my-day-frame";
import { listNames } from "@/components/my-day/my-day-page-parts";
import { clashWithShifts } from "@/components/my-day/my-day-clash";
import { AreaIcon, DateBlock, QuietFoot, quietCard } from "@/components/my-day/my-day-quiet";
import { MonthView, MyDaySegmented, StripDay, type DayDetail } from "@/components/my-day/my-day-today-cards";
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
import { addMonths, kindsByDate as kindsByDateOf, monthTitle } from "@/lib/my-day/figures";
import { duePerthDate, mergeMyDayItems } from "@/lib/my-day/merge";
import { perthWeekday, shiftTitle, weekdayTime } from "@/lib/my-day/quiet-figures";
import { myDayItemWeekDate, myDayWeekDates, myDayWeekDayLabel, myDayWeekRangeLabel } from "@/lib/my-day/week";
import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from "@/lib/reminders/settings";
import { perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import { zonedDateOf } from "@/lib/work-time/format";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";

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
  const [view, setView] = useState<WeekView>("week");
  const [shownMonth, setShownMonth] = useState<string | null>(null);
  const showView = (next: WeekView) => {
    setView(next);
    // A return to Month starts on this month again, as the calendar does.
    setShownMonth(null);
  };
  const viewProps = { view, onView: showView, shownMonth, onMonth: setShownMonth };
  return (
    <MyDayFrame
      title={view === "month" ? "This month" : "This week"}
      testId="my-day-week"
      now={now}
      signedOutSample={{
        render: (at) => (
          <MyDayWeekSample now={at} testId="my-day-week-ready">
            {(sample) => (
              <MyDayWeekDays
                {...viewProps}
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
      subtitle={(at) =>
        view === "month"
          ? monthBandLine(shownMonth ?? perthDateOf(at).slice(0, 7), perthDateOf(at).slice(0, 7))
          : myDayWeekRangeLabel(perthDateOf(at))
      }
    >
      {(at) => <MyDayWeekBody now={at} {...viewProps} />}
    </MyDayFrame>
  );
}

type WeekView = "week" | "month";

interface WeekViewProps {
  readonly view: WeekView;
  readonly onView: (view: WeekView) => void;
  /** The month the calendar shows ("2026-11"), or null for this month. */
  readonly shownMonth: string | null;
  readonly onMonth: (month: string) => void;
}

/** "October 2026", or "November 2026 · next month" once the calendar has moved on. */
function monthBandLine(month: string, current: string): string {
  if (month === current) return monthTitle(month);
  if (month === addMonths(current, 1)) return `${monthTitle(month)} · next month`;
  if (month === addMonths(current, -1)) return `${monthTitle(month)} · last month`;
  return monthTitle(month);
}

/** The last day of a month ("2026-10" to "2026-10-31"). */
function monthEnd(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
  return `${month}-${String(days).padStart(2, "0")}`;
}

function MyDayWeekBody({ now, ...viewProps }: { now: Date } & WeekViewProps) {
  const { zone } = useWorkTimeZone();
  const today = zonedDateOf(now, zone);
  const dates = useMemo(() => myDayWeekDates(today), [today]);
  const lastDate = dates[dates.length - 1]!;
  const month = viewProps.view === "month" ? (viewProps.shownMonth ?? today.slice(0, 7)) : null;
  // The month view reads the whole month shown, as well as the seven days.
  const from = month && `${month}-01` < today ? `${month}-01` : today;
  const to = month && monthEnd(month) > lastDate ? monthEnd(month) : lastDate;
  const range = useMemo(() => ({ from, to }), [from, to]);

  const items = useMyDayItems({ enabled: true, now });
  const shifts = useRosterShifts(range);
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
      {items.demoMode || shifts.demoMode ? (
        <ModeNotice testId="my-day-week-demo-notice">Demo data: these items are invented examples.</ModeNotice>
      ) : null}
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
        {...viewProps}
        notices={notices}
        now={now}
        shifts={showShifts ? shifts.shifts : []}
        sessions={teaching.week ? [...teaching.week.sessions, ...teaching.week.relocated] : []}
        items={items.items}
        cmeRoutines={items.cmeRoutines}
        reminders={reminders}
        rosterKnown={showShifts}
      />
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
  /** A state in words ("Date passed", "Cancelled"), shown in amber when `warn`. */
  readonly state: string | null;
  readonly warn: boolean;
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
    warn: false,
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
    warn: cancelled,
    clash: cancelled || session.allDay ? null : clashWithShifts(shifts, session.startsAt, session.endsAt),
    href: sessionHref(session) ?? `/teaching/week#${onCallEntryAnchorId(relocatedEntryId(session.occurrenceId))}`,
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
    warn: overdue,
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
          "grid min-h-12 min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] items-baseline gap-x-2 rounded-md py-1.5 no-underline",
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
                  <span className={entry.warn ? "font-semibold text-[color:var(--warning-text)]" : undefined}>
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

/** A row of the month's chosen day, in the same words as the agenda. */
function dayDetail(entry: AgendaEntry): DayDetail {
  return {
    key: entry.key,
    mode: entry.identity,
    title: entry.time && entry.time !== "All day" ? `${entry.title} ${entry.time}` : entry.title,
    subtitle: [entry.state, entry.area, entry.detail, entry.clash].filter(Boolean).join(" · ") || undefined,
    passed: entry.warn,
    href: entry.href,
    actionLabel: "Open",
  };
}

/**
 * Week or Month. Week: the seven days as a strip (the same codes as Today),
 * then one card with a date block per day and its timed rows, then a pointer
 * to Roster. Month: the calendar of shifts and due dates, and the chosen
 * day's rows. Drawn from whatever shifts, sessions and items it is given: the
 * reader's own, or the signed-out sample.
 */
export function MyDayWeekDays({
  now,
  shifts,
  sessions,
  items,
  cmeRoutines,
  reminders,
  rosterKnown,
  view = "week",
  onView,
  shownMonth = null,
  onMonth,
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
  /** Notices drawn under the Week and Month switch. */
  readonly notices?: ReactNode;
} & Partial<WeekViewProps>) {
  const { zone } = useWorkTimeZone();
  const today = zonedDateOf(now, zone);
  const dates = useMemo(() => myDayWeekDates(today), [today]);
  const lastDate = dates[dates.length - 1]!;
  const month = shownMonth ?? today.slice(0, 7);
  // CPD routines are listed as far ahead as the page shows.
  const through = view === "month" && monthEnd(month) > lastDate ? monthEnd(month) : lastDate;
  const merged = useMemo(
    () => mergeMyDayItems([items, cmeRoutineItemsThrough(cmeRoutines, through, now, reminders)]),
    [items, cmeRoutines, through, now, reminders],
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
  const detailFor = (date: string): DayDetail[] =>
    entriesOn(date, shifts, sessions, merged, (item) => {
      // What is already late waits on today, as in the week.
      const due = duePerthDate(item.due);
      return due !== null && due < today ? today : due;
    }).map(dayDetail);

  return (
    <div className="grid min-w-0 gap-2.5">
      {onView ? (
        <MyDaySegmented
          options={[
            ["week", "Week"],
            ["month", "Month"],
          ]}
          value={view}
          onChange={onView}
          label="Show the week or the month"
          testId="my-day-week-view"
        />
      ) : null}
      {notices}
      {view === "month" ? (
        <MonthView
          today={today}
          kindsByDate={rosterKnown ? kindsByDate : null}
          dueByDate={dueByDate}
          detailFor={detailFor}
          onMonth={onMonth}
        />
      ) : (
        <>
          <ol role="list" className="grid grid-cols-7 gap-1 text-center" data-testid="my-day-week-strip">
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
            className={cn(quietCard, "grid min-w-0 px-3 [&>li+li]:border-t [&>li+li]:border-[color:var(--work-line)]")}
          >
            {dates.map((date) => {
              const entries = entriesByDay.get(date) ?? [];
              const isToday = date === today;
              const nowIndex = isToday
                ? entries.findIndex((entry) => entry.startsAt !== null && entry.startsAt > at)
                : -1;
              const ending = entries.length === 0 ? endsOn(date) : undefined;
              return (
                <li
                  key={date}
                  data-testid={`my-day-week-day-${date}`}
                  className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2 py-2"
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
              <span className="text-sm-minus font-bold text-[color:var(--work-ink)]">
                All your shifts are in Roster
              </span>
              <span className="text-2xs text-[color:var(--text-muted)]">Swaps, leave and your team</span>
            </span>
            <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[color:var(--text-muted)]" />
          </Link>
          <div className="px-1">
            <QuietFoot icon={Info}>
              From Roster, Teaching, CPD and Admin. Each item opens the page that owns it.
            </QuietFoot>
          </div>
        </>
      )}
    </div>
  );
}
