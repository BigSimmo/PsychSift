"use client";

import { CalendarRange } from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo } from "react";

import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { MyDayFrame } from "@/components/my-day/my-day-frame";
import { listNames, MyDayItemRow } from "@/components/my-day/my-day-page-parts";
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
import { appModeDefinition } from "@/lib/app-modes";
import type { CmeRoutine } from "@/lib/cme/routines";
import type { MyDayItem } from "@/lib/my-day/model";
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
import { addDaysToDate, formatPerthDay, perthDateOf } from "@/lib/roster/shifts/perth-time";

/** The signed-out sample, downloaded only when a signed-out visitor opens this page. */
const MyDayWeekSample = dynamic(
  () => import("@/components/my-day/my-day-sample-subpages").then((module) => module.MyDaySubpageSampleView),
  { ssr: false },
);

/**
 * My Day, Week: the next seven Perth days, one list per day, gathering the
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

function shiftRow(shift: MyShift) {
  const subtitle = ["Roster", formatShiftRange(shift), shift.workplace ?? shift.location].filter(Boolean).join(" · ");
  return (
    <ModeRow
      key={`shift:${shift.id}`}
      title={SHIFT_KIND_LABEL[kindOf(shift)]}
      subtitle={subtitle}
      href="/roster/shifts"
      testId={`my-day-week-shift-${shift.id}`}
    />
  );
}

function teachingRow(session: SessionSummaryRead) {
  const subtitle = [
    "Teaching",
    session.status === "cancelled" ? "Cancelled" : null,
    session.allDay ? "All day" : timeRange(session.startsAt, session.endsAt),
    session.venue,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <ModeRow
      key={`teaching:${session.occurrenceId}`}
      title={session.title}
      subtitle={subtitle}
      href={sessionHref(session) ?? `/on-call/education#${onCallEntryAnchorId(relocatedEntryId(session.occurrenceId))}`}
      testId={`my-day-week-session-${session.occurrenceId}`}
    />
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

/**
 * The seven day lists and the read-only footer, drawn from whatever shifts,
 * sessions and items they are given: the reader's own, or the signed-out sample.
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
  const byDay = useMemo(() => {
    const dayShifts = groupByPerthDay(shifts, dates, (shift) => perthDateOf(shift.startsAt));
    const daySessions = groupByPerthDay(
      [...sessions].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title)),
      dates,
      (session) => perthDateKey(session.startsAt),
    );
    const merged = mergeMyDayItems([items, cmeRoutineItemsThrough(cmeRoutines, lastDate, now, reminders)]);
    const dayItems = groupByPerthDay(merged, dates, (item) => myDayItemWeekDate(item, today, lastDate));
    return { dayShifts, daySessions, dayItems };
  }, [shifts, sessions, items, cmeRoutines, dates, today, lastDate, now, reminders]);

  return (
    <>
      {dates.map((date) => {
        const rows = [
          ...(byDay.dayShifts.get(date) ?? []).map(shiftRow),
          ...(byDay.daySessions.get(date) ?? []).map(teachingRow),
          ...(byDay.dayItems.get(date) ?? []).map((item) => <MyDayItemRow key={item.id} item={item} now={now} />),
        ];
        return (
          <ModeGroupedList
            key={date}
            eyebrow={myDayWeekDayLabel(date, today)}
            headerIcon={date === today ? CalendarRange : undefined}
            mode="my-day"
            testId={`my-day-week-day-${date}`}
          >
            {rows.length > 0 ? rows : <ModeRow title="Nothing on" testId={`my-day-week-empty-${date}`} />}
          </ModeGroupedList>
        );
      })}

      <p className="px-3 text-sm text-[color:var(--text-muted)]" data-testid="my-day-week-footer">
        Read-only. Open an item to act on it in its own mode.
      </p>
    </>
  );
}
