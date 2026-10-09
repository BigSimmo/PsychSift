import type { Metadata } from "next";

import { CmeStateNotice } from "@/components/cme/cme-state-notice";
import { CpdHomeSendPage } from "@/components/cme/cpd-home/cpd-home-send-page";
import { loadCmePageData } from "@/lib/cme/load-cme-page-data";

export const metadata: Metadata = {
  title: "AMA CPD Home | CPD | PsychSift",
  description:
    "Make a CSV of your CPD activities to try in AMA CPD Home, copy each activity, and keep track of the files you added. What CPD Home can import is not checked yet.",
};

export default async function CmeCpdHomeRoute({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const query = await searchParams;
  const requestedYear = query.year ? Number(query.year) : undefined;
  const data = await loadCmePageData(
    Number.isInteger(requestedYear) && requestedYear! >= 2000 && requestedYear! <= 2100 ? requestedYear : undefined,
    { allYears: true },
  );
  if (data.state !== "ready" || !data.set) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <CmeStateNotice
          state={data.state === "ready" ? "unavailable" : data.state}
          year={data.year}
          heading="AMA CPD Home"
        />
      </main>
    );
  }
  return (
    <CpdHomeSendPage
      key={data.set.year}
      set={data.set}
      entries={data.entries}
      availableYears={data.availableYears ?? [data.set.year]}
      demoMode={data.demoMode}
      now={data.now}
    />
  );
}
