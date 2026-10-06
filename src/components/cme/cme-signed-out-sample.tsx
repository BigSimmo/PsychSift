"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { CmeAnnualSummary } from "@/components/cme/cme-annual-summary";
import { CmeCalendarPage } from "@/components/cme/cme-calendar-page";
import { CmeDashboard } from "@/components/cme/cme-dashboard";
import { CmeEntryRouteClient } from "@/components/cme/cme-entry-route-client";
import { CmeLogPage, type CmeLogAttention } from "@/components/cme/cme-log-page";
import { CmeNewEntryRoute } from "@/components/cme/cme-new-entry-route";
import { CmePageTabs } from "@/components/cme/cme-page-tabs";
import { CmePlanPage } from "@/components/cme/cme-plan-page";
import { CmeQuickLog } from "@/components/cme/cme-quick-log";
import { CmeRoutinesRoute } from "@/components/cme/cme-routines-route";
import { cmeRoutineLogHref } from "@/components/cme/cme-route-navigation";
import { CmeSampleContext } from "@/components/cme/cme-sample-context";
import { CmeSetupRoute } from "@/components/cme/cme-setup-route";
import { CmeTrainingPage } from "@/components/cme/cme-training-page";
import { CmeYearCheckPage } from "@/components/cme/cme-year-check-page";
import { SignedOutSampleNotice } from "@/components/mode-kit/signed-out-sample";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import {
  DEMO_CME_ENTRIES,
  DEMO_CME_INSTANT,
  DEMO_CME_PLAN_GOALS,
  DEMO_CME_ROUTINES,
  DEMO_CME_YEAR,
} from "@/lib/cme/demo-year";
import { parseCmeLearningPrefill } from "@/lib/cme/learning-source";
import { trainingExampleView } from "@/lib/cme/training-assessments";
import {
  SAMPLE_TRAINING_MILESTONES,
  SAMPLE_TRAINING_NOW_ISO,
  SAMPLE_TRAINING_PERIODS,
  sampleTrainingAssessments,
} from "@/lib/cme/training-assessments-sample";
import { cmeCategories, type CmeCategory } from "@/lib/cme/types";

/**
 * The signed-out CPD sample: the real screens filled with the invented demo year
 * (`src/lib/cme/demo-year.ts`), all in memory. It reads nothing from the server,
 * every screen is in its read-only demo state (nothing can be saved), and
 * `CmeSampleContext` stops the entry forms keeping typed text in tab storage.
 *
 * Loaded on demand by `CmeOwnerBoundary`, so it is never part of anyone's first load.
 */

const NOW_ISO = DEMO_CME_INSTANT.toISOString();
const SET = DEMO_CME_YEAR;
const ENTRIES = DEMO_CME_ENTRIES;
const ROUTINES = DEMO_CME_ROUTINES;
const GOALS = DEMO_CME_PLAN_GOALS;
const SAMPLE_YEARS = [DEMO_CME_YEAR.year] as const;

function SampleBody({ pathname, query }: { readonly pathname: string; readonly query: URLSearchParams }) {
  const router = useRouter();
  if (pathname === "/cme") {
    return (
      <>
        <CmeDashboard
          set={SET}
          entries={ENTRIES}
          now={DEMO_CME_INSTANT}
          demoMode
          routines={ROUTINES}
          onLogRoutine={(prefill) => router.push(cmeRoutineLogHref(prefill))}
          goals={GOALS}
        />
        <CmeQuickLog set={SET} entries={ENTRIES} routines={ROUTINES} nowIso={NOW_ISO} demoMode />
      </>
    );
  }
  if (pathname === "/cme/log") {
    const attention: CmeLogAttention | null =
      query.get("copy") === "todo"
        ? "copy"
        : query.get("fix") === "evidence" || query.get("fix") === "reflection"
          ? (query.get("fix") as CmeLogAttention)
          : null;
    const categoryParam = query.get("category");
    const category: CmeCategory | null = cmeCategories.includes(categoryParam as CmeCategory)
      ? (categoryParam as CmeCategory)
      : null;
    return (
      <CmeLogPage
        key={`${category ?? "all"}:${attention ?? "all"}`}
        entries={ENTRIES}
        allYearsEntries={ENTRIES}
        routines={ROUTINES}
        set={SET}
        today={perthCalendarDate(DEMO_CME_INSTANT)}
        navigationYears={SAMPLE_YEARS}
        initialAttention={attention}
        initialCategory={category}
        initialTab={query.get("tab") === "finish" ? "finish" : "activities"}
        demoMode
        drafts={[]}
        missedSessions={[]}
      />
    );
  }
  if (pathname.startsWith("/cme/log/")) {
    const id = decodeURIComponent(pathname.slice("/cme/log/".length));
    const entry = ENTRIES.find((candidate) => candidate.id === id) ?? null;
    return <CmeEntryRouteClient entry={entry} set={SET} edit={query.get("edit") === "1"} demoMode goals={GOALS} />;
  }
  if (pathname === "/cme/new") {
    const routine = ROUTINES.find((candidate) => candidate.id === query.get("routine")) ?? null;
    const repeatId = query.get("repeat");
    const repeatOf = repeatId ? (ENTRIES.find((candidate) => candidate.id === repeatId) ?? null) : null;
    const learningPrefill = parseCmeLearningPrefill({
      title: query.get("title") ?? undefined,
      sourceUrl: query.get("sourceUrl") ?? undefined,
    });
    return (
      <CmeNewEntryRoute
        key={`${routine?.id ?? "manual"}:${repeatOf?.id ?? ""}:${learningPrefill.title ?? ""}:${learningPrefill.sourceUrl ?? ""}`}
        routine={routine}
        repeatOf={repeatOf}
        learningPrefill={learningPrefill}
        set={SET}
        existingEntries={ENTRIES}
        demoMode
      />
    );
  }
  if (pathname === "/cme/routines") {
    return <CmeRoutinesRoute nowIso={NOW_ISO} initialRoutines={ROUTINES} demoMode />;
  }
  if (pathname === "/cme/calendar") {
    return <CmeCalendarPage set={SET} entries={ENTRIES} routines={ROUTINES} nowIso={NOW_ISO} />;
  }
  if (pathname === "/cme/summary") {
    return <CmeAnnualSummary set={SET} entries={ENTRIES} demoMode close={null} now={DEMO_CME_INSTANT} />;
  }
  if (pathname === "/cme/training") {
    // The mock-up's invented registrar (or, with ?example=intern, junior doctor),
    // on the mock-up's own "today" so its dates read as drawn.
    const view = trainingExampleView(query.get("example"));
    return (
      <CmeTrainingPage
        key={view}
        nowIso={SAMPLE_TRAINING_NOW_ISO}
        initialPeriods={SAMPLE_TRAINING_PERIODS}
        initialMilestones={SAMPLE_TRAINING_MILESTONES}
        demoMode
        assessments={sampleTrainingAssessments(view)}
      />
    );
  }
  if (pathname === "/cme/plan") {
    return <CmePlanPage key={SET.year} set={SET} goals={GOALS} entries={ENTRIES} demoMode now={DEMO_CME_INSTANT} />;
  }
  if (pathname === "/cme/check") {
    return <CmeYearCheckPage set={SET} entries={ENTRIES} />;
  }
  if (pathname === "/cme/setup" || pathname === "/cme/programme") {
    return (
      <CmeSetupRoute key={SET.year} year={SET.year} set={SET} demoMode editInitially={query.get("edit") === "1"} />
    );
  }
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6" data-testid="cme-sample-unavailable">
      <p>This page is not part of the sample. It works on your own CPD record, so it needs you to sign in.</p>
      <Link
        href="/cme"
        className="mt-2 inline-flex min-h-tap items-center text-sm font-semibold text-[color:var(--clinical-accent)]"
      >
        Back to the sample dashboard
      </Link>
    </main>
  );
}

export function CmeSignedOutSample() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = new URLSearchParams(searchParams.toString());
  return (
    <CmeSampleContext.Provider value>
      <Suspense fallback={null}>
        <CmePageTabs />
      </Suspense>
      <div className="mx-auto w-full max-w-3xl px-4 pt-4 sm:px-6">
        <SignedOutSampleNotice title="Sign in to see your CPD record" testId="cme-signed-out-sample">
          Below is a sample made of invented examples, so you can see how CPD works. Signed in, it shows your own
          activities and hours. Nothing is shared, and the sample doesn&rsquo;t save anything you type.
        </SignedOutSampleNotice>
      </div>
      <SampleBody pathname={pathname} query={query} />
    </CmeSampleContext.Provider>
  );
}
