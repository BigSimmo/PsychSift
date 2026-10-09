"use client";

import { useCallback, useEffect, useState } from "react";

import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { cmeRoutineLogHref } from "@/components/cme/cme-route-navigation";
import { cpdYearOf } from "@/lib/cme/cpd-year";
import { groupDrafts, type CmeDraft } from "@/lib/cme/drafts";
import { routineLogPrefill, routinesDueOn, type CmeRoutine } from "@/lib/cme/routines";
import { myDaySeverityForDue } from "@/lib/my-day/merge";
import type { MyDayItem, MyDaySourceResult } from "@/lib/my-day/model";
import { cpdCoachingMyDayItems, ruleEnginesOn } from "@/lib/my-day/rule-items";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import { perthDateKey, showsReminderInApp, type ReminderSettings } from "@/lib/reminders/settings";
import { useAuthSession } from "@/lib/supabase/client";
import { sharedGet } from "@/lib/shared-get";

/**
 * CPD for My Day: routines due today or earlier (when the reader's own
 * "CPD routines due" reminder is showing) and a count of drafts waiting on the
 * reader. Routine titles are the reader's own labels, already on the CPD page;
 * draft titles and reflections are never read here.
 */
function routineItem(routine: CmeRoutine, now: Date): MyDayItem {
  return {
    id: `cme:routine:${routine.id}`,
    mode: "cme",
    title: routine.title,
    detail: "Routine due",
    due: routine.nextDue,
    severity: myDaySeverityForDue(routine.nextDue, now),
    href: cmeRoutineLogHref(routineLogPrefill(routine, now)),
  };
}

/**
 * Routines falling due on or before `endDate` (a Perth date), for the Week
 * page, which looks past today. Same row, same id and same reminder gate as
 * `cmeMyDayItems`, so the two merge without repeating a routine.
 */
export function cmeRoutineItemsThrough(
  routines: readonly CmeRoutine[],
  endDate: string,
  now: Date,
  reminders: ReminderSettings,
): MyDayItem[] {
  if (!showsReminderInApp(reminders, "cpd-routines", perthDateKey(now))) return [];
  return routines
    .filter((routine) => routine.archivedAt === null && routine.nextDue !== null && routine.nextDue <= endDate)
    .map((routine) => routineItem(routine, now));
}

export function cmeMyDayItems(
  input: { routines: readonly CmeRoutine[]; drafts: readonly CmeDraft[]; year: number | string },
  now: Date,
  reminders: ReminderSettings,
): MyDayItem[] {
  const items: MyDayItem[] = [];
  if (showsReminderInApp(reminders, "cpd-routines", perthDateKey(now))) {
    for (const routine of routinesDueOn(input.routines, now)) {
      items.push(routineItem(routine, now));
    }
  }
  const waiting = groupDrafts(input.drafts).nextAction.length;
  if (waiting > 0) {
    items.push({
      id: "cme:drafts",
      mode: "cme",
      title: `Finish ${waiting} CPD draft${waiting === 1 ? "" : "s"}`,
      due: null,
      severity: "info",
      href: `/cme/log?year=${encodeURIComponent(String(input.year))}&tab=finish#cme-drafts`,
    });
  }
  return items;
}

const signedOut: MyDaySourceResult = { mode: "cme", status: "signed-out", items: [] };
const loading: MyDaySourceResult = { mode: "cme", status: "loading", items: [] };

/** The confirmed year and its activities, read only while the signed CPD coaching is switched on. */
type Coaching = { set: CmeRequirementSet | null; entries: CmeEntry[] };

type Loaded =
  | { status: "ready"; routines: CmeRoutine[]; drafts: CmeDraft[]; sample: boolean; coaching?: Coaching }
  | { status: "signed-out" | "failed" };

type Read<T> = { ok: true; data: T; demo: boolean } | { ok: false; unauthorized: boolean } | null;

async function readList<T>(url: string, key: "routines" | "drafts", signal: AbortSignal): Promise<Read<T[]>> {
  try {
    const response = await sharedGet(url, { signal });
    if (response.status === 401) return { ok: false, unauthorized: true };
    if (!response.ok) return { ok: false, unauthorized: false };
    const body = (await response.json().catch(() => null)) as ({ demoMode?: boolean } & Record<string, unknown>) | null;
    const list = body?.[key];
    if (!Array.isArray(list)) return { ok: false, unauthorized: false };
    return { ok: true, data: list as T[], demo: body?.demoMode === true };
  } catch {
    return signal.aborted ? null : { ok: false, unauthorized: false };
  }
}

/**
 * The year's confirmed targets and activities, the reads the CPD hours card makes. A failed read
 * fails the CPD source, so a missing coaching line never passes for a year that is on track.
 */
async function loadCoaching(signal: AbortSignal): Promise<Coaching | "failed" | "sample"> {
  try {
    const [year, entries] = await Promise.all([
      sharedGet("/api/cme/year", { signal }),
      sharedGet("/api/cme/entries", { signal }),
    ]);
    if (!year.ok || !entries.ok) return "failed";
    const yearBody = (await year.json().catch(() => null)) as {
      requirementSet?: CmeRequirementSet | null;
      demoMode?: boolean;
    } | null;
    const entriesBody = (await entries.json().catch(() => null)) as {
      entries?: unknown;
      year?: number;
      demoMode?: boolean;
    } | null;
    if (!yearBody || !entriesBody || !Array.isArray(entriesBody.entries)) return "failed";
    if (yearBody.demoMode || entriesBody.demoMode) return "sample";
    const set = yearBody.requirementSet ?? null;
    // Activities from another year are never measured against this year's targets.
    if (!set || entriesBody.year !== set.year) return { set: null, entries: [] };
    return { set, entries: entriesBody.entries as CmeEntry[] };
  } catch {
    return "failed";
  }
}

async function loadCme(signal: AbortSignal, withCoaching: boolean): Promise<Loaded | null> {
  const [routines, drafts, coaching] = await Promise.all([
    readList<CmeRoutine>("/api/cme/routines", "routines", signal),
    readList<CmeDraft>("/api/cme/drafts", "drafts", signal),
    withCoaching ? loadCoaching(signal) : Promise.resolve(undefined),
  ]);
  if (signal.aborted || !routines || !drafts) return null;
  if ((!routines.ok && routines.unauthorized) || (!drafts.ok && drafts.unauthorized)) return { status: "signed-out" };
  if (!routines.ok || !drafts.ok || coaching === "failed") return { status: "failed" };
  return {
    status: "ready",
    routines: routines.data,
    drafts: drafts.data,
    sample: routines.demo || drafts.demo,
    ...(coaching && coaching !== "sample" ? { coaching } : {}),
  };
}

const noRoutines: readonly CmeRoutine[] = [];

export function useCmeMyDaySource({ enabled, now }: { enabled: boolean; now: Date }): {
  result: MyDaySourceResult;
  retry: () => void;
  /** The reader's routines once loaded (for the Week page); empty until then. */
  routines: readonly CmeRoutine[];
} {
  const reminders = useAppPreferences().preferences.reminders;
  const { authEpoch } = useAuthSession();
  const [stored, setStored] = useState<{ epoch: number; loaded: Loaded } | null>(null);
  const [generation, setGeneration] = useState(0);
  const retry = useCallback(() => setGeneration((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void loadCme(controller.signal, ruleEnginesOn(new Date()).cpd).then((next) => {
      if (next && !controller.signal.aborted) setStored({ epoch: authEpoch, loaded: next });
    });
    return () => controller.abort();
  }, [enabled, generation, authEpoch]);

  if (!enabled) return { result: signedOut, retry, routines: noRoutines };
  // Data from another account (a different auth epoch) is never shown.
  if (!stored || stored.epoch !== authEpoch) return { result: loading, retry, routines: noRoutines };
  const loaded = stored.loaded;
  if (loaded.status !== "ready")
    return { result: { mode: "cme", status: loaded.status, items: [] }, retry, routines: noRoutines };
  return {
    result: {
      mode: "cme",
      status: "ready",
      items: [
        ...cmeMyDayItems({ routines: loaded.routines, drafts: loaded.drafts, year: cpdYearOf(now) }, now, reminders),
        ...(loaded.coaching && !loaded.sample
          ? cpdCoachingMyDayItems(loaded.coaching.set, loaded.coaching.entries, now)
          : []),
      ],
      ...(loaded.sample ? { sample: true } : {}),
    },
    retry,
    routines: loaded.routines,
  };
}
