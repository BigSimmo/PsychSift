"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ROSTER_UNDO_MS } from "@/components/roster/roster-format";
import { postRosterAction } from "@/components/roster/use-roster-team";
import { sickErrorWords, type SickShift } from "@/lib/roster/sick/sick-report";
import { useAuthSession } from "@/lib/supabase/client";

/*
 * The sick report, held for 10 seconds under Undo and then sent: one
 * `open.report` per picked shift, with `keepalive`. Same contract as Roster's
 * held swap (`useDelayedRosterAction`): leaving the page (`pagehide`) or
 * changing accounts cancels a report that has not gone yet, so it is never
 * sent by someone who walked away, and another account can never send it.
 * "Send now" skips the rest of the wait. Only one report can be held.
 */

export type SickSendResult = {
  readonly shift: SickShift;
  readonly ok: boolean;
  readonly openShiftId: string | null;
  readonly error: string | null;
};

type Held = { shifts: readonly SickShift[]; timer: number; tick: number; endsAt: number };

/** The session when an `AuthProvider` is mounted; signed out in a bare render. */
function useAuthIfAvailable(): { status: string; authEpoch: number } {
  try {
    return useAuthSession();
  } catch (error) {
    if (error instanceof Error && error.message === "useAuthSession must be used within AuthProvider.")
      return { status: "signed_out", authEpoch: 0 };
    throw error;
  }
}

export function useSickSend(onDone: (results: SickSendResult[]) => void): {
  /** Seconds left on the hold, or null when nothing is held. */
  readonly secondsLeft: number | null;
  readonly held: readonly SickShift[];
  readonly sending: boolean;
  readonly canSend: boolean;
  readonly schedule: (shifts: readonly SickShift[]) => boolean;
  readonly undo: () => boolean;
  readonly sendNow: () => void;
} {
  const auth = useAuthIfAvailable();
  const heldRef = useRef<Held | null>(null);
  const inFlight = useRef(false);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  const [held, setHeld] = useState<{ shifts: readonly SickShift[]; authEpoch: number } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [sending, setSending] = useState(false);

  const clear = useCallback(() => {
    const current = heldRef.current;
    if (current) {
      window.clearTimeout(current.timer);
      window.clearInterval(current.tick);
    }
    heldRef.current = null;
    setHeld(null);
    setSecondsLeft(null);
    return current;
  }, []);

  const send = useCallback(() => {
    const current = clear();
    if (!current) return;
    inFlight.current = true;
    setSending(true);
    void (async () => {
      const results: SickSendResult[] = [];
      // One at a time, so a refusal of the first never leaves the second half-sent.
      for (const shift of current.shifts) {
        const answer = await postRosterAction(
          shift.serviceId,
          { action: "open.report", assignmentId: shift.assignmentId },
          { keepalive: true },
        );
        results.push(
          answer.ok
            ? { shift, ok: true, openShiftId: answer.result.openShiftId ?? null, error: null }
            : { shift, ok: false, openShiftId: null, error: sickErrorWords(answer.code, answer.message) },
        );
      }
      inFlight.current = false;
      setSending(false);
      done.current(results);
    })();
  }, [clear]);

  const schedule = useCallback(
    (shifts: readonly SickShift[]) => {
      if (!shifts.length || heldRef.current || inFlight.current || auth.status !== "authenticated") return false;
      const endsAt = Date.now() + ROSTER_UNDO_MS;
      const timer = window.setTimeout(send, ROSTER_UNDO_MS);
      const tick = window.setInterval(() => {
        setSecondsLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
      }, 250);
      heldRef.current = { shifts, timer, tick, endsAt };
      setHeld({ shifts, authEpoch: auth.authEpoch });
      setSecondsLeft(Math.ceil(ROSTER_UNDO_MS / 1000));
      return true;
    },
    [send, auth.status, auth.authEpoch],
  );

  const undo = useCallback(() => clear() !== null, [clear]);

  useEffect(() => {
    const leave = () => void clear();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      clear();
    };
    // A new account (epoch) or sign-out drops anything still held.
  }, [clear, auth.authEpoch, auth.status]);

  const visible = auth.status === "authenticated" && held?.authEpoch === auth.authEpoch ? held.shifts : [];
  return {
    secondsLeft: visible.length ? secondsLeft : null,
    held: visible,
    sending,
    canSend: auth.status === "authenticated",
    schedule,
    undo,
    sendNow: send,
  };
}
