import "server-only";
import { fetchCmeCertificateEntryIds, fetchCmeEvidenceCounts } from "@/lib/cme/evidence-repository";
import type { CmeDraft } from "@/lib/cme/drafts";
import { fetchOwnerCmeDraft, fetchOwnerCmeDrafts } from "@/lib/cme/drafts-repository";
import type { CmeMissedSession } from "@/lib/cme/missed-sessions";
import { fetchOwnerCmeMissedSessions } from "@/lib/cme/missed-sessions-repository";
import { cpdYearOf, perthCalendarDate } from "@/lib/cme/cpd-year";
import type { CmePlanGoal } from "@/lib/cme/plan-goals";
import { fetchOwnerCmeEntryGoals, fetchOwnerCmePlanGoals } from "@/lib/cme/plan-goals-repository";
import {
  DEMO_CME_ENTRIES,
  DEMO_CME_INSTANT,
  DEMO_CME_PLAN_GOALS,
  DEMO_CME_YEAR,
  DEMO_CME_ROUTINES,
} from "@/lib/cme/demo-year";
import {
  fetchOwnerCmeEntries,
  fetchOwnerCmeEntry,
  fetchOwnerCmeRoutines,
  fetchOwnerCmeYear,
  fetchOwnerCmeYears,
  fetchOwnerCmeYearClose,
} from "@/lib/cme/repository";
import type { CmeRoutine } from "@/lib/cme/routines";
import { fetchOwnerTrainingPeriods } from "@/lib/cme/training-repository";
import { currentPosition, type TrainingPosition } from "@/lib/cme/training-timeline";
import { cmeYearConfigurationState } from "@/lib/cme/year-configuration";
import { canOfferCmeYearEnd } from "@/lib/cme/year-close-actions";
import type { CmeEntry, CmeRequirementSet, CmeYearClose } from "@/lib/cme/types";
import { isDemoMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CmePageData = {
  readonly state: "ready" | "unconfigured" | "signed-out" | "unavailable";
  readonly demoMode: boolean;
  readonly year: number;
  readonly set: CmeRequirementSet | null;
  readonly entries: readonly CmeEntry[];
  readonly routines: readonly CmeRoutine[];
  readonly now: Date;
  /** The closing snapshot and amendments, when the year is closed. */
  readonly close: CmeYearClose | null;
  /** The year's development-plan goals, in the owner's order. */
  readonly goals: readonly CmePlanGoal[];
  /** Saved drafts, only when asked for. Never counted toward hours. */
  readonly drafts: readonly CmeDraft[];
  /** Missed teaching and supervision, only when asked for. Never counted toward hours. */
  readonly missedSessions: readonly CmeMissedSession[];
  /** The one draft asked for by id, when it belongs to this owner. */
  readonly draft: CmeDraft | null;
  /** Drafts or missed sessions were asked for and could not be read; the rest of the page still loads. */
  readonly recordsFailed: boolean;
  /** Cross-year Log data is fetched only for the Log page. */
  readonly allEntries?: readonly CmeEntry[];
  readonly availableYears?: readonly number[];
  readonly allYearsFailed?: boolean;
  /** Optional owner-scoped training context for Today. Null when absent or unavailable. */
  readonly trainingPosition: TrainingPosition | null;
  /** Null means the next year's settings could not be checked. */
  readonly nextYearConfirmed: boolean | null;
  /** Undefined means the next year's goals could not be checked. */
  readonly nextYearGoals: readonly CmePlanGoal[] | undefined;
};

export type CmeRecordsOptions = {
  readonly includeArchived?: boolean;
  readonly drafts?: boolean;
  readonly missedSessions?: boolean;
  readonly draftId?: string;
  readonly allYears?: boolean;
  readonly trainingPosition?: boolean;
  readonly nextYear?: boolean;
};

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Drafts and missed sessions are not tied to a CPD year, so they load beside the year rather than
 * after it. A failure here is reported on its own section instead of taking the page down.
 */
async function loadRecords(admin: AdminClient, ownerId: string, options: CmeRecordsOptions) {
  try {
    const [drafts, missedSessions, draft] = await Promise.all([
      options.drafts ? fetchOwnerCmeDrafts(admin, ownerId) : [],
      options.missedSessions ? fetchOwnerCmeMissedSessions(admin, ownerId) : [],
      options.draftId ? fetchOwnerCmeDraft(admin, ownerId, options.draftId) : null,
    ]);
    return { drafts, missedSessions, draft, recordsFailed: false };
  } catch {
    return { drafts: [], missedSessions: [], draft: null, recordsFailed: true };
  }
}

const NO_RECORDS = { drafts: [], missedSessions: [], draft: null, recordsFailed: false } as const;

async function loadAllYears(
  admin: AdminClient,
  ownerId: string,
  selectedYear: number,
  selectedEntries: readonly CmeEntry[],
  options: CmeRecordsOptions,
) {
  if (!options.allYears) return {};
  try {
    const [years, certificateEntryIds] = await Promise.all([
      fetchOwnerCmeYears(admin, ownerId),
      fetchCmeCertificateEntryIds(admin, ownerId),
    ]);
    const byYear = await Promise.all(
      years.map(async ({ id, year }) => {
        if (year === selectedYear) return selectedEntries;
        const [entries, evidenceCounts] = await Promise.all([
          fetchOwnerCmeEntries(admin, ownerId, id, options),
          fetchCmeEvidenceCounts(admin, ownerId, year),
        ]);
        return entries.map((entry) => ({
          ...entry,
          evidenceCount: evidenceCounts[entry.id] ?? 0,
          certificateCount: certificateEntryIds.has(entry.id) ? 1 : 0,
        }));
      }),
    );
    return {
      allEntries: byYear.flat(),
      availableYears: years.map(({ year }) => year),
      allYearsFailed: false,
    };
  } catch {
    return { allYearsFailed: true };
  }
}

async function load(
  year?: number,
  entryId?: string,
  options: CmeRecordsOptions = {},
): Promise<CmePageData & { entry: CmeEntry | null }> {
  if (isDemoMode()) {
    const entry = entryId ? (DEMO_CME_ENTRIES.find((e) => e.id === entryId) ?? null) : null;
    const targetYear = entry ? Number(entry.date.slice(0, 4)) : (year ?? DEMO_CME_YEAR.year);
    return {
      state: targetYear === DEMO_CME_YEAR.year ? "ready" : "unconfigured",
      demoMode: true,
      year: targetYear,
      set: targetYear === DEMO_CME_YEAR.year ? DEMO_CME_YEAR : null,
      entries: targetYear === DEMO_CME_YEAR.year ? DEMO_CME_ENTRIES : [],
      ...(options.allYears
        ? {
            allEntries: targetYear === DEMO_CME_YEAR.year ? DEMO_CME_ENTRIES : [],
            // The demo also offers the empty year before, so year navigation can be exercised.
            availableYears: [DEMO_CME_YEAR.year, DEMO_CME_YEAR.year - 1],
            allYearsFailed: false,
          }
        : {}),
      routines: DEMO_CME_ROUTINES,
      now: DEMO_CME_INSTANT,
      // The demo year is never closed; closing is refused in demo mode.
      close: null,
      goals: targetYear === DEMO_CME_YEAR.year ? DEMO_CME_PLAN_GOALS : [],
      // Demo mode is read-only and has no drafts or missed sessions.
      ...NO_RECORDS,
      trainingPosition: null,
      nextYearConfirmed: null,
      nextYearGoals: undefined,
      entry,
    };
  }
  const now = new Date();
  const empty = {
    demoMode: false,
    year: year ?? cpdYearOf(now),
    set: null,
    entries: [],
    routines: [],
    now,
    close: null,
    goals: [],
    entry: null,
    ...NO_RECORDS,
    trainingPosition: null,
    nextYearConfirmed: null,
    nextYearGoals: undefined,
  };
  try {
    const server = await createSupabaseServerClient();
    if (!server) return { ...empty, state: "unavailable" };
    const { data: auth, error } = await server.auth.getUser();
    if (error) return { ...empty, state: error.name === "AuthSessionMissingError" ? "signed-out" : "unavailable" };
    if (!auth.user) return { ...empty, state: "signed-out" };
    const admin = createAdminClient();
    const entry = entryId ? await fetchOwnerCmeEntry(admin, auth.user.id, entryId) : null;
    const targetYear = entry ? Number(entry.date.slice(0, 4)) : empty.year;
    const [set, routines, records, trainingPosition] = await Promise.all([
      fetchOwnerCmeYear(admin, auth.user.id, targetYear),
      fetchOwnerCmeRoutines(admin, auth.user.id),
      loadRecords(admin, auth.user.id, options),
      options.trainingPosition
        ? fetchOwnerTrainingPeriods(admin, auth.user.id)
            // An empty record is not a reading: the CPD rule is left unticked rather than "Everyone else".
            .then((periods) => (periods.length ? currentPosition(periods, perthCalendarDate(now)) : null))
            .catch(() => null)
        : null,
    ]);
    if (!set) {
      const allYears = await loadAllYears(admin, auth.user.id, targetYear, [], options);
      return { ...empty, ...records, ...allYears, year: targetYear, routines, trainingPosition, state: "unconfigured" };
    }
    // Only the entry-goal links depend on the entry list; everything else needs just the year, so it
    // is read side by side rather than one after another (each read crosses Singapore -> Sydney).
    const [loadedEntries, evidenceCounts, certificateEntryIds, goals, close, nextYear] = await Promise.all([
      fetchOwnerCmeEntries(admin, auth.user.id, set.id, options),
      fetchCmeEvidenceCounts(admin, auth.user.id, targetYear),
      fetchCmeCertificateEntryIds(admin, auth.user.id),
      fetchOwnerCmePlanGoals(admin, auth.user.id, set.id),
      set.closedAt ? fetchOwnerCmeYearClose(admin, auth.user.id, set.id) : Promise.resolve(null),
      options.nextYear && canOfferCmeYearEnd(set, now)
        ? fetchOwnerCmeYear(admin, auth.user.id, targetYear + 1)
            .then(async (nextSet) => ({
              confirmed: nextSet ? cmeYearConfigurationState(nextSet) === "ready" : false,
              goals: nextSet ? await fetchOwnerCmePlanGoals(admin, auth.user.id, nextSet.id) : [],
            }))
            .catch(() => null)
        : null,
    ]);
    const entryGoals = await fetchOwnerCmeEntryGoals(
      admin,
      auth.user.id,
      entry ? [entry.id] : loadedEntries.map((item) => item.id),
    );
    const entries = loadedEntries.map((item) => ({
      ...item,
      evidenceCount: evidenceCounts[item.id] ?? 0,
      certificateCount: certificateEntryIds.has(item.id) ? 1 : 0,
      // Only an activity linked to a goal carries the field, so an unlinked one reads as before.
      ...(entryGoals[item.id] ? { goalId: entryGoals[item.id] } : {}),
    }));
    const state = cmeYearConfigurationState(set);
    if (state === "unavailable") return { ...empty, year: targetYear, state };
    const allYears = await loadAllYears(admin, auth.user.id, targetYear, entries, options);
    // Preserve the original settings and history for explicit owner repair.
    return {
      state,
      demoMode: false,
      year: targetYear,
      set,
      entries,
      ...allYears,
      routines,
      now,
      close,
      goals,
      trainingPosition,
      nextYearConfirmed: nextYear?.confirmed ?? null,
      nextYearGoals: nextYear?.goals,
      ...records,
      entry: entry
        ? {
            ...entry,
            evidenceCount: evidenceCounts[entry.id] ?? 0,
            certificateCount: certificateEntryIds.has(entry.id) ? 1 : 0,
            ...(entryGoals[entry.id] ? { goalId: entryGoals[entry.id] } : {}),
          }
        : null,
    };
  } catch {
    // Failure is distinct from setup: an outage must never invite replacing a saved year.
    return { ...empty, state: "unavailable" };
  }
}
export async function loadCmePageData(year?: number, options: CmeRecordsOptions = {}): Promise<CmePageData> {
  return load(year, undefined, options);
}
export async function loadCmeEntryPageData(id: string): Promise<CmePageData & { entry: CmeEntry | null }> {
  return load(undefined, id);
}
