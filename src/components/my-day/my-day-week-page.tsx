"use client";

import { BookOpen, Briefcase, CalendarDays, ChevronRight, GraduationCap, Phone, type LucideIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo } from "react";

import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { focusRing } from "@/components/card-recipes";
import {
  modeDot,
  modeIdentityIcon,
  modeModuleSurface,
  modePressable,
  modeRowHeight,
} from "@/components/mode-kit/recipes";
import { modeSecondaryText } from "@/components/mode-kit/type";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { MyDayFrame } from "@/components/my-day/my-day-frame";
import { listNames } from "@/components/my-day/my-day-page-parts";
import { cmeRoutineItemsThrough } from "@/components/my-day/sources/cme";
import { useMyDayItems } from "@/components/my-day/use-my-day-items";
import { formatShiftRange, kindOf } from "@/components/roster/roster-format";
import { useRosterShifts, type MyShift } from "@/components/roster/use-roster-shifts";
import { perthDateKey, timeRange } from "@/components/teaching/teaching-dates";
import type { SessionSummaryRead } from "@/components/teaching/teaching-reads";
import { relocatedEntryId, sessionHref } from "@/components/teaching/teaching-view-model";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { useTeachingWeek } from "@/components/teaching/use-teaching-week";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui-primitives";
import { appModeDefinition } from "@/lib/app-modes";
import type { CmeRoutine } from "@/lib/cme/routines";
import type { MyDayItem, MyDaySourceMode } from "@/lib/my-day/model";
import { mergeMyDayItems } from "@/lib/my-day/merge";
import {
  groupByPerthDay,
  MY_DAY_WEEK_DAYS,
  myDayItemWeekDate,
  myDayWeekDates,
  myDayWeekDayLabel,
} from "@/lib/my-day/week";
import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from "@/lib/reminders/settings";
import { SHIFT_KIND_LABEL } from "@/lib/roster/shift-kind";
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
      />
    </div>
  );
}

type AgendaEntry = {
  readonly key: string;
  /** The mode identity that tints the icon and the strip dot. */
  readonly identity: MyDaySourceMode;
  readonly Icon: LucideIcon;
  readonly title: string;
  /** `HH:MM` or a range, or null when the thing has no time of day. */
  readonly time: string | null;
  readonly area: string;
  readonly detail: string | null;
  /** A state in words ("Date passed", "Cancelled"), shown in warn tone when `warn`. */
  readonly state: string | null;
  readonly warn: boolean;
  readonly href: string;
  readonly testId: string;
};

const MODE_ICON: Readonly<Record<MyDaySourceMode, LucideIcon>> = {
  roster: CalendarDays,
  teaching: GraduationCap,
  cme: BookOpen,
  "my-work": Briefcase,
  "on-call": Phone,
};

function shiftEntry(shift: MyShift): AgendaEntry {
  const kind = kindOf(shift);
  const identity: MyDaySourceMode = kind === "on_call" ? "on-call" : "roster";
  return {
    key: `shift:${shift.id}`,
    identity,
    Icon: MODE_ICON[identity],
    title: SHIFT_KIND_LABEL[kind],
    time: formatShiftRange(shift),
    area: "Roster",
    detail: shift.workplace ?? shift.location ?? null,
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
    Icon: MODE_ICON.teaching,
    title: session.title,
    time: session.allDay ? "All day" : timeRange(session.startsAt, session.endsAt),
    area: "Teaching",
    detail: session.venue ?? null,
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
  return {
    key: item.id,
    identity: item.mode,
    Icon: MODE_ICON[item.mode],
    title: item.title,
    time: item.due && !DATE_ONLY.test(item.due) ? perthTimeOf(item.due) : null,
    area: appModeDefinition(item.mode).label,
    detail: item.detail ?? null,
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
      const ta = a.entry.time && /^\d/.test(a.entry.time) ? a.entry.time : null;
      const tb = b.entry.time && /^\d/.test(b.entry.time) ? b.entry.time : null;
      if (ta && tb) return ta.localeCompare(tb) || a.index - b.index;
      if (ta) return -1;
      if (tb) return 1;
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

/** `Sat 3 Oct` as its three parts: weekday, date number, month. */
function dayParts(date: string): { weekday: string; number: string } {
  const [weekday = "", number = ""] = formatPerthDay(date).split(" ");
  return { weekday, number };
}

function AgendaRow({ entry }: { readonly entry: AgendaEntry }) {
  const { Icon } = entry;
  return (
    <li>
      <Link
        href={entry.href}
        data-testid={entry.testId}
        className={cn(
          modeRowHeight.double,
          modePressable,
          focusRing,
          "flex min-w-0 items-center gap-3 rounded-md py-1.5 pr-1 no-underline",
        )}
      >
        <span
          aria-hidden="true"
          data-mode-identity={entry.identity}
          className="grid size-10 shrink-0 place-items-center rounded-full border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)]"
        >
          <Icon aria-hidden="true" strokeWidth={1.5} className={modeIdentityIcon} />
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="break-words text-base-minus font-semibold leading-5 text-[color:var(--text-heading)]">
            {entry.title}
          </span>
          <span className={cn(modeSecondaryText, "break-words leading-5")}>
            {entry.time ? <span className="font-medium text-[color:var(--text-heading)]">{entry.time}</span> : null}
            {entry.time ? " · " : null}
            {entry.area}
            {entry.state ? (
              <>
                {" · "}
                <span className={entry.warn ? "font-medium text-[color:var(--warning)]" : undefined}>
                  {entry.state}
                </span>
              </>
            ) : null}
            {entry.detail ? ` · ${entry.detail}` : null}
          </span>
        </span>
        <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
      </Link>
    </li>
  );
}

/**
 * The seven days as one strip card (weekday, date, a dot per area on) and one
 * agenda card, then a quiet pointer to Roster. Drawn from whatever shifts,
 * sessions and items it is given: the reader's own, or the signed-out sample.
 */
export function MyDayWeekDays({
  now,
  shifts,
  sessions,
  items,
  cmeRoutines,
  reminders,
}: {
  readonly now: Date;
  readonly shifts: readonly MyShift[];
  readonly sessions: readonly SessionSummaryRead[];
  readonly items: readonly MyDayItem[];
  readonly cmeRoutines: readonly CmeRoutine[];
  readonly reminders: ReminderSettings;
}) {
  const today = perthDateOf(now);
  const dates = useMemo(() => myDayWeekDates(today), [today]);
  const lastDate = dates[dates.length - 1]!;
  const entriesByDay = useMemo(() => {
    const dayShifts = groupByPerthDay(shifts, dates, (shift) => perthDateOf(shift.startsAt));
    const daySessions = groupByPerthDay(
      [...sessions].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title)),
      dates,
      (session) => perthDateKey(session.startsAt),
    );
    const merged = mergeMyDayItems([items, cmeRoutineItemsThrough(cmeRoutines, lastDate, now, reminders)]);
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
  }, [shifts, sessions, items, cmeRoutines, dates, today, lastDate, now, reminders]);
  const rosterHref = "/roster";

  return (
    <>
      {/* The strip repeats what the agenda below says in words, so it is hidden from screen readers. */}
      <div
        className={cn(modeModuleSurface, "grid grid-cols-7 gap-1 p-2")}
        aria-hidden="true"
        data-testid="my-day-week-strip"
      >
        {dates.map((date) => {
          const { weekday, number } = dayParts(date);
          const isToday = date === today;
          const modes = [...new Set((entriesByDay.get(date) ?? []).map((entry) => entry.identity))].slice(0, 3);
          return (
            <div
              key={date}
              data-testid={`my-day-week-strip-${date}`}
              className={cn(
                "grid min-w-0 justify-items-center gap-0.5 rounded-lg py-2",
                isToday
                  ? "bg-[color:var(--primary)] text-[color:var(--primary-contrast)]"
                  : "text-[color:var(--text-heading)]",
              )}
            >
              <span className={cn("text-xs font-semibold uppercase", !isToday && "text-[color:var(--text-muted)]")}>
                {weekday.charAt(0)}
              </span>
              <span className="text-lg-minus font-semibold nums">{number}</span>
              <span className="flex h-1.5 items-center gap-0.5">
                {modes.map((mode) => (
                  <span
                    key={mode}
                    data-mode-identity={mode}
                    className={cn(
                      modeDot,
                      isToday ? "bg-[color:var(--primary-contrast)]" : "bg-[color:var(--mode-identity)]",
                    )}
                  />
                ))}
              </span>
            </div>
          );
        })}
      </div>

      <ul role="list" className={cn(modeModuleSurface, "divide-y divide-[color:var(--border)]")}>
        {dates.map((date) => {
          const entries = entriesByDay.get(date) ?? [];
          const { weekday, number } = dayParts(date);
          const isToday = date === today;
          return (
            <li
              key={date}
              data-testid={`my-day-week-day-${date}`}
              className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3 px-4 py-2"
            >
              <h2 className="sr-only">{myDayWeekDayLabel(date, today)}</h2>
              <div aria-hidden="true" className="grid content-start justify-items-start pt-1.5 leading-none">
                <span
                  className={cn(
                    "text-xs font-semibold uppercase tracking-wide",
                    isToday ? "text-[color:var(--primary)]" : "text-[color:var(--text-muted)]",
                  )}
                >
                  {weekday}
                </span>
                <span
                  className={cn(
                    "mt-1 text-xl font-semibold nums",
                    isToday ? "text-[color:var(--primary)]" : "text-[color:var(--text-heading)]",
                  )}
                >
                  {number}
                </span>
              </div>
              {entries.length > 0 ? (
                <ul role="list" className="grid min-w-0">
                  {entries.map((entry) => (
                    <AgendaRow key={entry.key} entry={entry} />
                  ))}
                </ul>
              ) : (
                <p
                  className="flex min-h-12 items-center text-base-minus font-medium text-[color:var(--text-muted)]"
                  data-testid={`my-day-week-empty-${date}`}
                >
                  Nothing on
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div
        className="flex min-h-12 items-center gap-3 px-3 text-sm text-[color:var(--text-muted)]"
        data-testid="my-day-week-footer"
      >
        <CalendarDays aria-hidden="true" className="size-icon-md shrink-0" />
        <p className="min-w-0 flex-1">
          All your shifts are in <strong className="font-semibold text-[color:var(--text-heading)]">Roster</strong>
        </p>
        <Link
          href={rosterHref}
          aria-label="Go to Roster"
          className={cn(
            focusRing,
            "inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-md px-2 text-sm font-semibold text-[color:var(--primary)] no-underline",
          )}
        >
          Go
        </Link>
      </div>
    </>
  );
}
