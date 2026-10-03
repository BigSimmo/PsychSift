"use client";

import { Plus } from "lucide-react";
import { Fragment, useMemo, useState, type ReactNode } from "react";

import { pinnedHelpItems } from "@/components/admin/admin-pinned-numbers";
import { ADMIN_PAGE_HREFS } from "@/lib/admin/page-hrefs";
import { focusRing } from "@/components/card-recipes";
import { dashMuted } from "@/components/dashboard-kit/recipes";
import { useMyDayDeviceState } from "@/components/my-day/my-day-device-state";
import { listNames } from "@/components/my-day/my-day-page-parts";
import {
  CpdRingsCard,
  FlagCard,
  HeroCard,
  MODE_CHIP,
  NeedsYouCard,
  QuickActionsCard,
  RenewalsRunwayCard,
  shiftName,
  ThisWeekCard,
  type AgendaLine,
  type DayDetail,
} from "@/components/my-day/my-day-today-cards";
import {
  CallsCard,
  CpdMonthCard,
  CredentialsCard,
  HoursCard,
  MonthGlanceCard,
  NextTalkCard,
  PinnedNumbersCard,
  QuickNoteCard,
  WhosOnCard,
  type PinnedNumber,
} from "@/components/my-day/my-day-work-me-cards";
import type { MyDayDashboardSources } from "@/components/my-day/use-my-day-dashboard-sources";
import { useOnCallCallLog } from "@/components/on-call/handover/call-log";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { kindOf } from "@/components/roster/roster-format";
import { sessionHref } from "@/components/teaching/teaching-view-model";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui-primitives";
import type { AdminHelpItem } from "@/lib/admin/help-items";
import { displayPhoneNumber } from "@/lib/admin/phone-display";
import { useAdminPins } from "@/lib/admin/pins";
import {
  dueCountsByDate,
  isSnoozed,
  MY_DAY_CARD_LABELS,
  MY_DAY_PAGE_CARDS,
  selectNeedsYou,
  selectUpNext,
  snoozeUntil,
  weekOf,
  type MyDayCardId,
  type MyDayPageId,
  type MyDaySnoozes,
  type MyDayTimedEvent,
} from "@/lib/my-day/dashboard";
import {
  buildDayRibbon,
  cpdProjectedHours,
  hoursBars,
  kindsByDate as kindsByDateOf,
  monthGlance,
  myDayActionLabel,
  renewalsRunway,
  selectFlagItems,
  type RenewalRow,
} from "@/lib/my-day/figures";
import { duePerthDate } from "@/lib/my-day/merge";
import type { MyDayItem } from "@/lib/my-day/model";
import { onCallTelHref } from "@/lib/on-call/home-modules";
import type { ShiftKind } from "@/lib/roster/shift-kind";
import { perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import { summariseToday } from "@/lib/roster/today";
import type { RosterDisplayShift } from "@/lib/roster/team/team-view";
import type { SessionSummary } from "@/lib/teaching/model";

/**
 * My Day as a modular dashboard in three pages, Today, Work and Me (design
 * review v13, concept D), in the dashboard style
 * (`src/components/dashboard-kit/`, TOKENS.md §7.2).
 *
 * Every card reads a real source and hides itself when that source has
 * nothing, or does not exist in this build. "Edit" hides or restores cards;
 * the choice stays on this device for this account only.
 *
 * Read-only towards the server: the only things here that change anything
 * are "Later" (moves a row to tomorrow on this device, with Undo) and the
 * quick note (this device only).
 */

const NO_RENEWALS: readonly RenewalRow[] = [];
const NO_HELP: readonly AdminHelpItem[] = [];
const NO_SESSIONS: readonly SessionSummary[] = [];

export interface MyDayDashboardProps {
  readonly now: Date;
  readonly today: string;
  /** The merged items, with any invented ones already removed for a signed-in reader. */
  readonly items: readonly MyDayItem[];
  /** Admin's recorded dates, passed to a year ahead (runway and wallet). */
  readonly renewals?: readonly RenewalRow[];
  /** Admin's Help items, for pinned numbers. */
  readonly helpItems?: readonly AdminHelpItem[];
  readonly sources: MyDayDashboardSources;
  /** Names of the My Day sources that were checked, for the empty "Needs you" line. */
  readonly checked: readonly string[];
  readonly editing: boolean;
  /** Which page (tab) to draw. */
  readonly page?: MyDayPageId;
  readonly onShowAll: () => void;
  readonly onRetry: () => void;
  /**
   * The signed-out sample only: invented call counts and pinned numbers in
   * place of this device's call log and pins, so a visitor sees those cards
   * filled. Never set for a signed-in reader.
   */
  readonly sample?: MyDaySampleExtras;
}

export interface MyDaySampleExtras {
  /** Counts only: the sample never invents call notes or patient labels. */
  readonly calls: { readonly total: number; readonly open: number };
  readonly pinnedNumbers: readonly PinnedNumber[];
}

function shiftEvent(shift: RosterDisplayShift): MyDayTimedEvent {
  const kind = kindOf(shift);
  return {
    id: `shift:${shift.id}`,
    source: "shift",
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    title: shiftName(kind),
    where: [shift.workplace ?? shift.location ?? shift.teamName, `until ${perthTimeOf(shift.endsAt)}`]
      .filter(Boolean)
      .join(" · "),
    href: "/roster",
    actionLabel: "Open Roster",
  };
}

function teachingEvent(session: SessionSummary): MyDayTimedEvent {
  return {
    id: `teaching:${session.occurrenceId}`,
    source: "teaching",
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    title: session.title,
    where: [session.isPresenter ? "You're presenting" : null, session.venue].filter(Boolean).join(" · "),
    href: sessionHref(session) ?? "/teaching/week",
    actionLabel: "Open",
  };
}

const ALL_HIDDEN = "Every card is hidden. Choose Edit to bring them back.";
const WORK_EMPTY =
  "Nothing for Work yet. Tonight's calls, pinned numbers, your team and your next talk show here once they exist.";

const PINNED_NUMBERS_SHOWN = 4;

export function MyDayDashboard({
  now,
  today,
  items,
  renewals = NO_RENEWALS,
  helpItems = NO_HELP,
  sources,
  checked,
  editing,
  page = "today",
  onShowAll,
  onRetry,
  sample,
}: MyDayDashboardProps) {
  const stored = useMyDayDeviceState(today);
  // The signed-out sample keeps "Later" for this page only, so nothing one visitor does is kept for the next.
  const [sampleSnoozes, setSampleSnoozes] = useState<MyDaySnoozes>({});
  const device = sample
    ? {
        ...stored,
        snoozes: sampleSnoozes,
        snooze: (itemId: string, until: string) => setSampleSnoozes((current) => ({ ...current, [itemId]: until })),
        unsnooze: (itemId: string) =>
          setSampleSnoozes((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== itemId))),
      }
    : stored;
  const onHide = (id: MyDayCardId) => (editing ? () => device.setHidden(id, true) : undefined);
  const [undo, setUndo] = useState<{ readonly id: string; readonly title: string } | null>(null);

  // ---------------------------------------------------------------- roster and the hero
  const rosterReady = sources.roster.status === "ready";
  const shifts = sources.roster.shifts;
  const summary = useMemo(
    () =>
      rosterReady
        ? summariseToday(
            shifts.map((shift) => ({
              id: shift.id,
              startsAt: shift.startsAt,
              endsAt: shift.endsAt,
              kind: kindOf(shift),
            })),
            now,
          )
        : null,
    [rosterReady, shifts, now],
  );
  const byId = useMemo(() => new Map(shifts.map((shift) => [shift.id, shift])), [shifts]);
  const todaysShifts = useMemo(
    () => shifts.filter((shift) => kindOf(shift) !== "leave" && perthDateOf(shift.startsAt) === today),
    [shifts, today],
  );
  const teachingSessions = sources.teaching.sessions;
  const events = useMemo(
    () => [...todaysShifts.map(shiftEvent), ...teachingSessions.map(teachingEvent)],
    [todaysShifts, teachingSessions],
  );
  // The hero's shift: the shift on now, else the next one (today or later).
  const lead = summary?.lead;
  const leadShift =
    lead && lead.state !== "empty"
      ? lead.state === "day_off"
        ? lead.next
          ? (byId.get(lead.next.id) ?? null)
          : null
        : (byId.get(lead.shift.id) ?? null)
      : null;
  const shiftRunning = lead?.state === "on_now";
  // The shift already has the hero's ring, so Up next is the next thing after it.
  const upNext = selectUpNext(leadShift ? events.filter((event) => event.id !== `shift:${leadShift.id}`) : events, now);
  const ribbon = useMemo(
    () =>
      buildDayRibbon(
        [
          ...todaysShifts.map((shift) => ({
            id: `shift:${shift.id}`,
            startsAt: shift.startsAt,
            endsAt: shift.endsAt,
            kind: "shift" as const,
          })),
          ...teachingSessions.map((session) => ({
            id: `teaching:${session.occurrenceId}`,
            startsAt: session.startsAt,
            endsAt: session.endsAt,
            kind: "other" as const,
          })),
        ],
        now,
      ),
    [todaysShifts, teachingSessions, now],
  );

  // ---------------------------------------------------------------- this week
  const week = useMemo(() => weekOf(today), [today]);
  const kindsByDate = useMemo(
    () =>
      rosterReady ? kindsByDateOf(shifts.map((shift) => ({ startsAt: shift.startsAt, kind: kindOf(shift) }))) : null,
    [rosterReady, shifts],
  );
  const dueByDate = useMemo(() => dueCountsByDate(items), [items]);
  const weekHasDue = week.some((date) => (dueByDate.get(date) ?? 0) > 0);

  const agenda = useMemo<AgendaLine[]>(() => {
    const at = now.getTime();
    const lines: AgendaLine[] = [];
    for (const event of events) {
      lines.push({
        key: event.id,
        at: Date.parse(event.startsAt),
        time: perthTimeOf(event.startsAt),
        text: event.title,
        past: Date.parse(event.endsAt) <= at,
      });
    }
    for (const item of items) {
      if (!item.due || /^\d{4}-\d{2}-\d{2}$/.test(item.due) || duePerthDate(item.due) !== today) continue;
      const due = Date.parse(item.due);
      lines.push({ key: `item:${item.id}`, at: due, time: perthTimeOf(item.due), text: item.title, past: due <= at });
    }
    const byTime = (a: AgendaLine, b: AgendaLine) => a.at - b.at || a.key.localeCompare(b.key);
    // Unfinished and upcoming lines claim the six places first, so a busy
    // morning that is over cannot push the rest of the day off the card.
    const kept = [
      ...lines.filter((line) => !line.past).sort(byTime),
      ...lines.filter((line) => line.past).sort(byTime),
    ];
    return kept.slice(0, 6).sort(byTime);
  }, [events, items, now, today]);

  const ahead = sources.teaching.ahead ?? NO_SESSIONS;
  const detailFor = (date: string): DayDetail[] => {
    const details: DayDetail[] = [];
    for (const shift of shifts) {
      if (perthDateOf(shift.startsAt) !== date) continue;
      const kind: ShiftKind = kindOf(shift);
      details.push({
        key: `shift:${shift.id}`,
        code: kind === "on_call" ? "OC" : kind === "night" ? "N" : kind === "leave" ? "L" : "D",
        tint: kind === "on_call" ? "blue" : "blue-2",
        title:
          kind === "leave"
            ? "Leave"
            : `${shiftName(kind)} ${perthTimeOf(shift.startsAt)} to ${perthTimeOf(shift.endsAt)}`,
        subtitle: shift.workplace ?? shift.location ?? shift.teamName ?? undefined,
      });
    }
    for (const session of ahead) {
      if (session.allDay || perthDateOf(session.startsAt) !== date) continue;
      details.push({
        key: `teaching:${session.occurrenceId}`,
        code: "T",
        tint: "blue-2",
        title: `${session.title} ${perthTimeOf(session.startsAt)}`,
        subtitle: session.isPresenter ? "You're presenting" : (session.venue ?? undefined),
      });
    }
    for (const item of items) {
      if (duePerthDate(item.due) !== date) continue;
      const chip = MODE_CHIP[item.mode];
      details.push({
        key: `item:${item.id}`,
        code: chip.code,
        tint: chip.tint,
        title: item.title,
        subtitle: item.severity === "overdue" ? (item.mode === "my-work" ? "Date passed" : "Overdue") : "Due",
        passed: item.severity === "overdue",
        href: item.href,
        actionLabel: myDayActionLabel(item),
      });
    }
    return details;
  };

  // ---------------------------------------------------------------- items
  const needsYou = selectNeedsYou(items, device.snoozes, today);
  const flagItems = selectFlagItems(items, (id) => isSnoozed(device.snoozes, id, today));
  const later = (item: MyDayItem) => {
    device.snooze(item.id, snoozeUntil(now));
    setUndo({ id: item.id, title: item.title });
  };
  const runway = useMemo(() => renewalsRunway(renewals, today), [renewals, today]);

  // ---------------------------------------------------------------- work
  const callLog = useOnCallCallLog();
  const callEntries = callLog?.entries ?? [];
  const callTotal = sample ? sample.calls.total : callEntries.length;
  const callOpen = sample ? sample.calls.open : callEntries.filter((entry) => !entry.done).length;
  const pins = useAdminPins();
  const pinnedNumbers = useMemo<readonly PinnedNumber[]>(
    () =>
      sample?.pinnedNumbers ??
      // Pins with a phone number lead (it is a numbers card); four fit, the rest are on Help.
      [...pinnedHelpItems(pins, helpItems)]
        .sort((a, b) => Number(Boolean(b.phone)) - Number(Boolean(a.phone)))
        .slice(0, PINNED_NUMBERS_SHOWN)
        .map((help) => ({
          key: help.key,
          title: help.title,
          display: help.phone ? displayPhoneNumber(help.phone, "own-list") : (help.detail ?? ""),
          tel: onCallTelHref(help.phone ?? undefined) ?? null,
          href: `${ADMIN_PAGE_HREFS.help}#${onCallEntryAnchorId(help.entry?.id ?? help.key)}`,
        })),
    [sample, pins, helpItems],
  );
  const whosOn = sources.whosOn;
  const nextTalk = sources.teaching.nextTalk ?? null;
  // Handover is the end of tonight's on-call shift: the one running now, or one that starts today.
  const handoverAt =
    leadShift && kindOf(leadShift) === "on_call" && (shiftRunning || perthDateOf(leadShift.startsAt) === today)
      ? leadShift.endsAt
      : null;

  // ---------------------------------------------------------------- me
  const hoursShifts = useMemo(
    () => shifts.map((shift) => ({ startsAt: shift.startsAt, endsAt: shift.endsAt, kind: kindOf(shift) })),
    [shifts],
  );
  const weekHours = useMemo(() => hoursBars(hoursShifts, today, "week"), [hoursShifts, today]);
  const fortnightHours = useMemo(() => hoursBars(hoursShifts, today, "fortnight"), [hoursShifts, today]);
  const glance = useMemo(() => monthGlance(hoursShifts, today), [hoursShifts, today]);

  const cpd = sources.cpd;
  const cpdReady = cpd.status === "ready" && cpd.targetHours > 0;

  const visible: Record<MyDayCardId, boolean> = {
    "up-next": upNext !== null || leadShift !== null,
    flag: flagItems.length > 0,
    "quick-actions": true,
    "this-week": rosterReady || agenda.length > 0 || weekHasDue,
    "needs-you": true,
    cpd: cpdReady,
    renewals: runway.length > 0,
    calls: callTotal > 0,
    "pinned-numbers": pinnedNumbers.length > 0,
    "whos-on": whosOn?.status === "ready" && whosOn.colleagues.length > 0,
    "next-talk": nextTalk !== null,
    hours: rosterReady && (weekHours.totalHours > 0 || fortnightHours.totalHours > 0),
    "month-glance": rosterReady && glance.totalHours > 0,
    credentials: renewals.length > 0,
    "cpd-month": cpdReady,
    // The note is kept on this device; a signed-out sample must not keep one visitor's note for the next.
    "quick-note": !sample,
  };

  const partial = [
    sources.roster.partial ? "your team's shifts" : null,
    sources.teaching.partial ? "the On Call teaching list" : null,
  ].filter((name): name is string => name !== null);
  const retryAll = () => {
    onRetry();
    sources.retry?.();
  };
  const failed = [
    sources.roster.status === "failed" ? "Shifts" : null,
    sources.teaching.status === "failed" ? "Teaching sessions" : null,
    cpd.status === "failed" ? "CPD hours" : null,
  ].filter((name): name is string => name !== null);

  const cards: Record<MyDayCardId, () => ReactNode> = {
    "up-next": () => (
      <HeroCard
        shift={leadShift}
        running={shiftRunning}
        upNext={upNext}
        ribbon={ribbon}
        now={now}
        onHide={onHide("up-next")}
      />
    ),
    flag: () => <FlagCard items={flagItems} onHide={onHide("flag")} />,
    "quick-actions": () => <QuickActionsCard onHide={onHide("quick-actions")} />,
    "this-week": () => (
      <ThisWeekCard
        week={week}
        today={today}
        kindsByDate={kindsByDate}
        dueByDate={dueByDate}
        agenda={agenda}
        detailFor={detailFor}
        onHide={onHide("this-week")}
      />
    ),
    "needs-you": () => (
      <NeedsYouCard
        shown={needsYou.shown}
        waiting={needsYou.waiting}
        total={needsYou.total}
        checked={checked}
        undo={undo}
        onLater={later}
        onUndo={() => {
          if (undo) device.unsnooze(undo.id);
          setUndo(null);
        }}
        onShowAll={onShowAll}
        onRetry={retryAll}
        onHide={onHide("needs-you")}
      />
    ),
    cpd: () => (
      <CpdRingsCard
        loggedHours={cpd.loggedHours}
        targetHours={cpd.targetHours}
        byCategory={cpd.byCategory}
        categoryTargets={cpd.categoryTargets}
        onHide={onHide("cpd")}
      />
    ),
    renewals: () => <RenewalsRunwayCard points={runway} onHide={onHide("renewals")} />,
    calls: () => (
      <CallsCard
        total={callTotal}
        open={callOpen}
        clearsAt={sample ? null : (callLog?.expiresAt ?? null)}
        handoverAt={handoverAt}
        onHide={onHide("calls")}
      />
    ),
    "pinned-numbers": () => <PinnedNumbersCard numbers={pinnedNumbers} onHide={onHide("pinned-numbers")} />,
    "whos-on": () => <WhosOnCard colleagues={whosOn?.colleagues ?? []} onHide={onHide("whos-on")} />,
    "next-talk": () =>
      nextTalk ? <NextTalkCard session={nextTalk} today={today} onHide={onHide("next-talk")} /> : null,
    hours: () => <HoursCard week={weekHours} fortnight={fortnightHours} onHide={onHide("hours")} />,
    "month-glance": () => <MonthGlanceCard glance={glance} today={today} onHide={onHide("month-glance")} />,
    credentials: () => <CredentialsCard rows={renewals} today={today} onHide={onHide("credentials")} />,
    "cpd-month": () => (
      <CpdMonthCard
        byMonth={cpd.byMonth}
        loggedHours={cpd.loggedHours}
        targetHours={cpd.targetHours}
        projected={cpdProjectedHours(cpd.loggedHours, today)}
        currentMonth={Number(today.slice(5, 7)) - 1}
        onHide={onHide("cpd-month")}
      />
    ),
    "quick-note": () => <QuickNoteCard onHide={onHide("quick-note")} />,
  };

  const pageCards: readonly MyDayCardId[] = MY_DAY_PAGE_CARDS[page];
  const shownIds = pageCards.filter((id) => visible[id] && !device.hidden.has(id));
  const hiddenIds = pageCards.filter((id) => device.hidden.has(id));

  return (
    <div className="grid gap-2.5" data-testid="my-day-dashboard" data-page={page}>
      {failed.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className={dashMuted} data-testid="my-day-card-failed">
            {`Couldn't load ${listNames(failed)}, so ${failed.length === 1 ? "that card is" : "those cards are"} not shown.`}
          </p>
          <Button variant="secondary" onClick={retryAll} data-testid="my-day-card-retry">
            Retry
          </Button>
        </div>
      ) : null}
      {partial.length > 0 ? (
        <p className={dashMuted} data-testid="my-day-card-partial">
          {`Couldn't load ${listNames(partial)}, so these cards may be missing some of it.`}
        </p>
      ) : null}
      <div
        className="grid gap-2.5 lg:block lg:columns-2 lg:gap-2.5 lg:*:mb-2.5 lg:*:break-inside-avoid"
        data-editing={editing ? "" : undefined}
      >
        {shownIds.map((id) => (
          <Fragment key={id}>{cards[id]()}</Fragment>
        ))}
      </div>
      {shownIds.length === 0 && !editing ? (
        <p className={cn(dashMuted, "px-1")} data-testid="my-day-all-hidden">
          {page === "work" && hiddenIds.length === 0 ? WORK_EMPTY : ALL_HIDDEN}
        </p>
      ) : null}
      {editing ? (
        <div className="grid gap-2" data-testid="my-day-hidden-cards">
          <p className={dashMuted}>
            {hiddenIds.length > 0
              ? "Hidden cards. Choose one to bring it back."
              : "Choose × on a card to hide it. Hidden cards wait here."}
          </p>
          {hiddenIds.length > 0 ? (
            <ul role="list" className="flex flex-wrap gap-2">
              {hiddenIds.map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => device.setHidden(id, false)}
                    aria-label={`Show ${MY_DAY_CARD_LABELS[id]}`}
                    data-testid={`my-day-restore-${id}`}
                    className={cn(
                      focusRing,
                      "inline-flex min-h-12 items-center gap-1 rounded-full border border-dashed border-[color:var(--dash-line-strong)] bg-[color:var(--dash-raised)] px-4 text-sm font-dash-title text-[color:var(--dash-muted)]",
                    )}
                  >
                    <Plus aria-hidden="true" className="size-icon-sm" />
                    {MY_DAY_CARD_LABELS[id]}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
