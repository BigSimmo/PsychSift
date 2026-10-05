"use client";

import { useRouter } from "next/navigation";

import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";

import { CmeDashboard, type CmeReportingReminder } from "@/components/cme/cme-dashboard";
import { useCmeOneTapRoutineLog } from "@/components/cme/cme-one-tap-routine-log";
import { CmeQuickLog } from "@/components/cme/cme-quick-log";
import { cmeRoutineLogHref } from "@/components/cme/cme-route-navigation";
import type { CmePlanGoal } from "@/lib/cme/plan-goals";
import type { CmeRoutine } from "@/lib/cme/routines";
import type { TrainingPosition } from "@/lib/cme/training-timeline";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import { perthDateKey, snoozeReminder } from "@/lib/reminders/settings";

export type CmeDashboardRouteProps = {
  readonly set: CmeRequirementSet;
  readonly entries: readonly CmeEntry[];
  /** ISO instant from the server load — Dates cannot cross the RSC boundary intact. */
  readonly nowIso: string;
  readonly routines: readonly CmeRoutine[];
  readonly demoMode?: boolean;
  readonly reportingReminder?: CmeReportingReminder | null;
  readonly draftsToFinish?: number;
  readonly currentTrainingPosition?: TrainingPosition | null;
  readonly goals?: readonly CmePlanGoal[];
  readonly nextYearConfirmed?: boolean | null;
  readonly nextYearGoals?: readonly CmePlanGoal[];
};

/**
 * The CME mode home, wired to real destinations.
 *
 * A Client Component because `CmeDashboard`'s two controls are callbacks, and a
 * function prop cannot cross the Server Component boundary. The route file
 * itself stays a thin Server Component that exports only `metadata` and loads
 * owner (or demo) data — this is where the wiring lives.
 *
 * `now` is supplied by the server load so a server render and the client it
 * hydrates into agree on which season of the year the screen is in. Demo mode
 * freezes that instant against the corpus; live mode uses the request time.
 */
export function CmeDashboardRoute({
  set,
  entries,
  nowIso,
  routines,
  demoMode = false,
  reportingReminder = null,
  draftsToFinish = 0,
  currentTrainingPosition = null,
  goals,
  nextYearConfirmed = null,
  nextYearGoals,
}: CmeDashboardRouteProps) {
  const router = useRouter();
  const { preferences, setPreference } = useAppPreferences();
  const now = new Date(nowIso);
  const oneTap = useCmeOneTapRoutineLog({ demoMode });

  return (
    <>
      <CmeDashboard
        set={set}
        entries={entries}
        now={now}
        demoMode={demoMode}
        routines={routines}
        loggingDue={oneTap.logging}
        onLogRoutine={(prefill) => {
          void oneTap.logDueRoutine(prefill).then((result) => {
            if (result === "form") router.push(cmeRoutineLogHref(prefill));
          });
        }}
        onOpenCustomise={() => router.push("/cme/customise")}
        reportingReminder={reportingReminder}
        reminders={preferences.reminders}
        onSnoozeReminder={(type) =>
          setPreference("reminders", snoozeReminder(preferences.reminders, type, perthDateKey(now)))
        }
        draftsToFinish={draftsToFinish}
        currentTrainingPosition={currentTrainingPosition}
        goals={goals}
        nextYearConfirmed={nextYearConfirmed}
        nextYearGoals={nextYearGoals}
      />
      {oneTap.notice}
      <CmeQuickLog set={set} entries={entries} routines={routines} nowIso={nowIso} demoMode={demoMode} />
    </>
  );
}
