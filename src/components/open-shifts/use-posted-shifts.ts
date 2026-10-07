"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useSignedOutSample } from "@/components/mode-kit/use-signed-out-sample";
import { fetchRosterRead, useRosterTeams } from "@/components/roster/use-roster-team";
import { setOpenShiftsIsPoster } from "@/lib/teaching/page-visibility";
import { useOnlineStatus } from "@/lib/use-online-status";
import type { RosterGrade, RosterManageOpenShift, RosterTeam } from "@/lib/roster/team/model";

/**
 * The poster's side: the open shifts in every team the reader manages, with
 * who asked for each. Roster's `manage` read is manager-only and names the
 * claimant by id; the team's `members` read gives the name and level, as
 * Roster's own approval screen shows them.
 *
 * In memory only, like the doctor's side: nothing is written to the device.
 */

export type PostedShift = RosterManageOpenShift & {
  readonly serviceId: string;
  readonly teamName: string;
  readonly siteName: string | null;
  readonly claimantName: string | null;
  readonly claimantGrade: RosterGrade | null;
  readonly postedByName: string | null;
};

export type PostedTeam = {
  readonly serviceId: string;
  readonly name: string;
  readonly sites: readonly { id: string; name: string }[];
};

export type PostedShiftsState = {
  readonly status: "loading" | "ready" | "signed-out" | "not-poster" | "error";
  readonly shifts: readonly PostedShift[];
  readonly teams: readonly PostedTeam[];
  readonly failedTeams: readonly string[];
  readonly readAt: Date | null;
  /** The latest refresh failed, so the list shown is the earlier one: act on it only after a fresh read. */
  readonly refreshFailed: boolean;
  readonly offline: boolean;
  readonly actorId: string | null;
  readonly message: string | null;
  readonly reload: () => void;
};

type Loaded = {
  key: string;
  actorId: string | null;
  shifts: PostedShift[];
  teams: PostedTeam[];
  failedTeams: string[];
  readAt: Date;
};

async function loadTeam(team: RosterTeam): Promise<{ shifts: PostedShift[]; team: PostedTeam } | null> {
  const [manage, overview, members] = await Promise.all([
    fetchRosterRead(team.serviceId, "manage"),
    fetchRosterRead(team.serviceId, "overview"),
    fetchRosterRead(team.serviceId, "members"),
  ]);
  if (!manage.ok) return null;
  const sites = overview.ok ? overview.data.sites : [];
  const siteName = new Map(sites.map((site) => [site.id, site.name]));
  const people = new Map((members.ok ? members.data.members : []).map((member) => [member.userId, member]));
  const teamName = overview.ok ? overview.data.service.name : team.name;
  return {
    team: { serviceId: team.serviceId, name: teamName, sites },
    shifts: manage.data.openShifts.map((row) => {
      const claimant = row.claimedBy ? people.get(row.claimedBy) : undefined;
      return {
        ...row,
        serviceId: team.serviceId,
        teamName,
        siteName: row.siteId ? (siteName.get(row.siteId) ?? null) : null,
        claimantName: claimant?.name ?? null,
        claimantGrade: claimant?.grade ?? null,
        postedByName: row.postedBy ? (people.get(row.postedBy)?.name ?? null) : null,
      };
    }),
  };
}

export function usePostedShifts(): PostedShiftsState {
  const online = useOnlineStatus();
  const teams = useRosterTeams();
  // With example data on, the example team's manager side shows here as it does in Roster's Manage team,
  // so the poster's screens are not a dead end. Its answers are example receipts: nothing is saved.
  const example = useSignedOutSample("rost");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  // Clearing the failure first brings the loading shape back, so "Try again" visibly does something.
  const reload = useCallback(() => {
    setFailed(null);
    setGeneration((value) => value + 1);
  }, []);

  const managed = useMemo(
    () =>
      teams.data?.sample && !example
        ? []
        : (teams.data?.teams ?? []).filter((team) => team.enabled && team.role === "manager"),
    [teams.data, example],
  );
  const key = managed
    .map((team) => team.serviceId)
    .sort()
    .join(",");

  // The Post tab shows once the teams read confirms poster rights, whichever tab loaded first.
  useEffect(() => {
    if (teams.status === "ready") setOpenShiftsIsPoster(managed.length > 0);
    if (teams.status === "signed-out") setOpenShiftsIsPoster(false);
  }, [teams.status, managed]);

  const actorId = teams.data?.actorId ?? null;
  useEffect(() => {
    if (teams.status !== "ready" || managed.length === 0) return;
    let cancelled = false;
    void Promise.all(managed.map(async (team) => ({ team, result: await loadTeam(team) }))).then((results) => {
      if (cancelled) return;
      const ok = results.filter((entry) => entry.result !== null);
      if (ok.length === 0) {
        setFailed("Try again shortly.");
        return;
      }
      setFailed(null);
      setLoaded({
        key,
        actorId,
        shifts: ok.flatMap((entry) => entry.result?.shifts ?? []),
        teams: ok.flatMap((entry) => (entry.result ? [entry.result.team] : [])),
        failedTeams: results.filter((entry) => entry.result === null).map((entry) => entry.team.name),
        readAt: new Date(),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [teams.status, managed, key, generation, actorId]);

  const base = { reload, offline: !online, actorId };
  const empty = { shifts: [], teams: [], failedTeams: [], readAt: null, refreshFailed: false, message: null };
  if (teams.status === "signed-out") return { ...base, ...empty, status: "signed-out" };
  if (teams.status === "ready" && managed.length === 0) return { ...base, ...empty, status: "not-poster" };
  const current = loaded && loaded.key === key && loaded.actorId === actorId ? loaded : null;
  if (current) {
    return {
      ...base,
      status: "ready",
      shifts: current.shifts,
      teams: current.teams,
      failedTeams: current.failedTeams,
      readAt: current.readAt,
      refreshFailed: failed !== null,
      message: null,
    };
  }
  if (teams.status === "error" || teams.status === "unavailable" || teams.status === "not-confirmed" || failed) {
    return {
      ...base,
      ...empty,
      status: "error",
      message: failed ?? teams.message ?? "Try again shortly.",
    };
  }
  return { ...base, ...empty, status: "loading" };
}
