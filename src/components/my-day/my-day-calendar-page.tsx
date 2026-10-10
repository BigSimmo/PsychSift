"use client";

import { CalendarPlus, ChevronLeft, ChevronRight, Download, Info } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useId, useMemo, useRef, useState } from "react";

import { useJuniorRosterLeave } from "@/components/admin/junior/use-roster-leave";
import { useRemindMe } from "@/components/alerts/use-remind-me";
import { AddToCalendarOptions, downloadIcs } from "@/components/calendar/add-to-calendar-options";
import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { focusRing } from "@/components/card-recipes";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { MyDayFrame } from "@/components/my-day/my-day-frame";
import { listNames } from "@/components/my-day/my-day-page-parts";
import { QuietFoot, QuietLabel, quietCard } from "@/components/my-day/my-day-quiet";
import { MyDaySegmented } from "@/components/my-day/my-day-today-cards";
import { cmeRoutineItemsThrough } from "@/components/my-day/sources/cme";
import { adminCalendarRenewalItems } from "@/components/my-day/sources/entries";
import { useMyDayItems } from "@/components/my-day/use-my-day-items";
import { useFeatureNotificationSources } from "@/components/needs-you/use-feature-notification-sources";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { kindOf } from "@/components/roster/roster-format";
import { useRosterShifts, type MyShift } from "@/components/roster/use-roster-shifts";
import type { SessionSummaryRead } from "@/components/teaching/teaching-reads";
import { relocatedEntryId, sessionHref } from "@/components/teaching/teaching-view-model";
import { useTeachingWeek } from "@/components/teaching/use-teaching-week";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import { useWorkCalendarEntries } from "@/components/work-calendar/use-work-calendar-entries";
import { useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { appModeDefinition } from "@/lib/app-modes";
import { CALENDAR_TIME_ZONE } from "@/lib/calendar/calendar-event";
import { guardExampleAction, isExampleRecord } from "@/lib/example-data/guards";
import { addMonths, monthTitle, monthWeeks } from "@/lib/my-day/figures";
import { mergeMyDayItems } from "@/lib/my-day/merge";
import { shiftTitle } from "@/lib/my-day/quiet-figures";
import { addDaysToDate } from "@/lib/roster/shifts/perth-time";
import { useAuthSession } from "@/lib/supabase/client";
import { useAdminPaperwork } from "@/lib/work-screens/admin/paperwork-store";
import {
  adminRequestItems,
  visibleCalendarItems,
  alertCalendarItems,
  bandsOverlapping,
  calendarExportEvents,
  calendarItemEvent,
  dayList,
  filterByArea,
  itemsOnDate,
  leaveItems,
  MAIN_CALENDAR_AREAS,
  mergeCalendarItems,
  myDayCalendarItems,
  reminderCalendarItems,
  workEntryItems,
  type MainCalendarArea,
  type MainCalendarItem,
} from "@/lib/work-calendar/main-calendar";
import { formatZonedDay, formatZonedLongDay, zonedDateOf, zonedTimeOf } from "@/lib/work-time/format";

/**
 * My Day, Calendar: the one full-size calendar (owner request 10 Oct 2026).
 * Every dated thing in Work mode in one month: shifts, on call and leave from
 * Roster, rotations and the date preferences close, booked courses, teaching
 * sessions, CPD deadlines and routines, renewals and expiry dates, swaps to
 * answer, Admin requests to chase, the bell's dated alerts (first week,
 * contract, job applications, CPD Home, term folder) and the reader's own
 * Remind me notes. Read-only and stored nowhere: each source is the hook its
 * own page already reads, and every row opens the page that owns it.
 *
 * Anything that may leave the app can be added to Google, Outlook or Apple:
 * one item from its row, the month as a file, or every future change through
 * the private calendar link. Remind me notes and Admin requests are kept on
 * this device by their own features, so they are never exported.
 *
 * Assessments are not here: their records are kept in CLA, and the
 * Assessments pages only show an example of how CLA works.
 */

type CalendarView = "month" | "list";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
/** How many items a day's cell lists before "+ more". */
const CELL_ITEMS = 3;

/** The last day of a month ("2026-10" to "2026-10-31"). */
function monthEnd(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
  return `${month}-${String(days).padStart(2, "0")}`;
}

const areaLabel = (area: MainCalendarArea) => (area === "my-day" ? "Reminders" : appModeDefinition(area).label);

/** The private calendar link's card, loaded only when the page draws it. */
const CalendarSubscribe = dynamic(
  () => import("@/components/calendar/calendar-subscribe").then((module) => module.CalendarSubscribe),
  { ssr: false },
);

function minutesBetween(startsAt: string, endsAt: string): number | undefined {
  const minutes = Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : undefined;
}

function shiftItem(shift: MyShift, zone: string): MainCalendarItem {
  const kind = kindOf(shift);
  const start = zonedDateOf(shift.startsAt, zone);
  const place = shift.workplace ?? shift.location ?? null;
  if (kind === "leave") {
    // A leave shift ending at midnight belongs to the day before.
    const last = zonedDateOf(Math.max(Date.parse(shift.startsAt), Date.parse(shift.endsAt) - 1), zone);
    return {
      key: `shift:${shift.id}`,
      area: "roster",
      label: "Leave",
      title: shift.title || shiftTitle(kind),
      start,
      end: last < start ? start : last,
      time: null,
      detail: place,
      state: null,
      warn: false,
      href: "/roster/shifts",
      band: false,
    };
  }
  const minutes = minutesBetween(shift.startsAt, shift.endsAt);
  const endDay = zonedDateOf(shift.endsAt, zone);
  const until = `until ${endDay === start ? "" : `${formatZonedDay(endDay).split(" ")[0]} `}${zonedTimeOf(shift.endsAt, zone)}`;
  return {
    key: `shift:${shift.id}`,
    area: "roster",
    label: "Shift",
    title: shiftTitle(kind),
    start,
    end: start,
    time: zonedTimeOf(shift.startsAt, zone),
    detail: [until, place].filter(Boolean).join(" · "),
    state: null,
    warn: false,
    href: "/roster/shifts",
    band: false,
    startsAt: shift.startsAt,
    ...(minutes ? { minutes } : {}),
    reminder: "shifts",
  };
}

function sessionItem(session: SessionSummaryRead, zone: string): MainCalendarItem {
  const cancelled = session.status === "cancelled";
  const date = zonedDateOf(session.startsAt, zone);
  return {
    key: `teaching:${session.occurrenceId}`,
    area: "teaching",
    label: "Teaching",
    title: session.title,
    start: date,
    end: date,
    time: session.allDay ? null : zonedTimeOf(session.startsAt, zone),
    detail: [session.venue, session.isPresenter ? "you lead" : null].filter(Boolean).join(" · ") || null,
    state: cancelled ? "Cancelled" : null,
    warn: cancelled,
    // Teaching Week opens on this week unless told otherwise, so a relocated session names its own.
    href:
      sessionHref(session) ??
      `/teaching/week?week=${zonedDateOf(session.startsAt, CALENDAR_TIME_ZONE)}#${onCallEntryAnchorId(relocatedEntryId(session.occurrenceId))}`,
    band: false,
    ...(session.allDay
      ? {}
      : { startsAt: session.startsAt, minutes: minutesBetween(session.startsAt, session.endsAt) }),
    ...(session.venue ? { location: session.venue } : {}),
    reminder: "teaching",
  };
}

export function MyDayCalendarPage({ now }: { now?: Date } = {}) {
  const { zone } = useWorkTimeZone();
  // A new account starts a fresh calendar body, so nothing read for the last one stays on screen.
  const accountKey = useAuthSession().session?.user?.id ?? "none";
  const [shownMonth, setShownMonth] = useState<string | null>(null);
  return (
    <MyDayFrame
      title="Calendar"
      testId="my-day-calendar"
      now={now}
      wide
      signedOut={{
        title: "Sign in to see your calendar",
        body: "Your shifts, leave, rotations, courses, teaching, CPD and Admin dates show here together once you sign in.",
      }}
      subtitle={(at) => monthTitle(shownMonth ?? zonedDateOf(at, zone).slice(0, 7))}
    >
      {(at) => <CalendarBody key={accountKey} now={at} shownMonth={shownMonth} onMonth={setShownMonth} />}
    </MyDayFrame>
  );
}

function CalendarBody({
  now,
  shownMonth,
  onMonth,
}: {
  readonly now: Date;
  readonly shownMonth: string | null;
  readonly onMonth: (month: string) => void;
}) {
  const { zone } = useWorkTimeZone();
  const today = zonedDateOf(now, zone);
  const month = shownMonth ?? today.slice(0, 7);
  const from = `${month}-01`;
  const to = monthEnd(month);
  // Roster's team read and Teaching read Perth dates: a day either side keeps a month edge covered in another zone.
  const range = useMemo(() => ({ from: addDaysToDate(from, -1), to: addDaysToDate(to, 1) }), [from, to]);
  const [view, setView] = useState<CalendarView>("month");
  const [chosen, setSelected] = useState(today);
  // The chosen day stays in the shown month, even when the clock passes midnight into the next one.
  const selected = chosen.startsWith(month) ? chosen : today.startsWith(month) ? today : `${month}-01`;
  const [hidden, setHidden] = useState<ReadonlySet<MainCalendarArea>>(() => new Set());
  const [adding, setAdding] = useState<MainCalendarItem | null>(null);
  const addReturn = useRef<HTMLElement | null>(null);

  const items = useMyDayItems({ enabled: true, now });
  const shifts = useRosterShifts(range, { ownHistory: true });
  const teaching = useTeachingWeek(range, { demoMode: false }, now);
  const reminders = useAppPreferences().preferences.reminders;
  const calendar = useWorkCalendarEntries();
  const [leaveReload, setLeaveReload] = useState(0);
  const leave = useJuniorRosterLeave(true, leaveReload);
  const paperwork = useAdminPaperwork(null);
  const { reminders: notes } = useRemindMe();
  // The bell's own feature reads (first week, contract, applications, CPD Home, term folder), started once.
  const [readAt] = useState(() => new Date());
  const features = useFeatureNotificationSources({ enabled: true, clock: now, readAt, zone });
  const routeVisible = useWorkModeRouteVisible();
  const alerts = useMemo(
    () =>
      features
        .filter((source) => source.status === "ready" && !source.sample)
        .flatMap((source) => source.items)
        .filter((item) => routeVisible(item.href)),
    [features, routeVisible],
  );

  const example = items.demoMode || shifts.demoMode;
  // Example shifts belong to a sample doctor, never to the reader: left out unless this is a demo.
  const showShifts = shifts.status === "ready" && (!shifts.sample || shifts.demoMode);
  const sampleOmitted = shifts.status === "ready" && shifts.sample && !shifts.demoMode;
  const sessions = useMemo(
    () => (teaching.week ? [...teaching.week.sessions, ...teaching.week.relocated] : []),
    [teaching.week],
  );

  const all = useMemo(
    () =>
      visibleCalendarItems(
        mergeCalendarItems([
          // Example rotations and courses belong to a made-up doctor: only a demo shows them.
          workEntryItems(
            example
              ? calendar.entries
              : calendar.entries.filter((entry) => !entry.isExample && !isExampleRecord(entry.id)),
          ),
          showShifts ? shifts.shifts.map((shift) => shiftItem(shift, zone)) : [],
          leaveItems(leave.status === "ready" ? leave.leave : []),
          sessions.map((session) => sessionItem(session, zone)),
          myDayCalendarItems(
            mergeMyDayItems([items.items, cmeRoutineItemsThrough(items.cmeRoutines, to, now, reminders)]),
            areaLabel,
            zone,
          ),
          // Every recorded Admin date, past My Day's capped list, so any month shows its renewals.
          myDayCalendarItems(adminCalendarRenewalItems(items.adminEntries ?? [], now), areaLabel, zone),
          adminRequestItems(paperwork.state?.requests ?? []),
          alertCalendarItems(alerts, areaLabel, zone),
          reminderCalendarItems(notes, now, zone),
        ]),
        routeVisible,
      ),
    [
      calendar.entries,
      showShifts,
      shifts.shifts,
      leave,
      sessions,
      items.items,
      items.cmeRoutines,
      items.adminEntries,
      example,
      to,
      now,
      reminders,
      paperwork.state,
      alerts,
      notes,
      zone,
      routeVisible,
    ],
  );
  const present = MAIN_CALENDAR_AREAS.filter((area) => all.some((item) => item.area === area));
  const shown = useMemo(() => filterByArea(all, hidden), [all, hidden]);

  const loading =
    items.status === "loading" ||
    shifts.status === "loading" ||
    shifts.teamLoading ||
    shifts.historyLoading ||
    teaching.status === "loading" ||
    teaching.status === "idle" ||
    calendar.status === "loading" ||
    leave.status === "loading" ||
    features.some((source) => source.status === "loading");
  // The skeleton is for the first read only. A month change keeps the header and its
  // buttons in place (so focus and the month announcement survive) and says it is updating.
  const [settled, setSettled] = useState(false);
  if (!loading && !settled) setSettled(true);
  if (loading && !settled) {
    return (
      <>
        <span role="status" className="sr-only">
          Loading your calendar
        </span>
        <div className="grid gap-5" data-testid="my-day-calendar-loading" aria-hidden="true">
          <ModeModuleSkeleton rows={3} twoLine eyebrow />
          <ModeModuleSkeleton rows={2} twoLine eyebrow />
        </div>
      </>
    );
  }

  const failed: string[] = items.sources
    .filter((source) => source.status === "failed")
    .map((source) => appModeDefinition(source.mode).label);
  for (const [id, source] of Object.entries(calendar.sources)) {
    if (source.status === "error") failed.push(id === "rotations" ? "Rotations" : "Course bookings");
  }
  if (shifts.status === "error" || shifts.status === "signed-out") failed.push("Roster shifts");
  if (shifts.teamMessage) failed.push("Team shifts");
  if (shifts.historyFailed) failed.push("Older Roster shifts");
  if (leave.status === "failed") failed.push("Leave");
  if (teaching.status === "offline" || teaching.status === "error" || teaching.status === "signed-out") {
    failed.push("Teaching sessions");
  }
  if (teaching.week?.relocatedUnavailable) failed.push("On Call teaching entries");
  const retry = () => {
    items.retry();
    void shifts.reload();
    teaching.retry();
    setLeaveReload((count) => count + 1);
    calendar.retry();
  };

  const addingEvent = adding ? calendarItemEvent(adding) : null;
  const openAdd = (item: MainCalendarItem, from: HTMLElement) => {
    addReturn.current = from;
    setAdding(item);
  };

  const changeMonth = (next: string) => {
    onMonth(next);
    // The chosen day follows the month: today in this month, else the 1st.
    setSelected(next === today.slice(0, 7) ? today : `${next}-01`);
  };
  const toggleArea = (area: MainCalendarArea) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return next;
    });

  return (
    <div className="grid min-w-0 gap-2.5" data-testid="my-day-calendar-ready" aria-busy={loading}>
      <MyDaySegmented
        options={[
          ["month", "Month"],
          ["list", "List"],
        ]}
        value={view}
        onChange={setView}
        label="Show the month or a list"
        testId="my-day-calendar-view"
      />
      {failed.length > 0 ? (
        <div className="grid gap-2" data-testid="my-day-calendar-failed-notice">
          <ModeNotice tone="warning">{`Couldn't load: ${listNames(failed)}. Showing the rest.`}</ModeNotice>
          <div>
            <Button variant="secondary" onClick={retry}>
              Retry
            </Button>
          </div>
        </div>
      ) : null}
      {sampleOmitted ? (
        <ModeNotice testId="my-day-calendar-sample-notice">
          Roster is showing example shifts only, so your shifts aren&apos;t shown here.
        </ModeNotice>
      ) : null}
      {teaching.status === "setup" ? (
        <ModeNotice>Teaching isn&apos;t available yet, so its sessions aren&apos;t shown.</ModeNotice>
      ) : null}

      {present.length > 1 ? (
        <div
          role="group"
          aria-label="Show areas"
          className="flex flex-wrap gap-1.5"
          data-testid="my-day-calendar-filter"
        >
          {present.map((area) => {
            const on = !hidden.has(area);
            return (
              <button
                key={area}
                type="button"
                aria-pressed={on}
                onClick={() => toggleArea(area)}
                data-mode-identity={area}
                className={cn(
                  focusRing,
                  "inline-flex min-h-12 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold forced-colors:border",
                  on
                    ? "border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] text-[color:var(--work-ink)]"
                    : "border-[color:var(--work-line)] bg-[color:var(--work-surface)] text-[color:var(--text-muted)]",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-2 rounded-full forced-colors:bg-[CanvasText]",
                    on ? "bg-[color:var(--mode-identity)]" : "bg-[color:var(--neutral-400)]",
                  )}
                />
                {areaLabel(area)}
              </button>
            );
          })}
        </div>
      ) : null}

      <MonthHeader
        month={month}
        today={today}
        onMonth={changeMonth}
        summary={loading ? "Updating…" : monthSummary(shown, from, to)}
      />
      <Bands items={bandsOverlapping(shown, from, to)} today={today} />

      {view === "month" ? (
        // Wide screens: the month beside the chosen day. Phones: the day under the month.
        <div className="grid min-w-0 gap-2.5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-4">
          <MonthGrid month={month} today={today} selected={selected} items={shown} onSelect={setSelected} />
          <div className="lg:sticky lg:top-4">
            <DayPanel date={selected} today={today} items={dayList(shown, selected)} onAdd={openAdd} />
          </div>
        </div>
      ) : (
        <MonthList month={month} today={today} items={shown} onAdd={openAdd} />
      )}

      <CalendarExport
        month={month}
        // The whole month, whatever areas are hidden on screen.
        items={all.filter((item) => item.start <= to && item.end >= from)}
        updating={loading}
        onDownload={(events) => {
          if (loading || !guardExampleAction(example, "export")) return;
          downloadIcs(events, `PsychSift ${monthTitle(month)}`, reminders);
        }}
      />

      <div className="px-1">
        <QuietFoot icon={Info}>
          From Roster, Teaching, CPD, Admin, On Call and your reminders. Each item opens the page that owns it.
          Assessments stay in CLA.
        </QuietFoot>
      </div>

      <Sheet
        open={addingEvent !== null}
        onClose={() => setAdding(null)}
        title="Add to your calendar"
        description={adding?.title}
        mobilePlacement="bottom"
        returnFocusRef={addReturn}
        testId="my-day-calendar-add-sheet"
      >
        {addingEvent ? <AddToCalendarOptions event={addingEvent} reminders={reminders} example={example} /> : null}
      </Sheet>
    </div>
  );
}

/** Late or due: amber and counted. A cancelled session is amber too, but asks nothing of the reader. */
function needsYou(item: MainCalendarItem): boolean {
  return item.warn && item.state !== "Cancelled";
}

/** "14 things · 2 need you", for the month header. */
function monthSummary(items: readonly MainCalendarItem[], from: string, to: string): string {
  const inMonth = items.filter((item) => item.start <= to && item.end >= from);
  if (!inMonth.length) return "Nothing recorded";
  const late = inMonth.filter(needsYou).length;
  return `${inMonth.length} ${inMonth.length === 1 ? "thing" : "things"}${late ? ` · ${late} need${late === 1 ? "s" : ""} you` : ""}`;
}

function MonthHeader({
  month,
  today,
  onMonth,
  summary,
}: {
  readonly month: string;
  readonly today: string;
  readonly onMonth: (month: string) => void;
  readonly summary: string;
}) {
  const current = today.slice(0, 7);
  const navButton = cn(
    focusRing,
    "relative grid size-9 place-items-center rounded-full bg-[color:var(--work-wash)] text-[color:var(--text-muted)] before:absolute before:-inset-1.5 before:content-['']",
  );
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 px-1">
      <div className="grid min-w-0">
        <h2 className="m-0 min-w-0 text-lg font-bold text-[color:var(--work-ink)]">{monthTitle(month)}</h2>
        <p
          className="m-0 text-xs font-semibold text-[color:var(--text-muted)] nums"
          data-testid="my-day-calendar-summary"
        >
          {summary}
        </p>
      </div>
      {/* The month change is announced from a hidden line, not the visible heading. */}
      <p className="sr-only" aria-live="polite">
        {monthTitle(month)}
      </p>
      <span className="flex shrink-0 items-center gap-3">
        {month !== current ? (
          <button
            type="button"
            onClick={() => onMonth(current)}
            className={cn(
              focusRing,
              "min-h-12 rounded-full px-3 text-xs font-semibold text-[color:var(--mode-identity)]",
            )}
            data-testid="my-day-calendar-today"
          >
            Today
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onMonth(addMonths(month, -1))}
          aria-label="Previous month"
          className={navButton}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => onMonth(addMonths(month, 1))}
          aria-label="Next month"
          className={navButton}
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>
      </span>
    </div>
  );
}

/** Long stretches over the month (a rotation term), one tinted bar each in its area's colour. */
function Bands({ items, today }: { readonly items: readonly MainCalendarItem[]; readonly today: string }) {
  if (!items.length) return null;
  return (
    <ul className="m-0 grid list-none gap-1.5 p-0" aria-label="Over this month" data-testid="my-day-calendar-bands">
      {items.map((item) => (
        <li key={item.key}>
          <Link
            href={item.href}
            data-mode-identity={item.area}
            aria-label={`${item.label}: ${item.title}, ${formatZonedDay(item.start, today)} to ${formatZonedDay(item.end, today)}`}
            className={cn(
              focusRing,
              "flex min-h-12 min-w-0 items-center gap-2 rounded-lg border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] px-3 py-2 no-underline",
            )}
          >
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[color:var(--mode-identity)]" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[color:var(--work-ink)]">
              {item.title}
            </span>
            <span className="nums shrink-0 text-2xs font-semibold text-[color:var(--text-muted)]">
              {`${formatZonedDay(item.start, today).replace(/^\S+ /, "")} to ${formatZonedDay(item.end, today).replace(/^\S+ /, "")}`}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function MonthGrid({
  month,
  today,
  selected,
  items,
  onSelect,
}: {
  readonly month: string;
  readonly today: string;
  readonly selected: string;
  readonly items: readonly MainCalendarItem[];
  readonly onSelect: (date: string) => void;
}) {
  const titleId = useId();
  const weeks = monthWeeks(month);
  return (
    <div className={cn(quietCard, "px-1.5 py-2 sm:px-2.5")} data-testid="my-day-calendar-grid">
      <table className="w-full table-fixed border-collapse" aria-labelledby={titleId}>
        <caption id={titleId} className="sr-only">
          {monthTitle(month)}
        </caption>
        <thead>
          <tr>
            {DAY_NAMES.map((name) => (
              <th
                key={name}
                scope="col"
                className="pb-1 text-3xs font-bold tracking-wider text-[color:var(--text-muted)]"
              >
                <span aria-hidden="true">{name.slice(0, 3).toUpperCase()}</span>
                <span className="sr-only">{name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, row) => (
            <tr key={row}>
              {week.map((date, column) =>
                date ? (
                  <td key={date} className="border-t border-[color:var(--work-line)] p-0 align-top">
                    <DayCell
                      date={date}
                      today={today}
                      selected={date === selected}
                      weekend={column > 4}
                      items={itemsOnDate(items, date)}
                      onSelect={() => onSelect(date)}
                    />
                  </td>
                ) : (
                  <td key={`pad-${row}-${column}`} className="border-t border-[color:var(--work-line)]" />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayCell({
  date,
  today,
  selected,
  weekend,
  items,
  onSelect,
}: {
  readonly date: string;
  readonly today: string;
  readonly selected: boolean;
  readonly weekend: boolean;
  readonly items: readonly MainCalendarItem[];
  readonly onSelect: () => void;
}) {
  const isToday = date === today;
  const listed = items.slice(0, CELL_ITEMS);
  const more = items.length - listed.length;
  const late = items.some(needsYou);
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-current={isToday ? "date" : undefined}
      aria-label={`${formatZonedLongDay(date, today)}: ${items.length ? `${items.length} ${items.length === 1 ? "item" : "items"}${late ? ", one needs you" : ""}` : "nothing on"}`}
      onClick={onSelect}
      data-testid={`my-day-calendar-day-${date}`}
      className={cn(
        focusRing,
        "grid min-h-14 w-full content-start justify-items-center gap-1 rounded-lg px-0.5 pt-1 pb-1.5 sm:min-h-24 sm:justify-items-stretch lg:min-h-28",
        selected &&
          "bg-[color:var(--work-wash)] forced-colors:outline forced-colors:outline-2 forced-colors:outline-[Highlight]",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-6.5 place-items-center rounded-full text-xs nums forced-colors:border sm:justify-self-start",
          isToday
            ? "bg-[color:var(--mode-identity)] font-bold text-[color:var(--mode-identity-contrast)]"
            : selected
              ? "font-bold text-[color:var(--mode-identity)]"
              : weekend
                ? "font-semibold text-[color:var(--text-muted)]"
                : "font-semibold text-[color:var(--work-ink)]",
        )}
      >
        {Number(date.slice(8, 10))}
      </span>
      {/* Phone: a coloured bar per item. Wider: the item's time and title in its area's colour. */}
      <span aria-hidden="true" className="flex flex-wrap justify-center gap-0.5 sm:hidden">
        {listed.map((item) => (
          <span
            key={item.key}
            data-mode-identity={item.area}
            className={cn(
              "h-1 w-2.5 rounded-full forced-colors:bg-[CanvasText]",
              item.warn ? "bg-[color:var(--warning-text)]" : "bg-[color:var(--mode-identity)]",
            )}
          />
        ))}
      </span>
      <span aria-hidden="true" className="hidden min-w-0 gap-0.5 text-left sm:grid">
        {listed.map((item) => (
          <span
            key={item.key}
            data-mode-identity={item.area}
            className={cn(
              "block min-w-0 truncate rounded px-1 py-px text-3xs font-semibold leading-snug lg:text-2xs",
              item.warn
                ? "bg-[color:var(--warning-bg)] text-[color:var(--warning-text)]"
                : "bg-[color:var(--mode-identity-soft)] text-[color:var(--work-ink)]",
            )}
          >
            {item.time ? <span className="nums text-[color:var(--text-muted)]">{`${item.time} `}</span> : null}
            {item.title}
          </span>
        ))}
      </span>
      {more > 0 ? (
        <span aria-hidden="true" className="text-3xs font-semibold text-[color:var(--text-muted)] nums sm:text-left">
          {`+${more}`}
        </span>
      ) : null}
    </button>
  );
}

type AddHandler = (item: MainCalendarItem, from: HTMLElement) => void;

function ItemRow({
  item,
  testId,
  onAdd,
}: {
  readonly item: MainCalendarItem;
  readonly testId?: string;
  readonly onAdd: AddHandler;
}) {
  const exportable = calendarItemEvent(item) !== null;
  return (
    <li className="flex min-w-0 items-center gap-1">
      <Link
        href={item.href}
        data-testid={testId}
        className={cn(
          focusRing,
          "grid min-h-12 min-w-0 flex-1 grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-x-2 rounded-md py-2 no-underline",
        )}
      >
        <span className="text-xs font-bold text-[color:var(--work-ink)] nums">{item.time ?? "All day"}</span>
        <span className="grid min-w-0">
          <span className="min-w-0 text-sm leading-snug font-bold break-words text-[color:var(--work-ink)]">
            {item.title}
          </span>
          <span className="flex min-w-0 items-baseline gap-1.5 text-2xs leading-snug text-[color:var(--text-muted)]">
            <span
              aria-hidden="true"
              data-mode-identity={item.area}
              className="size-1.5 shrink-0 -translate-y-px rounded-full bg-[color:var(--mode-identity)] forced-colors:bg-[CanvasText]"
            />
            <span className="min-w-0 break-words">
              {item.label}
              {item.state ? (
                <>
                  {" · "}
                  <span className={item.warn ? "font-semibold text-[color:var(--warning-text)]" : undefined}>
                    {item.state}
                  </span>
                </>
              ) : null}
              {item.detail ? ` · ${item.detail}` : null}
              {item.start !== item.end ? ` · ${formatZonedDay(item.start)} to ${formatZonedDay(item.end)}` : null}
            </span>
          </span>
        </span>
      </Link>
      {exportable ? (
        <button
          type="button"
          onClick={(click) => onAdd(item, click.currentTarget)}
          aria-label={`Add ${item.title} to your calendar`}
          className={cn(
            focusRing,
            "grid size-12 shrink-0 place-items-center rounded-full text-[color:var(--text-muted)] hover:bg-[color:var(--work-wash)] hover:text-[color:var(--work-ink)]",
          )}
        >
          <CalendarPlus aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </li>
  );
}

function DayPanel({
  date,
  today,
  items,
  onAdd,
}: {
  readonly date: string;
  readonly today: string;
  readonly items: readonly MainCalendarItem[];
  readonly onAdd: AddHandler;
}) {
  return (
    <section className="grid gap-1.5" aria-label={formatZonedLongDay(date, today)} data-testid="my-day-calendar-day">
      <div className="px-1">
        <QuietLabel
          as="h3"
          title={date === today ? `Today, ${formatZonedLongDay(date, today)}` : formatZonedLongDay(date, today)}
        />
      </div>
      {items.length ? (
        <ul
          role="list"
          className={cn(
            quietCard,
            "m-0 grid list-none py-0 pr-1 pl-3 [&>li+li]:border-t [&>li+li]:border-[color:var(--work-line)]",
          )}
        >
          {items.map((item) => (
            <ItemRow key={item.key} item={item} testId={`my-day-calendar-item-${item.key}`} onAdd={onAdd} />
          ))}
        </ul>
      ) : (
        <p
          className="m-0 px-1 text-xs font-semibold text-[color:var(--text-muted)]"
          data-testid="my-day-calendar-nothing"
        >
          Nothing recorded for this day.
        </p>
      )}
    </section>
  );
}

/** The month as a list: each day that has something, from today in this month or the 1st in another. */
function MonthList({
  month,
  today,
  items,
  onAdd,
}: {
  readonly month: string;
  readonly today: string;
  readonly items: readonly MainCalendarItem[];
  readonly onAdd: AddHandler;
}) {
  const first = today.startsWith(month) ? today : `${month}-01`;
  const days = monthWeeks(month)
    .flat()
    .filter((date): date is string => date !== null && date >= first)
    .map((date) => [date, itemsOnDate(items, date)] as const)
    .filter(([, list]) => list.length > 0);
  if (!days.length) {
    return (
      <p
        className={cn(quietCard, "m-0 px-3 py-4 text-sm text-[color:var(--text-muted)]")}
        data-testid="my-day-calendar-list-empty"
      >
        {today.startsWith(month) ? "Nothing else recorded for the rest of this month." : "Nothing recorded this month."}
      </p>
    );
  }
  return (
    <ul role="list" className="m-0 grid list-none gap-2.5 p-0" data-testid="my-day-calendar-list">
      {days.map(([date, list]) => (
        <li key={date} className="grid gap-1.5">
          <div className="px-1">
            <QuietLabel
              as="h3"
              title={date === today ? `Today, ${formatZonedLongDay(date, today)}` : formatZonedLongDay(date, today)}
            />
          </div>
          <ul
            role="list"
            className={cn(
              quietCard,
              "m-0 grid list-none py-0 pr-1 pl-3 [&>li+li]:border-t [&>li+li]:border-[color:var(--work-line)]",
            )}
          >
            {list.map((item) => (
              <ItemRow key={item.key} item={item} testId={`my-day-calendar-list-item-${item.key}`} onAdd={onAdd} />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/**
 * Getting the calendar into Outlook, Google or Apple: the shown month as a
 * file (it stays on this device until the reader opens it), and the private
 * link that keeps their calendar app up to date by itself.
 */
function CalendarExport({
  month,
  items,
  updating,
  onDownload,
}: {
  readonly month: string;
  readonly items: readonly MainCalendarItem[];
  /** True while the shown month is still loading, so a download can't miss part of it. */
  readonly updating: boolean;
  readonly onDownload: (events: ReturnType<typeof calendarExportEvents>) => void;
}) {
  const events = calendarExportEvents(items);
  const kept = items.length - events.length;
  return (
    <section
      className="grid gap-1.5"
      aria-labelledby="my-day-calendar-export-title"
      data-testid="my-day-calendar-export"
    >
      <div className="px-1">
        <QuietLabel as="h2" id="my-day-calendar-export-title" title="Add to Outlook, Google or Apple" />
      </div>
      <div className={cn(quietCard, "grid gap-3 px-3 py-3")}>
        <p className="m-0 text-sm text-[color:var(--text-muted)]">
          Tap the calendar button beside any item to add just that one, or save the whole month as a calendar file that
          Outlook, Google and Apple Calendar all open.
          {kept > 0 ? " Your reminders and Admin requests stay in the app." : ""}
        </p>
        <div>
          <Button
            variant="secondary"
            icon={Download}
            disabled={updating || !events.length}
            onClick={() => onDownload(events)}
            testId="my-day-calendar-download"
          >
            {`Download ${monthTitle(month)}`}
          </Button>
        </div>
      </div>
      <CalendarSubscribe testId="my-day-calendar-subscribe" />
    </section>
  );
}
