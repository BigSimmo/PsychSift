"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { useAccountData } from "@/components/account-data-provider";
import { AdminCredentialsWallet } from "@/components/admin/admin-credentials-wallet";
import { AdminPinnedNumbers } from "@/components/admin/admin-pinned-numbers";
import { AdminSetupSheet } from "@/components/admin/admin-setup-sheet";
import { TodayAtAGlance } from "@/components/admin/today/today-at-a-glance";
import { TodayComingUpModule } from "@/components/admin/today/today-coming-up-module";
import { TodayNeedsYouModule } from "@/components/admin/today/today-needs-you-module";
import { TodayNewJobModule } from "@/components/admin/today/today-new-job-module";
import { TodayRenewNextCard } from "@/components/admin/today/today-renew-next-card";
import { TodayRequirementsModule } from "@/components/admin/today/today-requirements-module";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { TodayShell, type TodaySharedState } from "@/components/mode-kit/today/today-shell";
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
 * Today (mode id `my-work`) on the shared Today shell. Slots: the greeting is
 * the status line; Now is the "Renew next" answer card (the mode's own hero,
 * nothing when there is nothing to renew); Needs you is the existing module;
 * Coming up is the dated list then New job progress (once a start date is
 * set); At a glance is the counts, credentials wallet, pinned numbers and
 * Requirements in words. Nothing else renders here: no Pay, no Help block, no
 * ask box. Today has no tabs.
 *
 * Phone is one column in the shell's slot order. From `lg` the shell splits
 * into what to act on (Renew next, Needs you) and what is ahead; the left
 * column followed by the right column IS the phone order. The content is
 * capped so cards never stretch across a wide screen.
 */
const TODAY_WIDTH = "mx-auto w-full max-w-2xl lg:max-w-5xl";
const TODAY_COLUMNS = "grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start";
const TODAY_COLUMN = "grid min-w-0 content-start gap-5";

/**
 * The loading shape mirrors the ready layout — the Renew next card, the row of
 * three counts, then Needs you and Coming up — so nothing jumps when the
 * records arrive. Static grey, no shimmer (mode standard §7).
 */
function TodayLoadingSkeleton() {
  return (
    <div className={TODAY_COLUMNS} data-testid="admin-today-loading" aria-hidden="true">
      <div className={TODAY_COLUMN}>
        <ModeModuleSkeleton rows={3} twoLine eyebrow testId="admin-today-loading-renew-next" />
        <ModeModuleSkeleton rows={2} twoLine eyebrow testId="admin-today-loading-needs-you" />
      </div>
      <div className={TODAY_COLUMN}>
        <ModeModuleSkeleton rows={4} twoLine eyebrow testId="admin-today-loading-coming-up" />
        <div className="grid grid-cols-3 gap-2" data-testid="admin-today-loading-at-a-glance">
          {[0, 1, 2].map((index) => (
            <div key={index} className={cn(modeModuleSurface, "grid h-17 content-between px-3 py-2")}>
              <span className="h-6 w-6 rounded-sm bg-[color:var(--surface-subtle)]" />
              <span className="h-3 w-3/4 rounded-sm bg-[color:var(--surface-subtle)]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function greetingFor(now: Date): string {
  const hour = perthHour(now);
  return hour >= 5 && hour < 12 ? "Good morning" : hour >= 12 && hour < 18 ? "Good afternoon" : "Good evening";
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

  const own = useMemo(() => selectAdminOwnEntries(state), [state]);
  const shared = useMemo(() => selectAdminSharedEntries(state), [state]);
  const newJobProgress = useMemo(() => selectNewJobProgress({ own, shared }, now), [own, shared, now]);
  const renewNext = useMemo(() => selectRenewNext(own, newJobProgress?.startsOn, now), [own, newJobProgress, now]);
  const excludeEntryId = renewNext?.kind === "compliance" ? renewNext.entry?.id : undefined;
  const needsYou = useMemo(() => selectNeedsYou(own, now, { excludeEntryId }), [own, now, excludeEntryId]);
  const requirementsSummary = useMemo(() => selectRequirementsSummary(own), [own]);
  const showCounts = useMemo(() => renewalsShowCounts(own, now), [own, now]);
  const comingUp = useMemo(() => selectComingUp(own, now), [own, now]);

  // This page view only — nothing is written to the device (spec review 5).
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const setupOpen = isAuthenticated && load === "ready" && !state.demoMode && !setupDismissed && needsSetup(own);

  // Pinned numbers (owner decision 2026-10-01): the same rows Help lists, so a pin made there shows here.
  const helpItems = useMemo(() => buildAdminHelpItems({ own, shared, statewide: [] }), [own, shared]);

  function upsert(entry: OnCallEntry) {
    const latest = readCachedOnCallEntries()?.entries ?? state.entries;
    cacheOnCallEntries([...latest.filter((existing) => existing.id !== entry.id), entry]);
  }

  const todayState: TodaySharedState | null =
    load === "loading"
      ? { kind: "loading" }
      : load === "failed"
        ? { kind: "failed", onRetry: state.retry, reason: state.loadError === "offline" ? "offline" : null }
        : load === "signed-out"
          ? { kind: "signed-out", onSignIn: () => setSignInOpen(true) }
          : null;

  return (
    <InformationPageShell testId="admin-today-main">
      <div className={TODAY_WIDTH}>
        <TodayShell
          mode="my-work"
          modeName="Admin"
          testId="admin-today-ready"
          columns="two"
          status={
            <div className="grid gap-2">
              <header data-testid="admin-today-greeting" className="grid gap-0.5">
                <h1 className="text-2xl font-semibold text-[color:var(--text-heading)]">{greetingFor(now)}</h1>
                <p className="text-sm text-[color:var(--text-muted)]">{formatDateEcho(today)}</p>
              </header>
              {state.demoMode && load === "ready" ? (
                <ModeNotice testId="admin-today-demo-notice">
                  Example records. These dates are made up, and nothing here is your own.
                </ModeNotice>
              ) : null}
            </div>
          }
          nowSurface="own"
          now={renewNext ? <TodayRenewNextCard item={renewNext} ownEntries={own} today={today} /> : null}
          needsYouNode={needsYou ? <TodayNeedsYouModule needsYou={needsYou} today={today} /> : null}
          comingUp={
            <>
              <TodayComingUpModule comingUp={comingUp} today={today} />
              {newJobProgress ? <TodayNewJobModule progress={newJobProgress} today={today} /> : null}
            </>
          }
          atAGlance={
            <>
              <TodayAtAGlance counts={showCounts} />
              {isAuthenticated && !state.demoMode ? <AdminCredentialsWallet /> : null}
              <AdminPinnedNumbers items={helpItems} testId="admin-today-pinned" />
              <TodayRequirementsModule summary={requirementsSummary} />
            </>
          }
          state={todayState}
          loadingFallback={<TodayLoadingSkeleton />}
          stateExtra={
            load === "signed-out" ? (
              <Link
                href="/admin/help"
                className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 py-2 text-sm font-medium text-[color:var(--text-heading)] no-underline"
              >
                Help — Crisis lines and contacts
              </Link>
            ) : undefined
          }
        />
        {load === "signed-out" ? <AccountSetupDialog open={signInOpen} onClose={() => setSignInOpen(false)} /> : null}
      </div>

      <AdminSetupSheet
        open={setupOpen}
        onClose={() => setSetupDismissed(true)}
        existingEntries={own}
        onCreated={upsert}
      />
    </InformationPageShell>
  );
}
