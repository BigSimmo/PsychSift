"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ROSTER_UNDO_MS } from "@/components/roster/roster-format";
import { postRosterAction } from "@/components/roster/use-roster-team";
import type { RosterAction, RosterCommandResult } from "@/lib/roster/team/model";
import { useAuthSession } from "@/lib/supabase/client";

/*
 * One roster action held for 10 seconds under an Undo bar, then sent with
 * `keepalive`. Same contract as Teaching's `useDelayedPost`: leaving the page
 * (`pagehide`) or changing accounts cancels unsent work, so a swap is never
 * sent by someone who walked away, and another account can never submit it.
 * Only one action can be held at a time.
 */
export const UNDO_MS = ROSTER_UNDO_MS;

type Job = {
  label: string;
  serviceId: string;
  action: RosterAction;
  onDone: (result: RosterCommandResult) => void;
  onFailed: (message: string) => void;
};

export function useDelayedRosterAction(): {
  pending: string | null;
  /** True from the moment the hold ends until the server has answered. */
  sending: boolean;
  /** False when nobody is signed in: nothing can be scheduled. */
  canSend: boolean;
  schedule: (job: Job) => void;
  undo: () => void;
  /** Pause (true) or restart (false) the hold while someone is on the Undo bar. */
  hold: (on: boolean) => void;
} {
  const auth = useAuthSession();
  const held = useRef<{ job: Job; timer: number; paused: boolean } | null>(null);
  const inFlight = useRef(false);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<{ label: string; authEpoch: number } | null>(null);

  const send = useCallback(() => {
    const current = held.current;
    if (!current) return;
    window.clearTimeout(current.timer);
    held.current = null;
    setPending(null);
    inFlight.current = true;
    setSending(true);
    void postRosterAction(current.job.serviceId, current.job.action, { keepalive: true }).then((result) => {
      inFlight.current = false;
      setSending(false);
      if (result.ok) current.job.onDone(result.result);
      else current.job.onFailed(result.message);
    });
  }, []);

  const schedule = useCallback(
    (next: Job) => {
      if (held.current || inFlight.current || auth.status !== "authenticated") return;
      held.current = { job: next, timer: window.setTimeout(send, UNDO_MS), paused: false };
      setPending({ label: next.label, authEpoch: auth.authEpoch });
    },
    [send, auth.authEpoch, auth.status],
  );

  // While the pointer or keyboard focus is on the Undo bar the send waits, and the
  // full window starts again once both have left (WCAG 2.2.1).
  const hold = useCallback(
    (on: boolean) => {
      const current = held.current;
      if (!current || current.paused === on) return;
      window.clearTimeout(current.timer);
      current.paused = on;
      if (!on) current.timer = window.setTimeout(send, UNDO_MS);
    },
    [send],
  );

  const undo = useCallback(() => {
    if (held.current) window.clearTimeout(held.current.timer);
    held.current = null;
    setPending(null);
  }, []);

  useEffect(() => {
    window.addEventListener("pagehide", undo);
    return () => {
      window.removeEventListener("pagehide", undo);
      if (held.current) window.clearTimeout(held.current.timer);
      held.current = null;
    };
  }, [undo, auth.authEpoch, auth.status]);

  const visiblePending =
    auth.status === "authenticated" && pending?.authEpoch === auth.authEpoch ? pending.label : null;
  return { pending: visiblePending, sending, canSend: auth.status === "authenticated", schedule, undo, hold };
}
