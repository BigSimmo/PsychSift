"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchRosterRead, useRosterTeams } from "@/components/roster/use-roster-team";
import {
  personalOnlyShifts,
  sickCandidates,
  sickWindow,
  type SickPersonalShift,
  type SickShift,
} from "@/lib/roster/sick/sick-report";
import { perthDateOf } from "@/lib/roster/shifts/perth-time";
import type { RosterOpenShift, RosterOverview, RosterTeam } from "@/lib/roster/team/model";

/**
 * Everything the Sick for tomorrow page reads: for each confirmed team, my
 * shifts today and tomorrow (one `assignments` read), my open-shift requests
 * (to show a report already sent) and the overview (manager names, when the
 * database has them). Plus the doctor's own roster copy, to list shifts that
 * are not on a team roster. All in React state only: nothing is written to
 * the device, and it is all read again on the next visit.
 */

export type SickReportItem = { readonly serviceId: string; readonly teamName: string; readonly open: RosterOpenShift };

export type SickShiftsState =
  | { readonly status: "loading" }
  | { readonly status: "signed-out" | "error" | "not-confirmed"; readonly message: string }
  | {
      readonly status: "ready";
      /** No enabled team: nothing can be reported from here. */
      readonly teams: readonly RosterTeam[];
      readonly sample: boolean;
      readonly actorId: string | null;
      readonly candidates: readonly SickShift[];
      readonly reports: readonly SickReportItem[];
      readonly personal: readonly SickPersonalShift[];
      /** The own roster copy could not be read: say so rather than implying there is nothing. */
      readonly personalFailed: boolean;
      readonly managersByService: ReadonlyMap<string, RosterOverview["managers"]>;
      readonly readAt: Date;
    };

type OwnShiftsPayload = {
  shifts?: { id: string; startsAt: string; endsAt: string; title: string; workplace?: string | null }[];
  sample?: boolean;
};

async function readOwnShifts(): Promise<{ ok: true; payload: OwnShiftsPayload } | { ok: false; signedOut: boolean }> {
  try {
    const response = await fetch("/api/roster/shifts", { cache: "no-store" });
    if (response.status === 401) return { ok: false, signedOut: true };
    if (!response.ok) return { ok: false, signedOut: false };
    return { ok: true, payload: ((await response.json().catch(() => null)) as OwnShiftsPayload | null) ?? {} };
  } catch {
    return { ok: false, signedOut: false };
  }
}

export function useSickShifts(now: Date): SickShiftsState & { readonly reload: () => void } {
  const teams = useRosterTeams();
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  const today = perthDateOf(now);
  const [answer, setAnswer] = useState<{ key: string; state: SickShiftsState } | null>(null);

  const enabled = useMemo(() => teams.data?.teams.filter((team) => team.enabled) ?? [], [teams.data]);
  const actorId = teams.data?.actorId ?? null;
  const sample = teams.data?.sample === true;
  const key = JSON.stringify([today, enabled.map((team) => team.serviceId), actorId, sample]);

  useEffect(() => {
    if (teams.status !== "ready") return;
    let current = true;
    const range = sickWindow(new Date(`${today}T12:00:00+08:00`));
    void Promise.all([
      Promise.all(
        enabled.map(async (team) => {
          const [assignments, requests, overview] = await Promise.all([
            fetchRosterRead(team.serviceId, "assignments", range),
            fetchRosterRead(team.serviceId, "requests"),
            fetchRosterRead(team.serviceId, "overview"),
          ]);
          return { team, assignments, requests, overview };
        }),
      ),
      sample ? Promise.resolve(null) : readOwnShifts(),
    ]).then(([rows, own]) => {
      if (!current) return;
      const failed = rows.find((row) => !row.assignments.ok || !row.requests.ok);
      if (failed) {
        const bad = !failed.assignments.ok ? failed.assignments : !failed.requests.ok ? failed.requests : null;
        const signedOut = bad?.code === "roster_auth_required";
        setAnswer({
          key,
          state: signedOut
            ? { status: "signed-out", message: "Sign in to report a shift." }
            : { status: "error", message: "Your team roster couldn't be checked. Nothing was sent." },
        });
        return;
      }
      const at = new Date();
      const reads = rows.map((row) => ({
        team: row.team,
        assignments: row.assignments.ok ? row.assignments.data.assignments : [],
      }));
      const candidates = actorId ? sickCandidates(reads, actorId, at) : [];
      const reports = rows.flatMap((row) =>
        row.requests.ok
          ? row.requests.data.openShifts.map((open) => ({
              serviceId: row.team.serviceId,
              teamName: row.team.name,
              open,
            }))
          : [],
      );
      const ownShifts =
        own && own.ok && own.payload.sample !== true
          ? (own.payload.shifts ?? []).map((shift) => ({
              id: shift.id,
              startsAt: shift.startsAt,
              endsAt: shift.endsAt,
              title: shift.title,
              workplace: shift.workplace ?? null,
            }))
          : [];
      // Shifts already reported are on a team roster too, even once they are no longer mine.
      const teamTimes = [...candidates, ...reports.map((item) => item.open)];
      setAnswer({
        key,
        state: {
          status: "ready",
          teams: enabled,
          sample,
          actorId,
          candidates,
          reports,
          personal: personalOnlyShifts(ownShifts, teamTimes, at),
          personalFailed: !!own && !own.ok && !own.signedOut,
          managersByService: new Map(
            rows.map((row) => [row.team.serviceId, row.overview.ok ? row.overview.data.managers : undefined]),
          ),
          readAt: at,
        },
      });
    });
    return () => {
      current = false;
    };
  }, [key, teams.status, generation, enabled, actorId, sample, today]);

  if (teams.status === "loading") return { status: "loading", reload: teams.reload };
  if (teams.status === "signed-out")
    return { status: "signed-out", message: "Sign in to report a shift.", reload: teams.reload };
  if (teams.status === "not-confirmed")
    return { status: "not-confirmed", message: teams.message ?? "Your team isn't confirmed yet.", reload };
  if (teams.status !== "ready")
    return {
      status: "error",
      message: teams.message ?? "Your team roster couldn't be checked. Nothing was sent.",
      reload: teams.reload,
    };
  if (!answer || answer.key !== key) return { status: "loading", reload };
  return { ...answer.state, reload };
}
