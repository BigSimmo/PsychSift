"use client";

import { useEffect, useState } from "react";

import { RosterSwapTicket } from "@/components/roster/requests/roster-swap-ticket";
import { formatShiftRange, useRosterNow } from "@/components/roster/roster-format";
import { loadSwapOptionsRead, type SwapOptionsRead } from "@/components/roster/swaps/swap-options-loader";
import { postRosterAction } from "@/components/roster/use-roster-team";
import { Button } from "@/components/ui/button";
import { SHIFT_KIND_LABEL } from "@/lib/roster/shift-kind";
import { formatPerthDay, perthDateOf } from "@/lib/roster/shifts/perth-time";
import { placementProblem } from "@/lib/roster/team/eligibility";
import type { RosterAssignment, RosterSwap } from "@/lib/roster/team/model";
import { swapProgress } from "@/lib/roster/team/swap-progress";
import { reasonWords, swapPreview } from "@/lib/roster/team/swap-options";

/*
 * The answer card for a swap someone sent me, with the fresh-read and week-preview parts the swap
 * flow sheet shares. Kept apart from the sheet so the Swaps page does not load the whole flow.
 */

export const PANEL =
  "rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3 shadow-[var(--e1)]";

export function useFreshRead(serviceId: string, shiftStart: string) {
  const [fresh, setFresh] = useState<SwapOptionsRead | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let current = true;
    void loadSwapOptionsRead(serviceId, shiftStart, new Date()).then((result) => {
      if (!current) return;
      if (!result.ok) {
        setLoadError("The team roster couldn't be checked. Close this and try again.");
        return;
      }
      setLoadError(null);
      setFresh(result.fresh);
    });
    return () => {
      current = false;
    };
  }, [serviceId, shiftStart, generation]);
  return { fresh, loadError, reread: () => setGeneration((value) => value + 1) };
}

export function shiftLine(shift: RosterAssignment): string {
  return `${formatPerthDay(perthDateOf(shift.startsAt))} · ${SHIFT_KIND_LABEL[shift.kind]} ${formatShiftRange(shift)}`;
}

function WeekList({ label, shifts }: { label: string; shifts: readonly RosterAssignment[] }) {
  return (
    <div>
      <p className="text-xs text-[color:var(--text-muted)]">{label}</p>
      {shifts.length ? (
        <ul aria-label={label} className="grid gap-0.5 text-sm">
          {shifts.map((shift) => (
            <li key={shift.id} className="nums">
              {shiftLine(shift)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">No shifts</p>
      )}
    </div>
  );
}

export function WeekPreview({
  title,
  before,
  after,
}: {
  title: string;
  before: readonly RosterAssignment[];
  after: readonly RosterAssignment[];
}) {
  return (
    <section className={PANEL}>
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      <div className="grid gap-3">
        <WeekList label={`${title} before`} shifts={before} />
        <WeekList label={`${title} after`} shifts={after} />
      </div>
    </section>
  );
}

const ACCEPT_CANCEL_WORDS: Record<string, string> = {
  withdrawn: "Swap cancelled: it was withdrawn",
  roster_changed: "Swap cancelled: the roster changed",
  member_left: "Swap cancelled: they left the team",
  no_longer_fits: "Swap cancelled: it no longer fits",
};

/**
 * What an Accept really did. `swap.accept` answers success even when it finds
 * the swap has expired or no longer fits and ends it, so the words follow the
 * returned status rather than the button pressed.
 */
function acceptWords(result: { status?: string; autoApproved?: boolean; cancelReason?: string }): string {
  if (result.status === "approved") return result.autoApproved ? "Swap approved itself" : "Swap accepted";
  if (result.status === "cancelled") return ACCEPT_CANCEL_WORDS[result.cancelReason ?? ""] ?? "Swap cancelled";
  if (result.status === "expired") return "Swap expired before you accepted it";
  if (result.status === "accepted") return "Swap accepted";
  return "Answer sent. Check Swaps for where it has got to";
}

/**
 * A swap someone sent to me: what they give, what they get, my week before
 * and after, and Accept or Decline. A swap that has ended (Expired included)
 * offers neither.
 */
export function SwapAnswerCard({
  swap,
  serviceId,
  actorId,
  onDone,
}: {
  swap: RosterSwap;
  serviceId: string;
  actorId: string;
  onDone: (label: string) => void;
}) {
  const now = useRosterNow();
  const { fresh, loadError, reread } = useFreshRead(serviceId, swap.give?.startsAt ?? swap.createdAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoable, setUndoable] = useState(false);
  const { give, take } = swap;
  if (!give) return <p role="alert">That swap changed. Refresh Swaps.</p>;

  const progress = swapProgress(swap, actorId, now);
  const canAnswer = swap.counterpartyId === actorId && swap.status === "requested" && progress.ended === null;
  const canUndo =
    undoable ||
    (swap.status === "approved" &&
      swap.autoApproved &&
      !!swap.decidedAt &&
      now.getTime() < Date.parse(swap.decidedAt) + 600_000);
  const clash = fresh
    ? placementProblem(fresh.assignments, actorId, give.startsAt, give.endsAt, [take?.id], null)
    : null;
  const preview = fresh ? swapPreview(fresh.assignments, give, take, swap.requesterId, swap.counterpartyId) : null;
  const mine = preview ? (actorId === swap.requesterId ? preview.mine : preview.theirs) : null;
  const who = swap.requesterName ?? "They";

  async function act(action: "swap.accept" | "swap.decline" | "swap.undo") {
    setBusy(true);
    setError(null);
    const result = await postRosterAction(serviceId, { action, swapId: swap.id });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      reread();
      return;
    }
    if (action === "swap.undo") {
      setUndoable(false);
      onDone("Swap undone");
    } else if (action === "swap.accept") {
      setUndoable(result.result.status === "approved" && !!result.result.autoApproved);
      onDone(acceptWords(result.result));
    } else onDone("Swap declined");
  }

  return (
    <div className="grid gap-3">
      {loadError ? <p role="alert">{loadError}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <RosterSwapTicket shift={give} label={`${who} give`} />
      {take ? (
        <RosterSwapTicket shift={take} label={`${who} get`} />
      ) : (
        <p>{who} get nothing back. You just take the shift.</p>
      )}
      {mine ? <WeekPreview title="Your week" before={mine.before} after={mine.after} /> : null}
      {progress.ended ? <p>{progress.ended}</p> : null}
      {canAnswer ? (
        <>
          <p>
            {swap.needsManagerBecause
              ? `Your manager also needs to approve because ${reasonWords[swap.needsManagerBecause]}.`
              : "It goes through as soon as you accept."}
          </p>
          {clash ? <p role="alert">A shift clash was found, so this swap can&apos;t be accepted.</p> : null}
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={busy} onClick={() => void act("swap.decline")}>
              Decline
            </Button>
            <Button variant="primary" disabled={busy || !!clash} onClick={() => void act("swap.accept")}>
              Accept swap
            </Button>
          </div>
        </>
      ) : null}
      {canUndo ? (
        <Button variant="secondary" disabled={busy} onClick={() => void act("swap.undo")}>
          Undo for 10 min
        </Button>
      ) : null}
    </div>
  );
}
