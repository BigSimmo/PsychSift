"use client";

import { Lock, Phone, RefreshCw, TriangleAlert, Users } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

import { useModeBandHeading } from "@/components/mode-band/mode-band";
import { WorkButton, WorkCard, WorkEmpty } from "@/components/mode-kit/work";
import { InformationPageShell } from "@/components/information-page-shell";
import { RosterSampleNotice } from "@/components/roster/team/roster-sample-notice";
import { TeamCalendar } from "@/components/roster/team/calendar/team-calendar";
import { formatShiftRange, useRosterNow } from "@/components/roster/roster-format";
import {
  RosterFootnote,
  RosterIconLead,
  RosterInitials,
  RosterList,
  RosterNote,
  RosterRow,
  RosterSectionHead,
  rosterOutlineButton,
} from "@/components/roster/roster-list";
import { useRosterRead, useRosterTeams } from "@/components/roster/use-roster-team";
import { RosterPageHeader, rosterField } from "@/components/roster/roster-ui";
import { SHIFT_KIND_LABEL, SHIFT_KINDS, SHIFT_LETTER } from "@/lib/roster/shift-kind";
import { addDaysToDate, formatPerthDay, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import { calendarWindow, readCalendarState, type CalendarState } from "@/lib/roster/team/calendar-model";
import type { RosterAssignment, RosterTeam } from "@/lib/roster/team/model";
import { assignmentStartDate } from "@/lib/roster/team/team-view";

/** The letters the week and month views really use, with "blank is off". */
const LEGEND = `${SHIFT_KINDS.map((kind) => `${SHIFT_LETTER[kind]} ${SHIFT_KIND_LABEL[kind].toLowerCase()}`).join(" · ")} · blank is off.`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `5 to 11 Oct`, or `28 Sep to 4 Oct` across a month end. */
function dayRange(from: string, to: string): string {
  const [, fromMonth, fromDay] = from.split("-").map(Number);
  const [, toMonth, toDay] = to.split("-").map(Number);
  const start = fromMonth === toMonth ? `${fromDay}` : `${fromDay} ${MONTHS[fromMonth - 1]}`;
  return `${start} to ${toDay} ${MONTHS[toMonth - 1]}`;
}

function calendarTitle(state: CalendarState): string {
  if (state.view === "week") {
    const { from } = calendarWindow(state);
    return `Team week · ${dayRange(from, addDaysToDate(from, 6))}`;
  }
  // The calendar's own heading names the day or month, so the section head does not repeat it.
  return state.view === "day" ? "Team day" : "Team month";
}

/** "you're on late" in the mock-up; here the shift kind's own name. */
function ownShiftWords(own: readonly RosterAssignment[]): string {
  if (!own.length) return "you're off";
  const kind = own[0].kind;
  if (kind === "other") return "you're working";
  return `you're on ${SHIFT_KIND_LABEL[kind].toLowerCase()}`;
}

/**
 * Who is on now (mockup `rost_team`, "On now"): colleagues whose rostered
 * shift covers this moment. Then, when a shift of yours starts later today,
 * "On with you tonight" (or "today"): the colleagues whose shifts overlap it.
 * One team read over today and its neighbours feeds both. No phone buttons:
 * the roster holds no numbers, so the page ends with the signpost to On
 * Call's phone numbers instead. Each list hides while it has nobody in it.
 */
function TeamToday({ team, actorId, now }: { team: RosterTeam; actorId: string | null; now: Date }) {
  const today = perthDateOf(now);
  const range = useMemo(() => ({ from: addDaysToDate(today, -1), to: addDaysToDate(today, 1) }), [today]);
  const read = useRosterRead(team.serviceId, "assignments", range);
  if (read.status !== "ready") return null;
  const at = now.getTime();
  const rows = Array.isArray(read.data?.assignments) ? read.data.assignments : [];
  const colleague = (row: (typeof rows)[number]) => row.userId !== null && row.userId !== actorId;
  const onNow = rows
    .filter((row) => colleague(row) && Date.parse(row.startsAt) <= at && Date.parse(row.endsAt) > at)
    .sort((a, b) => a.endsAt.localeCompare(b.endsAt));
  const laterMine = actorId
    ? rows
        .filter((row) => row.userId === actorId && Date.parse(row.startsAt) > at && perthDateOf(row.startsAt) === today)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    : [];
  const withYou = laterMine.length
    ? rows
        .filter(
          (row) =>
            colleague(row) &&
            laterMine.some(
              (mine) =>
                Date.parse(row.startsAt) < Date.parse(mine.endsAt) &&
                Date.parse(row.endsAt) > Date.parse(mine.startsAt),
            ),
        )
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    : [];
  const first = laterMine[0];
  const tonight =
    !!first &&
    (first.kind === "night" || first.kind === "on_call" || Number(perthTimeOf(first.startsAt).slice(0, 2)) >= 17);
  const withYouTitle = tonight ? "On with you tonight" : "On with you today";
  const endWords = (row: (typeof rows)[number]) =>
    `until ${perthTimeOf(row.endsAt)}${perthDateOf(row.endsAt) !== today ? ` ${formatPerthDay(perthDateOf(row.endsAt))}` : ""}`;
  return (
    <>
      {onNow.length ? (
        <section aria-labelledby="roster-team-now" className="grid gap-3" data-testid="roster-team-on-now">
          <RosterSectionHead
            id="roster-team-now"
            title="On now"
            right={
              <span className="nums text-[0.71875rem] text-[color:var(--text-muted)]">{formatPerthDay(today)}</span>
            }
          />
          <RosterList label="On now">
            {onNow.map((row) => {
              const name = row.name ?? "Name not available";
              return (
                <RosterRow
                  key={row.id}
                  lead={<RosterInitials name={name} />}
                  title={name}
                  sub={`${SHIFT_KIND_LABEL[row.kind]} · ${endWords(row)}`}
                />
              );
            })}
          </RosterList>
        </section>
      ) : null}
      {first ? (
        <section aria-labelledby="roster-team-with-you" className="grid gap-3" data-testid="roster-team-with-you">
          <RosterSectionHead
            id="roster-team-with-you"
            title={withYouTitle}
            right={
              <span className="nums text-[0.71875rem] text-[color:var(--text-muted)]">
                {`Your ${SHIFT_KIND_LABEL[first.kind].toLowerCase()} · ${formatShiftRange(first)}`}
              </span>
            }
          />
          {withYou.length ? (
            <RosterList label={withYouTitle}>
              {withYou.map((row) => {
                const name = row.name ?? "Name not available";
                return (
                  <RosterRow
                    key={row.id}
                    lead={<RosterInitials name={name} />}
                    title={name}
                    sub={`${SHIFT_KIND_LABEL[row.kind]} · ${formatShiftRange(row)}`}
                  />
                );
              })}
            </RosterList>
          ) : (
            <RosterNote icon={Users}>Nobody else on the team is rostered with you.</RosterNote>
          )}
        </section>
      ) : null}
    </>
  );
}

/**
 * Who is on tomorrow. With a shift of your own, the colleagues whose shifts
 * overlap it; without one, everyone rostered to start tomorrow. Only named,
 * filled shifts are listed; an open shift is not a colleague.
 */
function OnTomorrow({ team, actorId, now }: { team: RosterTeam; actorId: string | null; now: Date }) {
  const tomorrow = addDaysToDate(perthDateOf(now), 1);
  const read = useRosterRead(team.serviceId, "assignments", {
    from: addDaysToDate(tomorrow, -1),
    to: addDaysToDate(tomorrow, 1),
  });
  const rows = Array.isArray(read.data?.assignments) ? read.data.assignments : [];
  const startingTomorrow = rows
    .filter((row) => assignmentStartDate(row) === tomorrow)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const own = actorId ? startingTomorrow.filter((row) => row.userId === actorId) : [];
  const others = startingTomorrow.filter((row) => row.userId !== null && row.userId !== actorId);
  const colleagues = own.length
    ? rows
        .filter(
          (row) =>
            row.userId !== null &&
            row.userId !== actorId &&
            own.some(
              (mine) =>
                Date.parse(row.startsAt) < Date.parse(mine.endsAt) &&
                Date.parse(row.endsAt) > Date.parse(mine.startsAt),
            ),
        )
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    : others;
  const day = formatPerthDay(tomorrow);
  const right =
    read.status === "ready" ? (
      <span className="text-sm text-[color:var(--text-muted)]">{actorId ? `${day} · ${ownShiftWords(own)}` : day}</span>
    ) : null;
  return (
    <section aria-labelledby="roster-team-tomorrow" className="grid gap-3">
      <RosterSectionHead
        id="roster-team-tomorrow"
        title={own.length ? "On with you tomorrow" : "On tomorrow"}
        right={right}
      />
      {read.status === "loading" ? (
        <RosterNote icon={Users}>Loading who&apos;s on tomorrow…</RosterNote>
      ) : read.status !== "ready" ? (
        <RosterNote icon={TriangleAlert} tone="warning" role="alert">
          <p>Couldn&apos;t load who&apos;s on tomorrow. {read.message}</p>
          <div>
            <button type="button" className={rosterOutlineButton} onClick={read.reload}>
              <RefreshCw aria-hidden="true" className="size-icon-sm" />
              Try again
            </button>
          </div>
        </RosterNote>
      ) : colleagues.length ? (
        <RosterList label={own.length ? "On with you tomorrow" : "On tomorrow"} testId="roster-team-tomorrow">
          {colleagues.map((row) => {
            const name = row.name ?? "Name not available";
            return (
              <RosterRow
                key={row.id}
                lead={<RosterInitials name={name} />}
                title={name}
                sub={`${SHIFT_KIND_LABEL[row.kind]} · ${formatShiftRange(row)}`}
              />
            );
          })}
        </RosterList>
      ) : (
        <RosterNote icon={Users}>
          {own.length ? "Nobody else on the team is rostered with you." : "Nobody on the team is rostered tomorrow."}
        </RosterNote>
      )}
    </section>
  );
}

/** The team calendar under a heading that names the week (or month, or day) it shows. */
function TeamCalendarSection({ team, actorId, now }: { team: RosterTeam; actorId: string | null; now: Date }) {
  const params = useSearchParams();
  const state = readCalendarState(params, perthDateOf(now));
  return (
    <section aria-labelledby="roster-team-calendar" className="grid gap-3">
      <RosterSectionHead id="roster-team-calendar" title={calendarTitle(state)} />
      <div data-roster-print className="contents">
        <TeamCalendar key={team.serviceId} team={team} actorId={actorId} now={now} />
      </div>
      {state.view === "day" ? null : <RosterFootnote testId="roster-team-legend">{LEGEND}</RosterFootnote>}
    </section>
  );
}

/** Phone numbers (in On Call), Join and (for managers) Manage, as the mock-up's last list. */
function TeamLinks({ manager }: { manager: boolean }) {
  return (
    <RosterList label="Teams">
      <RosterRow
        lead={<RosterIconLead icon={Phone} />}
        title="Phone numbers"
        sub="In On Call"
        href="/on-call/contacts"
      />
      <RosterRow
        lead={<RosterIconLead icon={Users} />}
        title="Join a team"
        sub="Paste an invite link or code"
        href="/roster/join"
      />
      {manager ? (
        <RosterRow
          lead={<RosterIconLead icon={Lock} />}
          title="Manage a team"
          sub="For rostering managers"
          href="/roster/manage"
        />
      ) : null}
    </RosterList>
  );
}

export function RosterTeamPage({ now: suppliedNow }: { readonly now?: Date } = {}) {
  const now = useRosterNow(suppliedNow);
  const teams = useRosterTeams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listed = Array.isArray(teams.data?.teams) ? teams.data.teams : [];
  const available = listed.filter((team) => team.enabled);
  const selected = available.find((team) => team.serviceId === selectedId) ?? available[0];
  const actorId = teams.data?.actorId ?? null;
  const manager = available.some((team) => team.role === "manager");
  // The band names the team (mockup eyebrow "Ward 4 consultants"), once a team is chosen.
  useModeBandHeading(selected ? { eyebrow: selected.name } : null);
  return (
    <InformationPageShell testId="roster-team-page" width="narrow">
      <RosterPageHeader icon={Users} eyebrow="Roster" title="Team" subtitle="Who's on, and the whole team calendar." />
      <div className="grid gap-3" data-mode-identity="roster">
        {teams.status === "loading" ? (
          <RosterNote icon={Users}>Loading your teams…</RosterNote>
        ) : teams.status !== "ready" ? (
          <RosterNote icon={TriangleAlert} tone="warning" role="alert">
            <p>{teams.message}</p>
            <div>
              <button type="button" className={rosterOutlineButton} onClick={teams.reload}>
                <RefreshCw aria-hidden="true" className="size-icon-sm" />
                Try again
              </button>
            </div>
          </RosterNote>
        ) : !selected ? (
          <>
            <WorkCard testId="roster-team-no-team">
              <WorkEmpty
                icon={Users}
                title={listed.length ? "Not confirmed yet" : "No team yet"}
                body={
                  listed.length
                    ? "This team hasn't been confirmed yet."
                    : "Appears once your manager adds you. Or join with the invite link or code your roster manager sent."
                }
                action={
                  listed.length ? undefined : (
                    <WorkButton icon={Users} href="/roster/join">
                      Join a team
                    </WorkButton>
                  )
                }
              />
            </WorkCard>
            <TeamLinks manager={false} />
          </>
        ) : (
          <>
            <RosterSampleNotice sample={teams.data?.sample} />
            {available.length > 1 ? (
              <label className="grid gap-1 px-1 text-sm text-[color:var(--text-muted)]">
                Team
                <select
                  className={rosterField}
                  value={selected.serviceId}
                  onChange={(event) => setSelectedId(event.target.value)}
                >
                  {available.map((team) => (
                    <option key={team.serviceId} value={team.serviceId}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="px-1 text-sm text-[color:var(--text-muted)]">{selected.name}</p>
            )}
            <TeamToday key={`today-${selected.serviceId}`} team={selected} actorId={actorId} now={now} />
            <OnTomorrow key={`tomorrow-${selected.serviceId}`} team={selected} actorId={actorId} now={now} />
            <Suspense fallback={<RosterNote icon={Users}>Loading the team roster…</RosterNote>}>
              <TeamCalendarSection team={selected} actorId={actorId} now={now} />
            </Suspense>
            <TeamLinks manager={manager} />
          </>
        )}
      </div>
    </InformationPageShell>
  );
}
