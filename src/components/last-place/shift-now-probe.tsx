"use client";

import { useEffect, useRef } from "react";

import { kindOf } from "@/components/roster/roster-format";
import { useRosterShifts } from "@/components/roster/use-roster-shifts";
import { summariseToday } from "@/lib/roster/today";
import { hasSupabaseAuthSession } from "@/lib/supabase/session-hint";

/**
 * Reads the doctor's own roster once, and reports whether a real shift (not
 * the example roster) is running right now. The same roster read and the same
 * "on now" rule My Day uses for its hero.
 */
function ShiftNowProbeActive({ onResult }: { readonly onResult: (onShiftNow: boolean) => void }) {
  const roster = useRosterShifts(undefined, { skipWhenUnauthenticated: true });
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current) return;
    if (roster.status === "loading" || (roster.status === "ready" && roster.teamLoading)) return;
    reported.current = true;
    if (roster.status !== "ready" || roster.sample || roster.demoMode) {
      onResult(false);
      return;
    }
    const today = summariseToday(
      roster.shifts.map((shift) => ({
        id: shift.id,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        kind: kindOf(shift),
      })),
      new Date(),
    );
    onResult(today.lead.state === "on_now");
  }, [roster.status, roster.teamLoading, roster.sample, roster.demoMode, roster.shifts, onResult]);
  return null;
}

export function ShiftNowProbe({ onResult }: { readonly onResult: (onShiftNow: boolean) => void }) {
  const canProbe = hasSupabaseAuthSession();
  const reported = useRef(false);
  useEffect(() => {
    if (canProbe || reported.current) return;
    reported.current = true;
    onResult(false);
  }, [canProbe, onResult]);
  if (!canProbe) return null;
  return <ShiftNowProbeActive onResult={onResult} />;
}
