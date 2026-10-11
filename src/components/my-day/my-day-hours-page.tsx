"use client";

import { CalendarDays, ChevronRight, Clock, Info, Moon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { MyDayFrame } from "@/components/my-day/my-day-frame";
import {
  AreaIcon,
  QuietFoot,
  QuietLabel,
  QuietList,
  QuietRow,
  QuietTextLink,
  quietCard,
} from "@/components/my-day/my-day-quiet";
import { hoursText, MyDaySegmented, ShiftLegend } from "@/components/my-day/my-day-today-cards";
import { HoursChart, weekdayLetters } from "@/components/my-day/my-day-work-me-cards";
import { cn } from "@/components/ui-primitives";
import { kindOf } from "@/components/roster/roster-format";
import { useRosterShifts, type MyShift } from "@/components/roster/use-roster-shifts";
import { useRosterRead, useRosterTeams } from "@/components/roster/use-roster-team";
import { Button } from "@/components/ui/button";
import { hoursBars, kindsByDate } from "@/lib/my-day/figures";
import { shortMonth } from "@/lib/my-day/quiet-figures";
import { isWorkedKind, type ShiftKind } from "@/lib/roster/shift-kind";
import { perthDateOf } from "@/lib/roster/shifts/perth-time";
import { summariseToday } from "@/lib/roster/today";
import { zonedDateOf } from "@/lib/work-time/format";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";

/** The signed-out sample, downloaded only when a signed-out visitor opens this page. */
const MyDayHoursSample = dynamic(
  () => import("@/components/my-day/my-day-sample-subpages").then((module) => module.MyDaySubpageSampleView),
  { ssr: false },
);

/**
 * My Day, Hours: the reader's rostered hours this week and this fortnight, and
 * the next leave. Every figure comes from the same Roster helpers the Roster
 * pages use (`summariseHours`, `fortnightFor`, `summariseToday`), so the numbers
 * match Roster's own Hours. Rostered hours, not pay; no limit or award rule is
 * applied here. Read-only and stored nowhere.
 */
export function MyDayHoursPage({ now }: { now?: Date } = {}) {
  return (
    <MyDayFrame
      title="Hours"
      testId="my-day-hours"
      now={now}
      subtitle={() => "Rostered, not pay"}
      signedOutSample={{
        render: (at) => (
          <MyDayHoursSample now={at} testId="my-day-hours-ready">
            {(sample) => (
              <MyDayHoursFigures now={at} shifts={sample.sources.roster.shifts} anchor={null} settingsFailed={false} />
            )}
          </MyDayHoursSample>
        ),
      }}
    >
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

  const settingsLoading = oneTeamId !== null && overview.status === "loading";
  const settingsFailed = oneTeamId !== null && (overview.status === "error" || overview.status === "unavailable");
  const loading = shifts.status === "loading" || shifts.teamLoading || settingsLoading;
  const usable = shifts.status === "ready" && (!shifts.sample || shifts.demoMode);

  if (loading) {
    return (
      <>
        <span role="status" className="sr-only">
          Loading your hours
        </span>
        <div className="grid gap-2.5" data-testid="my-day-hours-loading" aria-hidden="true">
          <ModeModuleSkeleton rows={2} twoLine eyebrow />
        </div>
      </>
    );
  }

  const link = <ShiftsLink />;

  if (shifts.status === "error" || shifts.status === "signed-out") {
    return (
      <div className="grid gap-2.5" data-testid="my-day-hours-failed">
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
      <div className="grid gap-2.5" data-testid="my-day-hours-sample">
        <ModeNotice>Roster is showing example shifts only, so no hours are shown for you.</ModeNotice>
        {link}
      </div>
    );
  }

  if (shifts.teamMessage) {
    return (
      <div className="grid gap-2.5" data-testid="my-day-hours-partial">
        <div className="grid gap-2">
          <ModeNotice tone="warning">{`${shifts.teamMessage} Your hours may be understated, so no totals are shown.`}</ModeNotice>
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

  if (shifts.shifts.length === 0) {
    return (
      <div className="grid gap-2.5" data-testid="my-day-hours-empty">
        <ModeNotice>No shifts in your roster yet. Add them in Shifts and your hours appear here.</ModeNotice>
        {link}
      </div>
    );
  }

  return (
    <div className="grid gap-2.5" data-testid="my-day-hours-ready">
      {settingsFailed ? (
        <ModeNotice tone="warning" testId="my-day-hours-settings-failed">
          Your team&apos;s pay fortnight settings couldn&apos;t be loaded, so this fortnight isn&apos;t shown.
        </ModeNotice>
      ) : null}
      <MyDayHoursFigures now={now} shifts={shifts.shifts} anchor={anchor} settingsFailed={settingsFailed} />
      {link}
    </div>
  );
}

/** "5 to 11 Oct", or "28 Sep to 11 Oct" across a month. */
function spanText(start: string, end: string): string {
  const day = (date: string) => Number(date.slice(8, 10));
  return start.slice(0, 7) === end.slice(0, 7)
    ? `${day(start)} to ${day(end)} ${shortMonth(end)}`
    : `${day(start)} ${shortMonth(start)} to ${day(end)} ${shortMonth(end)}`;
}

/** Roster's Shifts page: every shift, swap and team view lives there. */
function ShiftsLink() {
  return (
    <Link
      href="/roster/shifts"
      data-testid="my-day-hours-shifts-link"
      className={cn(
        quietCard,
        focusRing,
        "flex min-h-12 min-w-0 items-center gap-2.5 px-3 py-2.5 text-inherit no-underline",
      )}
    >
      <AreaIcon mode="roster" icon={CalendarDays} />
      <span className="grid min-w-0 flex-1">
        <span className="text-sm-minus font-bold text-[color:var(--work-ink)]">Shifts in Roster</span>
        <span className="text-2xs text-[color:var(--text-muted)]">Every rostered shift, swaps and your team</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[color:var(--text-muted)]" />
    </Link>
  );
}

/**
 * Week or Fortnight: the hours as a bar a day in the shift's colour, the
 * total and the average a shift, then the two totals and the next leave in
 * words. Drawn from whatever shifts it is given. Roster's own figures, never
 * pay, and no limit or award rule is applied here.
 */
export function MyDayHoursFigures({
  now,
  shifts,
  anchor,
  settingsFailed,
}: {
  readonly now: Date;
  readonly shifts: readonly MyShift[];
  readonly anchor: string | null;
  readonly settingsFailed: boolean;
}) {
  const { zone } = useWorkTimeZone();
  const [span, setSpan] = useState<"week" | "fortnight">("week");
  const today = zonedDateOf(now, zone);
  const hoursShifts = shifts.map((shift) => ({
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    kind: kindOf(shift),
  }));
  const week = hoursBars(hoursShifts, today, "week");
  const fortnight = hoursBars(hoursShifts, today, "fortnight", anchor);
  // Without the team's pay fortnight there is no honest fortnight to draw.
  const shown = span === "fortnight" && !settingsFailed ? fortnight : week;
  const worked = hoursShifts.filter((shift) => {
    const date = perthDateOf(shift.startsAt);
    return isWorkedKind(shift.kind) && date >= shown.start && date <= shown.end;
  });
  const kinds = kindsByDate(worked);
  const usedKinds = new Set<ShiftKind>(worked.map((shift) => shift.kind));
  const perShift = worked.length ? Math.round((shown.totalHours / worked.length) * 10) / 10 : null;
  const leave = summariseToday(
    shifts.map((shift) => ({
      id: shift.id,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      kind: kindOf(shift),
    })),
    now,
  ).nextLeave;

  return (
    <>
      <MyDaySegmented
        label="Show the week or the fortnight"
        value={span}
        onChange={setSpan}
        testId="my-day-hours-range"
        options={[
          ["week", "Week"],
          ["fortnight", "Fortnight"],
        ]}
      />
      <section
        className={cn(quietCard, "grid gap-2.5 px-3.5 py-3")}
        aria-label="Rostered hours"
        data-testid="my-day-hours-chart"
      >
        <QuietLabel
          as="h2"
          title={spanText(shown.start, shown.end)}
          aside={
            <span className="text-2xs font-semibold text-[color:var(--text-muted)] nums">
              {`${worked.length} ${worked.length === 1 ? "shift" : "shifts"}`}
            </span>
          }
        />
        <p className="m-0 text-xs font-semibold text-[color:var(--text-muted)]">
          <span className="mr-1 text-2xl-minus font-bold tracking-tight text-[color:var(--work-ink)] nums">
            {hoursText(shown.totalHours)}
          </span>
          h rostered
        </p>
        {span === "fortnight" && settingsFailed ? (
          <p className="m-0 text-xs text-[color:var(--text-muted)]">
            The fortnight isn&apos;t shown, so this is the week.
          </p>
        ) : null}
        <p className="sr-only">
          {shown.days
            .filter((day) => day.hours > 0)
            .map((day) => `${day.date}: ${hoursText(day.hours)} hours`)
            .join(", ")}
        </p>
        {shown.totalHours > 0 ? (
          <>
            <HoursChart bars={shown} letters={weekdayLetters(shown.days)} kinds={kinds} />
            <ShiftLegend
              kinds={usedKinds}
              end={
                perShift !== null ? (
                  <span className="shrink-0 text-2xs font-semibold text-[color:var(--text-muted)] nums">
                    {`Average ${hoursText(perShift)} h a shift`}
                  </span>
                ) : null
              }
            />
          </>
        ) : (
          <p className="m-0 text-xs text-[color:var(--text-muted)]" data-testid="my-day-hours-none-worked">
            {`No worked shifts this ${span === "fortnight" && !settingsFailed ? "fortnight" : "week"}. On call from home and leave are not counted.`}
          </p>
        )}
      </section>
      <div className={quietCard}>
        <QuietList testId="my-day-hours-facts" className="px-3">
          <QuietRow
            testId="my-day-hours-week"
            lead={<AreaIcon mode="roster" icon={Clock} />}
            title="This week"
            subtitle={spanText(week.start, week.end)}
            end={
              <span className="text-sm-minus font-bold text-[color:var(--work-ink)] nums">{`${hoursText(week.totalHours)} h`}</span>
            }
          />
          <QuietRow
            testId="my-day-hours-fortnight"
            lead={<AreaIcon mode="roster" icon={Clock} />}
            title="This fortnight"
            subtitle={settingsFailed ? "Pay fortnight settings not loaded" : spanText(fortnight.start, fortnight.end)}
            end={
              <span className="text-sm-minus font-bold text-[color:var(--work-ink)] nums">
                {settingsFailed ? "Unavailable" : `${hoursText(fortnight.totalHours)} h`}
              </span>
            }
          />
          <QuietRow
            testId="my-day-hours-leave"
            lead={<AreaIcon mode="roster" icon={Moon} />}
            title="Next leave"
            subtitle={leave ? spanText(leave.start, leave.end) : "None in the next 40 days"}
            end={
              <QuietTextLink href="/roster/requests?start=leave" testId="my-day-hours-request-leave">
                Request
              </QuietTextLink>
            }
          />
        </QuietList>
      </div>
      <div className="px-1" data-testid="my-day-hours-footer">
        <QuietFoot icon={Info}>
          From your roster. On call from home and leave are not counted as worked hours. Rostered hours, not pay.
        </QuietFoot>
      </div>
    </>
  );
}
