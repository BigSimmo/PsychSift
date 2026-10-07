import type { Metadata } from "next";

import { CmeStateNotice } from "@/components/cme/cme-state-notice";
import { CpdEvidencePage } from "@/components/work-screens/cpd/cpd-evidence-page";
import { cpdYearOf } from "@/lib/cme/cpd-year";
import { loadCmePageData } from "@/lib/cme/load-cme-page-data";
import { parseEvidenceCategory, parseEvidenceStatus } from "@/lib/work-screens/cpd/evidence";

export const metadata: Metadata = {
  title: "Evidence | CPD | PsychSift",
  description: "Which of your CPD activities have evidence attached, and which still need it.",
  robots: { index: false, follow: false },
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CmeEvidenceRoute({
  searchParams,
}: {
  searchParams: Promise<{ year?: string | string[]; category?: string | string[]; show?: string | string[] }>;
}) {
  const query = await searchParams;
  const raw = firstValue(query.year)?.trim();
  const requested = raw ? Number(raw) : undefined;
  const year =
    requested !== undefined && Number.isInteger(requested) && requested >= 2000 && requested <= 2100
      ? requested
      : undefined;
  const data = await loadCmePageData(year, { allYears: true });
  if (data.state === "signed-out" || data.state === "unavailable") {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <CmeStateNotice state={data.state} year={data.year} heading="Evidence" />
      </main>
    );
  }
  const current = cpdYearOf(data.now);
  return (
    <CpdEvidencePage
      key={data.year}
      entries={data.entries}
      year={data.year}
      years={data.availableYears ?? [current, data.year]}
      demoMode={data.demoMode}
      unconfigured={data.state === "unconfigured"}
      initialCategory={parseEvidenceCategory(firstValue(query.category))}
      initialStatus={parseEvidenceStatus(firstValue(query.show))}
    />
  );
}
