"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { teachingPost } from "@/lib/teaching/client";
import { useAuthSession } from "@/lib/supabase/client";

/*
 * One organiser post held for 10 seconds under an Undo bar (v5.2). Sent with
 * `keepalive` once the Undo window expires. Leaving or changing accounts cancels
 * unsent work, so another account can never submit it. Only one post can be held.
 */
export const UNDO_MS = 10_000;

type Job = {
  label: string;
  url: string;
  body: Record<string, unknown>;
  onPosted: () => void;
  onFailed: (error: unknown) => void;
};

export function useDelayedPost(): {
  pending: string | null;
  schedule: (input: Job) => void;
  undo: () => void;
  /** Pause (true) or restart (false) the hold while someone is on the Undo bar. */
  hold: (on: boolean) => void;
} {
  const auth = useAuthSession();
  const held = useRef<{ job: Job; timer: number; paused: boolean } | null>(null);
  const [pending, setPending] = useState<{ label: string; authEpoch: number } | null>(null);

  const send = useCallback(() => {
    const current = held.current;
    if (!current) return;
    window.clearTimeout(current.timer);
    held.current = null;
    setPending(null);
    teachingPost(current.job.url, current.job.body, { keepalive: true }).then(
      () => current.job.onPosted(),
      current.job.onFailed,
    );
  }, []);

  const schedule = useCallback(
    (next: Job) => {
      if (held.current || auth.status !== "authenticated") return;
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
  return { pending: visiblePending, schedule, undo, hold };
}
