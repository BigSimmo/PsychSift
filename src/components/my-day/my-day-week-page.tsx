"use client";

import { CalendarDays, Info } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Fragment, useMemo } from "react";

import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { focusRing } from "@/components/card-recipes";
import { dashSurface } from "@/components/dashboard-kit/recipes";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { MyDayFrame } from "@/components/my-day/my-day-frame";
import { listNames } from "@/components/my-day/my-day-page-parts";
import { AreaIcon, DateBlock, QuietFoot, QuietTextLink } from "@/components/my-day/my-day-quiet";
import { StripDay } from "@/components/my-day/my-day-today-cards";
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
import { kindsByDate as kindsByDateOf } from "@/lib/my-day/figures";
import { mergeMyDayItems } from "@/lib/my-day/merge";
import { perthWeekday, shiftTitle, weekdayTime } from "@/lib/my-day/quiet-figures";
import {
  groupByPerthDay,
  MY_DAY_WEEK_DAYS,
  myDayItemWeekDate,
  myDayWeekDates,
  myDayWeekDayLabel,
} from "@/lib/my-day/week";
import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from "@/lib/reminders/settings";
import { addDaysToDate, formatPerthDay, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";

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
  return (
    <MyDayFrame
      title="Week"
      testId="my-day-week"
      now={now}
      signedOutSample={{
        notice:
          "Below is a sample week made of invented examples, so you can see how My Day's Week works. Signed in, it gathers your own roster shifts, teaching sessions and dated items. Nothing is shared.",
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
      subtitle={(at) => {
        const today = perthDateOf(at);
        return `${formatPerthDay(today)} to ${formatPerthDay(addDaysToDate(today, MY_DAY_WEEK_DAYS - 1))}`;
      }}
    >
      {(at) => <MyDayWeekBody now={at} />}
    </MyDayFrame>
  );
}

function MyDayWeekBody({ now }: { now: Date }) {
  const today = perthDateOf(now);
  const dates = useMemo(() => myDayWeekDates(today), [today]);
  const lastDate = dates[dates.length - 1]!;
  const range = useMemo(() => ({ from: today, to: lastDate }), [today, lastDate]);

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

  return (
    <div className="grid gap-5" data-testid="my-day-week-ready">
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

      <MyDayWeekDays
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
    href: "/roster/shifts",
    testId: `my-day-week-shift-${shift.id}`,
  };
}

function teachingEntry(session: SessionSummaryRead): AgendaEntry {
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
    <li>
      <Link
        href={entry.href}
        data-testid={entry.testId}
        data-done={done ? "" : undefined}
        className={cn(
          focusRing,
          "grid min-h-13 min-w-0 grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-2 rounded-md py-2 no-underline",
        )}
      >
        <span className={cn("text-sm nums", done ? "text-[color:var(--dash-faint)]" : "text-[color:var(--dash-ink)]")}>
          {entry.time}
        </span>
        <span className="grid min-w-0">
          <span
            className={cn(
              "flex min-w-0 items-baseline gap-1.5 text-base-minus",
              done ? "text-[color:var(--dash-muted)]" : "text-[color:var(--dash-ink)]",
            )}
          >
            <span
              aria-hidden="true"
              data-mode-identity={entry.identity}
              className="size-1.5 shrink-0 -translate-y-0.5 rounded-full bg-[color:var(--mode-identity)] forced-colors:bg-[CanvasText]"
            />
            <span className="min-w-0 break-words">{entry.title}</span>
          </span>
          <span className="break-words text-sm text-[color:var(--dash-muted)]">
            {entry.area}
            {entry.state ? (
              <>
                {" · "}
                <span className={entry.warn ? "font-medium text-[color:var(--dash-amber)]" : undefined}>
                  {entry.state}
                </span>
              </>
            ) : null}
            {entry.detail ? ` · ${entry.detail}` : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** The blue line across today at the present minute. */
function NowLine({ now }: { readonly now: Date }) {
  return (
    <li
      aria-hidden="true"
      data-testid="my-day-week-now"
      className="grid min-h-8 grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-x-2 text-xs text-[color:var(--dash-blue)] nums"
    >
      <span>{perthTimeOf(now)}</span>
      <span className="h-px bg-[color:var(--dash-blue)] forced-colors:bg-[CanvasText]" />
      <span>now</span>
    </li>
  );
}

/**
 * The seven days as a strip (the same codes as Today), then one list with a
 * date block per day and its timed rows, then a pointer to Roster. Drawn from
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
}: {
  readonly now: Date;
  readonly shifts: readonly MyShift[];
  readonly sessions: readonly SessionSummaryRead[];
  readonly items: readonly MyDayItem[];
  readonly cmeRoutines: readonly CmeRoutine[];
  readonly reminders: ReminderSettings;
  /** False when the roster did not load: the strip shows no false "off" and empty days say why. */
  readonly rosterKnown: boolean;
}) {
  const today = perthDateOf(now);
  const dates = useMemo(() => myDayWeekDates(today), [today]);
  const lastDate = dates[dates.length - 1]!;
  const merged = useMemo(
    () => mergeMyDayItems([items, cmeRoutineItemsThrough(cmeRoutines, lastDate, now, reminders)]),
    [items, cmeRoutines, lastDate, now, reminders],
  );
  const entriesByDay = useMemo(() => {
    const dayShifts = groupByPerthDay(shifts, dates, (shift) => perthDateOf(shift.startsAt));
    const daySessions = groupByPerthDay(
      [...sessions].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title)),
      dates,
      (session) => perthDateKey(session.startsAt),
    );
    const dayItems = groupByPerthDay(merged, dates, (item) => myDayItemWeekDate(item, today, lastDate));
    return new Map(
      dates.map((date) => [
        date,
        byTimeOfDay([
          ...(dayShifts.get(date) ?? []).map(shiftEntry),
          ...(daySessions.get(date) ?? []).map(teachingEntry),
          ...(dayItems.get(date) ?? []).map(itemEntry),
        ]),
      ]),
    );
  }, [shifts, sessions, merged, dates, today, lastDate]);
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
        perthDateOf(new Date(Date.parse(shift.endsAt) - 1).toISOString()) === date,
    );
  const at = now.getTime();

  return (
    <div className={cn(dashSurface, "my-day-quiet grid gap-4")}>
      <ol role="list" className="grid grid-cols-7 gap-0.5 text-center" data-testid="my-day-week-strip">
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

      <ul role="list" className="grid min-w-0 [&>li+li]:border-t [&>li+li]:border-[color:var(--dash-line)]">
        {dates.map((date) => {
          const entries = entriesByDay.get(date) ?? [];
          const isToday = date === today;
          const nowIndex = isToday ? entries.findIndex((entry) => entry.startsAt !== null && entry.startsAt > at) : -1;
          const ending = entries.length === 0 ? endsOn(date) : undefined;
          return (
            <li
              key={date}
              data-testid={`my-day-week-day-${date}`}
              className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3 py-2.5"
            >
              <h2 className="sr-only">{myDayWeekDayLabel(date, today)}</h2>
              <span className="pt-2">
                <DateBlock number={Number(date.slice(8, 10))} word={perthWeekday(date)} today={isToday} />
              </span>
              {entries.length > 0 ? (
                <ul role="list" className="grid min-w-0 [&>li+li]:border-t [&>li+li]:border-[color:var(--dash-line)]">
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
                  className="flex min-h-12 items-center text-sm text-[color:var(--dash-muted)]"
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

      <div className="grid gap-3 border-t border-[color:var(--dash-line)] pt-2">
        <div className="flex min-h-12 min-w-0 items-center gap-3" data-testid="my-day-week-footer">
          <AreaIcon icon={CalendarDays} />
          <p className="min-w-0 flex-1 text-base-minus text-[color:var(--dash-ink)]">All your shifts are in Roster</p>
          <QuietTextLink href="/roster" ariaLabel="Open Roster">
            Open Roster
          </QuietTextLink>
        </div>
        <QuietFoot icon={Info}>From Roster, Teaching, CPD and Admin. Each item opens the page that owns it.</QuietFoot>
      </div>
    </div>
  );
}
