"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ROSTER_UNDO_MS } from "@/components/roster/roster-format";
import { postRosterAction } from "@/components/roster/use-roster-team";
import { sickErrorWords, type SickShift } from "@/lib/roster/sick/sick-report";
import { useAuthSession } from "@/lib/supabase/client";

/*
 * The sick report, held for 10 seconds under Undo and then sent: one
 * `open.report` per picked shift, with `keepalive`. "Send now" skips the rest
 * of the wait. Only one report can be held.
 *
 * Leaving does not cancel it (the spec: "Closing the app during the window
 * still sends"). On `pagehide`, on the page going out of view (phone locked,
 * app switched) and on leaving this page inside the app, a held report is sent
 * straight away with `keepalive`, so the request outlives the page. The result
 * shows when the doctor comes back, and Take back (`open.cancel`) is still
 * offered then. If there is no connection when it is due, it is kept in memory
 * as "Not sent yet" and goes the moment the signal returns, while this page is
 * open. Nothing is kept on the device. A change of account drops anything held
 * or waiting, so another account can never send it. Every path takes the
 * report out of the hold before posting, so it is never sent twice.
 */

export type SickSendResult = {
  readonly shift: SickShift;
  readonly ok: boolean;
  readonly openShiftId: string | null;
  readonly error: string | null;
};

/** Why it went: the 10 seconds ran out, Send now, the doctor left the page, or the signal came back. */
export type SickSendHow = "timer" | "now" | "left" | "online";

type Held = { shifts: readonly SickShift[]; timer: number; tick: number; endsAt: number };
type Entry = { readonly shifts: readonly SickShift[]; readonly authEpoch: number };

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

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

export function useSickSend(onDone: (results: SickSendResult[], how: SickSendHow) => void): {
  /** Seconds left on the hold, or null when nothing is held. */
  readonly secondsLeft: number | null;
  readonly held: readonly SickShift[];
  /** Due to go but there was no connection: sends when the signal returns. */
  readonly waiting: readonly SickShift[];
  readonly sending: boolean;
  readonly canSend: boolean;
  readonly schedule: (shifts: readonly SickShift[]) => boolean;
  readonly undo: () => boolean;
  readonly sendNow: () => void;
  /** Drops a report that is waiting for the signal. */
  readonly cancelWaiting: () => boolean;
} {
  const auth = useAuthIfAvailable();
  const heldRef = useRef<Held | null>(null);
  const waitingRef = useRef<readonly SickShift[] | null>(null);
  const inFlight = useRef(false);
  const done = useRef(onDone);
  const epoch = useRef(auth.authEpoch);
  useEffect(() => {
    done.current = onDone;
    epoch.current = auth.authEpoch;
  });
  const [held, setHeld] = useState<Entry | null>(null);
  const [waiting, setWaiting] = useState<Entry | null>(null);
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

  const post = useCallback((shifts: readonly SickShift[], how: SickSendHow) => {
    inFlight.current = true;
    setSending(true);
    void (async () => {
      const results: SickSendResult[] = [];
      // One at a time, so a refusal of the first never leaves the second half-sent.
      for (const shift of shifts) {
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
      done.current(results, how);
    })();
  }, []);

  const send = useCallback(
    (how: SickSendHow) => {
      // Out of the hold first: whichever path gets here second finds nothing to send.
      const current = clear();
      if (!current) return;
      if (isOffline()) {
        // No connection when it was due: keep it, never drop it silently.
        waitingRef.current = current.shifts;
        setWaiting({ shifts: current.shifts, authEpoch: epoch.current });
        return;
      }
      post(current.shifts, how);
    },
    [clear, post],
  );

  const schedule = useCallback(
    (shifts: readonly SickShift[]) => {
      if (
        !shifts.length ||
        heldRef.current ||
        waitingRef.current ||
        inFlight.current ||
        auth.status !== "authenticated"
      )
        return false;
      const endsAt = Date.now() + ROSTER_UNDO_MS;
      const timer = window.setTimeout(() => send("timer"), ROSTER_UNDO_MS);
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

  const cancelWaiting = useCallback(() => {
    if (!waitingRef.current) return false;
    waitingRef.current = null;
    setWaiting(null);
    return true;
  }, []);

  // Leaving or hiding the page sends a held report now, rather than losing it.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);
  useEffect(() => {
    const leave = () => {
      if (heldRef.current) sendRef.current("left");
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") leave();
    };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", onVisibility);
      // Leaving this page inside the app (a tab, Back) sends it too.
      leave();
    };
  }, []);

  // A report waiting for the signal goes the moment it returns.
  const hasWaiting = waiting !== null;
  useEffect(() => {
    if (!hasWaiting) return;
    const onOnline = () => {
      const shifts = waitingRef.current;
      if (!shifts || inFlight.current) return;
      waitingRef.current = null;
      setWaiting(null);
      post(shifts, "online");
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [hasWaiting, post]);

  // A new account (epoch) or sign-out drops anything still held or waiting, unsent.
  const authKey = `${auth.status}:${auth.authEpoch}`;
  const lastAuth = useRef(authKey);
  useEffect(() => {
    if (lastAuth.current === authKey) return;
    lastAuth.current = authKey;
    clear();
    waitingRef.current = null;
    setWaiting(null);
  }, [authKey, clear]);

  const mine = (entry: Entry | null) =>
    auth.status === "authenticated" && entry?.authEpoch === auth.authEpoch ? entry.shifts : [];
  const visible = mine(held);
  return {
    secondsLeft: visible.length ? secondsLeft : null,
    held: visible,
    waiting: mine(waiting),
    sending,
    canSend: auth.status === "authenticated",
    schedule,
    undo,
    sendNow: () => send("now"),
    cancelWaiting,
  };
}
