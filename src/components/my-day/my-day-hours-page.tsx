"use client";

import { ModeFactTile, ModeFactTiles } from "@/components/mode-kit/fact-tile";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { MyDayFrame } from "@/components/my-day/my-day-frame";
import { formatDateSpan, formatHours, kindOf } from "@/components/roster/roster-format";
import { useRosterShifts } from "@/components/roster/use-roster-shifts";
import { useRosterRead, useRosterTeams } from "@/components/roster/use-roster-team";
import { Button } from "@/components/ui/button";
import { fortnightFor, summariseHours } from "@/lib/roster/hours";
import { addDaysToDate, perthDateOf } from "@/lib/roster/shifts/perth-time";
import { summariseToday } from "@/lib/roster/today";

/**
 * My Day, Hours: the reader's rostered hours this week and this fortnight, and
 * the next leave. Every figure comes from the same Roster helpers the Roster
 * pages use (`summariseHours`, `fortnightFor`, `summariseToday`), so the numbers
 * match Roster's own Hours. Rostered hours, not pay; no limit or award rule is
 * applied here. Read-only and stored nowhere.
 */
export function MyDayHoursPage({ now }: { now?: Date } = {}) {
  return (
    <MyDayFrame title="Hours" testId="my-day-hours" now={now} subtitle={() => "Your rostered hours, not pay"}>
      {(at) => <MyDayHoursBody now={at} />}
    </MyDayFrame>
  );
}

function MyDayHoursBody({ now }: { now: Date }) {
  const shifts = useRosterShifts();
  const teams = useRosterTeams();
  const enabledTeams = (Array.isArray(teams.data?.teams) ? teams.data.teams : []).filter((team) => team.enabled);
  const oneTeamId = enabledTeams.length === 1 ? enabledTeams[0]!.serviceId : null;
  const overview = useRosterRead(oneTeamId, "overview");
  const anchor = overview.status === "ready" ? (overview.data?.settings?.payFortnightAnchor ?? null) : null;

  const today = perthDateOf(now);
  const loading = shifts.status === "loading" || shifts.teamLoading;
  const usable = shifts.status === "ready" && (!shifts.sample || shifts.demoMode);

  if (loading) {
    return (
      <>
        <span role="status" className="sr-only">
          Loading your hours
        </span>
        <div className="grid gap-5" data-testid="my-day-hours-loading" aria-hidden="true">
          <ModeModuleSkeleton rows={2} twoLine eyebrow />
        </div>
      </>
    );
  }

  const link = (
    <ModeGroupedList testId="my-day-hours-links">
      <ModeRow title="Open Shifts" subtitle="Roster" href="/roster/shifts" testId="my-day-hours-shifts-link" />
    </ModeGroupedList>
  );

  if (shifts.status === "error" || shifts.status === "signed-out") {
    return (
      <div className="grid gap-5" data-testid="my-day-hours-failed">
        <div className="grid gap-2">
          <ModeNotice tone="warning">Couldn&apos;t load your roster. Try again.</ModeNotice>
          <div>
            <Button variant="secondary" onClick={() => void shifts.reload()}>
              Retry
            </Button>
          </div>
        </div>
        {link}
      </div>
    );
  }

  if (!usable) {
    return (
      <div className="grid gap-5" data-testid="my-day-hours-sample">
        <ModeNotice>Roster is showing example shifts only, so no hours are shown for you.</ModeNotice>
        {link}
      </div>
    );
  }

  if (shifts.shifts.length === 0) {
    return (
      <div className="grid gap-5" data-testid="my-day-hours-empty">
        <ModeNotice>No shifts in your roster yet. Add them in Shifts and your hours appear here.</ModeNotice>
        {link}
      </div>
    );
  }

  const hoursShifts = shifts.shifts.map((shift) => ({
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    kind: kindOf(shift),
  }));
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addDaysToDate(today, -weekday);
  const week = summariseHours(hoursShifts, [], { start: monday, end: addDaysToDate(monday, 6) });
  const fortnight = summariseHours(hoursShifts, [], fortnightFor(today, anchor));
  const leave = summariseToday(
    shifts.shifts.map((shift) => ({
      id: shift.id,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      kind: kindOf(shift),
    })),
    now,
  ).nextLeave;

  return (
    <div className="grid gap-5" data-testid="my-day-hours-ready">
      {shifts.demoMode ? (
        <ModeNotice testId="my-day-hours-demo-notice">Demo data: these shifts are invented examples.</ModeNotice>
      ) : null}
      <ModeFactTiles testId="my-day-hours-facts">
        <ModeFactTile
          label={`This week · ${formatDateSpan(week.start, week.end)}`}
          value={formatHours(week.totalHours)}
          size="large"
          testId="my-day-hours-week"
        />
        <ModeFactTile
          label={`This fortnight · ${formatDateSpan(fortnight.start, fortnight.end)}`}
          value={formatHours(fortnight.totalHours)}
          size="large"
          testId="my-day-hours-fortnight"
        />
        <ModeFactTile
          label="Next leave"
          value={leave ? formatDateSpan(leave.start, leave.end) : "None booked"}
          testId="my-day-hours-leave"
        />
      </ModeFactTiles>
      <p className="px-3 text-sm text-[color:var(--text-muted)]" data-testid="my-day-hours-footer">
        Worked shifts only. On call from home and leave are not counted. Rostered hours, not pay.
      </p>
      {link}
    </div>
  );
}
