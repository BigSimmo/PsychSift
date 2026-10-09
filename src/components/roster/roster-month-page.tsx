"use client";

import { Clock, FileUp, Plus, TriangleAlert, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ModeBandAction, useModeBandHeading } from "@/components/mode-band/mode-band";
import { ModeNotice } from "@/components/mode-kit/notice";
import { useRosterSignedOutSample } from "@/components/roster/roster-sample-context";
import { WorkSignInNotice } from "@/components/mode-kit/work-sign-in-notice";
import { WorkStateNotice } from "@/components/mode-kit/work-state";
import {
  WorkBody,
  WorkButton,
  WorkCard,
  WorkDateRow,
  WorkEmpty,
  WorkGlassButton,
  WorkIconRow,
  WorkSectionLabel,
  WorkTag,
} from "@/components/mode-kit/work";
import { monthGridRange, monthKeyOf, shiftMonth } from "@/lib/calendar/month-grid";
import { WA_PUBLIC_HOLIDAYS } from "@/lib/on-call/wa-public-holidays";
import { restCuesByTeam } from "@/lib/roster/rest-cues";
import { SHIFT_KIND_LABEL, type ShiftKind } from "@/lib/roster/shift-kind";
import { formatSpanUntil, leadShift, shiftSpan } from "@/lib/roster/shifts-overview";
import {
  MONTHS,
  WEEKDAYS,
  addDaysToDate,
  formatPerthDay,
  perthDateOf,
  perthTimeOf,
} from "@/lib/roster/shifts/perth-time";
import type { RosterSwap } from "@/lib/roster/team/model";
import { swapProgress } from "@/lib/roster/team/swap-progress";
import type { RosterDisplayShift as OnCallShift } from "@/lib/roster/team/team-view";

import { RosterAddSheet, type RosterAddView } from "./roster-add-sheet";
import { RosterDaySheet, type RosterDayColleague } from "./roster-day-sheet";
import { kindOf, useRosterNow } from "./roster-format";
import { RosterImportFlow } from "./roster-import-flow";
import { RosterInitials } from "./roster-list";
import { longDay, RosterMonthGrid, RosterMonthLegend, RosterShiftChip, type RosterMonthDay } from "./roster-month-grid";
import {
  clockSpan,
  monthTotals,
  nextLeave,
  nextNights,
  rosterDays,
  runWords,
  type MonthShift,
  type MonthTotals,
} from "./roster-month-model";
import { useRosterLinks } from "./use-roster-links";
import { useRosterSettings } from "./use-roster-settings";
import { useRosterShifts } from "./use-roster-shifts";
import { useRosterRead, useRosterTeamRules, useRosterTeams } from "./use-roster-team";

/**
 * Roster's Month tab (work-mode redesign, owner request 6 Oct 2026; mockup
 * `rost_month`). What needs you first (your next shift, a rest warning, a
 * swap to answer), then the month as a calendar of shift codes, what is
 * coming up, and the month's totals. Tap a day for its sheet.
 *
 * Every figure comes from the roster already loaded. Honest states: loading
 * shows the page's shape; a failed load says nothing was checked; part of a
 * team roster missing makes every count "at least"; days before what the
 * roster loads say so instead of looking free.
 */

/** Mirrors PAST_SHIFT_DAYS in `GET /api/roster/shifts`: your own shifts load from three weeks back. */
const LOADED_PAST_DAYS = 21;
/** Team rules look back up to 21 days from a shift (see roster-shifts-page). */
const TEAM_RULE_LOOKBACK_DAYS = 21;
const AHEAD_DAYS = 14;

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

function toMonthShift(shift: OnCallShift): MonthShift {
  return { id: shift.id, startsAt: shift.startsAt, endsAt: shift.endsAt, kind: kindOf(shift) };
}

const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
const monthShort = (date: string) => MONTHS[Number(date.slice(5, 7)) - 1]!;
const dayWords = (date: string) => `${weekdayOf(date)} ${Number(date.slice(8, 10))}`;

/** Roster reads keep their signed-out answer, so a sign-in started here reloads the page. */
function reloadPage() {
  window.location.reload();
}

function MonthLoading() {
  return (
    <div className="grid gap-2.25" data-testid="roster-month-loading" aria-busy="true">
      <WorkCard padded>
        <div className="grid gap-2" aria-hidden="true">
          <span className="h-3.5 w-[55%] rounded-lg bg-[color:var(--surface-wash)]" />
          <span className="h-[11px] w-4/5 rounded-lg bg-[color:var(--surface-wash)]" />
        </div>
      </WorkCard>
      <WorkCard padded>
        <div className="grid gap-2.5" aria-hidden="true">
          <span className="h-3.5 w-2/5 rounded-lg bg-[color:var(--surface-wash)]" />
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 35 }, (_, index) => (
              <span key={index} className="h-[34px] rounded-lg bg-[color:var(--surface-wash)]" />
            ))}
          </div>
        </div>
      </WorkCard>
      <p role="status" className="sr-only">
        Loading your roster…
      </p>
    </div>
  );
}

/** The four kind columns, then Days off and Public holidays worked (owner idea 9). */
function MonthTotalsCard({
  totals,
  partial,
  month,
}: {
  readonly totals: MonthTotals;
  readonly partial: boolean;
  readonly month: string;
}) {
  const atLeast = partial ? "at least " : "";
  const kinds: readonly [ShiftKind & keyof MonthTotals, number][] = [
    ["day", totals.day],
    ["evening", totals.evening],
    ["night", totals.night],
    ["on_call", totals.on_call],
  ];
  const monthName = new Intl.DateTimeFormat("en-AU", { month: "long", timeZone: "UTC" }).format(
    new Date(`${month}-01T00:00:00Z`),
  );
  return (
    <WorkCard as="section" aria-label={`${monthName} totals`} testId="roster-month-totals">
      <dl className="m-0 grid grid-cols-4 px-1 pb-1.5 pt-2.5 text-center">
        {kinds.map(([kind, count]) => (
          <div key={kind} className="grid gap-0.5">
            <dt className="text-3xs font-semibold text-[color:var(--text-muted)]">{SHIFT_KIND_LABEL[kind]}</dt>
            <dd className="nums m-0 text-lg font-bold text-[color:var(--text-heading)]">
              <span className="sr-only">{atLeast}</span>
              {count}
            </dd>
          </div>
        ))}
      </dl>
      <dl className="m-0 grid grid-cols-2 border-t border-[color:var(--border)] px-1 pb-2.5 pt-2 text-center">
        <div className="grid gap-0.5">
          <dt className="text-3xs font-semibold text-[color:var(--text-muted)]">Days off</dt>
          <dd className="nums m-0 text-lg font-bold text-[color:var(--text-heading)]" data-testid="roster-month-off">
            {partial ? <span className="sr-only">at most </span> : null}
            {totals.off}
          </dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-3xs font-semibold text-[color:var(--text-muted)]">Public holidays worked</dt>
          <dd
            className="nums m-0 text-lg font-bold text-[color:var(--text-heading)]"
            data-testid="roster-month-holidays"
          >
            <span className="sr-only">{atLeast}</span>
            {totals.holidaysWorked}
          </dd>
        </div>
      </dl>
      {totals.countedFrom || partial ? (
        <p className="m-0 border-t border-[color:var(--border)] px-3 py-2 text-center text-2xs text-[color:var(--text-muted)]">
          {[
            totals.countedFrom
              ? `Counted from ${formatPerthDay(totals.countedFrom)}, as far back as your roster loads.`
              : null,
            partial ? "Part of your team roster didn't load, so these are minimums." : null,
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      ) : null}
    </WorkCard>
  );
}

export function RosterMonthPage({ now: pinnedNow }: { readonly now?: Date } = {}) {
  const router = useRouter();
  const now = useRosterNow(pinnedNow);
  const today = perthDateOf(now);
  // The band's eyebrow is today's date (mockup `rost_month`: "Tue 6 October").
  useModeBandHeading({ eyebrow: longDay(today) });
  const [month, setMonth] = useState(() => monthKeyOf(today));
  const [selected, setSelected] = useState<string | null>(null);
  const [sheetDate, setSheetDate] = useState<string | null>(null);
  const [addView, setAddView] = useState<RosterAddView | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // The app has no sign-in page, so "Sign in" opens the account dialog, as every other area does.

  const grid = monthGridRange(month);
  const loadedFrom = addDaysToDate(today, -LOADED_PAST_DAYS);
  // Read wider than the month, so a rest or run cue on its first day is judged on whole data.
  const teamRange = useMemo(
    () => ({
      from: addDaysToDate(grid.start < today ? grid.start : today, -TEAM_RULE_LOOKBACK_DAYS),
      to: maxDate(grid.end, addDaysToDate(today, AHEAD_DAYS)),
    }),
    [grid.start, grid.end, today],
  );
  const shifts = useRosterShifts(teamRange);
  // The frame's example data banner already says these are examples.
  const exampleBanner = useRosterSignedOutSample();
  const teams = useRosterTeams();
  const enabledTeams = (Array.isArray(teams.data?.teams) ? teams.data.teams : []).filter((team) => team.enabled);
  const oneTeamId = enabledTeams.length === 1 ? enabledTeams[0]!.serviceId : null;
  const actorId = teams.data?.actorId ?? null;
  const rulesByTeam = useRosterTeamRules(enabledTeams.map((team) => team.serviceId));
  const requests = useRosterRead(oneTeamId, "requests");
  // Who is on with you is read only once a day sheet opens, for that month.
  const sheetRange = useMemo(() => ({ from: grid.start, to: grid.end }), [grid.start, grid.end]);
  const assignments = useRosterRead(sheetDate ? oneTeamId : null, "assignments", sheetRange);
  const links = useRosterLinks();
  const settings = useRosterSettings();

  const holidays = WA_PUBLIC_HOLIDAYS;
  const monthShifts = useMemo(() => shifts.shifts.map(toMonthShift), [shifts.shifts]);
  const byId = useMemo(() => new Map(shifts.shifts.map((shift) => [shift.id, shift])), [shifts.shifts]);
  const cues = useMemo(
    () => new Map(restCuesByTeam(shifts.shifts, rulesByTeam).map((cue) => [cue.shiftId, cue])),
    [shifts.shifts, rulesByTeam],
  );
  const partial = Boolean(shifts.teamMessage);
  const canEdit = shifts.status === "ready" && !shifts.demoMode && !shifts.sample;

  // Swaps that wait on you, and the ones you asked for, from the read Swaps already uses.
  const swaps: readonly RosterSwap[] = requests.status === "ready" ? (requests.data?.swaps ?? []) : [];
  const swapStates = actorId ? swaps.map((swap) => ({ swap, progress: swapProgress(swap, actorId, now) })) : [];
  const waiting = swapStates.filter((entry) => entry.progress.tab === "needs_you").map((entry) => entry.swap);
  const asked = swapStates.filter((entry) => entry.progress.tab === "sent" && entry.swap.status === "requested");

  const days = useMemo(() => {
    const map = new Map<string, RosterMonthDay>();
    for (const [date, entry] of rosterDays(monthShifts)) map.set(date, { kinds: entry.kinds });
    const mark = (date: string, patch: Partial<RosterMonthDay>) =>
      map.set(date, { kinds: map.get(date)?.kinds ?? [], ...map.get(date), ...patch });
    // A swap waiting on you gives away your shift (swap.take) for theirs (swap.give).
    for (const swap of waiting) {
      if (swap.take) mark(perthDateOf(swap.take.startsAt), { swapAsked: true });
      if (swap.give) mark(perthDateOf(swap.give.startsAt), { ghost: swap.give.kind as ShiftKind });
    }
    for (const { swap } of asked) if (swap.give) mark(perthDateOf(swap.give.startsAt), { swapAsked: true });
    return map;
    // `waiting` and `asked` are rebuilt from `requests` each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthShifts, requests.data, actorId]);
  const totals = useMemo(
    () => monthTotals(monthShifts, month, holidays, loadedFrom),
    [monthShifts, month, holidays, loadedFrom],
  );

  const lead = leadShift(
    shifts.shifts.map((shift) => ({
      id: shift.id,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      kind: kindOf(shift),
      place: shift.workplace ?? shift.location,
    })),
    now,
  );
  const leadDisplay = lead.state === "none" ? null : (byId.get(lead.shift.id) ?? null);
  const restWarning = shifts.shifts
    .filter(
      (shift) =>
        Date.parse(shift.endsAt) > now.getTime() &&
        perthDateOf(shift.startsAt) <= addDaysToDate(today, AHEAD_DAYS) &&
        cues.get(shift.id)?.warning,
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  const nights = nextNights(monthShifts, now);
  const leave = nextLeave(monthShifts, now);
  const leaveShift = leave ? byId.get(leave.shift.id) : null;

  const sheetShifts = sheetDate
    ? shifts.shifts
        .filter((shift) => (rosterDays([toMonthShift(shift)]).has(sheetDate) ? true : false))
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    : [];
  const colleagues: RosterDayColleague[] | null =
    sheetDate && oneTeamId && actorId
      ? assignments.status === "ready"
        ? (assignments.data?.assignments ?? [])
            .filter(
              (row) =>
                row.userId !== actorId &&
                row.name &&
                sheetShifts.some(
                  (mine) =>
                    kindOf(mine) !== "leave" &&
                    Date.parse(row.startsAt) < Date.parse(mine.endsAt) &&
                    Date.parse(row.endsAt) > Date.parse(mine.startsAt),
                ),
            )
            .map((row) => ({
              name: row.name!,
              kind: SHIFT_KIND_LABEL[row.kind as ShiftKind] ?? row.shiftCode,
              until: perthTimeOf(row.endsAt),
            }))
        : null
      : null;

  function openDay(date: string) {
    setSelected(date);
    setSheetDate(date);
  }

  function changeMonth(step: -1 | 1) {
    setMonth((current) => shiftMonth(current, step));
    setSelected(null);
  }

  const notices = (
    <>
      {shifts.demoMode && !exampleBanner ? (
        <ModeNotice>Example only. Sign in to add your own shifts.</ModeNotice>
      ) : null}
      {notice ? <ModeNotice>{notice}</ModeNotice> : null}
      {shifts.teamMessage ? <ModeNotice tone="warning">{shifts.teamMessage}</ModeNotice> : null}
    </>
  );

  function statusCards() {
    const waitingSwap = waiting[0];
    const leadRow = leadDisplay
      ? (() => {
          const kind = kindOf(leadDisplay);
          const date = perthDateOf(leadDisplay.startsAt);
          const onNow = lead.state === "on_now";
          const title = onNow
            ? kind === "on_call"
              ? "On call now"
              : "On shift now"
            : date === today
              ? kind === "on_call"
                ? // Same rule as My Day's card: an on-call that starts at 17:00 or later is tonight.
                  Number(perthTimeOf(leadDisplay.startsAt).slice(0, 2)) >= 17
                  ? "On call tonight"
                  : "On call today"
                : `${SHIFT_KIND_LABEL[kind]} today`
              : date === addDaysToDate(today, 1)
                ? `${SHIFT_KIND_LABEL[kind]} tomorrow`
                : "Next shift";
          const place = leadDisplay.workplace ?? leadDisplay.location;
          const tag = onNow
            ? `${formatSpanUntil(Date.parse(leadDisplay.endsAt) - now.getTime())} left`
            : `In ${formatSpanUntil(Date.parse(leadDisplay.startsAt) - now.getTime())}`;
          return (
            <WorkDateRow
              month={weekdayOf(date)}
              day={Number(date.slice(8, 10))}
              title={title}
              sub={[shiftSpan(leadDisplay), onNow || date === today ? null : SHIFT_KIND_LABEL[kind], place]
                .filter(Boolean)
                .join(" · ")}
              end={<WorkTag>{tag}</WorkTag>}
              onClick={() => openDay(date)}
              testId="roster-month-lead"
            />
          );
        })()
      : null;
    const restRow = restWarning ? (
      <WorkIconRow
        icon={TriangleAlert}
        tone="amber"
        title={cues.get(restWarning.id)!.warning!}
        sub={`${formatPerthDay(perthDateOf(restWarning.startsAt))} · ${SHIFT_KIND_LABEL[kindOf(restWarning)]} · ${shiftSpan(restWarning)}`}
        href="/roster?view=hours"
        testId="roster-month-rest"
      />
    ) : null;
    return (
      <>
        {leadRow || restRow ? (
          <WorkCard>
            {leadRow}
            {restRow}
          </WorkCard>
        ) : null}
        {waitingSwap ? (
          <WorkCard testId="roster-month-swap">
            <div className="work-row">
              <RosterInitials name={waitingSwap.requesterName ?? "Colleague"} />
              <span className="work-row__text">
                <span className="work-row__title">
                  Swap from {waitingSwap.requesterName ?? "a colleague"}
                  {waiting.length > 1 ? ` and ${waiting.length - 1} more` : ""}
                </span>
                <span className="work-row__sub">
                  {waitingSwap.take
                    ? `Your ${dayWords(perthDateOf(waitingSwap.take.startsAt))} ${SHIFT_KIND_LABEL[waitingSwap.take.kind as ShiftKind].toLowerCase()}`
                    : "A shift of theirs"}
                  {waitingSwap.give
                    ? ` for their ${dayWords(perthDateOf(waitingSwap.give.startsAt))} ${SHIFT_KIND_LABEL[waitingSwap.give.kind as ShiftKind].toLowerCase()}`
                    : ", nothing in return"}
                </span>
              </span>
              <WorkButton variant="tinted" href="/roster/swaps">
                Answer
              </WorkButton>
            </div>
            <p className="nums m-0 flex items-center gap-1.5 px-3 pb-2.5 text-2xs text-[color:var(--text-muted)]">
              <Clock aria-hidden="true" className="size-3.5" strokeWidth={2} />
              Answer by {perthTimeOf(waitingSwap.expiresAt)}{" "}
              {perthDateOf(waitingSwap.expiresAt) === today
                ? "today"
                : formatPerthDay(perthDateOf(waitingSwap.expiresAt))}
            </p>
          </WorkCard>
        ) : null}
      </>
    );
  }

  function comingUp() {
    if (!nights && !leave) return null;
    return (
      <>
        <WorkSectionLabel>Coming up</WorkSectionLabel>
        <WorkCard as="ul" testId="roster-month-coming">
          {nights ? (
            <li>
              <WorkDateRow
                month={monthShort(nights.dates[0]!)}
                day={Number(nights.dates[0]!.slice(8, 10))}
                title={nights.count > 1 ? `Nights · ${nights.count} in a row` : "Night"}
                sub={`${runWords(nights.dates, dayWords)} · ${clockSpan(nights.first)}`}
                end={<RosterShiftChip kind="night" />}
                onClick={() => {
                  setMonth(monthKeyOf(nights.dates[0]!));
                  openDay(nights.dates[0]!);
                }}
              />
            </li>
          ) : null}
          {leave ? (
            <li>
              <WorkDateRow
                month={monthShort(leave.from)}
                day={Number(leave.from.slice(8, 10))}
                title={leaveShift?.title || SHIFT_KIND_LABEL.leave}
                sub={`${leave.from === leave.to ? formatPerthDay(leave.from) : `${dayWords(leave.from)} to ${formatPerthDay(leave.to)}`} · ${leave.days} ${leave.days === 1 ? "day" : "days"}`}
                end={<RosterShiftChip kind="leave" />}
                onClick={() => {
                  setMonth(monthKeyOf(leave.from));
                  openDay(leave.from);
                }}
              />
            </li>
          ) : null}
        </WorkCard>
      </>
    );
  }

  function body() {
    if (shifts.status === "loading") return <MonthLoading />;
    if (shifts.status === "signed-out")
      return (
        <WorkSignInNotice
          icon={Users}
          title="Sign in to see your roster"
          body="Your shifts, swaps and leave show here once you sign in."
          onSignedIn={reloadPage}
          testId="roster-month-signed-out"
        />
      );
    if (shifts.status === "error")
      return (
        <div className="grid gap-2.25" data-testid="roster-shifts-error">
          <WorkStateNotice
            kind="error"
            title="Couldn't load your roster"
            body="A connection problem. Nothing in your roster has changed."
            onRetry={() => void shifts.reload()}
          />
          <WorkCard>
            <WorkIconRow
              icon={Clock}
              tone="neutral"
              title="Hours and rest: not checked"
              sub="No warning here does not mean none"
              testId="roster-hours-not-checked"
            />
          </WorkCard>
          {links.links.length ? (
            <p className="m-0 px-1 text-2xs font-medium text-[color:var(--text-muted)]">
              A linked phone calendar may still show your shifts, as of its last update.
            </p>
          ) : null}
        </div>
      );

    const nothingYet =
      shifts.shifts.length === 0 && !shifts.teamLoading && teams.status === "ready" && enabledTeams.length === 0;
    if (nothingYet && !shifts.demoMode)
      return (
        <div className="grid gap-2.25" data-testid="roster-month-empty">
          {notices}
          <WorkCard>
            <WorkEmpty
              icon={FileUp}
              title="No shifts yet"
              body="Add your roster once to see your next shift, your week and your hours."
              action={
                canEdit ? (
                  <WorkButton icon={FileUp} onClick={() => setImporting(true)}>
                    Import a roster file
                  </WorkButton>
                ) : undefined
              }
            />
          </WorkCard>
          <WorkCard as="ul">
            {canEdit ? (
              <li>
                <WorkIconRow
                  icon={Plus}
                  title="Add a shift"
                  sub="Type in one shift at a time"
                  onClick={() => setAddView("menu")}
                />
              </li>
            ) : null}
            <li>
              <WorkIconRow icon={Users} title="Join a team" sub="Paste an invite link or code" href="/roster/join" />
            </li>
          </WorkCard>
          <p className="m-0 px-1 text-center text-2xs font-medium text-[color:var(--text-muted)]">
            PDF, Excel, CSV or calendar file. Nothing is shared until you join a team.
          </p>
        </div>
      );

    const thisMonth = monthKeyOf(today);
    return (
      <div className="grid gap-2.25">
        {notices}
        {shifts.teamLoading ? null : statusCards()}
        <WorkCard padded testId="roster-month-calendar">
          <RosterMonthGrid
            month={month}
            today={today}
            selected={selected}
            days={days}
            holidays={holidays}
            loadedFrom={loadedFrom}
            onSelect={openDay}
            onMonthChange={changeMonth}
            previousDisabled={`${month}-01` <= loadedFrom}
          />
          <RosterMonthLegend swapAsked={waiting.length > 0 || asked.length > 0} />
          {month !== thisMonth ? (
            <div className="mt-1 grid justify-items-center">
              <WorkButton
                variant="quiet"
                onClick={() => {
                  setMonth(thisMonth);
                  setSelected(null);
                }}
              >
                Back to this month
              </WorkButton>
            </div>
          ) : null}
        </WorkCard>
        {comingUp()}
        <MonthTotalsCard totals={totals} partial={partial} month={month} />
        <p className="m-0 px-1 text-center text-2xs font-medium text-[color:var(--text-muted)]">
          {shifts.sample
            ? "Example shifts and team, all made up."
            : "Your copy of the roster. Check official changes with your service."}
        </p>
        <p className="m-0 -mt-1 px-1 text-center text-2xs text-[color:var(--text-muted)]">
          WA public holidays, wa.gov.au, read 25 Sep 2026.{" "}
          <Link href="/roster/shifts" className="font-semibold text-[color:var(--mode-identity)]">
            Week by week
          </Link>
        </p>
      </div>
    );
  }

  return (
    // The page's main landmark, so "Skip to main content" and screen-reader landmarks land on the month.
    <main className="min-w-0">
      <WorkBody testId="roster-month-main">
        <h1 className="sr-only">Roster, month</h1>
        {canEdit ? (
          <ModeBandAction>
            {(underBand) =>
              underBand ? (
                <WorkGlassButton
                  icon={Plus}
                  label="Add to your roster"
                  onClick={() => setAddView("menu")}
                  testId="roster-month-add"
                />
              ) : (
                <WorkButton variant="tinted" icon={Plus} onClick={() => setAddView("menu")} testId="roster-month-add">
                  Add
                </WorkButton>
              )
            }
          </ModeBandAction>
        ) : null}
        {importing ? (
          <RosterImportFlow
            shifts={shifts}
            settings={settings}
            today={today}
            onClose={() => setImporting(false)}
            onSaved={() => {
              setImporting(false);
              setNotice("Saved");
            }}
          />
        ) : (
          body()
        )}

        <RosterDaySheet
          date={sheetDate}
          today={today}
          shifts={sheetShifts}
          cues={cues}
          holiday={sheetDate ? holidays.has(sheetDate) : false}
          colleagues={colleagues}
          teamId={oneTeamId}
          actorId={actorId}
          notLoaded={Boolean(sheetDate && sheetDate < loadedFrom)}
          onClose={() => setSheetDate(null)}
        />

        <RosterAddSheet
          open={addView !== null}
          view={addView ?? "menu"}
          onViewChange={setAddView}
          onClose={() => setAddView(null)}
          today={today}
          workplaces={[...new Set(shifts.shifts.flatMap((shift) => (shift.workplace ? [shift.workplace] : [])))]}
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
              setNotice("Saved");
            }
            return failure;
          }}
          onAddLink={async (url, workplace) => {
            const failure = await links.add(url, workplace);
            if (!failure) {
              void shifts.reload();
              setAddView(null);
              setNotice("Saved");
            }
            return failure;
          }}
        />
      </WorkBody>
    </main>
  );
}
