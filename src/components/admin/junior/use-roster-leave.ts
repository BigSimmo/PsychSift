"use client";

import { useEffect, useState } from "react";

import { isRosterLeaveKind, ROSTER_LEAVE_KIND_LABEL, type RosterLeaveKind } from "@/lib/roster/leave-kinds";

/** The doctor's own planned, applied and approved leave from Roster, read once into memory. */
export type JuniorRosterLeave = {
  readonly id: string;
  readonly kind: RosterLeaveKind;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly status: "planned" | "applied" | "approved";
};

export type JuniorRosterLeaveState =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "ready"; readonly leave: readonly JuniorRosterLeave[] };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseLeave(value: unknown): JuniorRosterLeave[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const row = item as Record<string, unknown>;
    if (
      typeof row.id === "string" &&
      isRosterLeaveKind(row.kind) &&
      typeof row.startsOn === "string" &&
      DATE.test(row.startsOn) &&
      typeof row.endsOn === "string" &&
      DATE.test(row.endsOn) &&
      (row.status === "planned" || row.status === "applied" || row.status === "approved")
    ) {
      return [{ id: row.id, kind: row.kind, startsOn: row.startsOn, endsOn: row.endsOn, status: row.status }];
    }
    return [];
  });
}

/**
 * Reads `/api/roster/leave` (the same route Roster's own pages read). Held in
 * memory for this page only: roster data never goes on the device. A signed
 * out reader gets an error from the route, which reads as "failed" here and
 * the page says it could not load leave rather than "no leave".
 */
export function useJuniorRosterLeave(enabled: boolean): JuniorRosterLeaveState {
  const [state, setState] = useState<JuniorRosterLeaveState>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch("/api/roster/leave", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("leave");
        const payload = (await response.json()) as { leave?: unknown };
        if (!controller.signal.aborted) setState({ status: "ready", leave: parseLeave(payload?.leave) });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "failed" });
      });
    return () => controller.abort();
  }, [enabled]);
  return state;
}

export const ROSTER_LEAVE_STATUS_WORDS: Record<JuniorRosterLeave["status"], string> = {
  planned: "Planned",
  applied: "Applied",
  approved: "Approved",
};

export const ROSTER_LEAVE_KIND_WORDS: Readonly<Record<RosterLeaveKind, string>> = ROSTER_LEAVE_KIND_LABEL;
