"use client";
import { managerWaiting } from "@/components/roster/manage/roster-manage-waiting";
import { useState } from "react";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeNotice } from "@/components/mode-kit/notice";
import { Button } from "@/components/ui/button";
import { useRosterTeams, useRosterRead, postRosterAction } from "@/components/roster/use-roster-team";
import { addDaysToDate, formatPerthDay, perthDateOf } from "@/lib/roster/shifts/perth-time";
import { personalRosterChanges, timelineSpan } from "@/lib/roster/team/team-view";
import type { RosterTeam } from "@/lib/roster/team/model";
import type { RosterDisplayShift } from "@/lib/roster/team/team-view";
import { WA_PUBLIC_HOLIDAYS } from "@/lib/on-call/wa-public-holidays";
import { formatShiftRange } from "@/components/roster/roster-format";
import { RosterChangeRows } from "@/components/roster/roster-change-rows";
import { teamChangeNotices } from "@/lib/roster/what-changed";
import { RosterSampleNotice } from "./roster-sample-notice";

function TeamSummary({
  team,
  actorId,
  now,
  enabledTeams,
  myShifts,
}: {
  team: RosterTeam;
  actorId: string;
  now: Date;
  enabledTeams: readonly RosterTeam[];
  myShifts: readonly RosterDisplayShift[];
}) {
  const today = perthDateOf(now);
  const overview = useRosterRead(team.serviceId, "overview");
  const shifts = useRosterRead(team.serviceId, "assignments", {
    from: addDaysToDate(today, -1),
    to: addDaysToDate(today, 7),
  });
  const requests = useRosterRead(team.serviceId, "requests");
  const manage = useRosterRead(team.role === "manager" ? team.serviceId : null, "manage");
  const myChanges = useRosterRead(
    overview.data?.latestPublication && !overview.data.seenLatest ? team.serviceId : null,
    "my_changes",
  );
  const publication = overview.data?.latestPublication;
  // A republished roster's changes stay in Needs you until the user taps "Got it". Opening the page
  // no longer marks the publication seen by itself, so a glance can't make the lines vanish unread.
  // The lines go only once the server has recorded "seen"; if that fails they stay and say so.
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [dismissFailed, setDismissFailed] = useState(false);
  const dismissChanges = () => {
    if (!publication) return;
    const publicationId = publication.id;
    setDismissFailed(false);
    void postRosterAction(team.serviceId, { action: "seen.mark", publicationId }).then((result) => {
      if (result.ok) setDismissedId(publicationId);
      else setDismissFailed(true);
    });
  };
  if (overview.status !== "ready" || !overview.data)
    return overview.status === "error" ? <ModeNotice tone="warning">{overview.message}</ModeNotice> : null;
  const assignments = Array.isArray(shifts.data?.assignments) ? shifts.data.assignments : [];
  const own = assignments.filter((row) => row.userId === actorId && timelineSpan(row, today));
  const colleagues = assignments.filter(
    (row) =>
      row.userId !== actorId &&
      own.some(
        (mine) =>
          Date.parse(row.startsAt) < Date.parse(mine.endsAt) && Date.parse(row.endsAt) > Date.parse(mine.startsAt),
      ),
  );
  const needsYou = (requests.data?.swaps ?? []).filter(
    (swap) => swap.counterpartyId === actorId && swap.status === "requested",
  );
  // The same count the Manage Inbox and the Settings "Manage" row show.
  const waiting = manage.data ? managerWaiting(manage.data, { decisionsInStrip: true, actorId }).count : 0;
  const cutoff = overview.data.nextCutoffOn;
  const holiday = Array.from({ length: 8 }, (_, offset) => addDaysToDate(today, offset)).find(
    (date) =>
      WA_PUBLIC_HOLIDAYS.has(date) && assignments.some((row) => row.userId === actorId && timelineSpan(row, date)),
  );
  const rotationEndsOn = overview.data.me.rotationEndsOn;
  const nextTeamShift = rotationEndsOn
    ? myShifts
        .filter(
          (shift) =>
            shift.source === "team" &&
            shift.serviceId !== team.serviceId &&
            perthDateOf(shift.startsAt) > rotationEndsOn,
        )
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]
    : null;
  const nextTeamName = enabledTeams.find((candidate) => candidate.serviceId === nextTeamShift?.serviceId)?.name;
  const unseen = Boolean(publication && !overview.data.seenLatest && dismissedId !== publication.id);
  const changed =
    unseen && myChanges.status === "ready" && myChanges.data
      ? personalRosterChanges(myChanges.data.before, myChanges.data.after)
      : [];
  const changeNotices = teamChangeNotices(changed, today);
  // When the change details could not be read, still say a new version is out rather than nothing.
  const genericNotice = unseen && publication && myChanges.status !== "loading" && changeNotices.length === 0;
  const detailsMissing = myChanges.status !== "ready";
  return (
    <>
      {dismissFailed && unseen ? (
        <ModeNotice tone="warning">Couldn&apos;t save that you&apos;ve seen the roster changes. Try again.</ModeNotice>
      ) : null}
      {needsYou.length > 0 || waiting > 0 || changeNotices.length > 0 ? (
        <ModeGroupedList eyebrow="Needs you" mode="roster">
          <RosterChangeRows
            notices={changeNotices}
            onDismiss={dismissChanges}
            testId={`roster-today-team-change-${team.serviceId}`}
          />
          {needsYou.map((swap) => (
            <ModeRow key={swap.id} title={`${swap.requesterName ?? "A colleague"} asks to swap`} href="/roster/swaps" />
          ))}
          {waiting > 0 ? <ModeRow title={`${waiting} waiting in Manage`} href="/roster/manage" /> : null}
        </ModeGroupedList>
      ) : null}
      {colleagues.length ? (
        <ModeGroupedList eyebrow="On with you" mode="roster">
          {colleagues.map((row) => (
            <ModeRow
              key={row.id}
              title={row.name ?? "Name not available"}
              subtitle={row.siteName ?? undefined}
              trailing={formatShiftRange(row)}
            />
          ))}
        </ModeGroupedList>
      ) : null}
      <ModeGroupedList>
        {rotationEndsOn ? (
          <ModeRow
            title={`${team.name} until ${formatPerthDay(rotationEndsOn)}${nextTeamName ? `, then ${nextTeamName}` : ""}`}
          />
        ) : null}
        {holiday ? <ModeRow title={`${formatPerthDay(holiday)} is a public holiday`} /> : null}
        {team.role === "member" && !overview.data.me.grade ? (
          <ModeRow title="Ask your manager to set your grade so you can swap." />
        ) : null}
        {cutoff && cutoff >= today && cutoff <= addDaysToDate(today, 14) ? (
          <ModeRow
            title={`Next roster closes ${formatPerthDay(cutoff)}. Add dates you can't work.`}
            href="/roster/requests?start=dates"
          />
        ) : null}
        {genericNotice ? (
          // A new version that changed none of your days from today on, or whose changes could not be
          // read: still say so, once.
          <ModeRow
            title={detailsMissing ? "Your roster may have changed" : "New roster published"}
            subtitle={
              detailsMissing
                ? `Version ${publication.version} · open your shifts to check`
                : `Version ${publication.version} · no change to your coming shifts`
            }
            href={detailsMissing ? "/roster/shifts" : undefined}
            trailing={
              <Button variant="secondary" size="sm" onClick={dismissChanges}>
                Got it
              </Button>
            }
          />
        ) : null}
        {team.role === "manager" ? (
          <ModeRow title="Manage" subtitle={team.name} href="/roster/manage" />
        ) : (
          <ModeRow title="Team" subtitle={team.name} href="/roster/team" />
        )}
      </ModeGroupedList>
    </>
  );
}
export function RosterTodayTeam({
  now,
  myShifts = [],
  sampleNoticeShown = false,
}: {
  now: Date;
  myShifts?: readonly RosterDisplayShift[];
  /** Today already says the whole page is an example, so the team strip need not say it again. */
  sampleNoticeShown?: boolean;
}) {
  const teams = useRosterTeams();
  if (teams.status !== "ready") return null;
  const enabled = (Array.isArray(teams.data?.teams) ? teams.data.teams : []).filter((team) => team.enabled);
  if (!enabled.length)
    return (
      <ModeGroupedList>
        <ModeRow title="Have an invite link? Open it here" href="/roster/join" />
      </ModeGroupedList>
    );
  if (!teams.data?.actorId)
    return (
      <ModeNotice tone="warning">Your team identity could not be loaded. Refresh before using team shifts.</ModeNotice>
    );
  return (
    <>
      <RosterSampleNotice sample={teams.data.sample && !sampleNoticeShown} />
      {enabled.map((team) => (
        <TeamSummary
          key={team.serviceId}
          team={team}
          actorId={teams.data!.actorId!}
          now={now}
          enabledTeams={enabled}
          myShifts={myShifts}
        />
      ))}
    </>
  );
}
