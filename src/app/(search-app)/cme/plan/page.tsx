import type { Metadata } from "next";

import { CmePlanPage } from "@/components/cme/cme-plan-page";
import { CmeStateNotice } from "@/components/cme/cme-state-notice";
import { CmeYearEndActions } from "@/components/cme/cme-year-close-panel";
import { cmeCarryGoalId } from "@/lib/cme/carry-return";
import { cmeDemoCarryPreview, loadCmePageData } from "@/lib/cme/load-cme-page-data";

export const metadata: Metadata = {
  title: "Development plan | CPD | PsychSift",
  description: "Your yearly development plan: your goals, and how the year's hours fall across them.",
};

export default async function CmePlanRoute({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; carry?: string; demoCarry?: string }>;
}) {
  const query = await searchParams;
  const requestedYear = query.year ? Number(query.year) : undefined;
  const data = await loadCmePageData(
    Number.isInteger(requestedYear) && requestedYear! >= 2000 && requestedYear! <= 2100 ? requestedYear : undefined,
    { nextYear: true, demoCarryPreview: cmeDemoCarryPreview(query.demoCarry) },
  );
  if (data.state !== "ready" || !data.set) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
        <CmeStateNotice
          state={data.state === "ready" ? "unavailable" : data.state}
          year={data.year}
          heading="Development plan"
        />
      </main>
    );
  }
  return (
    <>
      <CmePlanPage
        key={data.set.year}
        set={data.set}
        goals={data.goals}
        entries={data.entries}
        demoMode={data.demoMode}
        now={data.now}
        nextYearConfirmed={data.nextYearConfirmed}
        nextYearGoals={data.nextYearGoals}
        ownerId={data.ownerId ?? undefined}
        resumeCarryGoalId={cmeCarryGoalId(query.carry)}
      />
      <aside aria-label="Year-end actions" className="mx-auto w-full max-w-3xl px-4 pb-6 sm:px-6">
        <CmeYearEndActions
          set={data.set}
          entries={data.entries}
          goals={data.goals}
          now={data.now}
          nextYearConfirmed={data.nextYearConfirmed}
          nextYearGoals={data.nextYearGoals}
        />
      </aside>
    </>
  );
}
