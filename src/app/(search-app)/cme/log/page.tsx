import type { Metadata } from "next";

import { CmeLogPage, type CmeLogAttention } from "@/components/cme/cme-log-page";
import { CmeStateNotice } from "@/components/cme/cme-state-notice";
import { cpdYearOf, perthCalendarDate } from "@/lib/cme/cpd-year";
import { loadCmePageData } from "@/lib/cme/load-cme-page-data";
import { cmeCategories, type CmeCategory, type CmeRequirementSet } from "@/lib/cme/types";

export const metadata: Metadata = {
  title: "Log | CPD | PsychSift",
  description: "Every continuing-education activity you have recorded, by year.",
};

/** Skeletal set so the log can still render year tabs before targets are confirmed. */
function placeholderSet(year: number): CmeRequirementSet {
  return { year, confirmedOn: "", confirmedSource: "", totalHours: 0, requirements: [] };
}

export default async function CmeLogRoute({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string;
    saved?: string;
    fix?: string;
    copy?: string;
    missed?: string;
    tab?: string;
    category?: string;
  }>;
}) {
  const query = await searchParams;
  const requestedYear = query.year ? Number(query.year) : undefined;
  const data = await loadCmePageData(
    Number.isInteger(requestedYear) && requestedYear! >= 2000 && requestedYear! <= 2100 ? requestedYear : undefined,
    { includeArchived: true, drafts: true, missedSessions: true, allYears: true },
  );
  if (data.state === "signed-out" || data.state === "unavailable") {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <CmeStateNotice state={data.state} year={data.year} heading="Log" />
      </main>
    );
  }
  const currentYear = cpdYearOf(data.now);
  const initialAttention: CmeLogAttention | null =
    query.copy === "todo" ? "copy" : query.fix === "evidence" || query.fix === "reflection" ? query.fix : null;
  const initialCategory: CmeCategory | null = cmeCategories.includes(query.category as CmeCategory)
    ? (query.category as CmeCategory)
    : null;
  return (
    <CmeLogPage
      key={`${data.year}:${initialCategory ?? "all"}:${initialAttention ?? "all"}`}
      entries={data.entries}
      allYearsEntries={data.allEntries}
      allYearsFailed={data.allYearsFailed}
      routines={data.routines}
      set={data.set ?? placeholderSet(data.year)}
      today={perthCalendarDate(data.now)}
      navigationYears={data.availableYears ?? [currentYear, currentYear - 1, data.year]}
      justSaved={query.saved === "1"}
      missedLinkFailed={query.missed === "unlinked"}
      initialAttention={initialAttention}
      initialCategory={initialCategory}
      initialTab={query.tab === "finish" ? "finish" : "activities"}
      demoMode={data.demoMode}
      drafts={data.drafts}
      missedSessions={data.missedSessions}
      recordsFailed={data.recordsFailed}
      nowIso={data.now.toISOString()}
      loadTeachingCount={!data.demoMode}
    />
  );
}
