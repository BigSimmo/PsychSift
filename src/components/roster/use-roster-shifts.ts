"use client";

import { useCallback, useEffect, useState } from "react";
import { useRosterTeams, rosterTeamUrl } from "./use-roster-team";
import { mergeMyShifts, type RosterDisplayShift } from "@/lib/roster/team/team-view";
import { rosterAssignmentsSchema, type RosterAssignment, type RosterTeam } from "@/lib/roster/team/model";
import { addDaysToDate } from "@/lib/roster/shifts/perth-time";
import { reportAreaData } from "@/lib/example-data/store";
import { sharedGet } from "@/lib/shared-get";

import type {
  OnCallManualShiftRequest,
  OnCallShift,
  OnCallShiftImportRequest,
  OnCallShiftImportSummary,
} from "@/lib/roster/shifts/model";
import { zonedToday } from "@/lib/work-time/format";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";

/**
 * The signed-in doctor's own shifts, fetched from `/api/roster/shifts`.
 *
 * Nothing here is written to the device: the shifts live in React state only
 * and are fetched again on the next visit (Josh's offline rule).
 *
 * `signed-out` is a resting state, not an error: a roster is personal, so a
 * signed-out reader simply has none to show.
 */
/**
 * One of my shifts as every Roster screen shows it: my own (imported or added
 * by hand) or my shift on a confirmed team's roster (`source: "team"`, never
 * copied into my own shifts table).
 */
export type MyShift = RosterDisplayShift;

export type RosterShiftsStatus = "loading" | "ready" | "signed-out" | "error";

export type RosterShiftsState = {
  readonly status: RosterShiftsStatus;
  readonly shifts: readonly MyShift[];
  readonly teamMessage?: string | null;
  /** A selected team window is still being read; an empty period is not yet known to be free. */
  readonly teamLoading: boolean;
  /**
   * Team shifts for a newly asked range are on their way, and the last range's
   * are shown meanwhile. Every range covers the days around today, so only the
   * days outside the last range (a week further away) are not yet known.
   */
  readonly teamRefreshing?: boolean;
  /** With `ownHistory`: your own shifts for the older part of the range are still being read. */
  readonly historyLoading?: boolean;
  /** With `ownHistory`: your own shifts for the older part of the range could not be read. */
  readonly historyFailed?: boolean;
  readonly latestImport: OnCallShiftImportSummary | null;
  readonly demoMode: boolean;
  /** The shifts are the sample doctor's example roster; the reader's first saved shift replaces them. */
  readonly sample: boolean;
  /** Save an imported roster. Resolves to an error sentence, or null on success. */
  readonly save: (request: OnCallShiftImportRequest) => Promise<string | null>;
  /** Add a shift by hand, optionally repeating weekly. */
  readonly addManual: (request: OnCallManualShiftRequest) => Promise<string | null>;
  /** Remove a hand-added shift and its weekly repeats. */
  readonly removeSeries: (seriesId: string) => Promise<string | null>;
  /**
   * Delete every shift. `keepalive` lets the request outlive a closing page,
   * which is how a pending "Delete my data" still happens on `pagehide`.
   */
  /** `ok` once your own data is removed; `message` says what did not go (or why it failed). */
  readonly deleteAll: (options?: {
    keepalive?: boolean;
  }) => Promise<{ readonly ok: boolean; readonly message: string | null }>;
  /** Remove one workplace's imported shifts and its calendar links. No import is recorded. */
  readonly removeWorkplace: (workplace: string) => Promise<string | null>;
  /** Fetch the shifts again, e.g. after a calendar link refresh brought new ones. */
  readonly reload: () => Promise<void>;
  readonly dismissChanges: () => Promise<void>;
};

type Payload = {
  shifts?: OnCallShift[];
  latestImport?: OnCallShiftImportSummary | null;
  demoMode?: boolean;
  sample?: boolean;
  error?: unknown;
  message?: string;
};

export const ROSTER_SHIFTS_URL = "/api/roster/shifts";
const ROSTER_WORKPLACES_URL = "/api/roster/workplaces";

async function readPayload(response: Response): Promise<Payload> {
  return ((await response.json().catch(() => null)) as Payload | null) ?? {};
}

function errorText(payload: Payload, fallback: string): string {
  return typeof payload.error === "string" && payload.error ? payload.error : fallback;
}

type Loaded = Payload | "signed-out" | "error" | "aborted";

async function fetchShifts(signal?: AbortSignal): Promise<Loaded> {
  try {
    const response = await sharedGet(ROSTER_SHIFTS_URL, { signal });
    if (response.status === 401) return "signed-out";
    if (!response.ok) return "error";
    return await readPayload(response);
  } catch (error) {
    return (error as { name?: string })?.name === "AbortError" ? "aborted" : "error";
  }
}

/** Mirrors PAST_SHIFT_DAYS in `GET /api/roster/shifts`: the main list starts this many days back. */
const LISTED_PAST_DAYS = 21;

/** Own shifts in both lists once, soonest first. */
function unionShifts(listed: readonly OnCallShift[], older: readonly OnCallShift[]): readonly OnCallShift[] {
  const seen = new Set(listed.map((shift) => shift.id));
  const extra = older.filter((shift) => !seen.has(shift.id));
  if (!extra.length) return listed;
  return [...extra, ...listed].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/**
 * `teamRange` sets the dates team shifts are read for. With `ownHistory`, your
 * own shifts are read for the part of that range older than the main list
 * reaches too (one dated read, kept in memory only), so an older month shows
 * them. Screens that only look around today leave it off.
 */
export function useRosterShifts(
  teamRange?: { from: string; to: string },
  options?: { readonly ownHistory?: boolean },
): RosterShiftsState {
  const { zone } = useWorkTimeZone();
  const teams = useRosterTeams();
  const today = zonedToday(zone);
  const from = teamRange?.from ?? addDaysToDate(today, -LISTED_PAST_DAYS);
  const to = teamRange?.to ?? addDaysToDate(today, 40);
  const listedFrom = addDaysToDate(today, -LISTED_PAST_DAYS);
  // The dated read stops where the main list starts (a day of overlap, merged by ID).
  const historyTo = to < listedFrom ? to : listedFrom;
  const wantsHistory = Boolean(options?.ownHistory && teamRange && from < listedFrom);
  const [history, setHistory] = useState<{
    from: string;
    to: string;
    shifts: readonly OnCallShift[];
    failed: boolean;
  } | null>(null);
  const [historyReload, setHistoryReload] = useState(0);
  // After a change to your shifts, the older ones are read again rather than shown as they were.
  const refreshHistory = useCallback(() => {
    setHistory(null);
    setHistoryReload((count) => count + 1);
  }, []);
  useEffect(() => {
    if (!wantsHistory) return;
    const controller = new AbortController();
    const url = `${ROSTER_SHIFTS_URL}?${new URLSearchParams({ from, to: historyTo })}`;
    // A re-read after a change goes to the network itself, never joining a read that began before the change.
    const read =
      historyReload > 0
        ? fetch(url, { cache: "no-store", signal: controller.signal })
        : sharedGet(url, { signal: controller.signal });
    read
      .then(async (response) => {
        if (!response.ok) throw new Error("older shifts unavailable");
        const payload = await readPayload(response);
        if (!controller.signal.aborted)
          setHistory({ from, to: historyTo, shifts: payload.shifts ?? [], failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setHistory({ from, to: historyTo, shifts: [], failed: true });
      });
    return () => controller.abort();
  }, [wantsHistory, from, historyTo, historyReload]);
  const [teamData, setTeamData] = useState<{
    payload: typeof teams.data;
    owner: string;
    from: string;
    to: string;
    rows: { team: RosterTeam; assignments: RosterAssignment[] }[];
    message: string | null;
  } | null>(null);
  const actorId = teams.data?.actorId;
  const teamPayload = teams.data;
  useEffect(() => {
    if (!actorId || !teamPayload) return;
    const controller = new AbortController();
    // A sample team (release held) is only for looking at: its invented shifts
    // must never join the reader's own roster.
    const enabled = teamPayload.sample
      ? []
      : (Array.isArray(teamPayload.teams) ? teamPayload.teams : []).filter((team) => team.enabled);
    void Promise.all(
      enabled.map(async (team) => {
        const query = new URLSearchParams({ what: "assignments", from, to });
        const response = await sharedGet(`${rosterTeamUrl(team.serviceId)}?${query}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("team unavailable");
        return { team, assignments: rosterAssignmentsSchema.parse(await response.json()).assignments };
      }),
    )
      .then((rows) => {
        if (!controller.signal.aborted)
          setTeamData({ payload: teamPayload, owner: actorId, from, to, rows, message: null });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setTeamData({
            payload: teamPayload,
            owner: actorId,
            from,
            to,
            rows: [],
            message: "Team shifts could not be loaded. Your own shifts are shown.",
          });
      });
    return () => controller.abort();
  }, [actorId, teamPayload, from, to]);
  const [status, setStatus] = useState<RosterShiftsStatus>("loading");
  const [shifts, setShifts] = useState<readonly OnCallShift[]>([]);
  const [latestImport, setLatestImport] = useState<OnCallShiftImportSummary | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [sample, setSample] = useState(false);

  const accept = useCallback((payload: Payload) => {
    setShifts(payload.shifts ?? []);
    setLatestImport(payload.latestImport ?? null);
    setDemoMode(Boolean(payload.demoMode));
    setSample(Boolean(payload.sample));
    setStatus("ready");
    // Tells auto mode whether Roster has real shifts (the sample gate waits for it).
    if (!payload.demoMode && !payload.sample) {
      reportAreaData("rost", (payload.shifts?.length ?? 0) > 0 || payload.latestImport ? "has-data" : "empty");
    }
  }, []);

  const apply = useCallback(
    (result: Loaded) => {
      if (result === "aborted") return;
      if (result === "signed-out" || result === "error") setStatus(result);
      else accept(result);
    },
    [accept],
  );

  const load = useCallback(async () => apply(await fetchShifts()), [apply]);

  useEffect(() => {
    const controller = new AbortController();
    fetchShifts(controller.signal).then(apply, () => undefined);
    return () => controller.abort();
  }, [apply]);

  const save = useCallback(
    async (request: OnCallShiftImportRequest) => {
      try {
        const response = await fetch(ROSTER_SHIFTS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        const payload = await readPayload(response);
        if (response.status === 401) return "Sign in to save your roster.";
        if (!response.ok) return errorText(payload, "Your roster could not be saved. Try again.");
        accept(payload);
        refreshHistory();
        return null;
      } catch {
        return "Your roster could not be saved. Check your connection and try again.";
      }
    },
    [accept, refreshHistory],
  );

  const addManual = useCallback(
    async (request: OnCallManualShiftRequest) => {
      try {
        const response = await fetch(`${ROSTER_SHIFTS_URL}/manual`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        const payload = await readPayload(response);
        if (response.status === 401) return "Sign in to add a shift.";
        if (!response.ok) return errorText(payload, "That shift could not be saved. Try again.");
        await load();
        refreshHistory();
        return null;
      } catch {
        return "That shift could not be saved. Check your connection and try again.";
      }
    },
    [load, refreshHistory],
  );

  const removeSeries = useCallback(
    async (seriesId: string) => {
      try {
        const response = await fetch(`${ROSTER_SHIFTS_URL}/manual/${encodeURIComponent(seriesId)}`, {
          method: "DELETE",
        });
        if (!response.ok) return errorText(await readPayload(response), "That shift could not be removed. Try again.");
        setShifts((current) => current.filter((shift) => shift.seriesId !== seriesId));
        refreshHistory();
        return null;
      } catch {
        return "That shift could not be removed. Check your connection and try again.";
      }
    },
    [refreshHistory],
  );

  const deleteAll = useCallback(
    async (options?: { keepalive?: boolean }) => {
      try {
        const response = await fetch(ROSTER_SHIFTS_URL, { method: "DELETE", keepalive: options?.keepalive ?? false });
        const payload = await readPayload(response);
        if (!response.ok)
          return { ok: false, message: errorText(payload, "Your data could not be deleted. Try again.") };
        accept(payload);
        refreshHistory();
        return { ok: true, message: payload.message ?? null };
      } catch {
        return { ok: false, message: "Your data could not be deleted. Check your connection and try again." };
      }
    },
    [accept, refreshHistory],
  );

  const removeWorkplace = useCallback(
    async (workplace: string) => {
      try {
        const response = await fetch(ROSTER_WORKPLACES_URL, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workplace }),
        });
        if (!response.ok) {
          return errorText(await readPayload(response), "That workplace could not be removed. Try again.");
        }
        setShifts((current) =>
          current.filter((shift) => !(shift.source === "import" && shift.workplace === workplace)),
        );
        refreshHistory();
        return null;
      } catch {
        return "That workplace could not be removed. Check your connection and try again.";
      }
    },
    [refreshHistory],
  );

  const dismissChanges = useCallback(async () => {
    const current = latestImport;
    if (!current || current.seenAt) return;
    setLatestImport({ ...current, seenAt: new Date().toISOString() });
    await fetch(`${ROSTER_SHIFTS_URL}/imports/${current.id}`, { method: "PATCH" }).catch(() => undefined);
  }, [latestImport]);

  const reloadTeams = teams.reload;
  const reload = useCallback(async () => {
    reloadTeams();
    setHistoryReload((count) => count + 1);
    await load();
  }, [reloadTeams, load]);

  const sameTeams =
    teamData &&
    Boolean(actorId) &&
    teamData.owner === actorId &&
    teamData.payload === teamPayload &&
    teams.status === "ready"
      ? teamData
      : null;
  const currentTeamData = sameTeams && sameTeams.from === from && sameTeams.to === to ? sameTeams : null;
  // A new range for the same teams keeps the last one's shifts while it loads.
  const previousTeamData = currentTeamData ? null : sameTeams;
  const shownTeamData = currentTeamData ?? previousTeamData;
  const enabledTeamCount = Array.isArray(teamPayload?.teams)
    ? teamPayload.teams.filter((team) => team.enabled).length
    : 0;

  const currentHistory = wantsHistory && history?.from === from && history.to === historyTo ? history : null;
  const own = currentHistory ? unionShifts(shifts, currentHistory.shifts) : shifts;

  return {
    status,
    shifts: shownTeamData && actorId ? mergeMyShifts(own, shownTeamData.rows, actorId) : own,
    historyLoading: wantsHistory && !currentHistory,
    historyFailed: Boolean(currentHistory?.failed),
    teamLoading:
      teams.status === "loading" ||
      (teams.status === "ready" && Boolean(actorId) && enabledTeamCount > 0 && !shownTeamData),
    teamRefreshing: Boolean(previousTeamData) && enabledTeamCount > 0,
    teamMessage:
      teams.status === "error"
        ? "Team shifts could not be loaded. Your own shifts are shown."
        : (shownTeamData?.message ?? null),
    latestImport,
    demoMode,
    sample,
    save,
    addManual,
    removeSeries,
    deleteAll,
    removeWorkplace,
    reload,
    dismissChanges,
  };
}

/** "2 added, 1 moved, 1 removed", leaving out the zeros. */
export function describeRosterChangeCounts(summary: Pick<OnCallShiftImportSummary, "added" | "changed" | "removed">) {
  const parts = [
    summary.added ? `${summary.added} added` : null,
    summary.changed ? `${summary.changed} moved` : null,
    summary.removed ? `${summary.removed} removed` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "no changes";
}
