"use client";

import { Copy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { modeInsetHairline } from "@/components/mode-kit/recipes";
import { useRosterNow } from "@/components/roster/roster-format";
import { fetchRosterRead, postRosterAction } from "@/components/roster/use-roster-team";
import { Button, buttonFaceClass } from "@/components/ui/button";
import { formatHours, gradeLabel, hoursBetween, kindLabel } from "@/lib/open-shifts/model";
import { postAgainHref } from "@/lib/open-shifts/post-plan";
import { whoCouldDoThis, whoCouldWindow, type WhoCould } from "@/lib/open-shifts/who-could";
import { perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import type { RosterAction } from "@/lib/roster/team/model";

import { ConfirmSheet } from "./open-shifts-confirm";
import { SignInAction } from "./open-shifts-sign-in";
import { LoadFailed, NoTeam } from "./open-shifts-states";
import {
  FlatList,
  FootAction,
  ListSkeleton,
  OPEN_SHIFTS_HREF,
  SectionHeading,
  SubHeader,
  formatDayLong,
  formatDayShort,
  formatShiftTimes,
} from "./open-shifts-ui";
import { usePostedShifts, type PostedShift } from "./use-posted-shifts";

type Pending = "approve" | "decline" | "cancel" | "release" | null;

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name
    .replace(/^Dr\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?"
  );
}

function ShiftSummary({ shift }: { shift: PostedShift }) {
  return (
    <div className="rounded-md bg-[color:var(--surface-subtle)] px-4 py-3">
      <p className="font-semibold text-[color:var(--text-heading)]">{`${gradeLabel(shift.minGrade)} · ${kindLabel(shift.kind)}`}</p>
      <p className="nums">{`${formatDayShort(perthDateOf(shift.startsAt))}, ${formatShiftTimes(shift.startsAt, shift.endsAt)}`}</p>
      <p className="text-[color:var(--text-muted)]">{shift.siteName ?? shift.teamName}</p>
    </div>
  );
}

type WhoCouldState =
  { status: "loading" } | { status: "failed" } | { status: "ready"; result: WhoCould; unavailabilityChecked: boolean };

/**
 * "Who could do this": team members at or above the shift's level with nothing on their team roster at
 * the same time, from the reads a roster manager already makes. Names and level only; nobody is
 * messaged. A failed members or roster read shows no list at all, never a guess.
 */
function WhoCouldDoThis({ shift, actorId }: { shift: PostedShift; actorId: string | null }) {
  const [state, setState] = useState<WhoCouldState>({ status: "loading" });
  const [generation, setGeneration] = useState(0);
  const { serviceId, startsAt, endsAt, minGrade } = shift;

  useEffect(() => {
    let cancelled = false;
    const range = whoCouldWindow(startsAt, endsAt);
    void Promise.all([
      fetchRosterRead(serviceId, "members"),
      fetchRosterRead(serviceId, "assignments", range),
      fetchRosterRead(serviceId, "unavailability", range),
    ]).then(([members, assignments, unavailability]) => {
      if (cancelled) return;
      if (!members.ok || !assignments.ok) {
        setState({ status: "failed" });
        return;
      }
      setState({
        status: "ready",
        unavailabilityChecked: unavailability.ok,
        result: whoCouldDoThis({
          shift: { startsAt, endsAt, minGrade },
          members: members.data.members,
          assignments: assignments.data.assignments,
          unavailability: unavailability.ok ? unavailability.data.unavailability : null,
          actorId,
        }),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [serviceId, startsAt, endsAt, minGrade, actorId, generation]);

  const left =
    state.status === "ready"
      ? [
          state.result.busy > 0
            ? `${state.result.busy} at the right level ${state.result.busy === 1 ? "is" : "are"} already rostered then`
            : null,
          state.result.cantWork > 0 ? `${state.result.cantWork} said they can't work that day` : null,
        ].filter(Boolean)
      : [];

  return (
    <section aria-labelledby="open-shifts-who-could">
      <SectionHeading
        id="open-shifts-who-could"
        count={state.status === "ready" ? state.result.people.length : undefined}
      >
        Who could do this
      </SectionHeading>
      {state.status === "loading" ? (
        <p className="px-3 text-sm text-[color:var(--text-muted)]">Checking the team roster…</p>
      ) : state.status === "failed" ? (
        <div className="px-3 text-sm text-[color:var(--text-muted)]">
          <p>The team roster couldn&apos;t be read, so nobody is listed.</p>
          <button
            type="button"
            onClick={() => {
              setState({ status: "loading" });
              setGeneration((value) => value + 1);
            }}
            className="inline-flex min-h-12 items-center font-medium text-[color:var(--mode-identity)] focus-visible:outline-2 focus-visible:outline-[color:var(--command)]"
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          {state.result.people.length > 0 ? (
            <FlatList label="Team members who could do this shift">
              {state.result.people.map((person) => (
                <li
                  key={person.userId}
                  className={`${modeInsetHairline} flex min-h-12 flex-col justify-center px-3 py-2`}
                >
                  <span className="text-base-minus font-medium text-[color:var(--text-heading)]">
                    {`${person.name ?? "Name not set"}${person.isYou ? " (you)" : ""}`}
                  </span>
                  <span className="text-sm text-[color:var(--text-muted)]">
                    {[gradeLabel(person.grade), person.prefersOff ? "Would rather have the day off" : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </FlatList>
          ) : (
            <p className="px-3 text-sm text-[color:var(--text-muted)]">
              Nobody at the right level is free on the team roster then.
            </p>
          )}
          <p className="px-3 pt-2 text-xs text-[color:var(--text-muted)]">
            {[
              left.length ? `Not listed: ${left.join("; ")}.` : null,
              state.unavailabilityChecked ? null : "Days people said they can't work couldn't be checked.",
              "From the team roster only, not other jobs or private shifts. Nobody is told they're listed.",
            ]
              .filter(Boolean)
              .join(" ")}
          </p>
        </>
      )}
    </section>
  );
}

export function OpenShiftsPostedShiftPage({ serviceId, openShiftId }: { serviceId: string; openShiftId: string }) {
  const state = usePostedShifts();
  const router = useRouter();
  const [pending, setPending] = useState<Pending>(null);
  const nowMs = useRosterNow().getTime();
  const shift = state.shifts.find((row) => row.serviceId === serviceId && row.id === openShiftId) ?? null;
  const back = `${OPEN_SHIFTS_HREF}/post`;

  async function act(action: Exclude<Pending, null>): Promise<string | null> {
    if (!shift) return "This shift couldn't be found.";
    const body =
      action === "approve"
        ? { action: "open.approve", openShiftId: shift.id }
        : action === "decline"
          ? { action: "open.decline", openShiftId: shift.id }
          : action === "release"
            ? { action: "open.release", openShiftId: shift.id, urgent: false }
            : { action: "open.cancel", openShiftId: shift.id };
    const result = await postRosterAction(shift.serviceId, body as RosterAction);
    if (!result.ok) return `Nothing changed. ${result.message}`;
    setPending(null);
    state.reload();
    if (action === "cancel") router.push(back);
    return null;
  }

  if (state.status === "loading") {
    return (
      <div className="mx-auto w-full max-w-reading" data-mode-identity="open-shifts">
        <SubHeader backHref={back} backLabel="Post" title="Your posted shift" />
        <ListSkeleton rows={3} />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="mx-auto w-full max-w-reading" data-mode-identity="open-shifts">
        <SubHeader backHref={back} backLabel="Post" title="Your posted shift" />
        <LoadFailed what="This shift" message={state.message} onRetry={state.reload} />
      </div>
    );
  }
  if (state.status === "signed-out" || state.status === "no-team") {
    return (
      <div className="mx-auto w-full max-w-reading" data-mode-identity="open-shifts">
        <SubHeader backHref={back} backLabel="Post" title="Your posted shift" />
        {state.status === "signed-out" ? <SignInAction label="Sign in to see posted shifts" /> : <NoTeam />}
      </div>
    );
  }
  if (!shift || state.status !== "ready") {
    return (
      <div className="mx-auto w-full max-w-reading" data-mode-identity="open-shifts">
        <SubHeader backHref={back} backLabel="Post" title="Your posted shift" />
        <p className="px-3 py-8 text-sm text-[color:var(--text-muted)]">
          {state.status === "ready"
            ? "This shift is no longer in your teams' list. It may have been closed or already worked."
            : "Only a team's roster managers can see posted shifts."}
        </p>
      </div>
    );
  }

  const date = perthDateOf(shift.startsAt);
  const started = Date.parse(shift.startsAt) <= nowMs;
  const ownClaim = shift.claimedBy !== null && shift.claimedBy === state.actorId;
  const live = (shift.status === "open" || shift.status === "claimed") && !started;
  // A stale list (offline, or the last refresh failed) could show a request that's already decided.
  const disabled = state.offline || state.refreshFailed;

  return (
    <div className="mx-auto w-full max-w-reading pb-10" data-mode-identity="open-shifts" data-page-width="wide">
      <SubHeader backHref={back} backLabel="Post" title="Your posted shift" />

      <div className="px-3 pt-2">
        <p className="text-2xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
          {formatDayLong(date)}
        </p>
        <p className="mt-1 text-xl font-semibold nums text-[color:var(--text-heading)]">
          {`${formatShiftTimes(shift.startsAt, shift.endsAt)} · ${shift.siteName ?? shift.teamName}`}
        </p>
        <p className="mt-1 text-sm text-[color:var(--text-muted)]">
          {[
            `${gradeLabel(shift.minGrade)} · ${kindLabel(shift.kind)}`,
            formatHours(hoursBetween(shift.startsAt, shift.endsAt)),
            `code ${shift.shiftCode}`,
            shift.urgent ? "Urgent" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {shift.status === "reported" ? (
        <section>
          <SectionHeading>Reported</SectionHeading>
          <p className="px-3 text-sm text-[color:var(--text)]">
            {`${shift.postedByName ?? "A team member"} can't work this shift. Post it to the team so others can ask for it, or close it if it's been covered another way.`}
          </p>
          <FootAction>
            <Button variant="primary" block disabled={disabled || started} onClick={() => setPending("release")}>
              Post to team
            </Button>
            <Button variant="ghost" block disabled={disabled || started} onClick={() => setPending("cancel")}>
              Close: covered another way
            </Button>
          </FootAction>
        </section>
      ) : shift.status === "claimed" ? (
        <section>
          <SectionHeading count={1}>Request</SectionHeading>
          <div className="flex items-start gap-3 px-3 py-2">
            <span
              aria-hidden="true"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[color:var(--mode-identity-soft)] text-sm font-semibold text-[color:var(--text-heading)]"
            >
              {initials(shift.claimantName)}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-base-minus font-medium text-[color:var(--text-heading)]">
                {shift.claimantName ?? "A team member"}
              </span>
              <span className="text-sm nums text-[color:var(--text-muted)]">
                {[
                  shift.claimantGrade ? gradeLabel(shift.claimantGrade) : null,
                  shift.claimedAt
                    ? `requested ${formatDayShort(perthDateOf(shift.claimedAt))} ${perthTimeOf(shift.claimedAt)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </div>
          {ownClaim ? (
            <p className="px-3 pt-2 text-sm text-[color:var(--text-muted)]">
              You asked for this shift yourself, so another roster manager in the team decides.
            </p>
          ) : (
            <FootAction note="Roster rechecks overlaps and level when you approve.">
              <Button variant="primary" block disabled={disabled || started} onClick={() => setPending("approve")}>
                Approve
              </Button>
              <Button variant="secondary" block disabled={disabled || started} onClick={() => setPending("decline")}>
                Decline
              </Button>
            </FootAction>
          )}
        </section>
      ) : shift.status === "approved" ? (
        <section>
          <SectionHeading>Filled</SectionHeading>
          <p className="px-3 text-sm text-[color:var(--text)]">{`Filled by ${shift.claimantName ?? "a team member"}. It's on their roster now.`}</p>
        </section>
      ) : (
        <section>
          <SectionHeading>Requests</SectionHeading>
          <p className="px-3 text-sm text-[color:var(--text-muted)]">
            {shift.status === "open"
              ? "No requests yet. Doctors at the right level in the team can see it."
              : "This shift is closed."}
          </p>
        </section>
      )}

      {shift.status === "open" && !started ? <WhoCouldDoThis shift={shift} actorId={state.actorId} /> : null}

      <div className="mt-4 px-3">
        <Link
          href={postAgainHref(`${OPEN_SHIFTS_HREF}/post/new`, shift, shift.serviceId)}
          className={`${buttonFaceClass({ variant: "secondary", block: true })} no-underline`}
          data-testid="open-shifts-post-again"
        >
          <Copy aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />
          Post again
        </Link>
        <p className="pt-1 text-center text-2xs font-medium text-[color:var(--text-muted)]">
          Same times, level and site. You choose the date.
        </p>
      </div>

      {live ? (
        <div className="mt-2 px-3">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setPending("cancel")}
            className="inline-flex min-h-12 items-center text-sm font-medium text-[color:var(--danger-text)] disabled:cursor-not-allowed disabled:text-[color:var(--disabled)] focus-visible:outline-2 focus-visible:outline-[color:var(--command)]"
          >
            Filled elsewhere
          </button>
        </div>
      ) : null}
      {state.offline ? (
        <p className="px-3 text-sm text-[color:var(--text-muted)]">You&apos;re offline, so nothing can be changed.</p>
      ) : state.refreshFailed ? (
        <div className="px-3 text-sm text-[color:var(--text-muted)]">
          <p>The list couldn&apos;t be refreshed, so nothing can be changed until it loads again.</p>
          <button
            type="button"
            onClick={state.reload}
            className="inline-flex min-h-12 items-center font-medium text-[color:var(--mode-identity)] focus-visible:outline-2 focus-visible:outline-[color:var(--command)]"
          >
            Try again
          </button>
        </div>
      ) : started && shift.status !== "approved" ? (
        <p className="px-3 text-sm text-[color:var(--text-muted)]">
          This shift has started, so it can&apos;t be changed here.
        </p>
      ) : null}

      <ConfirmSheet
        open={pending === "approve"}
        onClose={() => setPending(null)}
        title={`Approve ${shift.claimantName ?? "this request"}?`}
        confirmLabel="Yes, approve"
        busyLabel="Approving"
        onConfirm={() => act("approve")}
        testId="open-shifts-approve"
      >
        <ShiftSummary shift={shift} />
        <p className="text-[color:var(--text-muted)]">
          The shift goes on their roster now. Roster sends them an alert if they have alerts on.
        </p>
      </ConfirmSheet>
      <ConfirmSheet
        open={pending === "decline"}
        onClose={() => setPending(null)}
        title={`Decline ${shift.claimantName ?? "this request"}?`}
        confirmLabel="Yes, decline"
        busyLabel="Declining"
        danger
        onConfirm={() => act("decline")}
        testId="open-shifts-decline"
      >
        <ShiftSummary shift={shift} />
        <p className="text-[color:var(--text-muted)]">
          The shift goes back on the list for others. Roster sends them an alert if they have alerts on. Roster
          doesn&apos;t record a reason, so tell them why yourself if it helps.
        </p>
      </ConfirmSheet>
      <ConfirmSheet
        open={pending === "release"}
        onClose={() => setPending(null)}
        title="Post this shift to the team?"
        confirmLabel="Yes, post it"
        busyLabel="Posting"
        onConfirm={() => act("release")}
        testId="open-shifts-release"
      >
        <ShiftSummary shift={shift} />
        <p className="text-[color:var(--text-muted)]">
          It goes live for team members at the right level, who can ask for it.
        </p>
      </ConfirmSheet>
      <ConfirmSheet
        open={pending === "cancel"}
        onClose={() => setPending(null)}
        title="Close this shift as filled elsewhere?"
        confirmLabel="Yes, close it"
        busyLabel="Closing"
        danger
        onConfirm={() => act("cancel")}
        testId="open-shifts-cancel"
      >
        <ShiftSummary shift={shift} />
        <p className="text-[color:var(--text-muted)]">
          {shift.status === "claimed"
            ? `The shift leaves the list now and ${shift.claimantName ?? "the doctor"}'s request closes with it. Roster doesn't send them an alert for this, so let them know.`
            : "The shift leaves the list now."}
        </p>
      </ConfirmSheet>
    </div>
  );
}
