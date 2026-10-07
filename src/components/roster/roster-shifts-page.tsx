"use client";

import {
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileUp,
  Info,
  Plus,
  RefreshCw,
  Share2,
  Users,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeModuleSurface, modePressable } from "@/components/mode-kit/recipes";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import type { CalendarEvent } from "@/lib/calendar/calendar-event";
import { monthGridRange, monthKeyOf } from "@/lib/calendar/month-grid";
import { fortnightFor, summariseHours } from "@/lib/roster/hours";
import { restCuesByTeam } from "@/lib/roster/rest-cues";
import { SHIFT_KIND_LABEL, SHIFT_LETTER } from "@/lib/roster/shift-kind";
import {
  formatSpanUntil,
  formatSpanWords,
  leadShift,
  shiftSpan,
  weekCountWords,
  weekRows,
  type OverviewShift,
  type WeekRow,
} from "@/lib/roster/shifts-overview";
import { WA_PUBLIC_HOLIDAYS } from "@/lib/on-call/wa-public-holidays";
import type { RosterDisplayShift as OnCallShift } from "@/lib/roster/team/team-view";
import { addDaysToDate, formatPerthDay, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";

import { RosterAskButton } from "./ask/roster-ask-box";
import { RosterSignInNotice } from "./invite/roster-sign-in-notice";
import type { RosterAddView } from "./roster-add-sheet";
import { kindOf, useRosterNow } from "./roster-format";
import { RosterFortnight } from "./roster-fortnight";
import {
  RosterDateLead,
  RosterFootnote,
  RosterIconLead,
  RosterLinkWord,
  RosterList,
  RosterNote,
  RosterRow,
  RosterSectionHead,
  rosterFilledButton,
} from "./roster-list";
import { RosterNextShift } from "./roster-next-shift";
import { RosterRestChip } from "./roster-rest-chip";
import { RosterShareButton } from "./roster-share-button";
import { RosterSickEntryLink } from "./sick/roster-sick-entry";
import { RosterWhoCanCover } from "./roster-who-can-cover";
import { useRosterExtraTime } from "./use-roster-extra-time";
import { useRosterLinks } from "./use-roster-links";
import { useRosterSettings } from "./use-roster-settings";
import { useRosterShifts } from "./use-roster-shifts";
import { useRosterRead, useRosterTeamRules, useRosterTeams } from "./use-roster-team";
import { RosterPageHeader } from "./roster-ui";
import { useModeBandCurrentTab, useModeBandHeading } from "@/components/mode-band/mode-band";
import { NewWorkModeOnly } from "@/components/work-mode-launch/work-mode-launch-provider";
import { zonedDateOf } from "@/lib/work-time/format";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";

/**
 * Roster Shifts, as the Roster mock-up draws it: the shift on now or next, the
 * hours-and-rest row, Ask, the week as one row per day, this pay fortnight, and
 * the roster tools. Hours & rest (`?view=hours`) and the month calendar
 * (`?view=month`) open from here and link back. The signed rules and their
 * quotes download in their own chunk, after the page.
 *
 * Honest states: loading shows the page's shape; a failed load says nothing was
 * checked; part of a team roster missing makes every figure "at least"; a new
 * doctor with no shifts is offered an import.
 */

type View = "week" | "hours" | "month";

/** Mirrors PAST_SHIFT_DAYS in `GET /api/roster/shifts`: how far back the owner's own shifts are loaded. */
const LOADED_PAST_DAYS = 21;
/**
 * The furthest back a team rule can look from one shift: `maxDaysInRow` allows
 * up to 21 days (`rosterRulesSchema`), beyond `maxHours14d`'s 14.
 */
const TEAM_RULE_LOOKBACK_DAYS = 21;
/** The longest span "Share my shifts" offers, and the hours-and-rest window, counted from today. */
const ROSTER_AHEAD_DAYS = 14;

const SHIFTS_HREF = "/roster/shifts";
// Hours and rest and the Month tab live at /roster in the work-mode frame
// (work-mode redesign, owner request 6 Oct 2026), so the frame ticks them.
const HOURS_HREF = "/roster?view=hours";
const MONTH_HREF = "/roster";

/** If the checks fail to load, say they were not run rather than leaving a gap. */
function HoursRowUnavailable() {
  return (
    <RosterRow
      lead={<RosterIconLead icon={Clock} />}
      title="Hours and rest: not checked"
      sub="This part of the page didn't load. Reload to check."
      testId="roster-hours-not-checked"
    />
  );
}

const RosterHoursRow = dynamic(
  () => import("./roster-shifts-checks").then((module) => module.RosterHoursRow).catch(() => HoursRowUnavailable),
  {
    ssr: false,
    loading: () => <RosterRow lead={<RosterIconLead icon={Clock} />} title="Hours and rest" sub="Checking…" />,
  },
);
// Fails quietly: the hours row above, from the same file, then says nothing was checked.
const RosterAfterNightNote = dynamic(
  () => import("./roster-shifts-checks").then((module) => module.RosterAfterNightNote).catch(() => () => null),
  { ssr: false },
);

/*
 * The month calendar, Hours & rest, the import flow and the add sheet each show only on demand, so
 * they load apart from the week list. The two views keep server rendering, so a direct link to
 * `?view=month` or `?view=hours` draws the same first HTML; the flow and the sheet load in the browser.
 * All four are fetched quietly once the page is idle, so opening one never waits.
 */
const loadCalendarView = () => import("@/components/calendar/calendar-view");
const loadHoursPanel = () => import("./roster-hours-panel");
const loadImportFlow = () => import("./roster-import-flow");
const loadAddSheet = () => import("./roster-add-sheet");
const CalendarView = dynamic(() => loadCalendarView().then((m) => m.CalendarView));
const RosterHoursPanel = dynamic(() => loadHoursPanel().then((m) => m.RosterHoursPanel));
const RosterImportFlow = dynamic(() => loadImportFlow().then((m) => m.RosterImportFlow), { ssr: false });
const RosterAddSheet = dynamic(() => loadAddSheet().then((m) => m.RosterAddSheet), { ssr: false });

function preloadOnDemandParts(): () => void {
  const load = () => {
    for (const loader of [loadAddSheet, loadImportFlow, loadCalendarView, loadHoursPanel]) {
      void loader().catch(() => undefined);
    }
  };
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(load);
    return () => window.cancelIdleCallback(id);
  }
  const timer = window.setTimeout(load, 1500);
  return () => window.clearTimeout(timer);
}

function mondayOf(date: string): string {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDaysToDate(date, -weekday);
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

function hoursOf(shift: OnCallShift): number {
  return (Date.parse(shift.endsAt) - Date.parse(shift.startsAt)) / (60 * 60 * 1000);
}

/** Shifts as calendar events: the letter and kind as the title, no place. */
function toCalendarEvents(shifts: readonly OnCallShift[]): CalendarEvent[] {
  return shifts.map((shift) => {
    const kind = kindOf(shift);
    return {
      id: `roster-${shift.id}`,
      title: `${SHIFT_LETTER[kind]} · ${SHIFT_KIND_LABEL[kind]}`,
      date: perthDateOf(shift.startsAt),
      startTime: perthTimeOf(shift.startsAt),
      durationMinutes: Math.round(hoursOf(shift) * 60),
      kind: "other",
    };
  });
}

function toOverview(shift: OnCallShift): OverviewShift {
  return {
    id: shift.id,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    kind: kindOf(shift),
    place: shift.workplace ?? shift.location,
  };
}

function viewOf(value: string | null): View {
  return value === "hours" || value === "month" ? value : "week";
}

/** The "‹ Shifts" link a sub-view opens with. */
function BackToShifts() {
  return (
    <Link
      href={SHIFTS_HREF}
      data-mode-identity="roster"
      className={cn(
        focusRing,
        "-ml-1 inline-flex min-h-12 items-center gap-1 justify-self-start rounded-md px-1 text-sm font-semibold text-[color:var(--mode-identity)] no-underline",
      )}
    >
      <ChevronLeft aria-hidden="true" strokeWidth={1.6} className="size-icon-md" />
      Shifts
    </Link>
  );
}

/** One day of the week list. A team or hand-added repeating shift opens its actions. */
function DayRow({
  row,
  byId,
  cues,
  onTeamShift,
  onRemoveSeries,
}: {
  readonly row: WeekRow;
  readonly byId: ReadonlyMap<string, OnCallShift>;
  readonly cues: ReturnType<typeof useCues>;
  readonly onTeamShift: (shift: OnCallShift) => void;
  readonly onRemoveSeries: (series: { readonly id: string; readonly label: string }) => void;
}) {
  const lead = <RosterDateLead weekday={row.weekday} day={row.day} />;
  if (!row.shifts.length)
    return (
      <RosterRow
        lead={lead}
        title="Off"
        sub={row.offNote ?? undefined}
        dim
        label={`${formatPerthDay(row.date)}: off`}
        testId="roster-shifts-off"
      />
    );
  return (
    <>
      {row.shifts.map((item) => {
        const shift = byId.get(item.id)!;
        const kind = item.kind;
        const leave = kind === "leave";
        const title = leave ? shift.title || SHIFT_KIND_LABEL.leave : shiftSpan(item);
        const place = item.place;
        const warning = cues.get(item.id)?.warning;
        const sub = (
          <>
            {leave ? "All day" : kind === "on_call" ? ["On call from home", place].filter(Boolean).join(" · ") : place}
            {/* Only a crossed team rule earns a chip here; plain rest figures live in Hours & rest. */}
            <RosterRestChip cue={warning ? cues.get(item.id) : undefined} />
          </>
        );
        const name = `${formatPerthDay(row.date)}: ${SHIFT_KIND_LABEL[kind]}, ${leave ? "all day" : title}${place ? `, ${place}` : ""}${warning ? `. ${warning}` : ""}`;
        const common = {
          lead,
          title,
          sub,
          trail: leave ? undefined : SHIFT_KIND_LABEL[kind],
          testId: "roster-shifts-row",
        } as const;
        if (shift.source === "team" && shift.assignmentId)
          return (
            <RosterRow
              key={item.id}
              {...common}
              onClick={() => onTeamShift(shift)}
              label={`${name}. Swap, give away or find cover`}
            />
          );
        if (shift.source === "manual" && shift.seriesId)
          return (
            <RosterRow
              key={item.id}
              {...common}
              onClick={() =>
                onRemoveSeries({
                  id: shift.seriesId!,
                  label: `${SHIFT_KIND_LABEL[kind].toLowerCase()} on ${formatPerthDay(row.date)}`,
                })
              }
              label={`${name}. Remove it and its repeats`}
            />
          );
        return <RosterRow key={item.id} {...common} label={name} />;
      })}
    </>
  );
}

function useCues(shifts: readonly OnCallShift[], rulesByTeam: Parameters<typeof restCuesByTeam>[1]) {
  return useMemo(
    () => new Map(restCuesByTeam(shifts, rulesByTeam).map((cue) => [cue.shiftId, cue])),
    [shifts, rulesByTeam],
  );
}

/** Shown while the roster loads: the page's shape in grey, and one plain line. */
function ShiftsLoading() {
  return (
    <div className="grid gap-3" data-testid="roster-shifts-loading">
      <div className={cn(modeModuleSurface, "grid gap-3 p-4 shadow-none")} aria-hidden="true">
        <span className="h-3.5 w-2/5 rounded-full bg-[color:color-mix(in_oklab,var(--text-heading)_7%,var(--surface-raised))]" />
        <span className="h-3.5 w-4/5 rounded-full bg-[color:color-mix(in_oklab,var(--text-heading)_7%,var(--surface-raised))]" />
        <span className="h-3.5 w-2/5 rounded-full bg-[color:color-mix(in_oklab,var(--text-heading)_7%,var(--surface-raised))]" />
      </div>
      <p role="status" className="mx-1 text-xs text-[color:var(--text-muted)]">
        Loading your roster…
      </p>
      <ModeModuleSkeleton rows={5} twoLine />
    </div>
  );
}

export function RosterShiftsPage({ now: pinnedNow }: { readonly now?: Date } = {}) {
  const { zone } = useWorkTimeZone();
  const router = useRouter();
  const view = viewOf(useSearchParams()?.get("view") ?? null);
  const now = useRosterNow(pinnedNow);
  const today = zonedDateOf(now, zone);
  // On a Sunday the week that matters is the one starting tomorrow.
  const [monday, setMonday] = useState(() => mondayOf(addDaysToDate(zonedDateOf(now, zone), 1)));
  const [month, setMonth] = useState(() => monthKeyOf(today));
  const monthRange = monthGridRange(month);
  const shownRange =
    view === "month"
      ? { from: monthRange.start, to: monthRange.end }
      : view === "week"
        ? { from: monday, to: addDaysToDate(monday, 6) }
        : { from: addDaysToDate(today, -21), to: addDaysToDate(today, 40) };
  // Team shifts are read wider than the screen shows, so nothing on it is
  // judged from a partial roster: back far enough for the rest, run and
  // rolling-hours rule cues on the first shown day, and always through the
  // 14 days ahead that the share and the hours-and-rest check cover.
  const teamRange = {
    from: addDaysToDate(shownRange.from < today ? shownRange.from : today, -TEAM_RULE_LOOKBACK_DAYS),
    to: maxDate(shownRange.to, addDaysToDate(today, ROSTER_AHEAD_DAYS)),
  };
  const shifts = useRosterShifts(teamRange);
  const teams = useRosterTeams();
  const enabledTeams = (Array.isArray(teams.data?.teams) ? teams.data.teams : []).filter((team) => team.enabled);
  const oneTeamId = enabledTeams.length === 1 ? enabledTeams[0]!.serviceId : null;
  const teamOverview = useRosterRead(oneTeamId, "overview");
  const rulesByTeam = useRosterTeamRules(enabledTeams.map((team) => team.serviceId));
  const links = useRosterLinks();
  const settings = useRosterSettings();
  const [addView, setAddView] = useState<RosterAddView | null>(null);
  // Once opened, the add sheet stays mounted, so its open and close behave exactly as before.
  const [addMounted, setAddMounted] = useState(false);
  if (addView !== null && !addMounted) setAddMounted(true);
  const [importing, setImporting] = useState(false);
  useEffect(preloadOnDemandParts, []);
  const [notice, setNotice] = useState<{ tone: "neutral" | "warning"; text: string } | null>(null);
  const [teamShift, setTeamShift] = useState<OnCallShift | null>(null);
  const [confirmSeries, setConfirmSeries] = useState<{ readonly id: string; readonly label: string } | null>(null);
  const [removing, setRemoving] = useState(false);

  const payAnchor = teamOverview.status === "ready" ? (teamOverview.data?.settings?.payFortnightAnchor ?? null) : null;
  // Without a team pay date the fortnight is last week and this one, and on a
  // Sunday it moves on with the week list, which then opens on tomorrow's week.
  const weekStart = mondayOf(addDaysToDate(today, 1));
  const fortnight = fortnightFor(payAnchor || weekStart <= today ? today : weekStart, payAnchor);
  const extra = useRosterExtraTime(
    shifts.shifts,
    now,
    fortnight,
    shifts.status === "ready" && !shifts.sample && !shifts.demoMode,
  );
  const summary = useMemo(
    () =>
      summariseHours(
        shifts.shifts.map((shift) => ({ startsAt: shift.startsAt, endsAt: shift.endsAt, kind: kindOf(shift) })),
        extra.records,
        fortnight,
      ),
    // `fortnight` is rebuilt each render from its two dates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shifts.shifts, extra.records, fortnight.start, fortnight.end],
  );
  // On call from home is not rostered hours (isWorkedKind), so a fortnight of on-call
  // shifts reads 0 h. The fortnight then says so instead of looking empty.
  const onCallExcluded = shifts.shifts.some((shift) => {
    const date = perthDateOf(shift.startsAt);
    return kindOf(shift) === "on_call" && date >= summary.start && date <= summary.end;
  });
  const overview = useMemo(() => shifts.shifts.map(toOverview), [shifts.shifts]);
  const byId = useMemo(() => new Map(shifts.shifts.map((shift) => [shift.id, shift])), [shifts.shifts]);
  // Every day a leave entry covers; one ending at midnight does not reach the next day.
  const leaveDates = useMemo(() => {
    const dates = new Set<string>();
    for (const shift of overview) {
      if (shift.kind !== "leave") continue;
      const last = zonedDateOf(Date.parse(shift.endsAt) - 1, zone);
      for (let date = zonedDateOf(shift.startsAt, zone); date <= last; date = addDaysToDate(date, 1)) dates.add(date);
    }
    return dates;
  }, [overview, zone]);
  const cues = useCues(shifts.shifts, rulesByTeam);
  const events = useMemo(() => toCalendarEvents(shifts.shifts), [shifts.shifts]);
  const holidayEvents = useMemo<CalendarEvent[]>(
    () =>
      [...WA_PUBLIC_HOLIDAYS]
        .filter((date) => date.slice(0, 4) >= today.slice(0, 4))
        .map((date) => ({ id: `wa-holiday-${date}`, title: "WA public holiday", date, kind: "other" })),
    [today],
  );
  const workplaces = useMemo(
    () => [...new Set(shifts.shifts.flatMap((shift) => (shift.workplace ? [shift.workplace] : [])))],
    [shifts.shifts],
  );
  const canEdit = shifts.status === "ready" && !shifts.demoMode;
  const partial = Boolean(shifts.teamMessage);
  const lead = leadShift(overview, now);
  const leadDisplay = lead.state === "none" ? null : byId.get(lead.shift.id)!;
  const rows = weekRows(overview, monday);
  // The shifts API returns only the last LOADED_PAST_DAYS; a week wholly before that would falsely read as empty.
  const previousWeekLoaded = addDaysToDate(monday, -7) >= addDaysToDate(today, -LOADED_PAST_DAYS);
  const weekLabel =
    monday === mondayOf(today)
      ? "This week"
      : monday === addDaysToDate(mondayOf(today), 7)
        ? "Next week"
        : `Week of ${formatPerthDay(monday)}`;
  const datesHref = `/roster/requests?start=dates${oneTeamId ? `&team=${encodeURIComponent(oneTeamId)}` : ""}`;
  const teamParam = oneTeamId ? `&team=${encodeURIComponent(oneTeamId)}` : "";

  async function removeSeries(seriesId: string) {
    setRemoving(true);
    const failure = await shifts.removeSeries(seriesId);
    setRemoving(false);
    setConfirmSeries(null);
    setNotice(failure ? { tone: "warning", text: failure } : { tone: "neutral", text: "Removed" });
  }

  const title = view === "hours" ? "Hours & rest" : view === "month" ? "Month" : "Shifts";
  const subtitle =
    view === "hours"
      ? "The next 14 days against your agreement."
      : view === "month"
        ? "Your shifts and WA public holidays."
        : "Your shifts, week by week.";
  // The page names its own place in the frame (work-mode redesign, owner request 6 Oct 2026):
  // Hours and rest, or My shifts for the week and plain month lists. The address alone would
  // tick the Month tab whenever this page draws at /roster (?view=month, and before the query
  // is read), though the month grid is not what is showing.
  useModeBandCurrentTab(view === "hours" ? "hours" : "shifts");
  // The band's words (work-mode redesign, owner request 6 Oct 2026): the 14 days the check
  // covers, or the week on screen. The page title under the band stays for screen readers.
  useModeBandHeading(
    view === "hours"
      ? { eyebrow: `Next 14 days · ${formatSpanWords(today, addDaysToDate(today, 13))}`, title: "Hours and rest" }
      : view === "month"
        ? { title: "Month" }
        : { eyebrow: `Week of ${formatSpanWords(monday, addDaysToDate(monday, 6))}` },
  );

  function body() {
    if (shifts.status === "loading") return <ShiftsLoading />;
    if (shifts.status === "signed-out")
      return <RosterSignInNotice testId="roster-shifts-signed-out">Sign in to see your roster.</RosterSignInNotice>;
    if (shifts.status === "error")
      return (
        <div className="grid gap-3" data-testid="roster-shifts-error">
          <RosterNote icon={Info} role="alert">
            <p>
              <span className="font-semibold text-[color:var(--text-heading)]">Couldn&apos;t load your roster.</span>{" "}
              This is a connection problem. Nothing in your roster has been changed.
            </p>
          </RosterNote>
          <button
            type="button"
            className={rosterFilledButton}
            data-mode-identity="roster"
            onClick={() => void shifts.reload()}
          >
            <RefreshCw aria-hidden="true" strokeWidth={1.6} className="size-icon-md" />
            Try again
          </button>
          <RosterList>
            <RosterRow
              lead={<RosterIconLead icon={Clock} />}
              title="Hours and rest: not checked"
              sub="Your roster didn't load, so nothing could be checked"
              testId="roster-hours-not-checked"
            />
          </RosterList>
          {links.links.length ? (
            <RosterFootnote>A linked calendar may still show your shifts, as of its last update.</RosterFootnote>
          ) : null}
        </div>
      );

    const notices = (
      <>
        {shifts.demoMode ? <ModeNotice>Example only. Sign in to add your own shifts.</ModeNotice> : null}
        {notice ? <ModeNotice tone={notice.tone}>{notice.text}</ModeNotice> : null}
        {shifts.teamMessage ? <ModeNotice tone="warning">{shifts.teamMessage}</ModeNotice> : null}
      </>
    );

    if (view === "hours")
      return (
        <div className="grid min-w-0 gap-3">
          <BackToShifts />
          {notices}
          {shifts.teamLoading ? (
            <ModeModuleSkeleton rows={4} twoLine testId="roster-team-shifts-loading" />
          ) : (
            <RosterHoursPanel
              shifts={shifts.shifts}
              now={now}
              summary={summary}
              extra={extra}
              partial={partial}
              payAnchored={Boolean(payAnchor)}
              onCallExcluded={onCallExcluded}
              onRetry={() => void shifts.reload()}
            />
          )}
        </div>
      );

    if (view === "month")
      return (
        <div className="grid min-w-0 gap-3">
          <BackToShifts />
          {notices}
          {shifts.teamLoading ? <ModeModuleSkeleton rows={4} twoLine testId="roster-team-shifts-loading" /> : null}
          <div className={shifts.teamLoading ? "hidden" : undefined}>
            <CalendarView
              events={[...events, ...holidayEvents]}
              exportEvents={events}
              today={today}
              exportName="Roster"
              testId="roster-shifts-month"
              exampleArea="rost"
              onMonthChange={setMonth}
            />
          </div>
          <RosterFootnote>WA public holidays, wa.gov.au, read 25 Sep 2026</RosterFootnote>
        </div>
      );

    // Only once the team list has loaded: a failed team read is not "no team".
    const nothingYet =
      shifts.shifts.length === 0 && !shifts.teamLoading && teams.status === "ready" && enabledTeams.length === 0;
    if (nothingYet && !shifts.demoMode)
      return (
        <div className="grid min-w-0 gap-3" data-testid="roster-shifts-empty">
          {notices}
          <div className="grid justify-items-center gap-1.5 px-4 pb-2 pt-6 text-center">
            <CalendarDays aria-hidden="true" strokeWidth={1.6} className="size-10 text-[color:var(--text-muted)]" />
            <h2 className="text-lg-minus font-semibold text-[color:var(--text-heading)]">No shifts yet</h2>
            <p className="max-w-72 text-sm text-[color:var(--text-muted)]">
              Add your roster once and PsychSift shows your next shift, your week and your hours.
            </p>
          </div>
          <button
            type="button"
            className={rosterFilledButton}
            data-mode-identity="roster"
            disabled={!canEdit}
            onClick={() => setImporting(true)}
          >
            <FileUp aria-hidden="true" strokeWidth={1.6} className="size-icon-md" />
            Import a roster file
          </button>
          <RosterList>
            <RosterRow
              onClick={() => setAddView("menu")}
              lead={<RosterIconLead icon={Plus} />}
              title="Add a shift"
              sub="Type in one shift at a time"
            />
            <RosterRow
              href="/roster/join"
              lead={<RosterIconLead icon={Users} />}
              title="Join a team"
              sub="Paste an invite link or code"
            />
          </RosterList>
        </div>
      );

    return (
      <div className="grid min-w-0 gap-3">
        {notices}
        {shifts.teamLoading ? (
          <ModeModuleSkeleton rows={4} twoLine testId="roster-team-shifts-loading" />
        ) : (
          <>
            {leadDisplay ? (
              <RosterNextShift
                shift={leadDisplay}
                onNow={lead.state === "on_now"}
                now={now}
                actorId={teams.data?.actorId ?? null}
              />
            ) : (
              <RosterNote icon={CalendarClock}>
                <p>
                  {partial
                    ? "No more shifts in the part of your roster that loaded."
                    : "No more shifts in your roster."}
                </p>
              </RosterNote>
            )}

            {lead.state === "on_now" ? (
              <>
                <RosterSectionHead title="After this shift" />
                <RosterList testId="roster-after-shift">
                  {weekRows(overview, addDaysToDate(perthDateOf(lead.shift.startsAt), 1))
                    .slice(0, 2)
                    .map((row) => (
                      <DayRow
                        key={row.date}
                        row={row}
                        byId={byId}
                        cues={cues}
                        onTeamShift={setTeamShift}
                        onRemoveSeries={setConfirmSeries}
                      />
                    ))}
                </RosterList>
                <RosterAfterNightNote shifts={shifts.shifts} shift={leadDisplay!} now={now} partial={partial} />
              </>
            ) : null}

            <RosterList testId="roster-shifts-checks">
              <RosterHoursRow shifts={shifts.shifts} now={now} partial={partial} href={HOURS_HREF} />
              {extra.canAdd || extra.saving ? (
                <RosterRow
                  lead={<RosterIconLead icon={Clock} />}
                  title="Stayed late?"
                  sub={
                    extra.finished
                      ? `${perthTimeOf(extra.finished.endsAt)} to now, ${formatSpanUntil(now.getTime() - Date.parse(extra.finished.endsAt))}`
                      : "Add the extra time while you remember"
                  }
                  action={
                    <RosterLinkWord
                      onClick={() => void extra.stayedLate()}
                      label="Add the time since your last shift ended"
                      disabled={extra.saving}
                      testId="roster-stayed-late"
                    >
                      {extra.saving ? "Saving…" : "Add"}
                    </RosterLinkWord>
                  }
                />
              ) : null}
            </RosterList>
            {extra.message ? (
              <p role="status" className="mx-1 text-sm text-[color:var(--text)]">
                {extra.message.text}
              </p>
            ) : null}

            <RosterAskButton variant="field" />
            {oneTeamId ? (
              <nav
                aria-label="Change a shift"
                className="-mt-1 grid grid-cols-3 overflow-hidden rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)]"
              >
                {(
                  [
                    ["Can't make", `/roster/requests?start=cant_make${teamParam}`],
                    ["Give away", `/roster/requests?start=give_away${teamParam}`],
                    ["Prefer off", `${datesHref}&kind=prefer_off`],
                  ] as const
                ).map(([label, href], index) => (
                  <Link
                    key={label}
                    href={href}
                    className={cn(
                      focusRing,
                      modePressable,
                      "grid min-h-12 place-items-center px-1 text-center text-sm font-medium text-[color:var(--text-heading)] no-underline",
                      index > 0 && "border-l border-[color:var(--border)]",
                    )}
                  >
                    {label}
                  </Link>
                ))}
              </nav>
            ) : null}
            {enabledTeams.length ? (
              <NewWorkModeOnly>
                <RosterSickEntryLink />
              </NewWorkModeOnly>
            ) : null}

            <section aria-labelledby="roster-week-heading" className="grid gap-3" data-testid="roster-shifts-week">
              <div className="mt-1 flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Previous week"
                  // aria-disabled keeps focus on the button when the earliest loaded week is reached.
                  aria-disabled={!previousWeekLoaded}
                  onClick={() => {
                    if (previousWeekLoaded) setMonday(addDaysToDate(monday, -7));
                  }}
                  className={cn(
                    focusRing,
                    "grid size-12 shrink-0 place-items-center rounded-md text-[color:var(--text-muted)] aria-disabled:text-[color:var(--disabled)]",
                  )}
                >
                  <ChevronLeft aria-hidden="true" strokeWidth={1.6} className="size-icon-md" />
                </button>
                <h2 id="roster-week-heading" className="grid flex-1 text-center">
                  <span className="text-lg-minus font-semibold text-[color:var(--text-heading)]">{weekLabel}</span>
                  <span className="nums text-xs text-[color:var(--text-muted)]">
                    {formatSpanWords(monday, addDaysToDate(monday, 6))}
                    {shifts.teamRefreshing ? null : ` · ${weekCountWords(rows)}${partial ? ", part loaded" : ""}`}
                  </span>
                </h2>
                <button
                  type="button"
                  aria-label="Next week"
                  onClick={() => setMonday(addDaysToDate(monday, 7))}
                  className={cn(
                    focusRing,
                    "grid size-12 shrink-0 place-items-center rounded-md text-[color:var(--text-muted)]",
                  )}
                >
                  <ChevronRight aria-hidden="true" strokeWidth={1.6} className="size-icon-md" />
                </button>
              </div>
              {shifts.teamRefreshing ? (
                <ModeModuleSkeleton rows={7} testId="roster-shifts-agenda-loading" />
              ) : (
                <RosterList
                  testId="roster-shifts-agenda"
                  label={`Shifts, ${weekLabel.replace(/^\w+ week/, (words) => words.toLowerCase())}`}
                >
                  {rows.map((row) => (
                    <DayRow
                      key={row.date}
                      row={row}
                      byId={byId}
                      cues={cues}
                      onTeamShift={setTeamShift}
                      onRemoveSeries={setConfirmSeries}
                    />
                  ))}
                </RosterList>
              )}
            </section>

            <RosterFortnight
              summary={summary}
              today={today}
              leaveDates={leaveDates}
              extraHours={summary.extraHours}
              extraStatus={extra.status}
              partial={partial}
              payAnchored={Boolean(payAnchor)}
              onCallExcluded={onCallExcluded}
            />

            <RosterSectionHead title="Roster tools" />
            <RosterList testId="roster-tools">
              {canEdit ? (
                <>
                  <RosterRow
                    onClick={() => setAddView("menu")}
                    lead={<RosterIconLead icon={Plus} />}
                    title="Add a shift"
                    sub="Or a day you're on call, or a calendar link"
                    testId="roster-tools-add"
                  />
                  <RosterRow
                    onClick={() => setImporting(true)}
                    lead={<RosterIconLead icon={FileUp} />}
                    title="Import a roster file"
                    sub="PDF, Excel, CSV or calendar file"
                    testId="roster-tools-import"
                  />
                </>
              ) : null}
              <RosterShareButton
                shifts={shifts.shifts}
                now={now}
                trigger={(open) => (
                  <RosterRow
                    onClick={open}
                    lead={<RosterIconLead icon={Share2} />}
                    title="Share my shifts"
                    sub="Next 7 or 14 days"
                    testId="roster-share"
                  />
                )}
              />
              <RosterRow
                href={MONTH_HREF}
                lead={<RosterIconLead icon={CalendarDays} />}
                title="Month"
                sub="Your shifts and WA public holidays"
                testId="roster-tools-month"
              />
            </RosterList>
            <RosterFootnote>Rostered hours, not pay.</RosterFootnote>
          </>
        )}
      </div>
    );
  }

  return (
    <InformationPageShell testId="roster-shifts-main" width="narrow">
      <RosterPageHeader icon={CalendarClock} title={title} subtitle={subtitle} ask={false} />
      {importing ? (
        <RosterImportFlow
          shifts={shifts}
          settings={settings}
          today={today}
          onClose={() => setImporting(false)}
          onSaved={() => {
            setImporting(false);
            setNotice({ tone: "neutral", text: "Saved" });
          }}
        />
      ) : (
        <div className="grid min-w-0 gap-3 pb-20">{body()}</div>
      )}

      <ConfirmDialog
        open={confirmSeries !== null}
        onCancel={() => setConfirmSeries(null)}
        onConfirm={() => {
          if (confirmSeries) void removeSeries(confirmSeries.id);
        }}
        title="Remove repeating shift?"
        description={
          confirmSeries
            ? `This removes your ${confirmSeries.label} and every weekly repeat of it from your roster. Shifts from imports and your team are not changed.`
            : ""
        }
        confirmLabel="Remove shift and repeats"
        busy={removing}
        busyLabel="Removing…"
      />

      <Sheet
        open={Boolean(teamShift)}
        onClose={() => setTeamShift(null)}
        title="Team shift"
        mobilePlacement="bottom"
        testId="roster-team-shift-actions"
      >
        {teamShift?.assignmentId ? (
          <ModeGroupedList
            eyebrow={`${formatPerthDay(perthDateOf(teamShift.startsAt))} · ${SHIFT_KIND_LABEL[kindOf(teamShift)]}`}
          >
            {(
              [
                ["swap", "Swap"],
                ["give_away", "Give away"],
                ["cant_make", "I can't make it"],
              ] as const
            ).map(([start, label]) => (
              <ModeRow
                key={start}
                title={label}
                href={`/roster/requests?start=${start}&assignment=${encodeURIComponent(teamShift.assignmentId!)}${teamShift.serviceId ? `&team=${encodeURIComponent(teamShift.serviceId)}` : ""}`}
              />
            ))}
            {teamShift.serviceId && teams.data?.actorId ? (
              <RosterWhoCanCover
                serviceId={teamShift.serviceId}
                assignmentId={teamShift.assignmentId}
                actorId={teams.data.actorId}
                startsAt={teamShift.startsAt}
              />
            ) : null}
          </ModeGroupedList>
        ) : null}
      </Sheet>

      {addMounted ? (
        <RosterAddSheet
          open={addView !== null}
          view={addView ?? "menu"}
          onViewChange={setAddView}
          onClose={() => setAddView(null)}
          today={today}
          workplaces={workplaces}
          hasTeam={enabledTeams.length > 0}
          onDates={() => {
            setAddView(null);
            router.push(datesHref);
          }}
          onImportFile={() => {
            setAddView(null);
            setImporting(true);
          }}
          onAddShift={async (request) => {
            const failure = await shifts.addManual(request);
            if (!failure) {
              setAddView(null);
              setNotice({ tone: "neutral", text: "Saved" });
            }
            return failure;
          }}
          onAddLink={async (url, workplace) => {
            const failure = await links.add(url, workplace);
            if (!failure) {
              void shifts.reload();
              setAddView(null);
              setNotice({ tone: "neutral", text: "Saved" });
            }
            return failure;
          }}
        />
      ) : null}
    </InformationPageShell>
  );
}
