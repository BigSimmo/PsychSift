"use client";

import { useCallback, useEffect, useState } from "react";

import {
  ROSTER_FOLLOW_UP_READS,
  type RosterAction,
  type RosterCommandResult,
  type RosterReadResult,
  type RosterReadWhat,
  type RosterRules,
  type RosterTeam,
} from "@/lib/roster/team/model";
import { setRosterHasEnabledTeam } from "@/lib/teaching/page-visibility";

/**
 * The team client every Roster screen reads through. Answers live in React
 * state only: nothing is written to the device, and everything is fetched
 * again on the next visit (Josh's offline rule).
 *
 * `unavailable` means the read is one the follow-up database change adds and
 * it isn't live yet; screens hide that module rather than showing an error.
 */

export type RosterTeamStatus = "loading" | "ready" | "signed-out" | "not-confirmed" | "unavailable" | "error";

export type RosterReadState<T> = {
  readonly status: RosterTeamStatus;
  readonly data: T | null;
  readonly message: string | null;
  readonly reload: () => void;
  /** When this answer arrived: the "Rechecked 18:21" time. Never a cached value. */
  readonly readAt: Date | null;
};

type ErrorPayload = { code?: unknown; message?: unknown; error?: unknown };

const SIGNED_OUT_MESSAGE = "Sign in to see your team.";
const FALLBACK_MESSAGE = "Roster couldn't be reached. Try again shortly.";

export function rosterTeamUrl(serviceId: string): string {
  return `/api/roster/team/${encodeURIComponent(serviceId)}`;
}

function messageOf(payload: ErrorPayload | null): string {
  if (typeof payload?.message === "string" && payload.message) return payload.message;
  if (typeof payload?.error === "string" && payload.error) return payload.error;
  return FALLBACK_MESSAGE;
}

function codeOf(payload: ErrorPayload | null): string {
  return typeof payload?.code === "string" ? payload.code : "roster_unavailable";
}

type Loaded<T> =
  | { status: "ready"; data: T; readAt: Date }
  | { status: Exclude<RosterTeamStatus, "ready" | "loading">; message: string }
  | { status: "aborted" };

async function load<T>(url: string, what: RosterReadWhat | "teams", signal: AbortSignal): Promise<Loaded<T>> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    if (response.ok) return { status: "ready", data: (await response.json()) as T, readAt: new Date() };
    const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
    const code = codeOf(payload);
    if (response.status === 401) return { status: "signed-out", message: SIGNED_OUT_MESSAGE };
    if (code === "roster_team_not_verified") return { status: "not-confirmed", message: messageOf(payload) };
    if (code === "roster_invalid_request" && (ROSTER_FOLLOW_UP_READS as readonly string[]).includes(what)) {
      return { status: "unavailable", message: messageOf(payload) };
    }
    return { status: "error", message: messageOf(payload) };
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") return { status: "aborted" };
    return { status: "error", message: FALLBACK_MESSAGE };
  }
}

function useLoaded<T>(url: string | null, what: RosterReadWhat | "teams"): RosterReadState<T> {
  // Each answer remembers the address it was read from, so a new address shows
  // "loading" at once instead of the previous team's data. A reload of the same
  // address keeps the current answer on screen until the fresh one arrives.
  const [state, setState] = useState<(Omit<RosterReadState<T>, "reload"> & { url: string }) | null>(null);
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((value) => value + 1), []);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    void load<T>(url, what, controller.signal).then((result) => {
      if (result.status === "aborted" || controller.signal.aborted) return;
      if (result.status === "ready") {
        setState({ url, status: "ready", data: result.data, message: null, readAt: result.readAt });
      } else {
        setState({ url, status: result.status, data: null, message: result.message, readAt: null });
      }
    });
    return () => controller.abort();
  }, [url, what, generation]);

  if (!state || state.url !== url) return { status: "loading", data: null, message: null, readAt: null, reload };
  return { status: state.status, data: state.data, message: state.message, readAt: state.readAt, reload };
}

/** `sample` marks the invented team served while the real-staff release is held. */
export type RosterTeamsPayload = { teams: RosterTeam[]; actorId?: string; sample?: boolean };

/** The teams I belong to. */
export function useRosterTeams(): RosterReadState<RosterTeamsPayload> {
  const state = useLoaded<RosterTeamsPayload>("/api/roster/team", "teams");
  useEffect(() => {
    if (state.status !== "ready") return;
    const enabled = Array.isArray(state.data?.teams) ? state.data.teams.some((team) => team.enabled) : false;
    setRosterHasEnabledTeam(enabled);
  }, [state.status, state.data]);
  return state;
}

/** Rules remain scoped to their team; changing membership discards the previous answers. */
export function useRosterTeamRules(serviceIds: readonly string[]): ReadonlyMap<string, RosterRules> {
  const key = JSON.stringify([...new Set(serviceIds)].sort());
  const [answer, setAnswer] = useState<{ key: string; rules: Map<string, RosterRules> } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const ids = JSON.parse(key) as string[];
    void Promise.all(
      ids.map(async (id) => {
        const result = await load<RosterReadResult<"overview">>(
          `${rosterTeamUrl(id)}?what=overview`,
          "overview",
          controller.signal,
        );
        return result.status === "ready" && result.data.settings?.rules
          ? ([id, result.data.settings.rules] as const)
          : null;
      }),
    ).then((rows) => {
      if (!controller.signal.aborted) setAnswer({ key, rules: new Map(rows.filter((row) => row !== null)) });
    });
    return () => controller.abort();
  }, [key]);
  return answer?.key === key ? answer.rules : new Map();
}

/** One read of one team. Pass a null `serviceId` to wait (no request is made). */
export function useRosterRead<W extends RosterReadWhat>(
  serviceId: string | null,
  what: W,
  range?: { from: string; to: string } | null,
): RosterReadState<RosterReadResult<W>> {
  let url: string | null = null;
  if (serviceId) {
    const params = new URLSearchParams({ what });
    if (range) {
      params.set("from", range.from);
      params.set("to", range.to);
    }
    url = `${rosterTeamUrl(serviceId)}?${params.toString()}`;
  }
  return useLoaded<RosterReadResult<W>>(url, what);
}

/** One read, fetched once on demand (a sheet's fresh "Rechecked" read). */
export async function fetchRosterRead<W extends RosterReadWhat>(
  serviceId: string,
  what: W,
  range?: { from: string; to: string } | null,
): Promise<{ ok: true; data: RosterReadResult<W>; readAt: Date } | { ok: false; code: string; message: string }> {
  const params = new URLSearchParams({ what });
  if (range) {
    params.set("from", range.from);
    params.set("to", range.to);
  }
  try {
    const response = await fetch(`${rosterTeamUrl(serviceId)}?${params.toString()}`, { cache: "no-store" });
    if (response.ok) return { ok: true, data: (await response.json()) as RosterReadResult<W>, readAt: new Date() };
    const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
    return { ok: false, code: codeOf(payload), message: messageOf(payload) };
  } catch {
    return { ok: false, code: "roster_unavailable", message: FALLBACK_MESSAGE };
  }
}

/**
 * Send one team action. The body names no actor: the server takes it from the
 * session. `keepalive` lets a held send finish even as the page is leaving.
 */
export async function postRosterAction(
  serviceId: string,
  action: RosterAction,
  options?: { keepalive?: boolean },
): Promise<{ ok: true; result: RosterCommandResult } | { ok: false; code: string; message: string }> {
  try {
    const response = await fetch(rosterTeamUrl(serviceId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
      cache: "no-store",
      ...(options?.keepalive ? { keepalive: true } : {}),
    });
    const payload = (await response.json().catch(() => null)) as
      ({ result?: RosterCommandResult } & ErrorPayload) | null;
    if (response.ok && payload?.result) return { ok: true, result: payload.result };
    if (response.status === 401) return { ok: false, code: "roster_auth_required", message: SIGNED_OUT_MESSAGE };
    return { ok: false, code: codeOf(payload), message: messageOf(payload) };
  } catch {
    return { ok: false, code: "roster_unavailable", message: FALLBACK_MESSAGE };
  }
}
