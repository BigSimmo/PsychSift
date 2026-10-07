import type { Metadata } from "next";

import { ApplicationsCvPage } from "@/components/cme/applications/applications-cv-page";
import { CmeStateNotice } from "@/components/cme/cme-state-notice";
import { loadCmePageData } from "@/lib/cme/load-cme-page-data";

export const metadata: Metadata = {
  title: "CV | Job applications | PsychSift",
  description:
    "A CV built only from your own records: terms, teaching you gave, CPD hours and outcome work, and a statement in your own words.",
};

export default async function CmeApplicationsCvRoute() {
  const data = await loadCmePageData(undefined, { allYears: true });
  if (data.state === "signed-out") {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <CmeStateNotice state="signed-out" year={data.year} heading="CV" />
      </main>
    );
  }
  // A year with no CPD set-up still has other years' activities, read through allYears.
  const entries = data.allEntries ?? data.entries;
  const cpdFailed = data.state === "unavailable" || Boolean(data.allYearsFailed);
  return <ApplicationsCvPage entries={entries} cpdFailed={cpdFailed} demoMode={data.demoMode} now={data.now} />;
}
