"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { kindOf } from "@/components/roster/roster-format";
import { fetchRosterRead, useRosterTeams } from "@/components/roster/use-roster-team";
import { useRosterShifts } from "@/components/roster/use-roster-shifts";
import { useSignedOutSample } from "@/components/mode-kit/use-signed-out-sample";
import type { OpenShiftListing } from "@/lib/open-shifts/model";
import { sampleListings, sampleRoster } from "@/lib/open-shifts/sample";
import type { FatigueShift } from "@/lib/roster/fatigue-rules";
import type { RosterTeam } from "@/lib/roster/team/model";
import { setOpenShiftsIsPoster } from "@/lib/teaching/page-visibility";
import { useOnlineStatus } from "@/lib/use-online-status";

/**
 * Every open shift in every Roster team the reader belongs to, plus their own
 * roster for the roster check.
 *
 * Nothing is written to the device (Roster's offline rule). The last list read
 * in this tab is kept in memory only, so a reader who loses signal keeps seeing
 * it, marked with the time it was read, and can't act on it.
 */

export type OpenShiftsStatus = "loading" | "ready" | "signed-out" | "no-team" | "error";

export type OpenShiftsState = {
  readonly status: OpenShiftsStatus;
  readonly listings: readonly OpenShiftListing[];
  readonly teams: readonly RosterTeam[];
  /** The reader's own roster, or null while it loads or when it couldn't be read. */
  readonly roster: readonly FatigueShift[] | null;
  readonly rosterStatus: "loading" | "ready" | "error";
  /** When the list was read: "Shift list updated 09:50". */
  readonly readAt: Date | null;
  /** Made-up example records: signed out, or team rosters not yet open to real staff. */
  readonly sample: "signed-out" | "release-held" | null;
  readonly offline: boolean;
  /** Teams whose open shifts couldn't be read, so the list is incomplete. */
  readonly failedTeams: readonly string[];
  readonly actorId: string | null;
  readonly message: string | null;
  readonly reload: () => void;
};

type Loaded = {
  readonly key: string;
  readonly listings: OpenShiftListing[];
  readonly failedTeams: string[];
  readonly readAt: Date;
};

// In memory for this tab only: the offline view. Never localStorage.
let lastLoaded: Loaded | null = null;

async function loadTeam(team: RosterTeam): Promise<OpenShiftListing[] | null> {
  const [requests, overview] = await Promise.all([
    fetchRosterRead(team.serviceId, "requests"),
    fetchRosterRead(team.serviceId, "overview"),
  ]);
  if (!requests.ok) return null;
  const sites = new Map((overview.ok ? overview.data.sites : []).map((site) => [site.id, site.name]));
  const teamName = overview.ok ? overview.data.service.name : team.name;
  const myGrade = overview.ok ? overview.data.me.grade : team.grade;
  return requests.data.openShifts.map((row) => ({
    ...row,
    serviceId: team.serviceId,
    teamName,
    siteName: row.siteId ? (sites.get(row.siteId) ?? null) : null,
    myGrade,
  }));
}

export function useOpenShifts(): OpenShiftsState {
  const signedOutSample = useSignedOutSample();
  const online = useOnlineStatus();
  const teams = useRosterTeams();
  const shifts = useRosterShifts();
  const [loaded, setLoaded] = useState<Loaded | null>(lastLoaded);
  const [failed, setFailed] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => {
    teams.reload();
    void shifts.reload();
    setGeneration((value) => value + 1);
  }, [teams, shifts]);

  const enabled = useMemo(() => (teams.data?.teams ?? []).filter((team) => team.enabled), [teams.data]);
  const releaseHeld = teams.data?.sample === true;
  const key = enabled
    .map((team) => team.serviceId)
    .sort()
    .join(",");

  useEffect(() => {
    setOpenShiftsIsPoster(!releaseHeld && enabled.some((team) => team.role === "manager"));
  }, [enabled, releaseHeld]);

  useEffect(() => {
    if (teams.status !== "ready" || enabled.length === 0) return;
    let cancelled = false;
    void Promise.all(enabled.map(async (team) => ({ team, rows: await loadTeam(team) }))).then((results) => {
      if (cancelled) return;
      const ok = results.filter((result) => result.rows !== null);
      if (ok.length === 0) {
        setFailed("Open shifts couldn't be reached. Try again shortly.");
        return;
      }
      const next: Loaded = {
        key,
        listings: ok.flatMap((result) => result.rows ?? []),
        failedTeams: results.filter((result) => result.rows === null).map((result) => result.team.name),
        readAt: new Date(),
      };
      lastLoaded = next;
      setFailed(null);
      setLoaded(next);
    });
    return () => {
      cancelled = true;
    };
  }, [teams.status, enabled, key, generation]);

  const now = useMemo(() => new Date(), []);
  const rosterRows = useMemo<FatigueShift[] | null>(() => {
    if (shifts.status !== "ready") return null;
    return shifts.shifts.map((shift) => ({
      id: shift.id,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      kind: kindOf(shift),
    }));
  }, [shifts.status, shifts.shifts]);

  const base = {
    reload,
    offline: !online,
    actorId: teams.data?.actorId ?? null,
  };

  if (signedOutSample || teams.status === "signed-out") {
    return {
      ...base,
      status: "ready",
      listings: sampleListings(now),
      teams: [],
      roster: sampleRoster(now),
      rosterStatus: "ready",
      readAt: null,
      sample: "signed-out",
      failedTeams: [],
      message: null,
    };
  }

  const rosterStatus = shifts.status === "ready" ? "ready" : shifts.status === "loading" ? "loading" : "error";

  if (releaseHeld) {
    return {
      ...base,
      status: "ready",
      listings: sampleListings(now),
      teams: [],
      roster: sampleRoster(now),
      rosterStatus: "ready",
      readAt: null,
      sample: "release-held",
      failedTeams: [],
      message: null,
    };
  }

  // Offline (or the read failed) with a list already read in this tab: keep showing it, dated.
  const current = loaded && loaded.key === key ? loaded : null;
  const offlineCopy = !online && lastLoaded ? lastLoaded : null;
  const shown = current ?? offlineCopy;

  if (teams.status === "ready" && enabled.length === 0) {
    return {
      ...base,
      status: "no-team",
      listings: [],
      teams: [],
      roster: rosterRows,
      rosterStatus,
      readAt: null,
      sample: null,
      failedTeams: [],
      message: null,
    };
  }

  if (shown) {
    return {
      ...base,
      status: "ready",
      listings: shown.listings,
      teams: enabled,
      roster: rosterRows,
      rosterStatus,
      readAt: shown.readAt,
      sample: null,
      failedTeams: shown.failedTeams,
      message: null,
    };
  }

  if (teams.status === "error" || teams.status === "unavailable" || teams.status === "not-confirmed" || failed) {
    return {
      ...base,
      status: "error",
      listings: [],
      teams: enabled,
      roster: rosterRows,
      rosterStatus,
      readAt: null,
      sample: null,
      failedTeams: [],
      message: failed ?? teams.message ?? "Open shifts couldn't be reached. Try again shortly.",
    };
  }

  return {
    ...base,
    status: "loading",
    listings: [],
    teams: enabled,
    roster: rosterRows,
    rosterStatus,
    readAt: null,
    sample: null,
    failedTeams: [],
    message: null,
  };
}
