import type { Metadata } from "next";

import { CmeStateNotice } from "@/components/cme/cme-state-notice";
import { CmeTrainingPage } from "@/components/cme/cme-training-page";
import { cpdYearOf } from "@/lib/cme/cpd-year";
import { trainingExampleView } from "@/lib/cme/training-assessments";
import { sampleTrainingAssessments } from "@/lib/cme/training-assessments-sample";
import { loadCmeTrainingPageData } from "@/lib/cme/training-page-data";

export const metadata: Metadata = {
  title: "Training | CPD | PsychSift",
  description:
    "Your own record of your training: stages, rotations and breaks, where you are now, and the next milestone due.",
};

type CmeTrainingRouteProps = {
  /** `?example=intern` switches the demo between the registrar and junior doctor examples. */
  readonly searchParams?: Promise<{ example?: string | string[] }>;
};

export default async function CmeTrainingRoute({ searchParams }: CmeTrainingRouteProps = {}) {
  const [data, query] = await Promise.all([loadCmeTrainingPageData(), searchParams ?? Promise.resolve({})]);
  if (data.state !== "ready") {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <CmeStateNotice state={data.state} year={cpdYearOf(data.now)} heading="Training" />
      </main>
    );
  }
  const view = trainingExampleView((query as { example?: string | string[] }).example);
  return (
    <CmeTrainingPage
      key={data.demoMode ? view : "owner"}
      nowIso={data.now.toISOString()}
      initialPeriods={data.periods}
      initialMilestones={data.milestones}
      demoMode={data.demoMode}
      assessments={data.demoMode ? sampleTrainingAssessments(view) : { status: "not-recorded" }}
    />
  );
}
