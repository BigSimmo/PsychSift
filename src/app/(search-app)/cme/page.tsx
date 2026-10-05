import type { Metadata } from "next";

import { CmeDashboardRoute } from "@/components/cme/cme-dashboard-route";
import { CmeStateNotice } from "@/components/cme/cme-state-notice";
import type { CmeReportingReminder } from "@/components/cme/cme-dashboard";
import { cmeReportingCloseDate } from "@/lib/cme/calendar-events";
import { cpdYearOf, perthCalendarDate } from "@/lib/cme/cpd-year";
import { groupDrafts } from "@/lib/cme/drafts";
import { loadCmePageData } from "@/lib/cme/load-cme-page-data";
import { isDemoMode } from "@/lib/env";
import type { CmeRequirementSet } from "@/lib/cme/types";

export const metadata: Metadata = {
  title: "CPD | PsychSift",
  description: "What you have done this year, and what is still short.",
};

function placeholderSet(year: number): CmeRequirementSet {
  return { year, confirmedOn: "", confirmedSource: "", totalHours: 0, requirements: [] };
}

/**
 * The CME mode home: a dashboard, not a redirect stub.
 *
 * `/cme` renders a body rather than forwarding to the shared home at
 * `/?mode=cme`, for On Call's reason exactly — the shared home is a search
 * home, and this mode declares no search surface (`resultsSurface: "none"`), so
 * a redirect would send the reader to the one page a composer could reach them
 * on and then ignore whatever they typed.
 */
/**
 * From 1 January until the college's reporting date, the dashboard for the new
 * year also counts last year's activities not yet copied to MyCPD. Only for a
 * last year the owner confirmed against the RANZCP preset, which is where that
 * date comes from; any failure simply shows no reminder.
 */
async function loadReportingReminder(now: Date, shownYear: number): Promise<CmeReportingReminder | null> {
  const currentYear = cpdYearOf(now);
  if (shownYear !== currentYear) return null;
  const previous = await loadCmePageData(currentYear - 1);
  if (previous.state !== "ready" || !previous.set) return null;
  const closesOn = cmeReportingCloseDate(previous.set);
  if (!closesOn || perthCalendarDate(now) > closesOn) return null;
  const notCopied = previous.entries.filter((entry) => !entry.archivedAt && !entry.transcribed).length;
  return notCopied > 0 ? { year: currentYear - 1, notCopied, closesOn } : null;
}

export default async function CmeHomeRoute({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const query = await searchParams;
  const requestedYear = query.year ? Number(query.year) : undefined;
  const year =
    Number.isInteger(requestedYear) && requestedYear! >= 2000 && requestedYear! <= 2100 ? requestedYear : undefined;
  // Last year's reminder does not depend on this year's data, so both loads run side by side
  // instead of one after the other. The reminder is discarded when this year is not ready.
  // Demo mode pins its own clock and year, where no earlier year is configured, so it never has one.
  const now = new Date();
  const [data, reportingReminder] = await Promise.all([
    loadCmePageData(year, { drafts: true, trainingPosition: true, nextYear: true }),
    isDemoMode() ? Promise.resolve(null) : loadReportingReminder(now, year ?? cpdYearOf(now)),
  ]);
  if (data.state !== "ready") {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <CmeStateNotice state={data.state} year={data.year} />
      </main>
    );
  }
  return (
    <CmeDashboardRoute
      reportingReminder={reportingReminder}
      set={data.set ?? placeholderSet(data.year)}
      entries={data.entries}
      nowIso={data.now.toISOString()}
      routines={data.routines}
      demoMode={data.demoMode}
      // Null when drafts could not be read, so nothing shows a count of none.
      draftsToFinish={data.recordsFailed ? null : groupDrafts(data.drafts).nextAction.length}
      currentTrainingPosition={data.trainingPosition}
      goals={data.goals}
      nextYearConfirmed={data.nextYearConfirmed}
      nextYearGoals={data.nextYearGoals}
    />
  );
}
