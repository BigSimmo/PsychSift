"use client";

import { useCallback, useEffect, useState } from "react";

import { managerWaiting } from "@/components/roster/manage/roster-manage-waiting";
import { fetchRosterRead, type RosterTeamsPayload } from "@/components/roster/use-roster-team";
import { myDaySeverityForDue } from "@/lib/my-day/merge";
import type { MyDayItem, MyDaySourceResult } from "@/lib/my-day/model";
import { fatigueMyDayItems, ruleEnginesOn, type MyDayRuleShift } from "@/lib/my-day/rule-items";
import { addDaysToDate, formatPerthDay, perthDateOf } from "@/lib/roster/shifts/perth-time";
import type { RosterManage, RosterOverview, RosterRequests, RosterTeam } from "@/lib/roster/team/model";
import { swapProgress } from "@/lib/roster/team/swap-progress";
import { useAuthSession } from "@/lib/supabase/client";
import { sharedGet } from "@/lib/shared-get";

/** What one team contributes: the same reads Roster Today's team strip makes. */
export interface RosterMyDayTeamInput {
  readonly team: Pick<RosterTeam, "serviceId" | "role">;
  readonly overview: Pick<RosterOverview, "nextCutoffOn"> | null;
  readonly requests: Pick<RosterRequests, "swaps"> | null;
  /** Read only for a team the reader manages. */
  readonly manage: Pick<RosterManage, "swaps" | "openShifts"> | null;
}

export interface RosterMyDayInput {
  readonly actorId: string;
  /** Invented demo / held-release data: never shown as the reader's own work. */
  readonly sample?: boolean;
  readonly teams: readonly RosterMyDayTeamInput[];
  /** The reader's own shifts, read only while the signed fatigue warnings are switched on. */
  readonly ownShifts?: readonly MyDayRuleShift[];
}

/**
 * Roster's own "Needs you" rows, mapped for My Day. Same selectors as
 * `RosterTodayTeam`: `swapProgress(...).tab === "needs_you"`, `managerWaiting`
 * (decisions-in-strip, managers only) and the 14-day roster cutoff nudge.
 * Sample data yields nothing.
 */
export function rosterMyDayItems(input: RosterMyDayInput, now: Date): MyDayItem[] {
  if (input.sample) return [];
  const today = perthDateOf(now);
  const items: MyDayItem[] = [];
  for (const { team, overview, requests, manage } of input.teams) {
    for (const swap of requests?.swaps ?? []) {
      if (swapProgress(swap, input.actorId, now).tab !== "needs_you") continue;
      items.push({
        id: `roster:swap:${swap.id}`,
        mode: "roster",
        title: `${swap.requesterName ?? "A colleague"} asks to swap`,
        due: swap.expiresAt,
        severity: myDaySeverityForDue(swap.expiresAt, now),
        href: `/roster/swaps?team=${encodeURIComponent(team.serviceId)}`,
      });
    }
    const waiting =
      team.role === "manager" && manage
        ? managerWaiting(manage, { decisionsInStrip: true, actorId: input.actorId }).count
        : 0;
    if (waiting > 0) {
      items.push({
        id: `roster:manage:${team.serviceId}`,
        mode: "roster",
        title: `${waiting} waiting in Manage`,
        due: null,
        severity: "info",
        href: `/roster/manage?team=${encodeURIComponent(team.serviceId)}`,
      });
    }
    const cutoff = overview?.nextCutoffOn;
    if (cutoff && cutoff >= today && cutoff <= addDaysToDate(today, 14)) {
      items.push({
        id: `roster:cutoff:${team.serviceId}`,
        mode: "roster",
        title: `Next roster closes ${formatPerthDay(cutoff)}. Add dates you can't work.`,
        due: cutoff,
        severity: myDaySeverityForDue(cutoff, now),
        href: `/roster/requests?start=dates&team=${encodeURIComponent(team.serviceId)}`,
      });
    }
  }
  if (input.ownShifts) items.push(...fatigueMyDayItems(input.ownShifts, now));
  return items;
}

const signedOut: MyDaySourceResult = { mode: "roster", status: "signed-out", items: [] };
const loading: MyDaySourceResult = { mode: "roster", status: "loading", items: [] };

type Loaded = { status: "ready"; input: RosterMyDayInput } | { status: "signed-out" | "failed" | "unavailable" };

type OwnShifts = { ok: true; shifts: MyDayRuleShift[] | undefined } | { ok: false };

/**
 * The reader's own shifts for the fatigue warnings (the read Roster Today makes), or undefined when
 * they are example data. A failed read fails the Roster source: a missing warning must never pass
 * for a roster with nothing to warn about.
 */
async function loadOwnShifts(signal: AbortSignal): Promise<OwnShifts> {
  try {
    const response = await sharedGet("/api/roster/shifts", { signal });
    if (!response.ok) return { ok: false };
    const body = (await response.json().catch(() => null)) as {
      shifts?: unknown;
      demoMode?: boolean;
      sample?: boolean;
    } | null;
    if (!body || !Array.isArray(body.shifts)) return { ok: false };
    if (body.demoMode || body.sample) return { ok: true, shifts: undefined };
    return { ok: true, shifts: body.shifts as MyDayRuleShift[] };
  } catch {
    return { ok: false };
  }
}

async function loadRoster(signal: AbortSignal, withOwnShifts: boolean): Promise<Loaded | null> {
  const ownShiftsRead = withOwnShifts
    ? loadOwnShifts(signal)
    : Promise.resolve<OwnShifts>({ ok: true, shifts: undefined });
  const loaded = await loadRosterTeams(signal);
  const own = await ownShiftsRead;
  if (!loaded || signal.aborted) return null;
  if (loaded.status !== "ready") return loaded;
  if (!own.ok) return { status: "failed" };
  return own.shifts ? { status: "ready", input: { ...loaded.input, ownShifts: own.shifts } } : loaded;
}

async function loadRosterTeams(signal: AbortSignal): Promise<Loaded | null> {
  let response: Response;
  try {
    response = await sharedGet("/api/roster/team", { signal });
  } catch {
    return signal.aborted ? null : { status: "failed" };
  }
  if (response.status === 401) return { status: "signed-out" };
  if (!response.ok) return { status: "failed" };
  const payload = (await response.json().catch(() => null)) as RosterTeamsPayload | null;
  if (!payload || !Array.isArray(payload.teams)) return { status: "failed" };
  if (payload.sample) return { status: "unavailable" };
  const enabled = payload.teams.filter((team) => team.enabled);
  if (!enabled.length) return { status: "ready", input: { actorId: payload.actorId ?? "", teams: [] } };
  const actorId = payload.actorId;
  if (!actorId) return { status: "failed" };
  let failed = false;
  const teams = await Promise.all(
    enabled.map(async (team): Promise<RosterMyDayTeamInput> => {
      const [overview, requests, manage] = await Promise.all([
        fetchRosterRead(team.serviceId, "overview"),
        fetchRosterRead(team.serviceId, "requests"),
        team.role === "manager" ? fetchRosterRead(team.serviceId, "manage") : null,
      ]);
      if (!overview.ok || !requests.ok || (manage && !manage.ok)) failed = true;
      return {
        team,
        overview: overview.ok ? overview.data : null,
        requests: requests.ok ? requests.data : null,
        manage: manage?.ok ? manage.data : null,
      };
    }),
  );
  if (signal.aborted) return null;
  return failed ? { status: "failed" } : { status: "ready", input: { actorId, teams } };
}

/**
 * Roster for My Day. A reader may belong to several teams, and the per-team
 * hooks follow only one, so each enabled team is read once (overview, requests,
 * and manage for managers) with `fetchRosterRead`. Nothing is stored; a retry
 * reads everything again.
 */
export function useRosterMyDaySource({ enabled, now }: { enabled: boolean; now: Date }): {
  result: MyDaySourceResult;
  retry: () => void;
} {
  const { authEpoch } = useAuthSession();
  const [stored, setStored] = useState<{ epoch: number; loaded: Loaded } | null>(null);
  const [generation, setGeneration] = useState(0);
  const retry = useCallback(() => setGeneration((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void loadRoster(controller.signal, ruleEnginesOn(new Date()).fatigue).then((next) => {
      if (next && !controller.signal.aborted) setStored({ epoch: authEpoch, loaded: next });
    });
    return () => controller.abort();
  }, [enabled, generation, authEpoch]);

  if (!enabled) return { result: signedOut, retry };
  // Data from another account (a different auth epoch) is never shown.
  if (!stored || stored.epoch !== authEpoch) return { result: loading, retry };
  const loaded = stored.loaded;
  if (loaded.status === "ready") {
    return { result: { mode: "roster", status: "ready", items: rosterMyDayItems(loaded.input, now) }, retry };
  }
  return { result: { mode: "roster", status: loaded.status, items: [] }, retry };
}
