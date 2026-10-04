"use client";

import {
  ArrowLeftRight,
  CalendarClock,
  CalendarOff,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileUp,
  Link2,
  Plane,
  Plus,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { CalendarView } from "@/components/calendar/calendar-view";
import { InformationPageShell } from "@/components/information-page-shell";
import { focusRing } from "@/components/card-recipes";
import { ModeActionButton } from "@/components/mode-kit/action-button";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeInsetHairline, modeModuleSurface, modePressable, modeRowHeight } from "@/components/mode-kit/recipes";
import { modeNumberText } from "@/components/mode-kit/type";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui-primitives";
import type { CalendarEvent } from "@/lib/calendar/calendar-event";
import { monthGridRange, monthKeyOf } from "@/lib/calendar/month-grid";
import { isWorkedKind, SHIFT_KIND_LABEL, SHIFT_LETTER } from "@/lib/roster/shift-kind";
import { WA_PUBLIC_HOLIDAYS } from "@/lib/on-call/wa-public-holidays";
import type { RosterDisplayShift as OnCallShift } from "@/lib/roster/team/team-view";
import { addDaysToDate, formatPerthDay, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";

import { RosterSignInNotice } from "./invite/roster-sign-in-notice";
import { RosterAddSheet, type RosterAddView } from "./roster-add-sheet";
import { RosterNewButton } from "./roster-new-button";
import { RosterRestChip } from "./roster-rest-chip";
import { RosterWhoCanCover } from "./roster-who-can-cover";
import { RosterShareButton } from "./roster-share-button";
import { restCuesByTeam, type RestCue } from "@/lib/roster/rest-cues";
import { formatDateSpan, formatHours, formatShiftRange, kindOf, useRosterNow } from "./roster-format";
import { RosterHoursPanel, type RosterExtraTime } from "./roster-hours-panel";
import { RosterImportFlow } from "./roster-import-flow";
import { RosterLetter, RosterWeekChart } from "./roster-week-strip";
import { RosterSampleShiftsNotice } from "./team/roster-sample-notice";
import { useRosterLinks } from "./use-roster-links";
import { useRosterSettings } from "./use-roster-settings";
import { useRosterShifts } from "./use-roster-shifts";
import { useRosterRead, useRosterTeams, useRosterTeamRules } from "./use-roster-team";
import { RosterPageHeader } from "./roster-ui";

/**
 * Roster Shifts: Week (a 24-hour chart and every shift in words), Month
 * (the shared calendar), Hours (the fortnight). "+ Add" opens one sheet with
 * three ways in. A night belongs to the day it starts and ends "+1".
 */

type View = "week" | "month" | "hours";

/** Mirrors PAST_SHIFT_DAYS in `GET /api/roster/shifts`: how far back the owner's own shifts are loaded. */
const LOADED_PAST_DAYS = 21;

const VIEWS = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "hours", label: "Hours" },
] as const;

function mondayOf(date: string): string {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDaysToDate(date, -weekday);
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

function WeekView({
  shifts,
  now,
  monday,
  onWeekChange,
  onRemoveSeries,
  onTeamShift,
  cues,
}: {
  readonly cues: ReadonlyMap<string, RestCue>;
  readonly shifts: readonly OnCallShift[];
  readonly now: Date;
  readonly monday: string;
  readonly onWeekChange: (monday: string) => void;
  readonly onRemoveSeries: (series: { readonly id: string; readonly label: string }) => void;
  readonly onTeamShift: (shift: OnCallShift) => void;
}) {
  const sunday = addDaysToDate(monday, 6);
  // The shifts API returns only the last LOADED_PAST_DAYS; a week wholly before that would falsely read as empty.
  const previousWeekLoaded = addDaysToDate(monday, -1) >= addDaysToDate(perthDateOf(now), -LOADED_PAST_DAYS);
  const inWeek = shifts
    .filter((shift) => {
      const date = perthDateOf(shift.startsAt);
      return date >= monday && date <= sunday;
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const total = inWeek.filter((shift) => isWorkedKind(kindOf(shift))).reduce((sum, shift) => sum + hoursOf(shift), 0);

  return (
    <div className="grid min-w-0 gap-4" data-testid="roster-shifts-week">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <ModeActionButton
          icon={ChevronLeft}
          label="Previous week"
          disabled={!previousWeekLoaded}
          onClick={() => onWeekChange(addDaysToDate(monday, -7))}
        />
        <h2 className={cn(modeNumberText, "text-base-minus text-[color:var(--text-heading)]")}>
          {formatDateSpan(monday, sunday)} · {formatHours(Math.round(total * 100) / 100)}
        </h2>
        <ModeActionButton
          icon={ChevronRight}
          label="Next week"
          onClick={() => onWeekChange(addDaysToDate(monday, 7))}
        />
      </div>
      <div className={cn(modeModuleSurface, "p-3")}>
        <RosterWeekChart monday={monday} shifts={shifts} now={now} testId="roster-shifts-week-chart" />
      </div>
      <ModeGroupedList testId="roster-shifts-agenda">
        {inWeek.length === 0 ? (
          <ModeRow title="No shifts this week" />
        ) : (
          inWeek.map((shift) => {
            const kind = kindOf(shift);
            const place = shift.workplace ?? shift.location;
            if (shift.source === "team" && shift.assignmentId)
              return (
                <li key={shift.id} className={modeInsetHairline}>
                  <button
                    type="button"
                    onClick={() => onTeamShift(shift)}
                    data-testid="roster-shifts-row"
                    className={cn(
                      modeRowHeight.double,
                      modePressable,
                      focusRing,
                      "flex w-full min-w-0 items-center justify-between gap-3 px-3 text-left",
                    )}
                  >
                    <span className="grid min-w-0 gap-0.5 py-1">
                      <span className="flex items-center gap-2 text-base-minus text-[color:var(--text-heading)]">
                        <RosterLetter kind={kind} />
                        {formatPerthDay(perthDateOf(shift.startsAt))}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[color:var(--text-muted)]">
                        <span>
                          {SHIFT_KIND_LABEL[kind]}
                          {place ? ` · ${place}` : ""}
                        </span>
                        <RosterRestChip cue={cues.get(shift.id)} />
                      </span>
                    </span>
                    <span
                      className={cn(
                        modeNumberText,
                        "shrink-0 whitespace-nowrap text-base-minus text-[color:var(--text)]",
                      )}
                    >
                      {formatShiftRange(shift)}
                    </span>
                  </button>
                </li>
              );
            return (
              <ModeRow
                key={shift.id}
                testId="roster-shifts-row"
                title={
                  <span className="flex min-w-0 items-center gap-2">
                    <RosterLetter kind={kind} />
                    {formatPerthDay(perthDateOf(shift.startsAt))}
                  </span>
                }
                subtitle={
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>{`${SHIFT_KIND_LABEL[kind]}${place ? ` · ${place}` : ""}`}</span>
                    <RosterRestChip cue={cues.get(shift.id)} />
                  </span>
                }
                trailing={
                  <>
                    <span
                      className={cn(
                        modeNumberText,
                        "whitespace-nowrap text-base-minus text-[color:var(--text)]",
                        // Room before the card edge when no remove control follows the time.
                        !(shift.source === "manual" && shift.seriesId) && "pr-2",
                      )}
                    >
                      {formatShiftRange(shift)}
                    </span>
                    {shift.source === "manual" && shift.seriesId ? (
                      <ModeActionButton
                        icon={Trash2}
                        label={`Remove ${SHIFT_KIND_LABEL[kind]} on ${formatPerthDay(perthDateOf(shift.startsAt))} and its repeats`}
                        onClick={() =>
                          onRemoveSeries({
                            id: shift.seriesId!,
                            label: `${SHIFT_KIND_LABEL[kind].toLowerCase()} on ${formatPerthDay(perthDateOf(shift.startsAt))}`,
                          })
                        }
                      />
                    ) : null}
                  </>
                }
              />
            );
          })
        )}
      </ModeGroupedList>
      <div className="justify-self-start">
        <RosterShareButton shifts={shifts} now={now} />
      </div>
    </div>
  );
}

/**
 * The furthest back a team rule can look from one shift: `maxDaysInRow` allows
 * up to 21 days (`rosterRulesSchema`), beyond `maxHours14d`'s 14.
 */
const TEAM_RULE_LOOKBACK_DAYS = 21;
/** The longest span "Share my shifts" offers, counted from today. */
const ROSTER_SHARE_MAX_DAYS = 14;

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

export function RosterShiftsPage({ now: pinnedNow }: { readonly now?: Date } = {}) {
  const router = useRouter();
  const now = useRosterNow(pinnedNow);
  const today = perthDateOf(now);
  const [view, setView] = useState<View>("week");
  const [monday, setMonday] = useState(() => mondayOf(today));
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
  // rolling-hours rule cues on the first shown day, and always through the 14-day
  // share window from today, which would otherwise copy a missing team shift
  // as "Off".
  const teamRange = {
    from: addDaysToDate(shownRange.from < today ? shownRange.from : today, -TEAM_RULE_LOOKBACK_DAYS),
    to: maxDate(shownRange.to, addDaysToDate(today, ROSTER_SHARE_MAX_DAYS)),
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
  const [importing, setImporting] = useState(false);
  const [extras, setExtras] = useState<readonly RosterExtraTime[]>([]);
  const [notice, setNotice] = useState<{ tone: "neutral" | "warning"; text: string } | null>(null);
  const [teamShift, setTeamShift] = useState<OnCallShift | null>(null);
  const [confirmSeries, setConfirmSeries] = useState<{ readonly id: string; readonly label: string } | null>(null);
  const [removing, setRemoving] = useState(false);

  const events = useMemo(() => toCalendarEvents(shifts.shifts), [shifts.shifts]);
  const cues = useMemo(
    () => new Map(restCuesByTeam(shifts.shifts, rulesByTeam).map((cue) => [cue.shiftId, cue])),
    [shifts.shifts, rulesByTeam],
  );
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

  async function removeSeries(seriesId: string) {
    setRemoving(true);
    const failure = await shifts.removeSeries(seriesId);
    setRemoving(false);
    setConfirmSeries(null);
    setNotice(failure ? { tone: "warning", text: failure } : { tone: "neutral", text: "Removed" });
  }

  return (
    <InformationPageShell testId="roster-shifts-main" width="narrow">
      <RosterPageHeader
        icon={CalendarClock}
        title="Shifts"
        subtitle="Your shifts, week by week."
        actions={
          !importing && canEdit ? (
            <RosterNewButton
              entries={[
                { id: "shift", label: "Add a shift", icon: Plus, onSelect: () => setAddView("shift") },
                {
                  id: "import",
                  label: "Import a file",
                  description: "PDF, Excel, CSV or calendar file",
                  icon: FileUp,
                  onSelect: () => setImporting(true),
                },
                { id: "link", label: "Add a calendar link", icon: Link2, onSelect: () => setAddView("link") },
                ...(enabledTeams.length > 0
                  ? [
                      {
                        id: "swap",
                        label: "Swap or give away",
                        description: "Pick the shift on the Team calendar",
                        icon: ArrowLeftRight,
                        href: "/roster/team?view=week",
                      } as const,
                    ]
                  : []),
                { id: "leave", label: "Plan leave", icon: Plane, href: "/roster/requests?start=leave" },
                {
                  id: "dates",
                  label: "Dates I can't work",
                  icon: CalendarOff,
                  href: `/roster/requests?start=dates${oneTeamId ? `&team=${encodeURIComponent(oneTeamId)}` : ""}`,
                },
                {
                  id: "late",
                  label: "Stayed late",
                  description: "Record extra time in Hours",
                  icon: Clock,
                  onSelect: () => setView("hours"),
                },
              ]}
            />
          ) : null
        }
      />
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
        <div className="grid min-w-0 gap-5 pb-20">
          {/* The roster identity scope recolours the selected segment violet (globals.css remaps the accent). */}
          <div data-mode-identity="roster" className="min-w-0">
            <SegmentedControl label="View" value={view} onChange={setView} options={VIEWS} layout="equal" />
          </div>

          {shifts.status === "loading" ? (
            <ModeModuleSkeleton rows={5} twoLine testId="roster-shifts-loading" />
          ) : shifts.status === "signed-out" ? (
            <RosterSignInNotice testId="roster-shifts-signed-out">Sign in to see your roster.</RosterSignInNotice>
          ) : shifts.status === "error" ? (
            <div className="grid gap-2" data-testid="roster-shifts-error">
              <ModeNotice tone="warning">Your shifts could not be loaded.</ModeNotice>
              <Button className="justify-self-start" onClick={() => void shifts.reload()}>
                Try again
              </Button>
            </div>
          ) : (
            <>
              {shifts.demoMode ? <ModeNotice>Example only. Sign in to add your own shifts.</ModeNotice> : null}
              <RosterSampleShiftsNotice sample={shifts.sample} />
              {notice ? <ModeNotice tone={notice.tone}>{notice.text}</ModeNotice> : null}
              {shifts.teamMessage ? <ModeNotice tone="warning">{shifts.teamMessage}</ModeNotice> : null}
              {view === "week" ? (
                shifts.teamLoading ? (
                  <ModeModuleSkeleton rows={4} twoLine testId="roster-team-shifts-loading" />
                ) : (
                  <WeekView
                    shifts={shifts.shifts}
                    now={now}
                    monday={monday}
                    onWeekChange={setMonday}
                    onRemoveSeries={setConfirmSeries}
                    onTeamShift={setTeamShift}
                    cues={cues}
                  />
                )
              ) : view === "month" ? (
                <div className="grid gap-2">
                  {shifts.teamLoading ? (
                    <ModeModuleSkeleton rows={4} twoLine testId="roster-team-shifts-loading" />
                  ) : null}
                  <div className={shifts.teamLoading ? "hidden" : undefined}>
                    <CalendarView
                      events={[...events, ...holidayEvents]}
                      exportEvents={events}
                      today={today}
                      exportName="Roster"
                      testId="roster-shifts-month"
                      onMonthChange={setMonth}
                    />
                  </div>
                  <p className="px-3 text-xs text-[color:var(--text-muted)]">
                    WA public holidays, wa.gov.au, read 25 Sep 2026
                  </p>
                </div>
              ) : (
                <RosterHoursPanel
                  shifts={shifts.shifts}
                  now={now}
                  extras={extras}
                  onExtra={(extra) => setExtras((current) => [...current, extra])}
                  payFortnightAnchor={
                    teamOverview.status === "ready" ? (teamOverview.data?.settings?.payFortnightAnchor ?? null) : null
                  }
                />
              )}
            </>
          )}
        </div>
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
            ).map(([start, title]) => (
              <ModeRow
                key={start}
                title={title}
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
          router.push(`/roster/requests?start=dates${oneTeamId ? `&team=${encodeURIComponent(oneTeamId)}` : ""}`);
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
    </InformationPageShell>
  );
}
