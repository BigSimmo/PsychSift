"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useMyDayWhosOn, type MyDayWhosOn } from "@/components/my-day/use-my-day-whos-on";
import { useRosterShifts, type MyShift } from "@/components/roster/use-roster-shifts";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { totalAllocatedHours } from "@/lib/cme/evaluate";
import { cpdCategoryTargets, cpdHoursByCategory, cpdHoursByMonth, type CpdByCategory } from "@/lib/my-day/figures";
import type { CmeCategory, CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import { addDaysToDate, perthDateOf } from "@/lib/roster/shifts/perth-time";
import { useAuthSession } from "@/lib/supabase/client";
import type { SessionSummary, TeachingWeekResponse } from "@/lib/teaching/model";

/**
 * The reads the dashboard cards add to My Day's own items, each made the way
 * its mode's page already makes it:
 *
 *   - Roster: `useRosterShifts`, the reader's own shifts (and their shifts on a
 *     confirmed team), exactly as Roster Today reads them.
 *   - Teaching: today's sessions from `/api/teaching?view=week`, the read
 *     Teaching Today makes for its "Next up" hero.
 *   - CPD: `/api/cme/year` and `/api/cme/entries`, the confirmed target and the
 *     year's activities, summed with `totalAllocatedHours` as the CPD hero does.
 *
 * `allowSample` is true only in a local demo build with no sign-in. Otherwise
 * any invented data (Roster's example roster, a demo Teaching team, a demo CPD
 * year) is dropped here and the card reads as unavailable, so a signed-in
 * reader never sees invented items.
 */

export type MyDayCardSourceStatus = "loading" | "ready" | "unavailable" | "failed";

export interface MyDayDashboardSources {
  readonly roster: {
    readonly status: MyDayCardSourceStatus;
    readonly shifts: readonly MyShift[];
    readonly sample: boolean;
    /** Ready, but a confirmed team's shifts could not be read: the roster is the reader's own shifts only. */
    readonly partial?: boolean;
  };
  readonly teaching: {
    readonly status: MyDayCardSourceStatus;
    /** Today's sessions that are going ahead, from services that are not demos (unless allowed). */
    readonly sessions: readonly SessionSummary[];
    /** Every session going ahead over the next six weeks, earliest first (the month calendar). */
    readonly ahead?: readonly SessionSummary[];
    /** The next session the reader presents, within six weeks. */
    readonly nextTalk?: SessionSummary | null;
    readonly sample: boolean;
    /** Ready, but the On Call teaching list could not be read, as Teaching's own week says. */
    readonly partial?: boolean;
  };
  readonly cpd: {
    readonly status: MyDayCardSourceStatus;
    readonly year: number | null;
    readonly loggedHours: number;
    readonly targetHours: number;
    /** Hours per Medical Board CPD type, from the activities' own allocations. */
    readonly byCategory: CpdByCategory;
    /** Each type's own target in the confirmed set, when it states one. */
    readonly categoryTargets: Readonly<Record<CmeCategory, number | null>>;
    /** Hours per month of the CPD year, January first. */
    readonly byMonth: readonly number[];
    /** This year's activities, for the CPD hours card's weekly bars. */
    readonly entries?: readonly CmeEntry[];
    /** The year has been closed: the hours card shows no pace line. */
    readonly closed?: boolean;
    readonly sample: boolean;
  };
  /** Colleagues on now on the reader's confirmed team; absent in older callers and tests. */
  readonly whosOn?: MyDayWhosOn;
  /** Read every dashboard source again (the page's Retry). */
  readonly retry?: () => void;
}

type CpdLoaded =
  | {
      status: "ready";
      year: number;
      loggedHours: number;
      targetHours: number;
      byCategory: CpdByCategory;
      categoryTargets: Readonly<Record<CmeCategory, number | null>>;
      byMonth: readonly number[];
      entries: readonly CmeEntry[];
      closed: boolean;
      sample: boolean;
    }
  | { status: "unavailable" | "failed" };

async function readJson(url: string, signal: AbortSignal): Promise<Record<string, unknown> | "unauthorized" | null> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (response.status === 401) return "unauthorized";
  if (!response.ok) return null;
  return (await response.json().catch(() => null)) as Record<string, unknown> | null;
}

async function loadCpd(signal: AbortSignal): Promise<CpdLoaded | null> {
  try {
    const [year, entries] = await Promise.all([
      readJson("/api/cme/year", signal),
      readJson("/api/cme/entries", signal),
    ]);
    if (signal.aborted) return null;
    if (year === "unauthorized" || entries === "unauthorized") return { status: "unavailable" };
    if (!year || !entries || !Array.isArray(entries.entries)) return { status: "failed" };
    const set = year.requirementSet as CmeRequirementSet | null | undefined;
    // No confirmed target for this year: there is nothing to measure hours against.
    if (!set || !(set.totalHours > 0) || entries.year !== set.year) return { status: "unavailable" };
    return {
      status: "ready",
      year: set.year,
      targetHours: set.totalHours,
      loggedHours: totalAllocatedHours(entries.entries as CmeEntry[]),
      byCategory: cpdHoursByCategory(entries.entries as CmeEntry[]),
      categoryTargets: cpdCategoryTargets(set.requirements ?? []),
      byMonth: cpdHoursByMonth(entries.entries as CmeEntry[], set.year),
      entries: entries.entries as CmeEntry[],
      closed: Boolean(set.closedAt),
      sample: year.demoMode === true || entries.demoMode === true,
    };
  } catch {
    return signal.aborted ? null : { status: "failed" };
  }
}

function useCpdHours(
  allowSample: boolean,
  today: string,
): { readonly cpd: MyDayDashboardSources["cpd"]; readonly retry: () => void } {
  const { authEpoch } = useAuthSession();
  // The CPD year is the calendar year: keyed on it, the read rolls over on 1 January.
  const cpdYear = today.slice(0, 4);
  const [attempt, setAttempt] = useState(0);
  const [stored, setStored] = useState<{ key: string; loaded: CpdLoaded } | null>(null);
  const key = `${authEpoch}|${cpdYear}|${attempt}`;
  useEffect(() => {
    const controller = new AbortController();
    void loadCpd(controller.signal).then((next) => {
      if (next && !controller.signal.aborted) setStored({ key, loaded: next });
    });
    return () => controller.abort();
  }, [key]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { cpd: cpdFrom(stored, key, allowSample), retry };
}

function cpdFrom(
  stored: { key: string; loaded: CpdLoaded } | null,
  key: string,
  allowSample: boolean,
): MyDayDashboardSources["cpd"] {
  // Data read under another sign-in, or for last year, is never shown.
  if (!stored || stored.key !== key) return { status: "loading", year: null, ...NO_CPD };
  const loaded = stored.loaded;
  if (loaded.status !== "ready" || (loaded.sample && !allowSample))
    return {
      status: loaded.status === "ready" ? "unavailable" : loaded.status,
      year: null,
      ...NO_CPD,
    };
  return loaded;
}

const NO_CPD = {
  loggedHours: 0,
  targetHours: 0,
  byCategory: { educational: 0, reviewing: 0, measuring: 0 },
  categoryTargets: { educational: null, reviewing: null, measuring: null },
  byMonth: [] as readonly number[],
  entries: [] as readonly CmeEntry[],
  closed: false,
  sample: false,
} as const;

const NO_SESSIONS: readonly SessionSummary[] = [];
const TEACHING_DAYS_AHEAD = 41;

function useTodaysTeaching(
  today: string,
  allowSample: boolean,
): { readonly teaching: MyDayDashboardSources["teaching"]; readonly retry: () => void } {
  const week = useTeachingResource<TeachingWeekResponse>(
    // Six weeks from today (the longest range the week view takes): today's
    // sessions for the hero and agenda, and the next talk the reader gives.
    `/api/teaching?${new URLSearchParams({ view: "week", from: today, to: addDaysToDate(today, TEACHING_DAYS_AHEAD) })}`,
  );
  const data = week.status === "ready" ? week.data : null;
  const ahead = useMemo(() => {
    if (!data) return NO_SESSIONS;
    const demoTeams = new Set(data.teams.filter((team) => team.isDemo).map((team) => team.id));
    return [...data.sessions, ...data.relocated]
      .filter(
        (session) =>
          session.status !== "cancelled" &&
          (allowSample || session.source === "on_call_relocated" || !demoTeams.has(session.serviceId)),
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.occurrenceId.localeCompare(b.occurrenceId));
  }, [data, allowSample]);
  const sessions = useMemo(
    () => ahead.filter((session) => !session.allDay && perthDateOf(session.startsAt) === today),
    [ahead, today],
  );
  const nextTalk = useMemo(
    () =>
      ahead.find((session) => session.isPresenter && !session.allDay && perthDateOf(session.startsAt) >= today) ?? null,
    [ahead, today],
  );
  const sample = Boolean(data?.teams.some((team) => team.isDemo));
  const status: MyDayCardSourceStatus =
    week.status === "ready"
      ? "ready"
      : week.status === "loading" || week.status === "idle"
        ? "loading"
        : week.status === "offline" || week.status === "error"
          ? "failed"
          : "unavailable";
  return {
    teaching: {
      status,
      sessions,
      ahead,
      nextTalk,
      sample: allowSample && sample,
      partial: status === "ready" && data?.relocatedUnavailable === true,
    },
    retry: week.retry,
  };
}

export function useMyDayDashboardSources({
  today,
  now,
  allowSample,
}: {
  readonly today: string;
  /** The page clock, for "who's on now". */
  readonly now: Date;
  readonly allowSample: boolean;
}): MyDayDashboardSources {
  const shifts = useRosterShifts();
  const invented = shifts.sample || shifts.demoMode;
  // A selected team's shifts still loading means the week is not yet known to be free.
  const rosterStatus: MyDayCardSourceStatus =
    shifts.status === "loading" || (shifts.status === "ready" && shifts.teamLoading)
      ? "loading"
      : shifts.status === "error"
        ? "failed"
        : shifts.status === "signed-out" || (invented && !allowSample)
          ? "unavailable"
          : "ready";
  const roster = useMemo(
    () => ({
      status: rosterStatus,
      shifts: rosterStatus === "ready" ? shifts.shifts : [],
      sample: rosterStatus === "ready" && invented,
      partial: rosterStatus === "ready" && Boolean(shifts.teamMessage),
    }),
    [rosterStatus, shifts.shifts, invented, shifts.teamMessage],
  );
  const { teaching, retry: retryTeaching } = useTodaysTeaching(today, allowSample);
  const { cpd, retry: retryCpd } = useCpdHours(allowSample, today);
  const reloadRoster = shifts.reload;
  const retry = useCallback(() => {
    void reloadRoster();
    retryTeaching();
    retryCpd();
  }, [reloadRoster, retryTeaching, retryCpd]);
  const whosOn = useMyDayWhosOn(now);
  return useMemo(() => ({ roster, teaching, cpd, whosOn, retry }), [roster, teaching, cpd, whosOn, retry]);
}
