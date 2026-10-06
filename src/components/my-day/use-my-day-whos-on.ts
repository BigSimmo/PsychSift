"use client";

import { useMemo } from "react";

import { useRosterRead, useRosterTeams } from "@/components/roster/use-roster-team";
import { addDaysToDate, perthDateOf } from "@/lib/roster/shifts/perth-time";
import type { RosterAssignment } from "@/lib/roster/team/model";

/**
 * "Who's on now": colleagues rostered on at this moment on the reader's first
 * confirmed team, read the way Roster Today reads a team's assignments. Only a
 * real team counts: the invented sample team (served while the real-staff
 * release is held) never appears, so a reader without a confirmed team gets
 * an empty list and the card hides.
 */

export interface MyDayColleague {
  readonly id: string;
  readonly name: string;
  readonly grade: string | null;
  /** When their shift ends (ISO). */
  readonly endsAt: string;
}

export interface MyDayWhosOn {
  readonly status: "loading" | "ready" | "unavailable";
  readonly teamName: string | null;
  readonly colleagues: readonly MyDayColleague[];
}

const GRADE_LABEL: Readonly<Record<string, string>> = {
  consultant: "Consultant",
  fellow: "Fellow",
  registrar: "Registrar",
  resident: "Resident",
  intern: "Intern",
  other: "Doctor",
};

export function colleaguesOnNow(
  assignments: readonly RosterAssignment[],
  actorId: string | undefined,
  now: Date,
): MyDayColleague[] {
  const at = now.getTime();
  return assignments
    .filter(
      (row) =>
        row.userId !== actorId &&
        row.kind !== "leave" &&
        row.name !== null &&
        Date.parse(row.startsAt) <= at &&
        Date.parse(row.endsAt) > at,
    )
    .sort((a, b) => a.endsAt.localeCompare(b.endsAt) || (a.name ?? "").localeCompare(b.name ?? ""))
    .map((row) => ({
      id: row.id,
      name: row.name as string,
      grade: row.grade ? (GRADE_LABEL[row.grade] ?? null) : null,
      endsAt: row.endsAt,
    }));
}

export function useMyDayWhosOn(now: Date): MyDayWhosOn {
  const teams = useRosterTeams();
  const payload = teams.status === "ready" ? teams.data : null;
  const team =
    payload && !payload.sample ? ((payload.teams ?? []).find((candidate) => candidate.enabled) ?? null) : null;
  const today = perthDateOf(now);
  const read = useRosterRead(team?.serviceId ?? null, "assignments", {
    from: addDaysToDate(today, -1),
    to: addDaysToDate(today, 1),
  });
  const assignments = read.status === "ready" ? read.data?.assignments : undefined;
  const colleagues = useMemo(
    () => (assignments ? colleaguesOnNow(assignments, payload?.actorId, now) : []),
    [assignments, payload?.actorId, now],
  );
  if (teams.status === "loading" || (team && read.status === "loading"))
    return { status: "loading", teamName: null, colleagues: [] };
  if (!team || read.status !== "ready") return { status: "unavailable", teamName: null, colleagues: [] };
  return { status: "ready", teamName: team.name, colleagues };
}
