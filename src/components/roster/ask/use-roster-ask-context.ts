"use client";

import { useEffect, useState } from "react";

import { useRosterShifts } from "@/components/roster/use-roster-shifts";
import { useRosterRead, useRosterTeams } from "@/components/roster/use-roster-team";
import type { AskAnswerData } from "@/lib/roster/ask/answer";
import type { AskContext, AskPerson } from "@/lib/roster/ask/parse";
import { fortnightFor, type HoursExtra } from "@/lib/roster/hours";
import { addDaysToDate, perthDateOf } from "@/lib/roster/shifts/perth-time";

/** All reads use existing roster endpoints. The question is never an argument to this hook. */
export function useRosterAskContext(): {
  readonly parser: AskContext;
  readonly answers: AskAnswerData;
  readonly teamChoices: readonly { id: string; name: string }[];
  readonly selectedTeamId: string | null;
  readonly selectTeam: (id: string) => void;
  /** Personal shifts and the team list — enough for nights, hours, leave. */
  readonly loading: boolean;
  /** Team overview and assignments — needed for who-is-on and swaps. */
  readonly teamLoading: boolean;
} {
  const today = perthDateOf(new Date());
  const range = { from: addDaysToDate(today, -7), to: addDaysToDate(today, 54) };
  const shifts = useRosterShifts();
  const teams = useRosterTeams();
  const [chosenTeamId, selectTeam] = useState<string | null>(null);
  const [leave, setLeave] = useState<AskAnswerData["leave"]>(undefined);
  const [extras, setExtras] = useState<readonly HoursExtra[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/roster/leave", { cache: "no-store", signal: controller.signal })
      .then(async (response) => (response.ok ? ((await response.json()) as { leave?: AskAnswerData["leave"] }) : null))
      .then((payload) => {
        if (!controller.signal.aborted && Array.isArray(payload?.leave)) setLeave(payload.leave);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  const availableTeams = Array.isArray(teams.data?.teams) ? teams.data.teams.filter((team) => team.enabled) : [];
  const teamChoices = availableTeams.map((team) => ({ id: team.serviceId, name: team.name }));
  const selectedTeamId = teamChoices.some((team) => team.id === chosenTeamId)
    ? chosenTeamId
    : (teamChoices[0]?.id ?? null);
  const selectedTeam = availableTeams.find((team) => team.serviceId === selectedTeamId);
  const overview = useRosterRead(selectedTeamId, "overview");
  const assignments = useRosterRead(selectedTeamId, "assignments", range);
  const payFortnightAnchor = overview.status === "ready" ? (overview.data?.settings?.payFortnightAnchor ?? null) : null;
  const fortnight = fortnightFor(today, payFortnightAnchor);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/roster/extra-time?from=${fortnight.start}&to=${fortnight.end}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => (response.ok ? ((await response.json()) as { records?: HoursExtra[] }) : null))
      .then((payload) => {
        if (!controller.signal.aborted && Array.isArray(payload?.records)) setExtras(payload.records);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [fortnight.start, fortnight.end]);
  const loadedAssignments =
    assignments.status === "ready" && Array.isArray(assignments.data?.assignments) ? assignments.data.assignments : [];
  // The member-facing assignments read already contains visible names. The
  // separate people read is manager-only and must never be called from Ask.
  const people = new Map<string, AskPerson>();
  for (const assignment of loadedAssignments) {
    if (assignment.userId && assignment.name)
      people.set(assignment.userId, {
        userId: assignment.userId,
        name: assignment.name,
        grade: assignment.grade,
      });
  }
  const publication = overview.status === "ready" ? (overview.data?.latestPublication ?? null) : null;
  const loadedRange = assignments.status === "ready" ? range : null;
  const actorId = teams.status === "ready" ? (teams.data?.actorId ?? null) : null;
  const parser: AskContext = {
    today,
    actorId,
    assignments: loadedAssignments,
    people: [...people.values()],
    codes: [...new Set(loadedAssignments.map((assignment) => assignment.shiftCode))],
  };
  const answers: AskAnswerData = {
    today,
    shifts: shifts.status === "ready" ? shifts.shifts : [],
    assignments: loadedAssignments,
    actorId,
    teamName: selectedTeam?.name ?? null,
    loadedRange,
    publication,
    payFortnightAnchor,
    rotationEndsOn: overview.status === "ready" ? (overview.data?.me?.rotationEndsOn ?? null) : null,
    leave,
    extras,
  };
  return {
    parser,
    answers,
    teamChoices,
    selectedTeamId,
    selectTeam,
    loading: shifts.status === "loading" || teams.status === "loading",
    teamLoading: Boolean(selectedTeamId && (overview.status === "loading" || assignments.status === "loading")),
  };
}
