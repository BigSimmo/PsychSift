"use client";

import { useMemo, useState } from "react";

import { GIVE_AWAY_WORDS, isUrgentGiveAway } from "@/components/roster/requests/request-ui";
import { RosterSwapTicket } from "@/components/roster/requests/roster-swap-ticket";
import { useRosterNow } from "@/components/roster/roster-format";
import { useDelayedRosterAction } from "@/components/roster/swaps/use-delayed-roster-action";
import { ROSTER_ONLY_NOTE } from "@/components/roster/swaps/swap-options-loader";
import { Button } from "@/components/ui/button";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { Sheet } from "@/components/ui/sheet";
import { openShiftCandidates, swapNeedsManager } from "@/lib/roster/team/eligibility";
import type { RosterAssignment } from "@/lib/roster/team/model";
import { approvalWords, swapOptions, swapPreview } from "@/lib/roster/team/swap-options";
import { zonedTimeOf } from "@/lib/work-time/format";

import { PANEL, shiftLine, useFreshRead, WeekPreview } from "./swap-answer-card";

/* The swaps page needs only the answer card, so it lives in its own small file; re-exported for callers here. */
export { SwapAnswerCard } from "./swap-answer-card";

/**
 * The calendar-first swap flow: pick who, pick what to take back, check, then
 * send. Sending is held for 10 seconds under an Undo (see
 * `useDelayedRosterAction`). Everything shown is advice worked out from a
 * fresh read; the server rechecks when the swap is created or accepted, and a
 * refusal is shown in plain words and the roster is read again.
 */

type Step = "who" | "take" | "check";

const UNNAMED = "Name not available";
const CHOICE = "w-full justify-start text-left";

function checkedTime(value: Date, zone: string): string {
  return zonedTimeOf(value, zone);
}

const grade = (value: string | null) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : "Grade not set");

export function SwapFlowSheet(props: {
  open: boolean;
  onClose: () => void;
  serviceId: string;
  actorId: string;
  give: RosterAssignment;
  mode: "swap" | "give_away";
  onSent: (label: string) => void;
  /** A colleague already chosen (from "Who can cover?"); used only while they can still take the shift. */
  initialColleagueId?: string | null;
}) {
  // A new session for each shift and mode, so nothing chosen earlier carries over.
  return props.open ? (
    <FlowSession
      key={JSON.stringify([
        props.serviceId,
        props.actorId,
        props.give.id,
        props.mode,
        props.initialColleagueId ?? null,
      ])}
      {...props}
    />
  ) : null;
}

function FlowSession({
  onClose,
  serviceId,
  actorId,
  give,
  mode,
  onSent,
  initialColleagueId,
}: Parameters<typeof SwapFlowSheet>[0]) {
  const now = useRosterNow();
  const { zone } = useWorkTimeZone();
  const { fresh, loadError, reread } = useFreshRead(serviceId, give.startsAt);
  const { pending, sending, canSend, schedule, undo } = useDelayedRosterAction();
  // A colleague chosen before the sheet opened starts at "take"; if they cannot take it, `shown` falls back to "who".
  const [step, setStep] = useState<Step>(initialColleagueId ? "take" : "who");
  const [colleagueId, setColleagueId] = useState(initialColleagueId ?? "");
  // null until chosen; "" means "Nothing, just take my shift".
  const [takeId, setTakeId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const options = useMemo(
    () =>
      fresh && mode === "swap"
        ? swapOptions({
            rows: fresh.assignments,
            give,
            me: { userId: actorId, grade: fresh.overview.me.grade },
            settings: fresh.overview.settings,
            now,
            members: fresh.members ?? undefined,
          })
        : null,
    [fresh, mode, give, actorId, now],
  );
  const chosen = options?.can.find((choice) => choice.userId === colleagueId) ?? null;
  const take = takeId ? (chosen?.takeBack.find((shift) => shift.id === takeId) ?? null) : null;
  // If a re-read means the choice no longer holds, step back to where it can be made again.
  const shown: Step = !chosen ? "who" : step === "check" && takeId && !take ? "take" : step;

  const giveAwayPeople = useMemo(
    () =>
      fresh && mode === "give_away"
        ? openShiftCandidates(
            fresh.assignments,
            { startsAt: give.startsAt, endsAt: give.endsAt, minGrade: give.grade, assignmentId: give.id },
            fresh.overview.settings,
            actorId,
          )
        : [],
    [fresh, mode, give, actorId],
  );

  // A shift starting within a day is reported to the manager, as the Requests give-away does.
  const urgent = mode === "give_away" && isUrgentGiveAway(give.startsAt, now);

  function close() {
    undo();
    onClose();
  }

  function goStep(next: Step) {
    setRefusal(null);
    setStep(next);
  }

  function send() {
    if (!fresh) return;
    setRefusal(null);
    setCancelled(false);
    const onFailed = (message: string) => {
      setRefusal(message);
      reread();
    };
    if (urgent) {
      schedule({
        label: "Telling your manager",
        serviceId,
        action: { action: "open.report", assignmentId: give.id },
        onDone: () => {
          onSent(GIVE_AWAY_WORDS.told);
          onClose();
        },
        onFailed,
      });
      return;
    }
    if (mode === "give_away") {
      const names = giveAwayPeople.map((person) => person.name ?? "colleague").join(" and ");
      schedule({
        label: "Offering this shift to your team",
        serviceId,
        action: { action: "open.post", assignmentId: give.id },
        onDone: () => {
          onSent(`Offered to ${names || "your team"}`);
          onClose();
        },
        onFailed,
      });
      return;
    }
    if (!chosen) return;
    schedule({
      label: `Swap with ${chosen.name ?? "your colleague"}`,
      serviceId,
      action: {
        action: "swap.create",
        giveAssignmentId: give.id,
        counterpartyId: chosen.userId,
        takeAssignmentId: take?.id ?? null,
      },
      onDone: () => {
        onSent("Swap sent");
        onClose();
      },
      onFailed,
    });
  }

  function cancelSend() {
    undo();
    setCancelled(true);
  }

  const managerReason =
    fresh && chosen
      ? swapNeedsManager({
          give,
          take,
          giverGrade: give.grade ?? fresh.overview.me.grade,
          takerGrade: chosen.grade,
          counterpartyId: chosen.userId,
          settings: fresh.overview.settings,
          assignments: fresh.assignments,
          now,
        })
      : null;
  const preview = fresh && chosen ? swapPreview(fresh.assignments, give, take, actorId, chosen.userId) : null;

  // While the hold runs, and while the server is answering, there is no Send button to tap again.
  const sendControls = sending ? (
    <p role="status" className={PANEL}>
      Sending…
    </p>
  ) : pending ? (
    <div role="status" className={`${PANEL} grid gap-2`}>
      <p className="font-medium">Sending in 10 seconds</p>
      <p className="text-sm">{pending}. Closing this window cancels it.</p>
      <Button variant="secondary" onClick={cancelSend}>
        Undo
      </Button>
    </div>
  ) : null;
  const signInNote = canSend ? null : <p role="status">Sign in to send</p>;

  return (
    <Sheet
      open
      onClose={close}
      title={mode === "swap" ? "Swap this shift" : urgent ? GIVE_AWAY_WORDS.urgentTitle : "Give this shift away"}
    >
      <div className="grid gap-4">
        {!fresh && !loadError ? <p role="status">Checking the team roster…</p> : null}
        {loadError ? <p role="alert">{loadError}</p> : null}
        {refusal ? <p role="alert">{refusal}</p> : null}
        {cancelled && !pending ? <p role="status">Cancelled before sending.</p> : null}
        <RosterSwapTicket shift={give} label="Your shift" />

        {fresh && mode === "swap" && options && shown === "who" ? (
          <>
            <p className="text-xs text-[color:var(--text-muted)]">Step 1 of 3 · Who</p>
            {fresh.members ? null : <p className="text-sm">{ROSTER_ONLY_NOTE}</p>}
            <section className="grid gap-2">
              <h3 className="text-base font-medium">Can swap</h3>
              {options.can.length ? (
                options.can.map((choice) => (
                  <Button
                    key={choice.userId}
                    className={CHOICE}
                    onClick={() => {
                      setColleagueId(choice.userId);
                      setTakeId(null);
                      goStep("take");
                    }}
                  >
                    <span>
                      {choice.name ?? UNNAMED}
                      <span className="block text-xs font-normal text-[color:var(--text-muted)]">
                        {grade(choice.grade)} · {choice.sameGrade ? "same grade" : "higher grade"}
                      </span>
                    </span>
                  </Button>
                ))
              ) : (
                <p>Nobody on the roster can take this shift at the moment.</p>
              )}
            </section>
            {options.cannot.length ? (
              <section className="grid gap-2">
                <h3 className="text-base font-medium">Can&apos;t swap</h3>
                <ul className="grid gap-2">
                  {options.cannot.map((blocked) => (
                    <li key={blocked.userId} className={PANEL}>
                      <span className="font-medium">{blocked.name ?? UNNAMED}</span>
                      <span className="block text-sm text-[color:var(--text-muted)]">{blocked.words}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}

        {fresh && mode === "swap" && chosen && shown === "take" ? (
          <>
            <p className="text-xs text-[color:var(--text-muted)]">Step 2 of 3 · Take back</p>
            <section className="grid gap-2">
              <h3 className="text-base font-medium">What would you take from {chosen.name ?? UNNAMED}?</h3>
              <Button
                className={CHOICE}
                onClick={() => {
                  setTakeId("");
                  goStep("check");
                }}
              >
                Nothing, just take my shift
              </Button>
              {chosen.takeBack.map((shift) => (
                <Button
                  key={shift.id}
                  className={CHOICE}
                  onClick={() => {
                    setTakeId(shift.id);
                    goStep("check");
                  }}
                >
                  {shiftLine(shift)}
                </Button>
              ))}
            </section>
            <Button variant="ghost" onClick={() => goStep("who")}>
              Back
            </Button>
          </>
        ) : null}

        {fresh && mode === "swap" && chosen && preview && shown === "check" ? (
          <>
            <p className="text-xs text-[color:var(--text-muted)]">Step 3 of 3 · Check and send</p>
            <h3 className="text-base font-medium">Swap with {chosen.name ?? UNNAMED}</h3>
            {take ? <RosterSwapTicket shift={take} label="Their shift in return" /> : <p>You take nothing back.</p>}
            <WeekPreview title="Your week" before={preview.mine.before} after={preview.mine.after} />
            <WeekPreview
              title={`${chosen.name ?? "Their"} week`}
              before={preview.theirs.before}
              after={preview.theirs.after}
            />
            <p>{approvalWords(managerReason)}</p>
            <p className="text-xs text-[color:var(--text-muted)]">Rechecked {checkedTime(fresh.readAt, zone)}</p>
            {sendControls ?? (
              <div className="grid gap-2">
                {signInNote}
                <Button variant="primary" disabled={!canSend} onClick={send}>
                  Send swap request
                </Button>
                <Button variant="ghost" onClick={() => goStep("take")}>
                  Back
                </Button>
              </div>
            )}
          </>
        ) : null}

        {fresh && mode === "give_away" ? (
          <>
            <h3 className="text-base font-medium">
              Who can take it: {giveAwayPeople.length} {giveAwayPeople.length === 1 ? "person" : "people"}
            </h3>
            <ul className="grid gap-1 text-sm">
              {giveAwayPeople.map((person) => (
                <li key={person.userId}>
                  {person.name ?? UNNAMED} · {grade(person.grade)}
                </li>
              ))}
            </ul>
            <p className="text-xs text-[color:var(--text-muted)]">Rechecked {checkedTime(fresh.readAt, zone)}</p>
            {urgent ? <p>{GIVE_AWAY_WORDS.ringIn}</p> : null}
            {sendControls ?? (
              <>
                {signInNote}
                <Button
                  variant="primary"
                  disabled={!canSend || (!urgent && giveAwayPeople.length === 0)}
                  onClick={send}
                >
                  {urgent
                    ? GIVE_AWAY_WORDS.urgentButton
                    : `Offer to ${giveAwayPeople.length === 1 ? "1 person" : `${giveAwayPeople.length} people`}`}
                </Button>
              </>
            )}
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
