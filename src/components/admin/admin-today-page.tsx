"use client";

import { LogIn, Phone, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { useAccountData } from "@/components/account-data-provider";
import { AdminLoadAlert, AdminPage, AdminRow, AdminSkeleton, adminStyles } from "@/components/admin/admin-kit";
import { AdminQuickAddSheet } from "@/components/admin/admin-quick-add-sheet";
import { AdminSetupSheet } from "@/components/admin/admin-setup-sheet";
import { ADMIN_PAGE_HREFS } from "@/components/admin/admin-page-sections";
import { AdminWorkAndLeaveGroup } from "@/components/admin/junior/work-and-leave-group";
import { TodayAtAGlance } from "@/components/admin/today/today-at-a-glance";
import { TodayComingUpModule } from "@/components/admin/today/today-coming-up-module";
import { TodayNeedsYouModule } from "@/components/admin/today/today-needs-you-module";
import { TodayNewJobModule } from "@/components/admin/today/today-new-job-module";
import { TodayRenewNextCard } from "@/components/admin/today/today-renew-next-card";
import { TodayOvertimeRow, TodayRequirementsModule } from "@/components/admin/today/today-requirements-module";
import { TodayStarred } from "@/components/admin/today/today-starred";
import { PageTitleUnderBand, useModeBandHeading, useModeBandShown } from "@/components/mode-band/mode-band";
import { ModeNotice } from "@/components/mode-kit/notice";
import { todayStateCopy } from "@/components/mode-kit/today/today-copy";
import { WorkButton, WorkCard, WorkDock, WorkEmpty, WorkIconCircle } from "@/components/mode-kit/work";
import { cn } from "@/components/ui-primitives";
import { adminLoadState, selectAdminOwnEntries, selectAdminSharedEntries } from "@/lib/admin/own-entries";
import { buildAdminHelpItems } from "@/lib/admin/help-items";
import { formatDateEcho } from "@/lib/admin/renewal-dates";
import { renewalsShowCounts } from "@/lib/admin/renewals-filters";
import { needsSetup } from "@/lib/admin/setup";
import { selectNewJobProgress } from "@/lib/admin/new-job-progress";
import {
  selectComingUp,
  selectNeedsYou,
  selectRenewNext,
  selectRequirementsSummary,
} from "@/lib/admin/today-selectors";
import { perthHour } from "@/lib/clock-time";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { cacheOnCallEntries, readCachedOnCallEntries, useOnCallEntries } from "@/lib/on-call/entry-store";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { msUntilNextOnCallLocalDay } from "@/lib/on-call/local-date";

/**
 * Admin's Today (work-mode redesign, owner request 6 Oct 2026), the first of
 * Admin's three tabs. Order, from Josh's locked mockup: the "Renew next"
 * hero, Needs you, the three counts, Coming up, New job (once a start date is
 * set), Pinned, Requirements, then the Overtime row into Roster. Nothing
 * else: no Pay, no ask box, no composer.
 *
 * Phone is one column in that order. From a laptop width it splits into what
 * to act on (left) and what is ahead (right); left then right IS the phone
 * order. The band names the page with the greeting and the date.
 *
 * Fail-closed: while loading, signed out or after a failed load nothing from
 * the reader's records is drawn, never a saved copy (the device cache holds
 * no compliance rows, and "nothing due" over a lapsing registration would be
 * unsafe).
 */

/** The loading shape mirrors the ready layout, so nothing jumps when the records arrive. Static grey. */
function TodayLoadingSkeleton() {
  return (
    <div className={cn(adminStyles.columns, "lg:grid-cols-2")} data-testid="admin-today-loading" aria-busy="true">
      <span className="sr-only">Loading Admin</span>
      <div className={adminStyles.column} aria-hidden="true">
        <div data-testid="admin-today-loading-renew-next">
          <AdminSkeleton className="h-44" />
        </div>
        <div className="grid gap-2" data-testid="admin-today-loading-needs-you">
          <AdminSkeleton className="h-3 w-24" />
          <AdminSkeleton className="h-28" />
        </div>
        <div className="grid grid-cols-3 gap-2" data-testid="admin-today-loading-at-a-glance">
          {[0, 1, 2].map((index) => (
            <AdminSkeleton key={index} className="h-17" />
          ))}
        </div>
      </div>
      <div className={adminStyles.column} aria-hidden="true">
        <div className="grid gap-2" data-testid="admin-today-loading-coming-up">
          <AdminSkeleton className="h-3 w-24" />
          <AdminSkeleton className="h-52" />
        </div>
      </div>
    </div>
  );
}

function greetingFor(now: Date): string {
  const hour = perthHour(now);
  return hour >= 5 && hour < 12 ? "Good morning" : hour >= 12 && hour < 18 ? "Good afternoon" : "Good evening";
}

/** Open to everyone, signed in or not: the crisis lines live on Help. */
function HelpRow() {
  return (
    <WorkCard as="ul">
      <AdminRow
        lead={<WorkIconCircle icon={Phone} />}
        title="Help and crisis lines"
        sub="000 and the Mental Health Emergency Response Line 1300 555 788"
        href={ADMIN_PAGE_HREFS.help}
        testId="admin-today-help-row"
      />
    </WorkCard>
  );
}

export function AdminTodayPage({ now: nowProp }: { now?: Date } = {}) {
  const state = useOnCallEntries();
  const { isAuthenticated } = useAccountData();
  const [tick, setTick] = useState(() => new Date());
  const now = nowProp ?? tick;
  useEffect(() => {
    if (nowProp) return;
    const timer = setTimeout(() => setTick(new Date()), msUntilNextOnCallLocalDay(now));
    return () => clearTimeout(timer);
  }, [nowProp, now]);
  const today = perthCalendarDate(now);
  const load = adminLoadState(state);
  const bandShown = useModeBandShown();
  const greeting = greetingFor(now);
  const dateEcho = formatDateEcho(today);
  useModeBandHeading({ eyebrow: dateEcho, title: greeting });

  const own = useMemo(() => selectAdminOwnEntries(state), [state]);
  const shared = useMemo(() => selectAdminSharedEntries(state), [state]);
  const newJobProgress = useMemo(() => selectNewJobProgress({ own, shared }, now), [own, shared, now]);
  const renewNext = useMemo(() => selectRenewNext(own, newJobProgress?.startsOn, now), [own, newJobProgress, now]);
  const excludeEntryId = renewNext?.kind === "compliance" ? renewNext.entry?.id : undefined;
  const needsYou = useMemo(() => selectNeedsYou(own, now, { excludeEntryId }), [own, now, excludeEntryId]);
  const requirementsSummary = useMemo(() => selectRequirementsSummary(own), [own]);
  const showCounts = useMemo(() => renewalsShowCounts(own, now), [own, now]);
  const comingUp = useMemo(() => selectComingUp(own, now), [own, now]);

  // This page view only: nothing is written to the device (spec review 5).
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const setupOpen = isAuthenticated && load === "ready" && !state.demoMode && !setupDismissed && needsSetup(own);
  // Demo records and a signed-out page refuse writes, so they get no Add.
  const canAdd = isAuthenticated && load === "ready" && !state.demoMode && !setupOpen;

  // Pinned numbers (owner decision 2026-10-01): the same rows Help lists, so a pin made there shows here.
  const helpItems = useMemo(() => buildAdminHelpItems({ own, shared, statewide: [] }), [own, shared]);

  function upsert(entry: OnCallEntry) {
    const latest = readCachedOnCallEntries()?.entries ?? state.entries;
    cacheOnCallEntries([...latest.filter((existing) => existing.id !== entry.id), entry]);
  }

  const failedCopy =
    state.loadError === "offline" ? todayStateCopy.failedOffline("Admin") : todayStateCopy.failed("Admin");
  const signedOutCopy = todayStateCopy["signed-out"]("Admin");

  return (
    <AdminPage testId="admin-today-main" wide>
      {/* The band shows the greeting and date; this stays for screen readers and band-less views. */}
      <header data-testid="admin-today-greeting" className={cn("grid gap-0.5", bandShown && "sr-only")}>
        <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
          {greeting}
        </PageTitleUnderBand>
        <p className="text-sm text-[color:var(--text-muted)]">{dateEcho}</p>
      </header>
      {state.demoMode && load === "ready" ? (
        <ModeNotice testId="admin-today-demo-notice">
          Example records. These dates are made up, and nothing here is your own.
        </ModeNotice>
      ) : null}

      {load === "loading" ? (
        <TodayLoadingSkeleton />
      ) : load === "failed" ? (
        <AdminLoadAlert
          title={failedCopy.title}
          body={failedCopy.body}
          offline={state.loadError === "offline"}
          onRetry={state.retry}
          testId="today-state-failed"
        />
      ) : load === "signed-out" ? (
        <>
          <WorkCard testId="today-state-signed-out">
            <WorkEmpty
              icon={LogIn}
              title={signedOutCopy.title}
              body={signedOutCopy.body}
              action={
                <WorkButton icon={LogIn} onClick={() => setSignInOpen(true)}>
                  {signedOutCopy.action}
                </WorkButton>
              }
            />
          </WorkCard>
          <HelpRow />
          <AccountSetupDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
        </>
      ) : (
        <div className={cn(adminStyles.columns, "lg:grid-cols-2")} data-testid="admin-today-ready">
          <div className={adminStyles.column} data-today-column="act">
            {renewNext ? <TodayRenewNextCard item={renewNext} ownEntries={own} today={today} /> : null}
            {needsYou ? <TodayNeedsYouModule needsYou={needsYou} today={today} /> : null}
            <TodayAtAGlance counts={showCounts} />
          </div>
          <div className={adminStyles.column} data-today-column="ahead">
            <TodayComingUpModule comingUp={comingUp} today={today} />
            {newJobProgress ? <TodayNewJobModule progress={newJobProgress} today={today} /> : null}
            <TodayStarred items={helpItems} testId="admin-today-pinned" />
            <TodayRequirementsModule summary={requirementsSummary} />
            <AdminWorkAndLeaveGroup />
            <TodayOvertimeRow />
          </div>
        </div>
      )}

      {canAdd ? (
        <WorkDock aria-label="Admin actions">
          <WorkButton icon={Plus} onClick={() => setQuickAddOpen(true)} testId="admin-today-add">
            Add a renewal
          </WorkButton>
        </WorkDock>
      ) : null}

      <AdminQuickAddSheet open={quickAddOpen} onClose={() => setQuickAddOpen(false)} onSaved={upsert} />
      <AdminSetupSheet
        open={setupOpen}
        onClose={() => setSetupDismissed(true)}
        existingEntries={own}
        onCreated={upsert}
      />
    </AdminPage>
  );
}
