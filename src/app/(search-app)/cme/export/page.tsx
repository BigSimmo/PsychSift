import type { Metadata } from "next";

import { CmeStateNotice } from "@/components/cme/cme-state-notice";
import { CpdExportPage } from "@/components/work-screens/cpd/cpd-export-page";
import { loadCmePageData } from "@/lib/cme/load-cme-page-data";

export const metadata: Metadata = {
  title: "Export | CPD | PsychSift",
  description: "Save your CPD year as a CSV or a printable summary, copy it to your CPD home, and close the year.",
  robots: { index: false, follow: false },
};

export default async function CmeExportRoute({
  searchParams,
}: {
  searchParams: Promise<{ year?: string | string[] }>;
}) {
  const query = await searchParams;
  const raw = (Array.isArray(query.year) ? query.year[0] : query.year)?.trim();
  const requested = raw ? Number(raw) : undefined;
  const year =
    requested !== undefined && Number.isInteger(requested) && requested >= 2000 && requested <= 2100
      ? requested
      : undefined;
  const data = await loadCmePageData(year, { allYears: true });
  if (data.state !== "ready" || !data.set) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <CmeStateNotice state={data.state === "ready" ? "unavailable" : data.state} year={data.year} heading="Export" />
      </main>
    );
  }
  return (
    <CpdExportPage
      key={data.set.year}
      set={data.set}
      entries={data.entries}
      years={data.availableYears ?? [data.set.year]}
      goalCount={data.goals.length}
      close={data.close}
      now={data.now}
      demoMode={data.demoMode}
    />
  );
}
