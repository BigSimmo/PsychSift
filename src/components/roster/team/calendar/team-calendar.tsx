"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ModeActionButton } from "@/components/mode-kit/action-button";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { RosterSentBar, type SentReceipt } from "@/components/roster/requests/roster-sent-bar";
import type { SharedManageReload } from "@/components/roster/manage/roster-approve-tab";
import { SwapFlowSheet } from "@/components/roster/swaps/swap-flow-sheet";
import { postRosterAction, useRosterRead } from "@/components/roster/use-roster-team";
import { Button } from "@/components/ui/button";
import { WorkStateLoading } from "@/components/mode-kit/work-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { monthKeyOf } from "@/lib/calendar/month-grid";
import { SHIFT_KIND_LABEL, SHIFT_KINDS, SHIFT_LETTER } from "@/lib/roster/shift-kind";
import { addDaysToDate, formatPerthDay, perthDateOf } from "@/lib/roster/shifts/perth-time";
import { formatZonedDay } from "@/lib/work-time/format";
import {
  calendarStateQuery,
  calendarWindow,
  filterAssignments,
  monthCells,
  readCalendarState,
  stepCalendar,
  weekBoard,
  type BoardRow,
  type CalendarShow,
  type CalendarState,
  type CalendarView,
} from "@/lib/roster/team/calendar-model";
import type { RosterAssignment, RosterSwap, RosterTeam } from "@/lib/roster/team/model";
import { assignmentStartDate } from "@/lib/roster/team/team-view";

import { CalendarFilterButton, type CalendarPerson } from "./calendar-filters";
import { DaySheet } from "./day-sheet";
import { DayView } from "./day-view";
import { MonthView } from "./month-view";
import { NeedsYouStrip } from "./needs-you-strip";
import { PrintButton } from "./print-button";
import { ShiftSheet } from "./shift-sheet";
import { useManagerCalendar } from "./use-manager-calendar";
import { WeekBoard } from "./week-board";

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
];
const UNIT: Record<CalendarView, string> = { month: "month", week: "week", day: "day" };

function heading(state: CalendarState): string {
  if (state.view === "day") return formatPerthDay(state.date);
  if (state.view === "week") return `Week of ${formatPerthDay(calendarWindow(state).from)}`;
  return new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${state.date}T00:00:00Z`),
  );
}

const PRINT_LEGEND = SHIFT_KINDS.map((kind) => `${SHIFT_LETTER[kind]} ${SHIFT_KIND_LABEL[kind]}`).join(" · ");

/** "Fri 9 Oct 2026": paper outlives the year, so the printed date always carries it. */
function printedOn(today: string): string {
  return `${formatZonedDay(today)} ${today.slice(0, 4)}`;
}

function peopleIn(rows: readonly RosterAssignment[]): CalendarPerson[] {
  const seen = new Map<string, CalendarPerson>();
  for (const row of rows) {
    if (row.userId && !seen.has(row.userId))
      seen.set(row.userId, { userId: row.userId, name: row.name ?? "Name not available" });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Assignment ids in the reader's own swaps that are still waiting on an answer. */
function pendingAssignmentIds(swaps: readonly RosterSwap[], actorId: string | null, now: Date): Set<string> {
  const ids = new Set<string>();
  if (!actorId) return ids;
  for (const swap of swaps) {
    if (swap.status !== "requested" && swap.status !== "accepted") continue;
    // A request nobody answered in time is expired, not waiting.
    if (swap.status === "requested" && Date.parse(swap.expiresAt) < now.getTime()) continue;
    if (swap.requesterId !== actorId && swap.counterpartyId !== actorId) continue;
    for (const side of [swap.give, swap.take]) if (side) ids.add(side.id);
  }
  return ids;
}

/** In Compare, both people get a row even when one has no shifts that week. */
function withComparedPeople(
  board: BoardRow[],
  show: CalendarShow,
  actorId: string | null,
  people: readonly CalendarPerson[],
): BoardRow[] {
  if (show.kind !== "compare") return board;
  const missing = (userId: string | null, isMe: boolean): BoardRow[] =>
    userId === null || board.some((row) => row.userId === userId)
      ? []
      : [
          {
            userId,
            name: people.find((person) => person.userId === userId)?.name ?? "Name not available",
            grade: null,
            isMe,
            days: Array.from({ length: 7 }, () => []),
          },
        ];
  // Comparing with myself is one row, not two.
  const merged = [...board, ...missing(actorId, true), ...(show.userId === actorId ? [] : missing(show.userId, false))];
  return merged.sort((a, b) => Number(b.isMe) - Number(a.isMe));
}

type RequestSheet = { kind: "swap" | "give_away"; shift: RosterAssignment } | null;

/**
 * The team calendar. View, date and filter live in the URL and are written
 * with `router.replace`, so stepping around never piles up history and
 * nothing about the roster is kept on the device.
 */
export function TeamCalendar({
  team,
  actorId,
  now,
  shared,
  onManagerLayer,
  phoneLink = true,
}: {
  /** The "Phone numbers are in On call" row. The Team page has its own in its last list, so it leaves this out. */
  phoneLink?: boolean;
  team: RosterTeam;
  actorId: string | null;
  now: Date;
  /** On the Manage page: the manage reload shared with the Approve tab. */
  shared?: SharedManageReload;
  /**
   * On the Manage page: told whether the manager layer (and so the Needs you
   * strip) is showing, so the Approve tab lists decisions only when the strip
   * cannot.
   */
  onManagerLayer?: (shown: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const today = perthDateOf(now);
  const state = readCalendarState(params, today);
  const overview = useRosterRead(team.serviceId, "overview");
  const requests = useRosterRead(team.serviceId, "requests");
  const read = useRosterRead(team.serviceId, "assignments", calendarWindow(state));
  const reload = read.reload;
  const [selected, setSelected] = useState<RosterAssignment | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [request, setRequest] = useState<RequestSheet>(null);
  const [sent, setSent] = useState<SentReceipt | null>(null);
  const clearSent = useCallback(() => setSent(null), []);
  const marked = useRef<string | null>(null);
  const publication = overview.data?.latestPublication;
  useEffect(() => {
    if (!publication || overview.data?.seenLatest || marked.current === publication.id) return;
    marked.current = publication.id;
    void postRosterAction(team.serviceId, { action: "seen.mark", publicationId: publication.id });
  }, [publication, overview.data?.seenLatest, team.serviceId]);

  function go(next: CalendarState) {
    router.replace(`${pathname}?${calendarStateQuery(next)}`, { scroll: false });
  }

  const all = read.data?.assignments ?? [];
  const rows = filterAssignments(all, state.show, actorId, now);
  const unit = UNIT[state.view];
  const monday = calendarWindow({ ...state, view: "week" }).from;
  const weekDays = Array.from({ length: 7 }, (_, index) => addDaysToDate(monday, index));
  const pendingSwapIds = pendingAssignmentIds(requests.data?.swaps ?? [], actorId, now);
  // Cover counts and rule flags read every shift in the window, not the filtered ones.
  const manager = useManagerCalendar(team, calendarWindow(state), all, actorId);
  // Counts are for planning ahead: a day that has passed shows none, short or not.
  const cover = new Map([...manager.cover].filter(([date]) => date >= today));
  const managerShown = manager.enabled;
  useEffect(() => {
    onManagerLayer?.(managerShown);
  }, [onManagerLayer, managerShown]);
  const managerReload = manager.reload;
  const requestsReload = requests.reload;
  const sharedChanged = shared?.onChanged;
  const managerChanged = useCallback(() => {
    managerReload();
    requestsReload();
    reload();
    sharedChanged?.("calendar");
  }, [managerReload, requestsReload, reload, sharedChanged]);
  const round = shared?.round ?? 0;
  const changedBy = shared?.changedBy;
  const seenRound = useRef(round);
  useEffect(() => {
    if (round === seenRound.current) return;
    seenRound.current = round;
    if (changedBy === "calendar") return;
    managerReload();
    requestsReload();
    reload();
  }, [round, changedBy, managerReload, requestsReload, reload]);
  // A sent swap or give-away changes requests and manage as well as the roster,
  // so the pending outline and the new open shift show straight away.
  const onSent = useCallback(
    (message: string, undo?: () => Promise<void>) => {
      setSent({
        message,
        undo: undo
          ? async () => {
              await undo();
              managerChanged();
            }
          : undefined,
      });
      managerChanged();
    },
    [managerChanged],
  );
  return (
    <>
      {state.view === "month" ? (
        <div data-roster-print-header className="hidden gap-1 text-sm print:grid">
          <p className="font-medium">{team.name}</p>
          <p>{`Printed ${printedOn(today)}`}</p>
          <p>{PRINT_LEGEND}</p>
        </div>
      ) : null}
      <SegmentedControl
        label="View"
        layout="equal"
        value={state.view}
        onChange={(view) => go({ ...state, view })}
        options={VIEWS}
      />
      <div className="flex items-center justify-between gap-1">
        <ModeActionButton icon={ChevronLeft} label={`Previous ${unit}`} onClick={() => go(stepCalendar(state, -1))} />
        {/* Tapping the title opens the date picker: the date input lies over it, unseen. */}
        <div className="relative flex min-h-12 min-w-0 items-center gap-1 rounded px-1 has-[input:focus-visible]:outline has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-[color:var(--focus)]">
          {/* The page title is the page's one h1; the date is the calendar's heading. */}
          <h2 className="truncate text-base-minus font-semibold text-[color:var(--text-heading)]">{heading(state)}</h2>
          <CalendarDays
            aria-hidden="true"
            className="size-icon-sm shrink-0 text-[color:var(--text-muted)] print:hidden"
          />
          <input
            type="date"
            aria-label="Go to date"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            value={state.date}
            onClick={(event) => {
              try {
                event.currentTarget.showPicker();
              } catch {
                // Some browsers open the picker on their own, or not from a script.
              }
            }}
            onChange={(event) => {
              if (event.target.value) go({ ...state, date: event.target.value });
            }}
          />
        </div>
        <ModeActionButton icon={ChevronRight} label={`Next ${unit}`} onClick={() => go(stepCalendar(state, 1))} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <CalendarFilterButton
          show={state.show}
          canFilterToMe={actorId !== null}
          actorId={actorId}
          people={peopleIn(all)}
          onChange={(show: CalendarShow) => go({ ...state, show })}
        />
        {state.date !== today ? (
          <Button className="min-h-12" onClick={() => go({ ...state, date: today })}>
            Today
          </Button>
        ) : null}
        {state.view === "month" ? <PrintButton /> : null}
      </div>
      {manager.enabled ? (
        <NeedsYouStrip
          serviceId={team.serviceId}
          pending={manager.pending}
          claimed={manager.claimed}
          shortDays={manager.shortDays.filter((date) => date >= today)}
          checks={manager}
          onChanged={managerChanged}
          onPickDay={(date) => go({ ...state, view: "day", date })}
        />
      ) : manager.unavailable ? (
        <p className="text-sm text-[color:var(--text-muted)]">Manager tools aren&apos;t available right now.</p>
      ) : null}
      {read.status === "loading" ? (
        <WorkStateLoading label="Loading the team roster…" />
      ) : read.status !== "ready" ? (
        <div role="alert">
          <p>{read.message}</p>
          <Button onClick={read.reload}>Try again</Button>
        </div>
      ) : state.view === "day" ? (
        <DayView actorId={actorId} now={now} day={state.date} today={today} rows={rows} onSelect={setSelected} />
      ) : state.view === "week" ? (
        <WeekBoard
          rows={withComparedPeople(weekBoard(monday, rows, actorId), state.show, actorId, peopleIn(all))}
          days={weekDays}
          onPickShift={setSelected}
          pendingSwapIds={pendingSwapIds}
          openShifts={requests.data?.openShifts}
          cover={cover}
          flags={manager.flags}
        />
      ) : (
        <MonthView
          cells={monthCells(monthKeyOf(state.date), rows, actorId)}
          today={today}
          onPickDay={setPickedDay}
          cover={cover}
        />
      )}
      {phoneLink ? (
        <ModeGroupedList>
          <ModeRow
            title="Phone numbers are in On call"
            href={`/on-call/service?service=${encodeURIComponent(team.serviceId)}`}
          />
        </ModeGroupedList>
      ) : null}
      <RosterSentBar receipt={sent} clear={clearSent} />
      {pickedDay ? (
        <DaySheet
          date={pickedDay}
          rows={rows.filter((row) => assignmentStartDate(row) === pickedDay)}
          actorId={actorId}
          now={now}
          filtered={state.show.kind !== "everyone"}
          onClose={() => setPickedDay(null)}
          onPickShift={(shift) => {
            setPickedDay(null);
            setSelected(shift);
          }}
          onSwap={(shift) => {
            setPickedDay(null);
            setRequest({ kind: "swap", shift });
          }}
          onGiveAway={(shift) => {
            setPickedDay(null);
            setRequest({ kind: "give_away", shift });
          }}
        />
      ) : null}
      {selected ? (
        <ShiftSheet
          shift={selected}
          team={team}
          actorId={actorId}
          now={now}
          flags={manager.enabled ? manager.flags.get(selected.id) : undefined}
          manage={manager.enabled ? { onChanged: managerChanged, pending: manager.pending, checks: manager } : null}
          onClose={() => setSelected(null)}
          onSwap={(shift) => {
            setSelected(null);
            setRequest({ kind: "swap", shift });
          }}
          onGiveAway={(shift) => {
            setSelected(null);
            setRequest({ kind: "give_away", shift });
          }}
        />
      ) : null}
      {actorId && request ? (
        <SwapFlowSheet
          open
          onClose={() => setRequest(null)}
          serviceId={team.serviceId}
          actorId={actorId}
          give={request.shift}
          mode={request.kind}
          onSent={onSent}
        />
      ) : null}
    </>
  );
}
