"use client";

import { ArrowDown, CheckCheck, Eye, Hourglass } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { RosterStat } from "@/components/roster/roster-ui";
import { goToNeedsYou } from "@/components/roster/team/calendar/needs-you-strip";
import { useRosterRead } from "@/components/roster/use-roster-team";
import { addDaysToDate, formatPerthDay, perthDateOf } from "@/lib/roster/shifts/perth-time";
import type { RosterOverview } from "@/lib/roster/team/model";
import { coverGaps, coverReadWindow, RosterCoverGap } from "./roster-cover-tab";
import { managerReason, RosterDecisionSheet, type ManagerDecision } from "./roster-decision-sheet";
import { managerWaiting } from "./roster-manage-waiting";

/** The manage reload shared with the calendar on the Manage page (see `ManagerTeam`). */
export type SharedManageReload = {
  round: number;
  changedBy: string;
  onChanged: (changedBy: string) => void;
};

/** A read that answered with anything but data (an error, signed out, unavailable). */
const readFailed = (status: string) => status !== "ready" && status !== "loading";

/** The three figures on one row at every width, as a list so they are read as a set (no tile left alone). */
const STATS_GRID = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,5.5rem),1fr))] gap-2";

/**
 * The manager's Inbox: one list of everything waiting on them, in order —
 * swaps to approve, open shifts someone has taken, shifts someone can't make,
 * then days short of the team's targets. Each request opens the Review sheet,
 * which rechecks it live before anything is sent; each short day opens the
 * same "Post gap" sheet the Cover tab uses.
 *
 * The section keeps its `approve` id (and this component its name) so nothing
 * that points at the old Approve tab breaks.
 */
export function RosterApproveTab({
  serviceId,
  shared,
  decisionsInStrip = false,
  actorId = null,
  overview,
}: {
  serviceId: string;
  shared?: SharedManageReload;
  /**
   * The calendar's Needs you strip is showing on this page, so waiting swaps
   * and taken shifts are decided there (inline, rechecked live) and this tab
   * points to it instead of listing them a second time.
   */
  decisionsInStrip?: boolean;
  /** The reader, whose own swaps the strip leaves out (the server refuses them). */
  actorId?: string | null;
  /**
   * The team overview the Manage page already holds. With it, the Inbox also
   * lists the days short of the team's targets (the Cover tab's own reads and
   * gap rows); without it, the Inbox lists requests only.
   */
  overview?: RosterOverview;
}) {
  const manage = useRosterRead(serviceId, "manage");
  const reloadManage = manage.reload;
  const round = shared?.round ?? 0;
  const changedBy = shared?.changedBy;
  // Only a round started elsewhere after this tab opened; opening the tab reads afresh anyway.
  const seenRound = useRef(round);
  useEffect(() => {
    if (round === seenRound.current) return;
    seenRound.current = round;
    if (changedBy !== "approve") reloadManage();
  }, [round, changedBy, reloadManage]);
  const people = useRosterRead(serviceId, "people");
  const today = perthDateOf(new Date());
  const leave = useRosterRead(serviceId, "team_leave", { from: today, to: addDaysToDate(today, 61) });
  const coverServiceId = overview ? serviceId : null;
  const assignments = useRosterRead(coverServiceId, "assignments", coverReadWindow(today));
  const maker = useRosterRead(coverServiceId, "maker");
  const [decision, setDecision] = useState<ManagerDecision | null>(null);
  if (!manage.data || !people.data) {
    const failed = manage.status === "error" || people.status === "error";
    return (
      <div role={failed ? "alert" : "status"}>
        <p>{manage.message ?? people.message ?? "Loading requests…"}</p>
        {failed ? (
          <Button
            onClick={() => {
              manage.reload();
              people.reload();
            }}
          >
            Try again
          </Button>
        ) : null}
      </div>
    );
  }
  const names = new Map(
    people.data.people.map((person) => [person.userId, person.displayName ?? person.rosterName ?? "Team member"]),
  );
  const { swaps, claimed, reported } = managerWaiting(manage.data, { decisionsInStrip, actorId });
  const waiting = swaps.length + claimed.length + reported.length;
  // The strip decides swaps and taken shifts; a shift someone can't make is only decided here.
  const inStrip = decisionsInStrip ? swaps.length + claimed.length : 0;
  const listedSwaps = decisionsInStrip ? [] : swaps;
  const listedOpen = decisionsInStrip ? reported : [...claimed, ...reported];
  // Short days come from the Cover tab's own reads and gap rule, so the two lists always agree.
  const coverFailed = readFailed(assignments.status) || readFailed(maker.status);
  const coverReady = !overview || (assignments.status === "ready" && maker.status === "ready");
  const gaps =
    overview && coverReady && assignments.data && maker.data
      ? coverGaps(today, assignments.data.assignments ?? [], maker.data.needs ?? [])
      : [];
  const auto = manage.data.swaps.filter((swap) => swap.status === "approved" && swap.autoApproved).length;
  const seen = manage.data.seen;
  const listed = listedSwaps.length + listedOpen.length + gaps.length;
  return (
    <section className="grid gap-4" aria-label="Inbox">
      <ul className={STATS_GRID} aria-label="Summary">
        <li>
          <RosterStat stacked icon={Hourglass} label="Waiting" value={waiting} testId="roster-stat-waiting" />
        </li>
        <li>
          <RosterStat stacked icon={CheckCheck} label="Auto-approved" value={auto} testId="roster-stat-auto" />
        </li>
        {seen ? (
          <li>
            <RosterStat
              stacked
              icon={Eye}
              label={`Seen roster v${seen.version}`}
              value={`${seen.seen} of ${seen.members}`}
              testId="roster-stat-seen"
            />
          </li>
        ) : null}
      </ul>
      {!waiting && !gaps.length && coverReady ? <p>Nothing waiting for your decision.</p> : null}
      {inStrip ? (
        <div className="grid gap-2">
          <p className="text-sm text-[color:var(--text-muted)]">
            {`${inStrip} ${inStrip === 1 ? "request is" : "requests are"} in Needs you, beside the calendar, where you can approve or decline each one.`}
          </p>
          <Button icon={ArrowDown} onClick={goToNeedsYou}>
            Go to Needs you
          </Button>
        </div>
      ) : null}
      {listed ? (
        <ul
          className="divide-y divide-[color:var(--border)] rounded-xl border border-[color:var(--border)]"
          data-testid="roster-inbox-list"
        >
          {listedSwaps.map((swap) => (
            <li key={swap.id} data-inbox-kind="swap">
              <button
                type="button"
                className="grid min-h-12 w-full gap-1 p-4 text-left"
                onClick={() => setDecision({ kind: "swap", item: swap })}
              >
                <span>
                  Swap · {names.get(swap.requesterId) ?? "Team member"} and{" "}
                  {names.get(swap.counterpartyId) ?? "Team member"}
                </span>
                {swap.needsManagerBecause ? (
                  <span className="text-sm text-muted-foreground">{managerReason[swap.needsManagerBecause]}</span>
                ) : null}
              </button>
            </li>
          ))}
          {listedOpen.map((shift) => (
            <li key={shift.id} data-inbox-kind={shift.status}>
              <button
                type="button"
                className="grid min-h-12 w-full gap-1 p-4 text-left"
                onClick={() => setDecision({ kind: "open", item: shift })}
              >
                <span>
                  {shift.status === "reported"
                    ? `${names.get(shift.postedBy ?? "") ?? "A team member"} can't make ${formatPerthDay(perthDateOf(shift.startsAt))} ${shift.kind}`
                    : `Taken by ${names.get(shift.claimedBy ?? "") ?? "a team member"} · needs your approval`}
                </span>
              </button>
            </li>
          ))}
          {overview && assignments.data
            ? gaps.map(({ date, need }) => (
                <li key={`${date}-${need.id}`} data-inbox-kind="short">
                  <RosterCoverGap
                    inList
                    date={date}
                    need={need}
                    assignments={assignments.data!.assignments}
                    overview={overview}
                    serviceId={serviceId}
                    onPosted={() => {
                      manage.reload();
                      shared?.onChanged("approve");
                    }}
                  />
                </li>
              ))
            : null}
        </ul>
      ) : null}
      {overview && coverFailed ? (
        <div role="alert" className="grid gap-2">
          <p>{assignments.message ?? maker.message}</p>
          <Button
            onClick={() => {
              assignments.reload();
              maker.reload();
            }}
          >
            Try again
          </Button>
        </div>
      ) : overview && !coverReady ? (
        <p role="status">Loading cover…</p>
      ) : null}
      {leave.data?.leave.length ? (
        <section className="grid gap-2">
          <h2>Planned leave</h2>
          <p className="text-sm text-muted-foreground">Leave is approved in HR.</p>
          {leave.data.leave.map((row, index) => (
            <p key={`${row.userId}-${row.startsOn}-${index}`}>
              Leave · {row.name ?? names.get(row.userId) ?? "Team member"} · {formatPerthDay(row.startsOn)}–
              {formatPerthDay(row.endsOn)}
            </p>
          ))}
        </section>
      ) : null}
      {decision ? (
        <RosterDecisionSheet
          serviceId={serviceId}
          decision={decision}
          onClose={() => setDecision(null)}
          onChanged={() => {
            manage.reload();
            shared?.onChanged("approve");
          }}
        />
      ) : null}
    </section>
  );
}
