"use client";

import { CalendarPlus, ChevronLeft, ChevronRight, Download, Repeat } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import { Checkbox } from "@/components/ui/choice";
import { Sheet } from "@/components/ui/sheet";
import { ExternalTextLink, TextLink } from "@/components/ui/link";
import { cardSurface } from "@/components/card-recipes";
import { cn, eyebrowText, floatingControl, textMuted, toolbarButton } from "@/components/ui-primitives";
import {
  calendarEventKindLabels,
  calendarRecurrenceLabels,
  dateKeyToUtcMillis,
  expandEvents,
  formatEventTime,
  type CalendarEvent,
  type CalendarEventKind,
} from "@/lib/calendar/calendar-event";
import { icsFileName, toIcs } from "@/lib/calendar/ics";
import { monthGrid, monthGridRange, monthKeyOf, shiftMonth, WEEKDAY_SHORT_LABELS } from "@/lib/calendar/month-grid";
import { googleCalendarUrl, outlookCalendarUrl } from "@/lib/calendar/provider-links";
import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { applyReminderAlarms, type ReminderSettings } from "@/lib/reminders/settings";
import { guardExampleAction, isExampleRecord, withoutExampleRecords } from "@/lib/example-data/guards";
import { useExampleData } from "@/lib/example-data/store";
import type { WorkAreaId } from "@/lib/work-frame/areas";

/**
 * A phone-first month calendar with the day's list underneath.
 *
 * The grid is for finding a day; the list under it is where the meaning is.
 * Each mark names a kind of event (by colour in the default "dot" style, by a
 * grey shape in the "shape" style CPD uses), and every event in the list says
 * its kind in words too, so nothing depends on telling marks apart.
 *
 * Swipe the grid sideways, or use the arrows, to change month. Every event can
 * be added to the owner's own calendar: as a file (nothing leaves the device),
 * or through Google's or Outlook's own "add event" page, which only opens when
 * the owner taps it.
 */

const KIND_DOT: Record<CalendarEventKind, string> = {
  logged: "bg-[color:var(--tone-indigo)]",
  due: "bg-[color:var(--tone-purple)]",
  deadline: "bg-[color:var(--tone-rose)]",
  teaching: "bg-[color:var(--clinical-accent)]",
  expiry: "bg-[color:var(--tone-rose)]",
  other: "bg-[color:var(--tone-slate)]",
};

/**
 * How events are marked in the grid, the legend and the day's list.
 *
 * "dot" (the default, and On Call's look) is a small dot whose colour names the
 * kind. "shape" is CPD's, from mode design standard module 7: grey marks told
 * apart by shape instead of colour (a dot for Logged, a ring for Due, a
 * diamond for Deadline), with the kind in words in the legend and the list.
 */
export type CalendarMarkStyle = "dot" | "shape";

type CalendarMarkShape = "dot" | "ring" | "diamond";

const KIND_SHAPE: Record<CalendarEventKind, CalendarMarkShape> = {
  logged: "dot",
  due: "ring",
  deadline: "diamond",
  teaching: "dot",
  expiry: "diamond",
  other: "dot",
};

/** 8 px shapes in `currentColor`. The diamond is a 6 px square turned 45°, about 8 px corner to corner. */
const SHAPE_CLASS: Record<CalendarMarkShape, string> = {
  dot: "size-2 rounded-full bg-current forced-colors:bg-[CanvasText]",
  ring: "size-2 rounded-full border-2 border-current forced-colors:border-[CanvasText]",
  diamond: "size-1.5 rotate-45 bg-current forced-colors:bg-[CanvasText]",
};

/** The grey every shape is drawn in: 6.2:1 on a light card, 7.5:1 on a dark one. */
const SHAPE_INK = "text-[color:var(--text-muted)]";

function ShapeMark({ kind, className }: { kind: CalendarEventKind; className?: string }) {
  const shape = KIND_SHAPE[kind];
  return (
    <span aria-hidden="true" data-mark={shape} className={cn("inline-block shrink-0", SHAPE_CLASS[shape], className)} />
  );
}

const WEEKDAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function weekdayLong(date: string): string {
  const millis = dateKeyToUtcMillis(date) ?? 0;
  return WEEKDAY_LONG[(new Date(millis).getUTCDay() + 6) % 7];
}

function dayLabel(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${weekdayLong(date)} ${day} ${MONTHS_LONG[month - 1]}`;
}

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return `${MONTHS_LONG[month - 1]} ${year}`;
}

/**
 * The file carries a calendar alarm on an event only when the owner turned
 * that reminder's "Phone calendar alert" on in Settings; with the defaults it
 * is exactly the file it always was.
 */
function downloadIcs(events: readonly CalendarEvent[], name: string, reminders: ReminderSettings) {
  const now = new Date();
  const withAlarms = applyReminderAlarms(events, reminders, now);
  const blob = new Blob([toIcs(withAlarms, { name, now })], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = icsFileName(name);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * What an expiry becomes in a downloaded file when the owner keeps its name
 * private. A calendar a file lands in is often shared with family or a PA, and
 * "Police check expires" or a health-screening title says more than a date.
 */
const PLAIN_EXPIRY_TITLE = "Expiry date";

/** The events that go in the downloaded file, after the owner's choices. */
function selectDownloadEvents(
  events: readonly CalendarEvent[],
  excludedKinds: ReadonlySet<CalendarEventKind>,
  plainExpiryTitles: boolean,
): CalendarEvent[] {
  return events
    .filter((event) => !excludedKinds.has(event.kind))
    .map((event) =>
      plainExpiryTitles && event.kind === "expiry"
        ? {
            id: event.id,
            date: event.date,
            kind: event.kind,
            title: PLAIN_EXPIRY_TITLE,
            ...(event.startTime ? { startTime: event.startTime } : {}),
            ...(event.recurrence ? { recurrence: event.recurrence } : {}),
          }
        : event,
    );
}

/** Kinds present in the events, in a fixed order, for the legend. */
function legendKinds(events: readonly CalendarEvent[]): CalendarEventKind[] {
  const order: CalendarEventKind[] = ["logged", "due", "deadline", "teaching", "expiry", "other"];
  const present = new Set(events.map((event) => event.kind));
  return order.filter((kind) => present.has(kind));
}

export type CalendarViewProps = {
  readonly events: readonly CalendarEvent[];
  /** Perth calendar date for today. */
  readonly today: string;
  /** Names the downloaded file and the calendar it creates, e.g. "CME 2026". */
  readonly exportName: string;
  /** Series to export with "Add all". Defaults to every event given. */
  readonly exportEvents?: readonly CalendarEvent[];
  readonly testId?: string;
  /** "dot" (default, unchanged) or "shape" (grey dot, ring and diamond). See `CalendarMarkStyle`. */
  readonly markStyle?: CalendarMarkStyle;
  /** Reports the displayed month after arrows, swipes, or an adjacent-day selection. */
  readonly onMonthChange?: (month: string) => void;
  /** Optional wording for the upcoming events list; the month follows this prefix. */
  readonly laterHeadingPrefix?: string;
  /** The work area whose records these are, so a calendar file is refused while it shows example data. */
  readonly exampleArea?: WorkAreaId;
};

export function CalendarView({
  events,
  today,
  exportName,
  exportEvents,
  testId = "calendar-view",
  markStyle = "dot",
  onMonthChange,
  laterHeadingPrefix = "Later in",
  exampleArea,
}: CalendarViewProps) {
  // Example records never leave the app: a calendar file is refused (with the
  // "can't be exported" sheet) while the area shows examples or any event is one.
  const areaExample = useExampleData(exampleArea).active;
  const { preferences } = useAppPreferences();
  const reminders = preferences.reminders;
  const [month, setMonth] = useState(() => monthKeyOf(today));
  useEffect(() => {
    onMonthChange?.(month);
  }, [month, onMonthChange]);
  const [selected, setSelected] = useState(today);
  const [sheetEvent, setSheetEvent] = useState<CalendarEvent | null>(null);
  // When the day turns over on an open page, a reader still looking at "today"
  // follows it to the new day; one who picked another day keeps their place.
  const [shownToday, setShownToday] = useState(today);
  if (shownToday !== today) {
    setShownToday(today);
    if (selected === shownToday) {
      setSelected(today);
      setMonth(monthKeyOf(today));
    }
  }
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const weeks = useMemo(() => monthGrid(month), [month]);
  const visible = useMemo(() => expandEvents(events, monthGridRange(month)), [events, month]);
  const byDay = useMemo(() => {
    const map = new Map<string, (typeof visible)[number][]>();
    for (const event of visible) map.set(event.date, [...(map.get(event.date) ?? []), event]);
    return map;
  }, [visible]);
  const selectedEvents = byDay.get(selected) ?? [];
  const laterThisMonth = visible.filter((event) => event.date > selected && monthKeyOf(event.date) === month);
  const kinds = legendKinds(events);
  const downloadSource = exportEvents ?? events;
  const downloadKinds = legendKinds(downloadSource);
  const [excludedKinds, setExcludedKinds] = useState<ReadonlySet<CalendarEventKind>>(() => new Set());
  const [plainExpiryTitles, setPlainExpiryTitles] = useState(true);
  const downloadEvents = selectDownloadEvents(downloadSource, excludedKinds, plainExpiryTitles);
  const includesExpiry = downloadKinds.includes("expiry") && !excludedKinds.has("expiry");

  function toggleKind(kind: CalendarEventKind, include: boolean) {
    setExcludedKinds((current) => {
      const next = new Set(current);
      if (include) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  function goToMonth(next: string) {
    setMonth(next);
    // Keep the selection inside the month being shown: today if it is there, else the 1st.
    setSelected(monthKeyOf(today) === next ? today : `${next}-01`);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    swipeStart.current = { x: event.clientX, y: event.clientY };
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    // A deliberate sideways swipe only; a vertical scroll never changes month.
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    goToMonth(shiftMonth(month, dx < 0 ? 1 : -1));
  }

  return (
    <section data-testid={testId} aria-label="Calendar" className="flex flex-col gap-4">
      <div className={cn(cardSurface, "p-3 sm:p-4")}>
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className={toolbarButton}
            onClick={() => goToMonth(shiftMonth(month, -1))}
            aria-label="Previous month"
          >
            <ChevronLeft aria-hidden="true" className="size-icon-sm" />
          </button>
          <div className="flex min-w-0 flex-col items-center">
            <h2 className="text-base font-semibold text-[color:var(--text)]">{monthLabel(month)}</h2>
            <p aria-live="polite" className="sr-only">
              {monthLabel(month)}
            </p>
            {monthKeyOf(today) !== month ? (
              <button
                type="button"
                onClick={() => goToMonth(monthKeyOf(today))}
                className="min-h-tap text-xs font-semibold text-[color:var(--clinical-accent)]"
              >
                Back to today
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className={toolbarButton}
            onClick={() => goToMonth(shiftMonth(month, 1))}
            aria-label="Next month"
          >
            <ChevronRight aria-hidden="true" className="size-icon-sm" />
          </button>
        </div>

        <div
          className="mt-3 touch-pan-y select-none"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (swipeStart.current = null)}
          data-testid={`${testId}-grid`}
        >
          <div className="grid grid-cols-7 text-center" aria-hidden="true">
            {WEEKDAY_SHORT_LABELS.map((label) => (
              <span key={label} className={cn(eyebrowText, "pb-1")}>
                {label.slice(0, 1)}
              </span>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week[0].date} className="grid grid-cols-7">
              {week.map((day) => {
                const dayEvents = byDay.get(day.date) ?? [];
                const isToday = day.date === today;
                const isSelected = day.date === selected;
                return (
                  <button
                    key={day.date}
                    type="button"
                    data-date={day.date}
                    aria-pressed={isSelected}
                    aria-label={`${dayLabel(day.date)}${isToday ? ", today" : ""}${
                      dayEvents.length ? `, ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}` : ""
                    }${
                      markStyle === "shape" && dayEvents.length
                        ? `: ${legendKinds(dayEvents)
                            .map((kind) => calendarEventKindLabels[kind])
                            .join(", ")}`
                        : ""
                    }`}
                    onClick={() => {
                      if (!day.inMonth) setMonth(monthKeyOf(day.date));
                      setSelected(day.date);
                    }}
                    className={cn(
                      "flex min-h-12 flex-col items-center justify-start gap-1 rounded-lg pt-1.5 text-sm transition motion-reduce:transition-none",
                      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
                      day.inMonth ? "text-[color:var(--text)]" : "text-[color:var(--text-muted)]",
                      isSelected
                        ? "bg-[color:var(--clinical-accent-soft)] font-semibold text-[color:var(--clinical-accent)] opacity-100 ring-2 ring-inset ring-[color:var(--clinical-accent)]"
                        : "hover:bg-[color:var(--surface-subtle)]",
                    )}
                  >
                    <span
                      className={cn(
                        "nums grid size-7 place-items-center rounded-full font-medium",
                        isToday && !isSelected && "ring-2 ring-[color:var(--clinical-accent)]",
                      )}
                    >
                      {Number(day.date.slice(8))}
                    </span>
                    {markStyle === "shape" ? (
                      <span className={cn("flex h-2 items-center gap-1", SHAPE_INK)} aria-hidden="true">
                        {legendKinds(dayEvents)
                          .slice(0, 3)
                          .map((kind) => (
                            <ShapeMark key={kind} kind={kind} />
                          ))}
                      </span>
                    ) : (
                      <span className="flex h-1.5 items-center gap-0.5" aria-hidden="true">
                        {dayEvents.slice(0, 3).map((event) => (
                          <span
                            key={event.occurrenceKey}
                            className={cn("size-1.5 rounded-full forced-colors:bg-[CanvasText]", KIND_DOT[event.kind])}
                          />
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {kinds.length > 0 && markStyle === "shape" ? (
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1" aria-label="What the marks mean">
            {kinds.map((kind) => (
              <li key={kind} className={cn(textMuted, "flex items-center gap-1.5 text-sm")}>
                <ShapeMark kind={kind} />
                {calendarEventKindLabels[kind]}
              </li>
            ))}
          </ul>
        ) : kinds.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1" aria-label="What the dots mean">
            {kinds.map((kind) => (
              <li key={kind} className={cn(textMuted, "flex items-center gap-1.5 text-xs")}>
                <span aria-hidden="true" className={cn("size-2 rounded-full", KIND_DOT[kind])} />
                {calendarEventKindLabels[kind]}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div data-testid={`${testId}-day`}>
        <h3 className="text-sm font-semibold text-[color:var(--text)]">
          {dayLabel(selected)}
          {selected === today ? " · Today" : ""}
        </h3>
        {selectedEvents.length ? (
          <ul className="mt-2 flex flex-col gap-2">
            {selectedEvents.map((event) => (
              <CalendarEventRow
                key={event.occurrenceKey}
                event={event}
                markStyle={markStyle}
                onAdd={(target) => {
                  returnFocus.current = target;
                  setSheetEvent(event);
                }}
              />
            ))}
          </ul>
        ) : (
          <p className={cn(textMuted, "mt-1 text-sm")}>Nothing on this day.</p>
        )}
      </div>

      {laterThisMonth.length ? (
        <div data-testid={`${testId}-later`}>
          <h3 className={eyebrowText}>
            {laterHeadingPrefix} {monthLabel(month).split(" ")[0]}
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {laterThisMonth.slice(0, 8).map((event) => (
              <CalendarEventRow
                key={event.occurrenceKey}
                event={event}
                showDate
                markStyle={markStyle}
                onAdd={(target) => {
                  returnFocus.current = target;
                  setSheetEvent(event);
                }}
              />
            ))}
          </ul>
        </div>
      ) : null}

      <div className={cn(cardSurface, "flex flex-col gap-2 p-4")}>
        <p className="text-sm font-semibold text-[color:var(--text)]">Put these in your own calendar</p>
        <p className={cn(textMuted, "text-sm")}>
          Downloads one calendar file with the dates you choose, repeats included. Open it on your phone or computer to
          add them to Apple, Google or Outlook. The file is made on this device and nothing is sent anywhere.
        </p>
        <p className={cn(textMuted, "text-sm")} data-testid={`${testId}-export-snapshot`}>
          It is a one-off copy of today&apos;s dates. If a date changes here later, the copy in your calendar does not
          change with it. Download a new file to catch up.
        </p>
        {downloadKinds.length > 1 ? (
          <fieldset className="flex flex-col" data-testid={`${testId}-export-kinds`}>
            <legend className="text-sm font-semibold text-[color:var(--text)]">What goes in the file</legend>
            {downloadKinds.map((kind) => (
              <Checkbox
                key={kind}
                label={calendarEventKindLabels[kind]}
                checked={!excludedKinds.has(kind)}
                onChange={(change) => toggleKind(kind, change.currentTarget.checked)}
                data-testid={`${testId}-export-kind-${kind}`}
              />
            ))}
          </fieldset>
        ) : null}
        {includesExpiry ? (
          <Checkbox
            label="Keep what each expiry is for private"
            description={`The file says "${PLAIN_EXPIRY_TITLE}" instead of the item's name. Your calendar may be shared with others.`}
            checked={plainExpiryTitles}
            onChange={(change) => setPlainExpiryTitles(change.currentTarget.checked)}
            data-testid={`${testId}-export-plain-expiry`}
          />
        ) : null}
        <button
          type="button"
          data-testid={`${testId}-export`}
          className={cn(floatingControl, "self-start")}
          disabled={downloadEvents.length === 0}
          onClick={() => {
            if (!guardExampleAction(areaExample || downloadEvents.some((event) => isExampleRecord(event)), "export"))
              return;
            downloadIcs(withoutExampleRecords(downloadEvents), exportName, reminders);
          }}
        >
          <Download aria-hidden="true" className="size-icon-sm" />
          Download calendar file
        </button>
      </div>

      <Sheet
        open={sheetEvent !== null}
        onClose={() => setSheetEvent(null)}
        title="Add to your calendar"
        description={sheetEvent ? sheetEvent.title : undefined}
        mobilePlacement="bottom"
        returnFocusRef={returnFocus}
        testId={`${testId}-add-sheet`}
      >
        {sheetEvent ? <AddToCalendarOptions event={sheetEvent} reminders={reminders} example={areaExample} /> : null}
      </Sheet>
    </section>
  );
}

function CalendarEventRow({
  event,
  showDate = false,
  markStyle,
  onAdd,
}: {
  event: CalendarEvent;
  showDate?: boolean;
  markStyle: CalendarMarkStyle;
  onAdd: (target: HTMLElement) => void;
}) {
  return (
    <li className={cn(cardSurface, "flex items-start gap-3 p-3")} data-kind={event.kind}>
      {markStyle === "shape" ? (
        <ShapeMark kind={event.kind} className={cn("mt-1.5", SHAPE_INK)} />
      ) : (
        <span aria-hidden="true" className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", KIND_DOT[event.kind])} />
      )}
      <div className="min-w-0 flex-1">
        <p className={cn(eyebrowText)}>
          {calendarEventKindLabels[event.kind]}
          {showDate ? ` · ${dayLabel(event.date)}` : ""}
          {event.startTime ? ` · ${formatEventTime(event.startTime)}` : ""}
        </p>
        {event.href ? (
          <TextLink href={event.href} tone="inherit" className="text-sm font-semibold text-[color:var(--text)]">
            {event.title}
          </TextLink>
        ) : (
          <p className="text-sm font-semibold text-[color:var(--text)]">{event.title}</p>
        )}
        {event.recurrence || event.location ? (
          <p className={cn(textMuted, "mt-0.5 flex flex-wrap items-center gap-x-2 text-xs")}>
            {event.recurrence ? (
              <span className="inline-flex items-center gap-1">
                <Repeat aria-hidden="true" className="size-icon-xs" />
                {calendarRecurrenceLabels[event.recurrence]}
              </span>
            ) : null}
            {event.location ? <span>{event.location}</span> : null}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className={toolbarButton}
        aria-label={`Add ${event.title} to your calendar`}
        onClick={(click) => onAdd(click.currentTarget)}
      >
        <CalendarPlus aria-hidden="true" className="size-icon-sm" />
      </button>
    </li>
  );
}

function AddToCalendarOptions({
  event,
  reminders,
  example,
}: {
  event: CalendarEvent;
  reminders: ReminderSettings;
  example: boolean;
}) {
  const blocked = example || isExampleRecord(event);
  return (
    <div className="flex flex-col gap-3 pb-2">
      <button
        type="button"
        className={cn(floatingControl, "justify-start")}
        onClick={() => {
          if (!guardExampleAction(blocked, "export")) return;
          downloadIcs([event], event.title, reminders);
        }}
        data-testid="calendar-add-file"
      >
        <Download aria-hidden="true" className="size-icon-sm" />
        Calendar file (Apple, any calendar)
      </button>
      <ExternalTextLink
        href={googleCalendarUrl(event)}
        tone="inherit"
        className={cn(floatingControl, "justify-start no-underline")}
        onClick={(click) => {
          if (!guardExampleAction(blocked, "export")) click.preventDefault();
        }}
        data-testid="calendar-add-google"
      >
        Google Calendar
      </ExternalTextLink>
      <ExternalTextLink
        href={outlookCalendarUrl(event)}
        tone="inherit"
        className={cn(floatingControl, "justify-start no-underline")}
        onClick={(click) => {
          if (!guardExampleAction(blocked, "export")) click.preventDefault();
        }}
        data-testid="calendar-add-outlook"
      >
        Outlook
      </ExternalTextLink>
      <p className={cn(textMuted, "text-xs")}>
        Google and Outlook open their own page with this event filled in, which sends its title and time to them. The
        calendar file stays on this device.
        {event.recurrence ? " Outlook adds the first date only. Set the repeat there, or use the calendar file." : ""}
      </p>
    </div>
  );
}
