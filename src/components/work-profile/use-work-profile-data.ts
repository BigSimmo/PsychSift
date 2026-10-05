"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useOnCallHospitalPhone } from "@/components/on-call/call/call-device-stores";
import { useRosterSettings } from "@/components/roster/use-roster-settings";
import { useRosterShifts } from "@/components/roster/use-roster-shifts";
import { useRosterRead, useRosterTeams } from "@/components/roster/use-roster-team";
import { useTeachingWeek } from "@/components/teaching/use-teaching-week";
import { cmeYearConfigurationState } from "@/lib/cme/year-configuration";
import type { CmeRequirementSet } from "@/lib/cme/types";
import { useOnCallEntries } from "@/lib/on-call/entry-store";
import type { RosterTeam } from "@/lib/roster/team/model";
import { addDaysToDate, perthDateOf } from "@/lib/roster/shifts/perth-time";
import { summariseAdmin, workplaceNames, type AdminSummary, type Loaded } from "@/lib/work-profile/model";

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** False only when the browser says there is no network; true on the server. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

type CpdStatus = { configured: boolean; routines: number };

async function readJson(
  url: string,
  signal: AbortSignal,
): Promise<{ ok: boolean; unauthorized: boolean; body: unknown }> {
  const response = await fetch(url, { cache: "no-store", signal });
  return {
    ok: response.ok,
    unauthorized: response.status === 401,
    body: response.ok ? await response.json().catch(() => null) : null,
  };
}

/** Whether this year's CPD programme is set up, and how many routines run. Fetched, never cached. */
function useCpdStatus(): Loaded<CpdStatus> {
  const [state, setState] = useState<Loaded<CpdStatus>>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([readJson("/api/cme/year", controller.signal), readJson("/api/cme/routines", controller.signal)])
      .then(([year, routines]) => {
        if (year.unauthorized || routines.unauthorized) return setState({ status: "signed-out" });
        if (!year.ok || !routines.ok) return setState({ status: "failed" });
        const set = (year.body as { requirementSet?: CmeRequirementSet | null } | null)?.requirementSet ?? null;
        const list = (routines.body as { routines?: unknown } | null)?.routines;
        setState({
          status: "ready",
          value: {
            configured: cmeYearConfigurationState(set) === "ready",
            routines: Array.isArray(list) ? list.length : 0,
          },
        });
      })
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name === "AbortError") return;
        setState({ status: "failed" });
      });
    return () => controller.abort();
  }, []);
  return state;
}

export type WorkProfileData = {
  readonly roster: Loaded<{ workplaces: number; rowName: string | null }>;
  readonly workplaces: Loaded<readonly string[]>;
  readonly teams: Loaded<readonly RosterTeam[]>;
  readonly teaching: Loaded<{ teams: number }>;
  readonly cpd: Loaded<CpdStatus>;
  readonly admin: Loaded<AdminSummary>;
  readonly hospitalPhone: boolean;
  /** The single enabled team's pay-fortnight anchor (YYYY-MM-DD), when there is exactly one team. */
  readonly payFortnightAnchor: Loaded<string | null>;
};

/**
 * Everything the page reads, each as its own Loaded value, so one failing area
 * says "Not checked" without hiding the others. Only mounted for a signed-in
 * reader: nothing here fetches signed out.
 */
export function useWorkProfileData(now: Date): WorkProfileData {
  const settings = useRosterSettings();
  const shifts = useRosterShifts();
  const teamsRead = useRosterTeams();
  const entries = useOnCallEntries();
  const hospitalPhone = useOnCallHospitalPhone();
  const cpd = useCpdStatus();

  const today = perthDateOf(now.toISOString());
  const range = useMemo(() => ({ from: today, to: addDaysToDate(today, 6) }), [today]);
  const teachingWeek = useTeachingWeek(range, { demoMode: false }, now);

  const teamList = Array.isArray(teamsRead.data?.teams) ? teamsRead.data.teams : [];
  const enabledTeams = teamList.filter((team) => team.enabled);
  const oneTeamId = enabledTeams.length === 1 ? enabledTeams[0]!.serviceId : null;
  const overview = useRosterRead(oneTeamId, "overview");

  const rosterLoaded: Loaded<{ workplaces: number; rowName: string | null }> =
    settings.status === "loading" || shifts.status === "loading"
      ? { status: "loading" }
      : settings.status === "signed-out" || shifts.status === "signed-out"
        ? { status: "signed-out" }
        : settings.status === "error" || shifts.status === "error"
          ? { status: "failed" }
          : {
              status: "ready",
              value: {
                // A sample roster (team rosters held) is not the doctor's own set-up.
                workplaces: shifts.sample ? 0 : workplaceNames(shifts.shifts, settings.settings.codes).length,
                rowName: settings.settings.rowName?.trim() || null,
              },
            };

  const workplaces: Loaded<readonly string[]> =
    rosterLoaded.status === "ready"
      ? { status: "ready", value: shifts.sample ? [] : workplaceNames(shifts.shifts, settings.settings.codes) }
      : rosterLoaded;

  const teams: Loaded<readonly RosterTeam[]> =
    teamsRead.status === "loading"
      ? { status: "loading" }
      : teamsRead.status === "ready"
        ? { status: "ready", value: teamsRead.data?.sample ? [] : teamList }
        : teamsRead.status === "signed-out"
          ? { status: "signed-out" }
          : teamsRead.status === "unavailable" || teamsRead.status === "not-confirmed"
            ? { status: "ready", value: [] }
            : { status: "failed" };

  const teaching: Loaded<{ teams: number }> =
    teachingWeek.status === "ready"
      ? { status: "ready", value: { teams: (teachingWeek.week?.teams ?? []).filter((team) => !team.isDemo).length } }
      : teachingWeek.status === "idle" || teachingWeek.status === "loading"
        ? { status: "loading" }
        : teachingWeek.status === "signed-out"
          ? { status: "signed-out" }
          : { status: "failed" };

  const admin: Loaded<AdminSummary> = entries.loading
    ? { status: "loading" }
    : entries.signedOut
      ? { status: "signed-out" }
      : entries.isOffline && entries.entries.length === 0
        ? { status: "failed" }
        : { status: "ready", value: summariseAdmin(entries.entries, entries.isOffline) };

  const payFortnightAnchor: Loaded<string | null> =
    oneTeamId === null
      ? teams.status === "ready"
        ? { status: "ready", value: null }
        : teams.status === "loading"
          ? { status: "loading" }
          : { status: "failed" }
      : overview.status === "ready"
        ? { status: "ready", value: overview.data?.settings?.payFortnightAnchor ?? null }
        : overview.status === "loading"
          ? { status: "loading" }
          : { status: "failed" };

  return { roster: rosterLoaded, workplaces, teams, teaching, cpd, admin, hospitalPhone, payFortnightAnchor };
}
