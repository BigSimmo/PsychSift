"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { rosterField } from "@/components/roster/roster-ui";

import { useRosterNow } from "@/components/roster/roster-format";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { fetchRosterRead, postRosterAction } from "@/components/roster/use-roster-team";
import { SHIFT_KIND_LABEL } from "@/lib/roster/shift-kind";
import { formatPerthDay, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import { openShiftCandidates } from "@/lib/roster/team/eligibility";
import type { RosterAction, RosterAssignment, RosterOverview } from "@/lib/roster/team/model";
import { zonedTimeOf } from "@/lib/work-time/format";

import { RosterSwapTicket } from "./roster-swap-ticket";
import { GIVE_AWAY_WORDS, isUrgentGiveAway, type RequestSent } from "./request-ui";

type Fresh = { assignments: RosterAssignment[]; overview: RosterOverview; readAt: Date };

export function RosterGiveAwaySheet(props: ComponentProps<typeof GiveAwaySession>) {
  return props.open ? (
    <GiveAwaySession
      key={JSON.stringify([props.serviceId, props.actorId, props.initialAssignmentId, props.urgent])}
      {...props}
    />
  ) : null;
}

function GiveAwaySession({
  open,
  onClose,
  serviceId,
  actorId,
  initialAssignmentId,
  urgent,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  serviceId: string;
  actorId: string;
  initialAssignmentId?: string | null;
  urgent?: boolean;
  onSent: RequestSent;
}) {
  const now = useRosterNow();
  const { zone } = useWorkTimeZone();
  const [fresh, setFresh] = useState<Fresh | null>(null);
  const [assignmentId, setAssignmentId] = useState(initialAssignmentId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let current = true;
    void Promise.all([
      fetchRosterRead(serviceId, "assignments", {
        from: perthDateOf(new Date()),
        to: new Date(Date.now() + 54 * 86_400_000).toISOString().slice(0, 10),
      }),
      fetchRosterRead(serviceId, "overview"),
    ]).then(([assignments, overview]) => {
      if (!current) return;
      if (!assignments.ok || !overview.ok) {
        setError("The team roster couldn't be checked. Close and try again.");
        return;
      }
      setFresh({ assignments: assignments.data.assignments, overview: overview.data, readAt: assignments.readAt });
    });
    return () => {
      current = false;
    };
  }, [open, serviceId, initialAssignmentId]);

  const mine = fresh?.assignments.filter((shift) => shift.userId === actorId && shift.kind !== "leave") ?? [];
  const shift = mine.find((item) => item.id === assignmentId);
  const candidates =
    fresh && shift
      ? openShiftCandidates(
          fresh.assignments,
          {
            startsAt: shift.startsAt,
            endsAt: shift.endsAt,
            minGrade: shift.grade,
            assignmentId: shift.id,
          },
          fresh.overview.settings,
          actorId,
        )
      : [];
  const isUrgent = urgent || (!!shift && isUrgentGiveAway(shift.startsAt, now));

  async function send(action: "open.post" | "open.report") {
    if (!shift || !actorId) return;
    setBusy(true);
    setError(null);
    const result = await postRosterAction(serviceId, { action, assignmentId: shift.id } as RosterAction);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const id = result.result.openShiftId;
    onSent(
      action === "open.report"
        ? GIVE_AWAY_WORDS.told
        : `Offered to ${candidates.map((candidate) => candidate.name ?? "colleague").join(" and ") || "your team"}`,
      id
        ? async () => {
            const reverse = await postRosterAction(serviceId, { action: "open.cancel", openShiftId: id });
            if (!reverse.ok) throw new Error(reverse.message);
          }
        : undefined,
    );
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={isUrgent ? GIVE_AWAY_WORDS.urgentTitle : GIVE_AWAY_WORDS.title}>
      <div className="grid gap-4">
        {!fresh && !error ? <p role="status">Checking the team roster…</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {fresh ? (
          <label className="grid gap-1 text-sm">
            My shift
            <select
              value={assignmentId}
              onChange={(event) => setAssignmentId(event.target.value)}
              className={rosterField}
            >
              <option value="">Choose a shift</option>
              {mine.map((item) => (
                <option value={item.id} key={item.id}>
                  {`${formatPerthDay(perthDateOf(item.startsAt))} · ${SHIFT_KIND_LABEL[item.kind]} ${perthTimeOf(item.startsAt)}–${perthTimeOf(item.endsAt)}`}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {shift ? <RosterSwapTicket shift={shift} label="Your shift" /> : null}
        {shift ? (
          <>
            <p>
              Who can take it: {candidates.length} {candidates.length === 1 ? "person" : "people"}
            </p>
            <ul className="grid gap-1 text-sm">
              {candidates.map((candidate) => (
                <li key={candidate.userId}>
                  {candidate.name ?? "Colleague"} · {candidate.grade} · free · {candidate.hoursSinceLastShift ?? "—"} h
                  since last shift
                </li>
              ))}
            </ul>
            {isUrgent ? <p>{GIVE_AWAY_WORDS.ringIn}</p> : null}
            <p className="text-xs text-[color:var(--text-muted)]">Rechecked {zonedTimeOf(fresh!.readAt, zone)}</p>
            <Button
              variant="primary"
              disabled={busy || (!isUrgent && candidates.length === 0)}
              onClick={() => void send(isUrgent ? "open.report" : "open.post")}
            >
              {isUrgent
                ? GIVE_AWAY_WORDS.urgentButton
                : `Offer to ${candidates.length === 1 ? "1 person" : `${candidates.length} people`}`}
            </Button>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
