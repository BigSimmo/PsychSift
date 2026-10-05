"use client";

import { useEffect, useMemo, useState } from "react";

import { isWorkedKind } from "@/lib/roster/shift-kind";
import type { HoursExtra } from "@/lib/roster/hours";
import type { RosterDisplayShift as OnCallShift } from "@/lib/roster/team/team-view";

import { kindOf } from "./roster-format";

/**
 * The doctor's extra time for one fortnight, read from the shared record Admin
 * uses for claims (`/api/roster/extra-time`), plus "Stayed late", which saves the
 * time from the end of the shift that just finished until now. Records saved on
 * this visit are kept beside the saved ones, so a failed read still counts what
 * was recorded now, and the page says the read failed.
 */

/** A late finish is offered for this long after a shift ends. */
const STAYED_LATE_WINDOW_MS = 8 * 60 * 60 * 1000;

export type RosterExtraTime = HoursExtra;

/**
 * One extra-time record's identity: its kind and its start as an instant. The
 * server returns database timestamps (`+00:00`) and this visit's records use
 * `toISOString()` (`Z`), so the same start compares by instant, not spelling;
 * a call-in and a late finish may share a start and are different records.
 */
export function extraKey(extra: RosterExtraTime): string {
  return `${extra.kind ?? "stayed_late"}|${Date.parse(extra.startedAt)}`;
}

/**
 * The worked shift that finished most recently, if it ended in the last eight
 * hours. None while another worked shift is running, since the time since the
 * last one ended is then that shift, not a late finish.
 */
export function justFinished(shifts: readonly OnCallShift[], now: Date): OnCallShift | null {
  const at = now.getTime();
  const working = shifts.some(
    (shift) => isWorkedKind(kindOf(shift)) && Date.parse(shift.startsAt) <= at && Date.parse(shift.endsAt) > at,
  );
  if (working) return null;
  let best: OnCallShift | null = null;
  for (const shift of shifts) {
    const end = Date.parse(shift.endsAt);
    if (!isWorkedKind(kindOf(shift)) || end > at || at - end > STAYED_LATE_WINDOW_MS) continue;
    if (!best || end > Date.parse(best.endsAt)) best = shift;
  }
  return best;
}

type SavedExtras = { readonly status: "loading" | "ready" | "error"; readonly records: readonly RosterExtraTime[] };

function useSavedExtras(from: string, to: string, attempt: number): SavedExtras {
  const key = `${from}/${to}/${attempt}`;
  const [loaded, setLoaded] = useState<{ key: string; result: SavedExtras } | null>(null);
  useEffect(() => {
    let alive = true;
    const settle = (result: SavedExtras) => {
      if (alive) setLoaded({ key, result });
    };
    void fetch(`/api/roster/extra-time?from=${from}&to=${to}`, { cache: "no-store" })
      .then(async (response) => {
        const body = response.ok ? ((await response.json()) as { records?: RosterExtraTime[] }) : null;
        settle(
          body && Array.isArray(body.records)
            ? { status: "ready", records: body.records }
            : { status: "error", records: [] },
        );
      })
      .catch(() => settle({ status: "error", records: [] }));
    return () => {
      alive = false;
    };
  }, [from, to, key]);
  // While a new range or a retry loads, keep the last records so the figures do not flash to zero.
  return loaded?.key === key ? loaded.result : { status: "loading", records: loaded?.result.records ?? [] };
}

export type RosterExtraTimeState = {
  readonly status: SavedExtras["status"];
  /** Saved records and this visit's, once each. */
  readonly records: readonly RosterExtraTime[];
  /** The shift a late finish can be recorded against now, or null. */
  readonly finished: OnCallShift | null;
  readonly alreadyLogged: boolean;
  /** A late finish can be recorded now: one just ended, it is not logged, and the saved records loaded. */
  readonly canAdd: boolean;
  readonly saving: boolean;
  readonly message: { readonly tone: "neutral" | "warning"; readonly text: string } | null;
  readonly stayedLate: () => Promise<void>;
  readonly retry: () => void;
};

export function useRosterExtraTime(
  shifts: readonly OnCallShift[],
  now: Date,
  fortnight: { readonly start: string; readonly end: string },
  /** False for sample or example shifts: a late finish is only offered against the doctor's own roster. */
  enabled = true,
): RosterExtraTimeState {
  const [attempt, setAttempt] = useState(0);
  const saved = useSavedExtras(fortnight.start, fortnight.end, attempt);
  const [visit, setVisit] = useState<readonly RosterExtraTime[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<RosterExtraTimeState["message"]>(null);
  const records = useMemo(() => {
    const byStart = new Map<string, RosterExtraTime>();
    for (const extra of [...saved.records, ...visit]) byStart.set(extraKey(extra), extra);
    return [...byStart.values()];
  }, [saved.records, visit]);
  const finished = enabled ? justFinished(shifts, now) : null;
  const alreadyLogged = finished
    ? records.some(
        (extra) => extraKey(extra) === extraKey({ kind: "stayed_late", startedAt: finished.endsAt, endedAt: null }),
      )
    : false;

  async function stayedLate() {
    // Only once the saved records are known, so a late finish already logged elsewhere is never sent again.
    if (!finished || alreadyLogged || saving || saved.status !== "ready") return;
    const extra = { kind: "stayed_late" as const, startedAt: finished.endsAt, endedAt: now.toISOString() };
    setSaving(true);
    try {
      const response = await fetch("/api/roster/extra-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(extra),
      });
      if (!response.ok) setMessage({ tone: "warning", text: "Extra time could not be saved. Try again." });
      else {
        setVisit((current) => [...current, extra]);
        setMessage({ tone: "neutral", text: "Saved" });
      }
    } catch {
      setMessage({ tone: "warning", text: "Extra time could not be saved. Check your connection and try again." });
    } finally {
      setSaving(false);
    }
  }

  return {
    status: saved.status,
    records,
    finished,
    alreadyLogged,
    canAdd: Boolean(finished) && !alreadyLogged && saved.status === "ready",
    saving,
    message,
    stayedLate,
    retry: () => setAttempt((n) => n + 1),
  };
}
