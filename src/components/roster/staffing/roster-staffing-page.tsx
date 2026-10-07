"use client";

import { Info, Plane, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { useRosterNow } from "@/components/roster/roster-format";
import {
  RosterFootnote,
  RosterLinkWord,
  RosterNote,
  RosterSectionHead,
  rosterFilledButton,
  rosterOutlineButton,
} from "@/components/roster/roster-list";
import { RosterPageHeader, rosterField } from "@/components/roster/roster-ui";
import { RosterSampleNotice } from "@/components/roster/team/roster-sample-notice";
import { useRosterTeams } from "@/components/roster/use-roster-team";
import { cn } from "@/components/ui-primitives";
import { announce } from "@/components/ui/live-announcer";
import { perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import {
  alternativeDates,
  dayCount,
  isIsoDate,
  leaveStaffing,
  shortDay,
  spanWords,
  staffingWindow,
  type StaffingWindow,
} from "@/lib/roster/staffing/team-staffing";

import {
  SAFE_NUMBER_NOTE,
  StaffingFrame,
  StaffingResult,
  StaffingStatusNote,
  lowestOf,
} from "./roster-leave-staffing-check";
import { RosterStaffingLegend, RosterStaffingStrip } from "./roster-staffing-strip";
import { useTeamStaffing } from "./use-team-staffing";

/**
 * Team staffing (feature #7): plan leave with the team in view. The strip
 * shows how many of the team are on each day, from one assignments read. Pick
 * dates (type them or tap two days) to see your leave on it, the fewest on,
 * and same-length dates with more of the team on. "Plan this leave" opens the
 * existing Plan leave sheet with the dates filled in. Nothing is kept on the
 * device; the dates live in this page only (and in the address, if it was
 * opened with `?from=&to=`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const subscribeSearch = (notify: () => void) => {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
};
const searchSnapshot = () => window.location.search;
const serverSearchSnapshot = () => "";

function MiniBars({ counts }: { readonly counts: readonly number[] }) {
  const top = Math.max(1, ...counts);
  return (
    <span aria-hidden="true" className="flex h-6 shrink-0 items-end gap-0.5" data-mode-identity="roster">
      {counts.slice(0, 7).map((count, index) => (
        <i
          key={index}
          className="block w-1.5 rounded-sm bg-[color:var(--mode-identity)]"
          style={{ height: Math.max(3, Math.round((count / top) * 24)) }}
        />
      ))}
    </span>
  );
}

export function RosterStaffingPage({ now: pinnedNow }: { readonly now?: Date } = {}) {
  const now = useRosterNow(pinnedNow);
  const today = perthDateOf(now);
  const search = useSyncExternalStore(subscribeSearch, searchSnapshot, serverSearchSnapshot);
  const teams = useRosterTeams();
  const enabled = useMemo(() => teams.data?.teams.filter((team) => team.enabled) ?? [], [teams.data]);
  const actorId = teams.data?.actorId ?? null;

  // The address may prefill dates and a team; it can never name the actor.
  const fromUrl = useMemo(() => {
    const params = new URLSearchParams(search);
    const from = params.get("from");
    const to = params.get("to");
    const team = params.get("team");
    return {
      from: isIsoDate(from) ? from : "",
      to: isIsoDate(to) ? to : "",
      team: team && UUID.test(team) ? team : null,
    };
  }, [search]);
  const [edit, setEdit] = useState<{ from: string; to: string } | null>(null);
  const [chosenTeam, setChosenTeam] = useState<string | null>(null);
  const from = edit?.from ?? fromUrl.from;
  const to = edit?.to ?? fromUrl.to;

  const wantedTeam = chosenTeam ?? fromUrl.team;
  const serviceId =
    enabled.length > 1
      ? (enabled.find((team) => team.serviceId === wantedTeam)?.serviceId ?? null)
      : (enabled[0]?.serviceId ?? null);

  const end = to || from;
  const problem = !from
    ? null
    : from < today
      ? "Pick a first day from today on."
      : end < from
        ? "The last day is before the first."
        : dayCount(from, end) > 366
          ? "Leave can span up to 366 days."
          : null;
  const leave: StaffingWindow | null = from && !problem ? { from, to: end } : null;
  const span = staffingWindow(today, leave);
  const staffing = useTeamStaffing(serviceId, span, actorId);
  // The whole read window, so a run can be extended into the next week with a tap.
  const shown = staffing.days;
  const result = leave && staffing.status === "ready" ? leaveStaffing(staffing.days, leave) : null;
  const options = leave && staffing.status === "ready" ? alternativeDates(staffing.days, leave, today) : [];

  function setDates(next: { from: string; to: string }) {
    setEdit(next);
    if (next.from && isIsoDate(next.from)) {
      announce(`${spanWords({ from: next.from, to: next.to || next.from })} picked`);
    }
  }

  function pick(date: string) {
    // First tap picks one day; a second, later tap ends the run; any other tap starts again.
    if (from && (!to || to === from) && date > from) setDates({ from, to: date });
    else setDates({ from: date, to: date });
  }

  const planHref = leave ? `/roster/requests?start=leave&date=${leave.from}&to=${leave.to}` : null;

  return (
    <InformationPageShell testId="roster-staffing-page">
      <RosterPageHeader
        icon={Users}
        eyebrow="Plan leave with the team in view"
        title="Team staffing"
        subtitle="How many of your team are on each day."
      />
      <div className="grid min-w-0 gap-3" data-mode-identity="roster">
        {teams.status === "loading" ? <ModeModuleSkeleton rows={3} eyebrow /> : null}
        {teams.status !== "loading" && teams.status !== "ready" ? (
          <div className="grid gap-2">
            <RosterNote icon={Info} role="alert">
              <p>{teams.message ?? "Your teams couldn't be checked."}</p>
            </RosterNote>
            {teams.status === "error" ? (
              <button
                type="button"
                className={cn(rosterOutlineButton, "justify-self-start px-4")}
                onClick={teams.reload}
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
        {teams.status === "ready" ? (
          <>
            <RosterSampleNotice sample={teams.data?.sample} />
            {enabled.length === 0 ? (
              <RosterNote icon={Info} testId="staffing-no-team">
                <p className="font-semibold">No team roster yet</p>
                <p>Join your team to see who is on each day.</p>
                <Link
                  href="/roster/join"
                  className="font-semibold text-[color:var(--mode-identity)] underline-offset-2 hover:underline"
                >
                  Join a team
                </Link>
              </RosterNote>
            ) : null}
            {enabled.length > 1 ? (
              <label className="grid max-w-sm gap-1 text-sm text-[color:var(--text-muted)]">
                Team
                <select
                  value={serviceId ?? ""}
                  onChange={(event) => setChosenTeam(event.target.value || null)}
                  className={rosterField}
                >
                  <option value="">Choose a team</option>
                  {enabled.map((team) => (
                    <option value={team.serviceId} key={team.serviceId}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {enabled.length > 0 ? (
              <section className="grid gap-2" aria-labelledby="staffing-dates-head">
                <RosterSectionHead
                  id="staffing-dates-head"
                  title="Your leave"
                  right={
                    from ? (
                      <RosterLinkWord
                        onClick={() => {
                          setEdit({ from: "", to: "" });
                          announce("Dates cleared");
                        }}
                        label="Clear the dates"
                      >
                        Clear
                      </RosterLinkWord>
                    ) : undefined
                  }
                />
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid min-w-0 gap-1 text-sm text-[color:var(--text-muted)]">
                    First day
                    <input
                      type="date"
                      value={from}
                      min={today}
                      onChange={(event) =>
                        setDates({
                          from: event.target.value,
                          to: to && to >= event.target.value ? to : event.target.value,
                        })
                      }
                      className={rosterField}
                    />
                  </label>
                  <label className="grid min-w-0 gap-1 text-sm text-[color:var(--text-muted)]">
                    Last day
                    <input
                      type="date"
                      value={to}
                      min={from || today}
                      onChange={(event) => setDates({ from: from || event.target.value, to: event.target.value })}
                      className={rosterField}
                    />
                  </label>
                </div>
                {problem ? (
                  <p
                    role="alert"
                    className="mx-1 text-sm text-[color:var(--warning-text)]"
                    data-testid="staffing-problem"
                  >
                    {problem}
                  </p>
                ) : (
                  <RosterFootnote>
                    {leave
                      ? `${dayCount(leave.from, leave.to)} ${dayCount(leave.from, leave.to) === 1 ? "day" : "days"}. Tap a day to start again.`
                      : "Or tap a day below, then a later day to end."}
                  </RosterFootnote>
                )}
              </section>
            ) : null}
            {serviceId ? (
              <section className="grid gap-2" aria-labelledby="staffing-strip-head">
                <RosterSectionHead
                  id="staffing-strip-head"
                  title="Team staffing"
                  right={
                    staffing.readAt ? (
                      <span className="nums text-xs text-[color:var(--text-muted)]">
                        {leave ? spanWords(span) : "Next 3 weeks"}
                        {" · "}Rechecked {perthTimeOf(staffing.readAt)}
                      </span>
                    ) : undefined
                  }
                />
                {staffing.status === "loading" ? <ModeModuleSkeleton rows={3} /> : null}
                {staffing.status !== "loading" && staffing.status !== "ready" ? (
                  <div className="grid gap-2">
                    <StaffingStatusNote status={staffing.status} message={staffing.message} />
                    <button
                      type="button"
                      className={cn(rosterOutlineButton, "justify-self-start px-4")}
                      onClick={staffing.reload}
                    >
                      Try again
                    </button>
                  </div>
                ) : null}
                {staffing.status === "ready" ? (
                  <StaffingFrame>
                    <RosterStaffingStrip
                      days={shown}
                      leave={leave}
                      today={today}
                      lowestDays={result ? lowestOf(result) : []}
                      onPick={pick}
                      testId="staffing-strip"
                    />
                    <RosterStaffingLegend showYou={!!leave && shown.some((day) => day.youWork)} />
                    {result ? <StaffingResult result={result} /> : null}
                    {leave && span.capped ? (
                      <p className="text-xs text-[color:var(--text-muted)]">
                        Long leave: days after {shortDay(span.to)} aren&apos;t checked here.
                      </p>
                    ) : null}
                  </StaffingFrame>
                ) : null}
                <RosterNote icon={Info} role="note" testId="staffing-safe-note">
                  <p>{SAFE_NUMBER_NOTE}</p>
                </RosterNote>
              </section>
            ) : null}
            {options.length ? (
              <section className="grid gap-2" aria-labelledby="staffing-alt-head">
                <RosterSectionHead id="staffing-alt-head" title="Same length, more of the team on" />
                <ul role="list" className={cn(modeModuleSurface, "shadow-none")} data-testid="staffing-options">
                  {options.map((option) => (
                    <li
                      key={option.from}
                      className="relative flex min-h-14 items-center gap-3 px-4 py-2 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[color:var(--border)] before:content-[''] first:before:hidden"
                    >
                      <MiniBars counts={option.counts} />
                      <span className="grid min-w-0 flex-1">
                        <span className="nums text-base-minus font-semibold text-[color:var(--text-heading)]">
                          {spanWords(option)}
                        </span>
                        <span className="nums text-sm text-[color:var(--text-muted)]">
                          Fewest on: {option.lowest} with you away
                        </span>
                      </span>
                      <button
                        type="button"
                        className={cn(rosterOutlineButton, "shrink-0 px-4")}
                        aria-label={`Use ${spanWords(option)}`}
                        onClick={() => setDates({ from: option.from, to: option.to })}
                      >
                        Use
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {planHref && serviceId ? (
              <>
                <Link href={planHref} className={cn(rosterFilledButton, "w-full")} data-testid="staffing-plan">
                  <Plane aria-hidden="true" className="size-icon-md" />
                  Plan this leave
                </Link>
                <RosterFootnote>
                  Opens Plan leave with these dates. Lodge it in HR as usual. Your roster manager decides.
                </RosterFootnote>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </InformationPageShell>
  );
}
