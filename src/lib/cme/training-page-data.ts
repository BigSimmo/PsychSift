import "server-only";

import {
  SAMPLE_TRAINING_MILESTONES,
  SAMPLE_TRAINING_NOW_ISO,
  SAMPLE_TRAINING_PERIODS,
} from "@/lib/cme/training-assessments-sample";
import { fetchOwnerTrainingMilestones, fetchOwnerTrainingPeriods } from "@/lib/cme/training-repository";
import type { TrainingMilestone, TrainingPeriod } from "@/lib/cme/training-timeline";
import { isDemoMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CmeTrainingPageData = {
  readonly state: "ready" | "signed-out" | "unavailable";
  readonly demoMode: boolean;
  readonly periods: readonly TrainingPeriod[];
  readonly milestones: readonly TrainingMilestone[];
  readonly now: Date;
};

/**
 * The Training page's data: the signed-in owner's own periods and milestones.
 *
 * Resolves the owner exactly as `loadCmePageData` does (the server session's
 * verified user, then the service-role client scoped to that owner), and
 * keeps the same distinction between signed out and unavailable, so an outage
 * never reads as an empty record. Demo mode shows the invented registrar
 * example from the owner's mock-up (`training-assessments-sample.ts`), on the
 * mock-up's own "today" so its dates read as drawn.
 *
 * The timeline is not tied to a CPD year, so an unconfigured year does not
 * block this page.
 */
export async function loadCmeTrainingPageData(): Promise<CmeTrainingPageData> {
  if (isDemoMode()) {
    return {
      state: "ready",
      demoMode: true,
      periods: SAMPLE_TRAINING_PERIODS,
      milestones: SAMPLE_TRAINING_MILESTONES,
      now: new Date(SAMPLE_TRAINING_NOW_ISO),
    };
  }
  const now = new Date();
  const empty = { demoMode: false, periods: [], milestones: [], now };
  try {
    const server = await createSupabaseServerClient();
    if (!server) return { ...empty, state: "unavailable" };
    const { data: auth, error } = await server.auth.getUser();
    if (error) return { ...empty, state: error.name === "AuthSessionMissingError" ? "signed-out" : "unavailable" };
    if (!auth.user) return { ...empty, state: "signed-out" };
    const admin = createAdminClient();
    const [periods, milestones] = await Promise.all([
      fetchOwnerTrainingPeriods(admin, auth.user.id),
      fetchOwnerTrainingMilestones(admin, auth.user.id),
    ]);
    return { state: "ready", demoMode: false, periods, milestones, now };
  } catch {
    return { ...empty, state: "unavailable" };
  }
}
