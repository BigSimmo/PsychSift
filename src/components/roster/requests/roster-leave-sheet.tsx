"use client";

import { CalendarCheck, CalendarX, Users } from "lucide-react";
import { useEffect, useState, type ComponentProps } from "react";

import { WorkCard, WorkIconRow, WorkSectionLabel } from "@/components/mode-kit/work";
import { rosterField } from "@/components/roster/roster-ui";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { RosterLeaveStaffingCheck } from "@/components/roster/staffing/roster-leave-staffing-check";
import { fetchRosterRead, postRosterAction } from "@/components/roster/use-roster-team";
import { NewWorkModeOnly } from "@/components/work-mode-launch/work-mode-launch-provider";
import { SHIFT_KIND_LABEL } from "@/lib/roster/shift-kind";
import { formatPerthDay, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import type { RosterAssignment, RosterTeam } from "@/lib/roster/team/model";
import type { RosterLeave } from "@/lib/roster/leave";

import { clashDayWords, leaveChecks } from "./roster-leave-checks";
import { RosterSwapTicket } from "./roster-swap-ticket";
import type { RequestSent } from "./request-ui";

type LeaveBody = {
  kind: "annual" | "pd_leave";
  startsOn: string;
  endsOn: string;
  status: "planned" | "applied" | "approved";
  serviceId: string | null;
};

export function RosterLeaveSheet(props: ComponentProps<typeof LeaveSession>) {
  return props.open ? (
    <LeaveSession
      key={JSON.stringify([
        props.actorId,
        props.initialDate,
        props.initialTo,
        props.existing,
        props.teams.map((team) => team.serviceId),
      ])}
      {...props}
    />
  ) : null;
}

function LeaveSession({
  open,
  onClose,
  teams,
  actorId,
  assignments,
  assignmentsReady = true,
  loadedTo = null,
  initialDate,
  initialTo,
  existing,
  onSent,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  teams: RosterTeam[];
  actorId: string;
  assignments: RosterAssignment[];
  /** False while the team roster read is loading or failed: the checks then say "not checked". */
  assignmentsReady?: boolean;
  /** The last day the team roster read covers. Without it the checks claim nothing past the clashes. */
  loadedTo?: string | null;
  initialDate?: string | null;
  initialTo?: string | null;
  existing?: RosterLeave | null;
  onSent: RequestSent;
  onSaved: (leave: RosterLeave) => void;
  onDeleted: (id: string) => void;
}) {
  const [kind, setKind] = useState<LeaveBody["kind"]>(existing?.kind ?? "annual");
  const [status, setStatus] = useState<LeaveBody["status"]>(existing?.status ?? "planned");
  const [startsOn, setStartsOn] = useState(existing?.startsOn ?? initialDate ?? "");
  const [endsOn, setEndsOn] = useState(existing?.endsOn ?? initialTo ?? initialDate ?? "");
  const [serviceId, setServiceId] = useState<string | null>(
    existing?.serviceId ?? (teams.length === 1 ? teams[0]!.serviceId : null),
  );
  const [overlapRead, setOverlapRead] = useState<{
    key: string;
    value: number | null;
    status: "idle" | "error";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const span =
    startsOn && endsOn
      ? Math.round((Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) / 86_400_000)
      : -1;
  const valid = span >= 0 && span <= 366;
  const canOverlap = !!serviceId && valid && span <= 61;
  const overlapKey = JSON.stringify([serviceId, startsOn, endsOn]);
  const currentOverlap = canOverlap && overlapRead?.key === overlapKey ? overlapRead : null;
  const overlap = currentOverlap?.value ?? null;
  const overlapState = !canOverlap ? "idle" : (currentOverlap?.status ?? "loading");

  useEffect(() => {
    if (!open || !canOverlap || !serviceId) return;
    let current = true;
    void fetchRosterRead(serviceId, "leave_overlap", { from: startsOn, to: endsOn }).then((result) => {
      if (!current) return;
      setOverlapRead({
        key: overlapKey,
        value: result.ok ? result.data.alreadyOff : null,
        status: result.ok ? "idle" : "error",
      });
    });
    return () => {
      current = false;
    };
  }, [open, canOverlap, serviceId, startsOn, endsOn, overlapKey]);

  const covered =
    serviceId && valid
      ? assignments.filter(
          (shift) =>
            shift.userId === actorId &&
            perthDateOf(shift.startsAt) <= endsOn &&
            perthDateOf(shift.endsAt) >= startsOn &&
            shift.kind !== "leave",
        )
      : [];

  async function save() {
    if (!valid || !startsOn || !endsOn) {
      setError("Check the dates. Leave can span up to 366 days.");
      return;
    }
    if (!existing && teams.length > 1 && !serviceId) {
      setError("Choose one team for this leave entry.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/roster/leave", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          existing
            ? { id: existing.id, startsOn, endsOn, status }
            : ({ kind, startsOn, endsOn, status, serviceId } satisfies LeaveBody),
        ),
        cache: "no-store",
      });
      const payload = (await response.json()) as { leave?: RosterLeave; message?: string };
      if (!response.ok || !payload.leave) {
        setError(payload.message ?? "Leave couldn't be saved. Try again.");
        return;
      }
      onSaved(payload.leave);
      const id = payload.leave.id;
      onSent(existing ? "Leave updated" : "Leave planned", async () => {
        const reverse = await fetch("/api/roster/leave", {
          method: existing ? "PATCH" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            existing ? { id, startsOn: existing.startsOn, endsOn: existing.endsOn, status: existing.status } : { id },
          ),
          cache: "no-store",
        });
        if (!reverse.ok) throw new Error("Could not undo leave.");
      });
      onClose();
    } catch {
      setError("Leave couldn't be reached. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/roster/leave", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: existing.id }),
        cache: "no-store",
      });
      if (!response.ok) {
        setError("Leave couldn't be removed. Try again.");
        return;
      }
      onDeleted(existing.id);
      onSent("Leave removed", async () => {
        const reverse = await fetch("/api/roster/leave", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: existing.kind,
            startsOn: existing.startsOn,
            endsOn: existing.endsOn,
            status: existing.status,
            serviceId: existing.serviceId,
          }),
          cache: "no-store",
        });
        if (!reverse.ok) throw new Error("Could not restore leave.");
      });
      onClose();
    } catch {
      setError("Leave couldn't be reached. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function offer(shift: RosterAssignment) {
    if (!serviceId) return;
    const response = await postRosterAction(serviceId, { action: "open.post", assignmentId: shift.id });
    if (!response.ok) {
      setError(response.message);
      return;
    }
    onSent(
      "Shift offered to your team",
      response.result.openShiftId
        ? async () => {
            const reverse = await postRosterAction(serviceId, {
              action: "open.cancel",
              openShiftId: response.result.openShiftId!,
            });
            if (!reverse.ok) throw new Error(reverse.message);
          }
        : undefined,
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title={existing ? "Review leave" : "Plan leave"}>
      <div className="grid gap-4">
        <p className="text-sm">Keep your HR application up to date too. No reason is recorded here.</p>
        <label className="grid gap-1 text-sm">
          Kind
          <select
            value={kind}
            disabled={!!existing}
            onChange={(event) => setKind(event.target.value as LeaveBody["kind"])}
            className={rosterField}
          >
            <option value="annual">Annual leave</option>
            <option value="pd_leave">Professional development leave</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          From
          <input
            type="date"
            value={startsOn}
            min={perthDateOf(new Date())}
            onChange={(event) => setStartsOn(event.target.value)}
            className={rosterField}
          />
        </label>
        <label className="grid gap-1 text-sm">
          To
          <input
            type="date"
            value={endsOn}
            min={startsOn || perthDateOf(new Date())}
            onChange={(event) => setEndsOn(event.target.value)}
            className={rosterField}
          />
        </label>
        <label className="grid gap-1 text-sm">
          HR status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as LeaveBody["status"])}
            className={rosterField}
          >
            <option value="planned">Planned · also lodge in HR</option>
            <option value="applied">Applied in HR</option>
            <option value="approved">Approved in HR</option>
          </select>
        </label>
        {teams.length > 1 ? (
          <label className="grid gap-1 text-sm">
            Team
            <select
              value={serviceId ?? ""}
              disabled={!!existing}
              onChange={(event) => setServiceId(event.target.value || null)}
              className={rosterField}
            >
              <option value="">Choose a team</option>
              {teams.map((team) => (
                <option key={team.serviceId} value={team.serviceId}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {serviceId && valid && startsOn && endsOn ? (
          <section className="grid gap-2" aria-labelledby="roster-leave-checks" data-testid="roster-leave-checks">
            <WorkSectionLabel id="roster-leave-checks">Checks</WorkSectionLabel>
            <WorkCard as="ul">
              <LeaveCheckRows
                assignments={assignments}
                ready={assignmentsReady}
                actorId={actorId}
                startsOn={startsOn}
                endsOn={endsOn}
                loadedTo={loadedTo}
              />
              {canOverlap ? (
                <li>
                  <WorkIconRow
                    icon={Users}
                    tone="neutral"
                    title="Others off in your team"
                    sub={
                      overlapState === "loading" ? (
                        <span role="status">Checking how many are off…</span>
                      ) : overlapState === "error" ? (
                        <span role="alert">Team overlap couldn&apos;t be checked. Try again before saving.</span>
                      ) : overlap !== null ? (
                        <span>
                          {overlap} of the team {overlap === 1 ? "is" : "are"} already off these dates
                        </span>
                      ) : null
                    }
                  />
                </li>
              ) : null}
            </WorkCard>
          </section>
        ) : null}
        {serviceId && valid ? (
          <NewWorkModeOnly>
            <section
              className="grid gap-2"
              aria-label="Team staffing on these dates"
              data-testid="leave-staffing-check"
            >
              <RosterLeaveStaffingCheck
                serviceId={serviceId}
                actorId={actorId || null}
                startsOn={startsOn}
                endsOn={endsOn}
                today={perthDateOf(new Date())}
              />
            </section>
          </NewWorkModeOnly>
        ) : null}
        {serviceId && valid && covered.length ? (
          <section className="grid gap-2">
            <h3 className="font-medium">Your team shifts during leave</h3>
            {covered.map((shift) => (
              <div key={shift.id} className="grid gap-2">
                <RosterSwapTicket shift={shift} label="Team shift" />
                <Button onClick={() => void offer(shift)}>Offer as open shift</Button>
              </div>
            ))}
          </section>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <Button
          variant="primary"
          busy={busy}
          disabled={!valid || (canOverlap && overlapState !== "idle") || (!existing && teams.length > 1 && !serviceId)}
          onClick={() => void save()}
        >
          {existing ? "Save changes" : "Save leave"}
        </Button>
        {existing ? (
          <Button variant="secondary" disabled={busy} onClick={() => void remove()}>
            Remove leave
          </Button>
        ) : null}
      </div>
    </Sheet>
  );
}

/**
 * Clashes and first shift back, from the team roster the page already read.
 * Says "not checked" rather than "no clashes" while that read isn't ready.
 */
function LeaveCheckRows({
  assignments,
  ready,
  actorId,
  startsOn,
  endsOn,
  loadedTo,
}: {
  assignments: RosterAssignment[];
  ready: boolean;
  actorId: string;
  startsOn: string;
  endsOn: string;
  loadedTo: string | null;
}) {
  if (!ready || !actorId || !loadedTo) {
    return (
      <li>
        <WorkIconRow
          icon={CalendarX}
          tone="neutral"
          title="Clashes: not checked"
          sub="Your team roster hasn't loaded, so clashes can't be checked yet."
          testId="roster-leave-check-clashes"
        />
      </li>
    );
  }
  const checks = leaveChecks(assignments, actorId, startsOn, endsOn, loadedTo);
  const count = checks.clashes.length;
  const atLeast = checks.clashesPartial ? "at least " : "";
  const back = checks.firstBack;
  return (
    <>
      <li>
        <WorkIconRow
          icon={CalendarX}
          tone={count ? "amber" : "neutral"}
          title={
            count
              ? `Clashes with ${atLeast}${count} ${count === 1 ? "shift" : "shifts"}`
              : checks.clashesPartial
                ? "No clashes in the loaded roster"
                : "No clashes with your team shifts"
          }
          sub={[
            count
              ? clashDayWords(
                  checks.clashes.map((shift) => perthDateOf(shift.startsAt)),
                  formatPerthDay,
                )
              : null,
            checks.clashesPartial ? `Roster loaded to ${formatPerthDay(loadedTo)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          testId="roster-leave-check-clashes"
        />
      </li>
      <li>
        <WorkIconRow
          icon={CalendarCheck}
          tone="neutral"
          title="First shift back"
          sub={
            back
              ? `${formatPerthDay(perthDateOf(back.startsAt))} · ${SHIFT_KIND_LABEL[back.kind]} from ${perthTimeOf(back.startsAt)}`
              : checks.firstBackState === "loaded"
                ? `No team shift by ${formatPerthDay(loadedTo)}`
                : "Your roster isn't loaded that far yet"
          }
          testId="roster-leave-check-back"
        />
      </li>
    </>
  );
}
