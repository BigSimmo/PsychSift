"use client";

import {
  Award,
  CalendarDays,
  GraduationCap,
  History,
  Shield,
  Sparkles,
  TriangleAlert,
  UserRound,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { pinnedHelpItems } from "@/components/admin/admin-pinned-numbers";
import { ADMIN_PAGE_HREFS } from "@/lib/admin/page-hrefs";
import { EndOfShiftCard } from "@/components/alerts/end-of-shift-card";
import { focusRing } from "@/components/card-recipes";
import { useWorkUndoToast } from "@/components/mode-kit/work";
import { useMyDayDeviceState } from "@/components/my-day/my-day-device-state";
import {
  AreaIcon,
  QuietFoot,
  QuietLabel,
  QuietList,
  QuietNote,
  QuietSection,
  QuietTextLink,
  quietCard,
  quietLink,
} from "@/components/my-day/my-day-quiet";
import { MY_DAY_ALWAYS_ON, MyDayLaterSheet } from "@/components/my-day/my-day-sheets";
import { listNames } from "@/components/my-day/my-day-page-parts";
import {
  CpdRingsCard,
  CustomiseRow,
  FlagCard,
  HeroCard,
  type HeroEndOfShift,
  type HeroFinishedShift,
  type HeroNextTeaching,
  NeedsYouCard,
  QuickActionsCard,
  RenewalsRunwayCard,
  shiftName,
  ThisWeekCard,
  type DayDetail,
} from "@/components/my-day/my-day-today-cards";
import {
  CallNotesFoot,
  CallsCard,
  ComingUpCard,
  CpdMonthCard,
  CredentialsCard,
  GlanceCard,
  HoursCard,
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
import type { AdminHelpItem } from "@/lib/admin/help-items";
import type { NewJobProgress } from "@/lib/admin/new-job-progress";
import { endOfShiftCard } from "@/lib/alerts/end-of-shift";
import { displayPhoneNumber } from "@/lib/admin/phone-display";
import { useAdminPins } from "@/lib/admin/pins";
import {
  dueCountsByDate,
  isSnoozed,
  MY_DAY_PAGE_CARDS,
  nextRosteredDay,
  selectNeedsYou,
  selectUpNext,
  snoozeUntil,
  type MyDayCardId,
  type MyDayPageId,
  type MyDaySnoozes,
  type MyDayTimedEvent,
} from "@/lib/my-day/dashboard";
import {
  cpdProjectedHours,
  hoursBars,
  kindsByDate as kindsByDateOf,
  myDayActionLabel,
  renewalsRunway,
  selectFlagItems,
  type RenewalRow,
} from "@/lib/my-day/figures";
import { duePerthDate } from "@/lib/my-day/merge";
import { weekRows } from "@/lib/my-day/quiet-figures";
import { withMyDayReturn } from "@/lib/my-day/return-link";
import { myDayWeekDates } from "@/lib/my-day/week";
import type { MyDayItem } from "@/lib/my-day/model";
import { nextTeachingSession } from "@/lib/my-day/next-teaching";
import { onCallTelHref } from "@/lib/on-call/home-modules";
import { isWorkedKind, type ShiftKind } from "@/lib/roster/shift-kind";
import { addDaysToDate, formatPerthDay, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import { summariseToday } from "@/lib/roster/today";
import type { RosterDisplayShift } from "@/lib/roster/team/team-view";
import type { SessionSummary } from "@/lib/teaching/model";

/**
 * My Day's three card pages, Today, On shift (`?page=work`) and My records
 * (`?page=me`), in the flat work-mode design (work-mode redesign, owner
 * request 6 Oct 2026).
 *
 * Every card reads a real source and hides itself when that source has
 * nothing, or does not exist in this build. The Customise sheet hides or
 * restores cards; the choice stays on this device for this account only.
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
  /** Opens the Customise sheet from the "Customise My Day" row. */
  readonly onCustomise?: () => void;
  /** Opens Remind me, with the words to start from (a Needs you row's title). */
  readonly onRemindMe?: (text?: string) => void;
  /** Opens Your reminders, from the end-of-shift card. */
  readonly onOpenReminders?: () => void;
  /** Reminders still to do on this phone, for the end-of-shift card. */
  readonly pendingReminders?: number;
  /** The New job countdown for My records. */
  readonly newJob?: NewJobProgress | null;
  /** When the sources last answered, "14:05", for the "Checked … at" line. */
  readonly checkedAt?: string | null;
  /** A My Day item source failed, so the Needs you count is "at least". */
  readonly incomplete?: boolean;
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

const ALL_HIDDEN = "Every card is hidden. Choose Customise My Day to bring them back.";
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
  onCustomise,
  onRemindMe,
  onOpenReminders,
  pendingReminders,
  newJob = null,
  checkedAt = null,
  incomplete: itemsIncomplete = false,
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
  // Cards are hidden from the Customise sheet now, so no card draws its own hide button.
  const isHidden = (id: MyDayCardId) => !MY_DAY_ALWAYS_ON.has(id) && device.hidden.has(id);
  const [hiddenNote, setHiddenNote] = useState<{
    readonly id: string;
    readonly title: string;
    readonly until: string;
  } | null>(null);
  const [laterItem, setLaterItem] = useState<MyDayItem | null>(null);
  const toast = useWorkUndoToast();

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
  // No shift left today: the one that ended earlier today, and the next one on a later day.
  const finished: HeroFinishedShift | null = useMemo(() => {
    if (lead?.state !== "day_off" || !lead.finishedToday) return null;
    const at = now.getTime();
    const ended = shifts
      .filter(
        (shift) => kindOf(shift) !== "leave" && Date.parse(shift.endsAt) <= at && perthDateOf(shift.endsAt) === today,
      )
      .sort((a, b) => Date.parse(b.endsAt) - Date.parse(a.endsAt))[0];
    return ended ? { kind: kindOf(ended), endsAt: ended.endsAt } : null;
  }, [lead, shifts, now, today]);
  const heroShift = lead?.state === "day_off" ? null : leadShift;
  const nextShift = lead?.state === "day_off" ? leadShift : null;

  // ---------------------------------------------------------------- this week
  // Today and the six days after it, the same seven days as the Week page.
  const week = useMemo(() => myDayWeekDates(today), [today]);
  const kindsByDate = useMemo(
    () =>
      rosterReady ? kindsByDateOf(shifts.map((shift) => ({ startsAt: shift.startsAt, kind: kindOf(shift) }))) : null,
    [rosterReady, shifts],
  );
  const dueByDate = useMemo(() => dueCountsByDate(items), [items]);
  const weekHasDue = week.some((date) => (dueByDate.get(date) ?? 0) > 0);

  const ahead = sources.teaching.ahead ?? NO_SESSIONS;
  const rows = useMemo(
    () =>
      weekRows(
        shifts
          .filter((shift) => kindOf(shift) !== "leave")
          .map((shift) => ({ id: shift.id, kind: kindOf(shift), startsAt: shift.startsAt, endsAt: shift.endsAt })),
        // Today's sessions are also in `ahead`: keep each occurrence once.
        [...new Map([...teachingSessions, ...ahead].map((session) => [session.occurrenceId, session])).values()].map(
          (session) => ({
            id: session.occurrenceId,
            title: session.title,
            startsAt: session.startsAt,
            endsAt: session.endsAt,
            venue: session.venue ?? null,
            isPresenter: session.isPresenter,
            allDay: session.allDay,
            href: sessionHref(session) ?? "/teaching/week",
          }),
        ),
        today,
        now,
      ),
    [shifts, teachingSessions, ahead, today, now],
  );
  const detailFor = (date: string): DayDetail[] => {
    const details: DayDetail[] = [];
    for (const shift of shifts) {
      if (perthDateOf(shift.startsAt) !== date) continue;
      const kind: ShiftKind = kindOf(shift);
      details.push({
        key: `shift:${shift.id}`,
        mode: "roster",
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
        mode: "teaching",
        title: `${session.title} ${perthTimeOf(session.startsAt)}`,
        subtitle: session.isPresenter ? "You're presenting" : (session.venue ?? undefined),
      });
    }
    for (const item of items) {
      if (duePerthDate(item.due) !== date) continue;
      details.push({
        key: `item:${item.id}`,
        mode: item.mode,
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
  const tomorrow = addDaysToDate(today, 1);
  // The next rostered day, offered by Later only when it is not tomorrow (and only from a roster that loaded).
  const workingDay = useMemo(
    () =>
      rosterReady
        ? nextRosteredDay(
            shifts.map((shift) => ({ startsAt: shift.startsAt, kind: kindOf(shift) })),
            today,
          )
        : null,
    [rosterReady, shifts, today],
  );
  const offerWorkingDay = workingDay !== null && workingDay !== tomorrow;
  const untilWords = (until: string) => (until === tomorrow ? "tomorrow" : formatPerthDay(until));
  const moveLater = (item: MyDayItem, until: string) => {
    device.snooze(item.id, until);
    setLaterItem(null);
    setHiddenNote({ id: item.id, title: item.title, until });
    toast?.(`${item.title} moved to ${untilWords(until)}`, () => {
      device.unsnooze(item.id);
      setHiddenNote((current) => (current?.id === item.id ? null : current));
    });
  };
  const later = (item: MyDayItem) => {
    if (offerWorkingDay) setLaterItem(item);
    else moveLater(item, snoozeUntil(now));
  };
  const snoozedCount = needsYou.total - needsYou.waiting;
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
          // The detail is the subtitle only when the number is shown; otherwise it already is the display.
          detail: help.phone ? (help.detail ?? null) : null,
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
  // Worked shifts in each window, for "84 h rostered · 9 shifts".
  const shiftsIn = (bars: { readonly start: string; readonly end: string }) =>
    hoursShifts.filter((shift) => {
      const date = perthDateOf(shift.startsAt);
      return isWorkedKind(shift.kind) && date >= bars.start && date <= bars.end;
    }).length;
  const nextLeave = summary?.nextLeave ?? null;
  const nextRenewal = useMemo(
    () => [...renewals].filter((row) => row.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null,
    [renewals, today],
  );
  // An ordinary day's "Coming up": the next on-call shift still to start.
  const nextOnCall = useMemo(() => {
    const at = now.getTime();
    return (
      shifts
        .filter((shift) => kindOf(shift) === "on_call" && Date.parse(shift.startsAt) > at)
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null
    );
  }, [shifts, now]);

  const cpd = sources.cpd;
  const cpdReady = cpd.status === "ready" && cpd.targetHours > 0;

  // ---------------------------------------------------------------- moved cards
  // Teaching's "Next up": the next session that is not already Up next in the hero.
  const allSessions = useMemo(() => [...teachingSessions, ...ahead], [teachingSessions, ahead]);
  const nextSession = useMemo(() => nextTeachingSession(allSessions, now), [allSessions, now]);
  const nextUp = nextSession && upNext?.event.id !== `teaching:${nextSession.occurrenceId}` ? nextSession : null;
  // Today's next session can be Up next itself: hiding "next-up" hides that panel too.
  const heroUpNext = upNext?.event.id.startsWith("teaching:") && device.hidden.has("next-up") ? null : upNext;
  // The next session lives in the hero as a glass panel; hiding "next-up" hides the panel.
  // Plain values, not memos: `leadShift` is worked out fresh each render.
  const heroNext: HeroNextTeaching | null = (() => {
    if (!nextUp || device.hidden.has("next-up")) return null;
    const date = perthDateOf(nextUp.startsAt);
    const times = nextUp.allDay ? "" : `, ${perthTimeOf(nextUp.startsAt)} to ${perthTimeOf(nextUp.endsAt)}`;
    const href = sessionHref(nextUp);
    return {
      key: nextUp.occurrenceId,
      title: nextUp.title,
      when: `${formatPerthDay(date)}${times}`,
      href: href ?? "/teaching/week",
      where: [nextUp.venue, nextUp.isPresenter ? "you lead" : null].filter(Boolean).join(" · "),
      actionLabel: href ? "Details" : "See in Week",
      clash: nextUp.allDay ? null : clashLine(leadShift, nextUp.startsAt, nextUp.endsAt),
    };
  })();
  const heroUpNextWithClash =
    heroUpNext && heroUpNext.event.source === "teaching"
      ? { ...heroUpNext, clash: clashLine(leadShift, heroUpNext.event.startsAt, heroUpNext.event.endsAt) }
      : heroUpNext;

  // ---------------------------------------------------------------- end of shift
  // The last half hour of a rostered shift that has started: the hero turns to handover.
  const endOfShift = useMemo(
    () =>
      rosterReady
        ? endOfShiftCard(
            now,
            shifts
              .filter((shift) => kindOf(shift) !== "leave")
              .map((shift) => ({ label: shiftName(kindOf(shift)), startsAt: shift.startsAt, endsAt: shift.endsAt })),
          )
        : null,
    [rosterReady, shifts, now],
  );
  const heroEnd: HeroEndOfShift | null =
    endOfShift && heroShift && shiftRunning
      ? {
          ...endOfShift,
          calls: kindOf(heroShift) === "on_call" ? { logged: callTotal, open: callOpen } : null,
        }
      : null;
  const onCallNow = Boolean(heroShift && shiftRunning && kindOf(heroShift) === "on_call");

  // ---------------------------------------------------------------- first steps
  // Every source answered and none holds anything: a new reader, so the page says where to start.
  const firstSteps =
    !sample &&
    !itemsIncomplete &&
    checked.length > 0 &&
    items.length === 0 &&
    renewals.length === 0 &&
    rosterReady &&
    shifts.length === 0 &&
    sources.teaching.status === "ready" &&
    teachingSessions.length === 0 &&
    ahead.length === 0 &&
    cpd.status === "ready" &&
    cpd.targetHours === 0;

  const visible: Record<MyDayCardId, boolean> = {
    "up-next": heroUpNext !== null || leadShift !== null || heroNext !== null || finished !== null,
    // The next teaching panel lives inside the hero, so it shows only while the hero does.
    "next-up": nextUp !== null && !device.hidden.has("up-next"),
    flag: flagItems.length > 0,
    "quick-actions": true,
    // A roster that failed still gets its place, with a line saying shifts are not shown.
    "this-week": sources.roster.status === "failed" || rosterReady || rows.length > 0 || weekHasDue,
    "needs-you": true,
    cpd: cpdReady,
    renewals: runway.length > 0,
    // During or before tonight's on call the panel shows, even with no calls logged yet.
    calls: callTotal > 0 || handoverAt !== null,
    "pinned-numbers": pinnedNumbers.length > 0,
    "whos-on": whosOn?.status === "ready" && whosOn.colleagues.length > 0,
    // During on call the next talk has its own section; otherwise it leads "Coming up".
    "next-talk": nextTalk !== null && handoverAt !== null,
    "coming-up": handoverAt === null && (nextTalk !== null || nextOnCall !== null),
    glance: nextLeave !== null || nextRenewal !== null || newJob !== null || weekHours.totalHours > 0,
    hours: rosterReady && (weekHours.totalHours > 0 || fortnightHours.totalHours > 0),
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
  const rosterFailed = sources.roster.status === "failed";
  // The roster has its own amber note; the rest share one line.
  const failed = [
    sources.teaching.status === "failed" ? "Teaching sessions" : null,
    cpd.status === "failed" ? "CPD hours" : null,
  ].filter((name): name is string => name !== null);
  // Any source missing or part-read: counts are "at least", never a clean "nothing due".
  const incomplete = itemsIncomplete || rosterFailed || failed.length > 0 || partial.length > 0;
  const missing = [rosterFailed ? "Roster" : null, ...failed].filter((name): name is string => name !== null);
  const online = useOnline();
  const desktop = useDesktop();
  const offlineAt = online ? null : (checkedAt ?? null);

  const cards: Record<MyDayCardId, () => ReactNode> = {
    "up-next": () => (
      <>
        <HeroCard
          shift={heroShift}
          running={shiftRunning}
          upNext={heroUpNextWithClash}
          nextTeaching={heroNext}
          finished={finished}
          nextShift={nextShift}
          endOfShift={heroEnd}
          offlineAt={offlineAt}
          sample={Boolean(sample)}
          now={now}
        />
        {endOfShift && page === "today" && !sample ? (
          <EndOfShiftCard shift={endOfShift} pendingReminders={pendingReminders} onOpenReminders={onOpenReminders} />
        ) : null}
      </>
    ),
    // Drawn inside the hero (see `heroNext`), so the card itself draws nothing.
    "next-up": () => null,
    flag: () => <FlagCard items={flagItems} today={today} />,
    "quick-actions": () => (
      <QuickActionsCard onCall={onCallNow} onRemindMe={onRemindMe ? () => onRemindMe() : undefined} />
    ),
    "this-week": () =>
      rosterFailed ? (
        <QuietSection title="This week" testId="my-day-card-this-week">
          <p
            className="m-0 text-xs font-semibold text-[color:var(--text-muted)]"
            data-testid="my-day-week-roster-failed"
          >
            Roster not loaded, so shifts are not shown.
          </p>
          <div>
            <QuietTextLink href={withMyDayReturn("/roster")} pill>
              Open Roster
            </QuietTextLink>
          </div>
        </QuietSection>
      ) : (
        <ThisWeekCard
          week={week}
          today={today}
          kindsByDate={kindsByDate}
          dueByDate={dueByDate}
          rows={rows}
          detailFor={detailFor}
        />
      ),
    "needs-you": () =>
      firstSteps ? (
        <FirstSteps />
      ) : (
        <NeedsYouCard
          shown={needsYou.shown}
          waiting={needsYou.waiting}
          total={needsYou.total}
          checked={checked}
          checkedAt={checkedAt}
          incomplete={incomplete}
          missing={missing}
          offline={!online}
          today={today}
          hidden={
            hiddenNote && snoozedCount > 0
              ? { ...hiddenNote, until: untilWords(hiddenNote.until), count: snoozedCount }
              : null
          }
          inlineUndo={toast === null}
          onLater={later}
          onUndo={() => {
            if (hiddenNote) device.unsnooze(hiddenNote.id);
            setHiddenNote(null);
          }}
          onRemindMe={onRemindMe}
          onShowAll={onShowAll}
          onRetry={retryAll}
        />
      ),
    cpd: () => (
      <CpdRingsCard
        loggedHours={cpd.loggedHours}
        targetHours={cpd.targetHours}
        byCategory={cpd.byCategory}
        categoryTargets={cpd.categoryTargets}
        today={today}
        year={cpd.year}
      />
    ),
    renewals: () => <RenewalsRunwayCard points={runway} today={today} />,
    calls: () => (
      <CallsCard
        total={callTotal}
        open={callOpen}
        handoverAt={handoverAt}
        shiftStartsAt={handoverAt && leadShift ? leadShift.startsAt : null}
      />
    ),
    "pinned-numbers": () => <PinnedNumbersCard numbers={pinnedNumbers} offline={!online} />,
    "whos-on": () => <WhosOnCard colleagues={whosOn?.colleagues ?? []} />,
    "next-talk": () => (nextTalk ? <NextTalkCard session={nextTalk} today={today} /> : null),
    "coming-up": () => <ComingUpCard talk={nextTalk} onCall={nextOnCall} today={today} />,
    glance: () => (
      <GlanceCard
        leave={nextLeave}
        renewal={nextRenewal}
        weekHours={rosterReady && weekHours.totalHours > 0 ? weekHours.totalHours : null}
        newJob={newJob}
        today={today}
      />
    ),
    hours: () => (
      <HoursCard
        week={weekHours}
        fortnight={fortnightHours}
        weekShifts={shiftsIn(weekHours)}
        fortnightShifts={shiftsIn(fortnightHours)}
      />
    ),
    credentials: () => <CredentialsCard rows={renewals} today={today} />,
    "cpd-month": () => (
      <CpdMonthCard
        byMonth={cpd.byMonth}
        byCategory={cpd.byCategory}
        loggedHours={cpd.loggedHours}
        targetHours={cpd.targetHours}
        projected={cpd.closed ? null : cpdProjectedHours(cpd.loggedHours, today)}
        closed={cpd.closed === true}
        currentMonth={Number(today.slice(5, 7)) - 1}
      />
    ),
    "quick-note": () => <QuickNoteCard />,
  };

  const pageCards: readonly MyDayCardId[] = MY_DAY_PAGE_CARDS[page];
  const shownIds = pageCards.filter((id) => visible[id] && !isHidden(id));
  const hiddenIds = pageCards.filter((id) => isHidden(id));

  const drawCards = (ids: readonly MyDayCardId[]) => ids.map((id) => <Fragment key={id}>{cards[id]()}</Fragment>);
  // Today on a computer: two set columns, the day on the left and the planning on the right.
  const twoColumns = page === "today" && desktop;
  const leftIds = shownIds.filter((id) => TODAY_LEFT.has(id));
  const rightIds = shownIds.filter((id) => !TODAY_LEFT.has(id));

  return (
    <div className="grid min-w-0 gap-2.5" data-testid="my-day-dashboard" data-page={page}>
      {online ? null : (
        <QuietNote
          icon={WifiOff}
          testId="my-day-offline"
          role="status"
          title="You are offline"
          body={
            checkedAt
              ? `This is My Day as it loaded at ${checkedAt}. New items appear when you are back online.`
              : "New items appear when you are back online."
          }
        />
      )}
      {rosterFailed ? (
        <QuietNote
          icon={TriangleAlert}
          warn
          testId="my-day-roster-failed"
          role="alert"
          title="Your roster did not load"
          body="Shifts and on call may be missing here. Check Roster before you rely on this page."
          action={
            <button type="button" onClick={retryAll} className={quietLink} data-testid="my-day-roster-retry">
              Try again
            </button>
          }
        />
      ) : null}
      {failed.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 px-1">
          <p className="m-0 text-xs text-[color:var(--text-muted)]" data-testid="my-day-card-failed">
            {`Couldn't load ${listNames(failed)}, so ${failed.length === 1 ? "that card is" : "those cards are"} not shown.`}
          </p>
          <button type="button" onClick={retryAll} className={quietLink} data-testid="my-day-card-retry">
            Try again
          </button>
        </div>
      ) : null}
      {partial.length > 0 ? (
        <p className="m-0 px-1 text-xs text-[color:var(--text-muted)]" data-testid="my-day-card-partial">
          {`Couldn't load ${listNames(partial)}, so these cards may be missing some of it.`}
        </p>
      ) : null}
      {twoColumns ? (
        <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start gap-5" data-testid="my-day-columns">
          <div className="grid min-w-0 gap-2.5">{drawCards(leftIds)}</div>
          <div className="grid min-w-0 gap-2.5">{drawCards(rightIds)}</div>
        </div>
      ) : (
        <div
          className={
            page === "today"
              ? "grid min-w-0 gap-2.5"
              : "grid min-w-0 gap-2.5 lg:block lg:columns-2 lg:gap-5 lg:*:mb-2.5 lg:*:break-inside-avoid"
          }
        >
          {drawCards(shownIds)}
          {page === "work" && shownIds.includes("calls") ? <CallNotesFoot /> : null}
        </div>
      )}
      {shownIds.length === 0 ? (
        <p className="m-0 px-1 text-xs text-[color:var(--text-muted)]" data-testid="my-day-all-hidden">
          {page === "work" && hiddenIds.length === 0 ? WORK_EMPTY : ALL_HIDDEN}
        </p>
      ) : null}
      {page === "today" && incomplete ? (
        <QuietFoot icon={History}>A missing card means not checked, not nothing due.</QuietFoot>
      ) : null}
      {onCustomise ? <CustomiseRow onOpen={onCustomise} /> : null}
      <MyDayLaterSheet
        item={laterItem}
        tomorrow={tomorrow}
        nextWorkingDay={workingDay ?? tomorrow}
        onClose={() => setLaterItem(null)}
        onPick={moveLater}
        onRemindMe={(item) => {
          setLaterItem(null);
          onRemindMe?.(item.title);
        }}
      />
    </div>
  );
}

/**
 * The hero's clash line: a teaching session that starts as on call (or a
 * night) ends, or runs into it. A day shift with lunchtime teaching is not a
 * clash, so only on call and nights count.
 */
function clashLine(shift: RosterDisplayShift | null, startsAt: string, endsAt: string): string | null {
  if (!shift) return null;
  const kind = kindOf(shift);
  if (kind !== "on_call" && kind !== "night") return null;
  const name = kind === "on_call" ? "on call" : "your night shift";
  const shiftStart = Date.parse(shift.startsAt);
  const shiftEnd = Date.parse(shift.endsAt);
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (![shiftStart, shiftEnd, start, end].every(Number.isFinite)) return null;
  if (Math.abs(start - shiftEnd) <= 60_000) return `Starts as ${name} ends.`;
  if (start < shiftEnd && end > shiftStart) return `Runs into ${name}, which ends ${perthTimeOf(shift.endsAt)}.`;
  return null;
}

interface FirstStep {
  readonly title: string;
  readonly subtitle: string;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly mode?: "roster" | "teaching" | "cme" | "my-work";
}

const FIRST_STEPS: readonly FirstStep[] = [
  {
    title: "Import your roster",
    subtitle: "Shifts, on call and leave",
    href: "/roster",
    icon: CalendarDays,
    mode: "roster",
  },
  {
    title: "Follow your team's teaching",
    subtitle: "Sessions open to your service",
    href: "/teaching/whats-on",
    icon: GraduationCap,
    mode: "teaching",
  },
  { title: "Set up your CPD year", subtitle: "Your target and plan", href: "/cme/setup", icon: Award, mode: "cme" },
  {
    title: "Record renewal dates",
    subtitle: "Registration, life support, checks",
    href: "/admin/renewals?record=missing",
    icon: Shield,
    mode: "my-work",
  },
  {
    title: "Choose your stage",
    subtitle: "Tailors Teaching and training rows",
    href: "/my-day/profile",
    icon: UserRound,
  },
];

/** A new reader with nothing anywhere yet: where to start, each row opening the page that sets it up. */
function FirstSteps() {
  return (
    <div className="grid min-w-0 gap-2.5" data-testid="my-day-first-steps">
      <div className={`${quietCard} grid justify-items-center gap-1 px-4 py-5 text-center`}>
        <AreaIcon icon={Sparkles} size="lg" />
        <h2 className="m-0 mt-1 text-base font-bold text-[color:var(--work-ink)]">Your day starts here</h2>
        <p className="m-0 max-w-xs text-xs text-[color:var(--text-muted)]">
          Set up the areas you use and My Day fills itself. Nothing here is required.
        </p>
      </div>
      <section aria-labelledby="my-day-first-steps-label" className="grid min-w-0 gap-1.5">
        <QuietLabel id="my-day-first-steps-label" title="First steps" />
        <QuietList className={quietCard}>
          {FIRST_STEPS.map((step) => (
            <li key={step.href} className="min-w-0 p-0!">
              <Link
                href={withMyDayReturn(step.href)}
                className={`${focusRing} flex min-h-12 min-w-0 items-center gap-2.5 px-3 py-2 text-inherit no-underline`}
              >
                <AreaIcon icon={step.icon} mode={step.mode} />
                <span className="grid min-w-0 flex-1">
                  <span className="text-sm-minus font-bold break-words text-[color:var(--work-ink)]">{step.title}</span>
                  <span className="text-2xs break-words text-[color:var(--text-muted)]">{step.subtitle}</span>
                </span>
              </Link>
            </li>
          ))}
        </QuietList>
      </section>
    </div>
  );
}

/** Today's left column on a computer; the rest go on the right. */
const TODAY_LEFT: ReadonlySet<MyDayCardId> = new Set(["up-next", "flag", "needs-you"]);

const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeDesktop(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True at the computer width. The server and the first paint draw the phone layout. */
function useDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** The browser's own offline signal. The server always says online. */
function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}
