"use client";

import { ChevronRight, ClipboardList, PenLine } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { AdminLoadFailed } from "@/components/admin/admin-load-failed";
import { ADMIN_STATUS_SHAPES, AdminRuleToConfirm, AdminStatusWord } from "@/components/admin/admin-status-word";
import { focusRing } from "@/components/card-recipes";
import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeInsetHairline, modeModuleSurface, modePressable } from "@/components/mode-kit/recipes";
import { EmptyState } from "@/components/primitive-recipes/feedback";
import { Button, buttonFaceClass } from "@/components/ui/button";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import {
  buildComplianceOverview,
  COMPLIANCE_BUCKET_LABELS,
  COMPLIANCE_BUCKETS,
  complianceDateLine,
  complianceFilterChips,
  complianceFilterMatches,
  complianceGroupNames,
  complianceIsFirstUse,
  type ComplianceFilter,
  type ComplianceItem,
  type ComplianceOverview,
} from "@/lib/admin/compliance-overview";
import { selectNewJobStart } from "@/lib/admin/new-job-progress";
import { adminLoadState, selectAdminOwnEntries, selectAdminSharedEntries } from "@/lib/admin/own-entries";
import { ADMIN_PAGE_HREFS } from "@/lib/admin/page-hrefs";
import { formatDateEcho } from "@/lib/admin/renewal-dates";
import { ADMIN_REQUIREMENTS_CATALOGUE } from "@/lib/admin/requirements";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { useOnCallEntries } from "@/lib/on-call/entry-store";

/** Each item opens on Renewals, where its dates are recorded and edited, so there is one editor. */
function itemHref(itemId: string): string {
  return `${ADMIN_PAGE_HREFS.renewals}?item=${encodeURIComponent(itemId)}`;
}

/**
 * The recorded share as one ring: the accent arc is what is recorded, the
 * track is the rest. A count, never a percentage or a verdict.
 */
function RecordedRing({ recorded, total }: { readonly recorded: number; readonly total: number }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const share = total > 0 ? recorded / total : 0;
  return (
    <span className="relative inline-flex size-20 shrink-0 items-center justify-center">
      <svg aria-hidden="true" viewBox="0 0 64 64" className="absolute inset-0 size-full -rotate-90">
        <circle cx="32" cy="32" r={radius} fill="none" strokeWidth="6" className="stroke-[color:var(--border)]" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${share * circumference} ${circumference}`}
          className="stroke-[color:var(--clinical-accent)]"
        />
      </svg>
      <span className="relative grid justify-items-center leading-none">
        <span className="nums text-xl font-semibold text-[color:var(--text-heading)]">{recorded}</span>
        <span className={cn(textMuted, "nums text-xs")}>{`of ${total}`}</span>
      </span>
    </span>
  );
}

/**
 * The summary (mock-up v2, screen 8): an eyebrow naming the next start date
 * when one is recorded, the ring with its four-status legend beside it, then
 * one plain sentence. The legend is a key, not a set of buttons: the chips
 * below the actions filter.
 */
function SummaryCard({ overview }: { readonly overview: ComplianceOverview }) {
  const recorded = overview.total - overview.counts["not-recorded"];
  const startsOn = overview.nextJob?.startsOn;
  return (
    <section aria-labelledby="admin-compliance-summary-heading" className={cn(modeModuleSurface, "grid gap-3 p-3")}>
      <h2 id="admin-compliance-summary-heading" className={eyebrowText} data-testid="admin-compliance-summary-eyebrow">
        {startsOn ? `Before your next job, ${formatDateEcho(startsOn)}` : "Your requirements"}
      </h2>
      <div className="flex min-w-0 items-center gap-4">
        <RecordedRing recorded={recorded} total={overview.total} />
        <ul role="list" aria-label="By status" className="grid min-w-0 flex-1 gap-1">
          {COMPLIANCE_BUCKETS.map((bucket) => (
            <li
              key={bucket}
              className="flex min-w-0 items-center justify-between gap-2"
              data-testid={`admin-compliance-count-${bucket}`}
            >
              <AdminStatusWord bucket={bucket} className="whitespace-normal" />
              <span className="nums text-sm font-medium text-[color:var(--text-heading)]">
                {overview.counts[bucket]}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-sm text-[color:var(--text)]" data-testid="admin-compliance-recorded">
        <span className="font-medium text-[color:var(--text-heading)]">{`${recorded} of ${overview.total} recorded.`}</span>
        {overview.notForThisJob.length > 0 ? ` ${overview.notForThisJob.length} not for this job.` : null}
        {" Dates you entered, not a check."}
      </p>
    </section>
  );
}

/** The one filled button (record dates on Renewals) and the plain export row under it. */
function Actions() {
  return (
    <div className="grid min-w-0 gap-3">
      <Link
        href={`${ADMIN_PAGE_HREFS.renewals}?record=missing`}
        data-testid="admin-compliance-record-dates"
        className={cn(buttonFaceClass({ variant: "primary", block: true }), "no-underline")}
      >
        <PenLine aria-hidden="true" className="size-icon-md shrink-0" />
        <span>Record dates</span>
      </Link>
      <ModeGroupedList testId="admin-compliance-actions">
        <ModeRow
          href={ADMIN_PAGE_HREFS.complianceExport}
          title="Export a copy for yourself"
          subtitle="Excel, saved on this device"
          testId="admin-compliance-export-link"
        />
      </ModeGroupedList>
    </div>
  );
}

function FilterChips({
  overview,
  filter,
  onFilter,
}: {
  readonly overview: ComplianceOverview;
  readonly filter: ComplianceFilter;
  readonly onFilter: (filter: ComplianceFilter) => void;
}) {
  return (
    <div role="group" aria-label="Show" className="flex min-w-0 flex-wrap gap-2">
      {complianceFilterChips(overview).map((chip) => {
        const selected = chip.filter === filter;
        return (
          <button
            key={chip.filter}
            type="button"
            aria-pressed={selected}
            onClick={() => onFilter(chip.filter)}
            data-testid={`admin-compliance-filter-${chip.filter}`}
            className={cn(
              focusRing,
              modePressable,
              "inline-flex min-h-12 items-center gap-1.5 rounded-full border px-3 text-sm",
              selected
                ? "border-[color:var(--text-heading)] font-medium text-[color:var(--text-heading)]"
                : "border-[color:var(--border)] text-[color:var(--text)]",
            )}
          >
            {chip.label}
            <span className="nums">{chip.count}</span>
          </button>
        );
      })}
    </div>
  );
}

/** One row: the title, the status word first, the date the doctor typed, and the rule mark. */
function ItemRow({ item, today }: { readonly item: ComplianceItem; readonly today: string }) {
  const dateLine = complianceDateLine(item, today);
  return (
    <ModeRow
      href={itemHref(item.row.item.id)}
      title={item.row.item.title}
      subtitle={<AdminStatusWord bucket={item.bucket} testId={`admin-compliance-status-${item.row.item.id}`} />}
      meta={
        dateLine || item.ruleToConfirm ? (
          <span className="grid justify-items-start gap-1 text-sm text-[color:var(--text-muted)]">
            {dateLine ? <span>{dateLine}</span> : null}
            {item.ruleToConfirm ? <AdminRuleToConfirm /> : null}
          </span>
        ) : undefined
      }
      testId={`admin-compliance-item-${item.row.item.id}`}
    />
  );
}

/** A group's eyebrow with its recorded count on the right (mock-up v2). */
function GroupHeading({ id, label, aside }: { readonly id: string; readonly label: string; readonly aside: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2 px-3">
      <h2 id={id} className={eyebrowText}>
        {label}
      </h2>
      <span className={cn(textMuted, "nums shrink-0 text-xs")}>{aside}</span>
    </div>
  );
}

function GroupLists({
  overview,
  filter,
  today,
}: {
  readonly overview: ComplianceOverview;
  readonly filter: ComplianceFilter;
  readonly today: string;
}) {
  return (
    <>
      {overview.groups.map((group) => {
        const items = group.items.filter((item) => complianceFilterMatches(filter, item));
        if (items.length === 0) return null;
        const headingId = `admin-compliance-group-${group.group}-heading`;
        return (
          <section
            key={group.group}
            id={`admin-compliance-group-${group.group}`}
            aria-labelledby={headingId}
            className="grid min-w-0 gap-2 scroll-mt-32"
            data-testid={`admin-compliance-group-${group.group}`}
          >
            <GroupHeading
              id={headingId}
              label={group.label}
              aside={`${group.recorded} of ${group.items.length} recorded`}
            />
            <ul role="list" className={modeModuleSurface}>
              {items.map((item) => (
                <ItemRow key={item.row.item.id} item={item} today={today} />
              ))}
            </ul>
          </section>
        );
      })}
      {filter === "all" && overview.notForThisJob.length > 0 ? (
        <section
          aria-labelledby="admin-compliance-not-for-this-job-heading"
          className="grid min-w-0 gap-2"
          data-testid="admin-compliance-not-for-this-job"
        >
          <GroupHeading
            id="admin-compliance-not-for-this-job-heading"
            label="Not for this job"
            aside={`${overview.notForThisJob.length}`}
          />
          <ul role="list" className={modeModuleSurface}>
            {overview.notForThisJob.map((item) => (
              <ModeRow
                key={item.id}
                href={itemHref(item.id)}
                title={item.title}
                subtitle={<AdminStatusWord bucket="recorded" label="Not for this job" />}
                meta={item.status === "needs-checking" ? <AdminRuleToConfirm /> : undefined}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/**
 * First use (mock-up v2, screen 22): nothing recorded yet, so a to-do list
 * rather than twenty rows of "Not recorded yet". One job: record dates.
 */
function FirstUse({ overview }: { readonly overview: ComplianceOverview }) {
  return (
    <div className="grid min-w-0 gap-5" data-testid="admin-compliance-first-use">
      <div className="grid justify-items-center gap-2 px-3 pt-2 text-center">
        <span
          aria-hidden="true"
          className="inline-flex size-12 items-center justify-center rounded-full border border-[color:var(--border)] text-[color:var(--text-muted)]"
        >
          <ClipboardList aria-hidden="true" strokeWidth={1.5} className="size-icon-md" />
        </span>
        <h2 className="text-lg-minus font-semibold text-[color:var(--text-heading)]">Add your dates once</h2>
        <p className={cn(textMuted, "max-w-sm text-sm")}>
          Type the end dates from your certificates. Compliance then shows what to renew next and what to sort out
          before your next job.
        </p>
      </div>
      <Link
        href={`${ADMIN_PAGE_HREFS.renewals}?record=missing`}
        data-testid="admin-compliance-record-dates"
        className={cn(buttonFaceClass({ variant: "primary", block: true }), "no-underline")}
      >
        <span>Record dates</span>
      </Link>
      <section aria-labelledby="admin-compliance-first-use-heading" className="grid min-w-0 gap-2">
        <h2 id="admin-compliance-first-use-heading" className={cn(eyebrowText, "px-3")}>
          {`${overview.total} items on the statewide list`}
        </h2>
        <ul role="list" className={modeModuleSurface}>
          {overview.groups.map((group) => {
            const Shape = ADMIN_STATUS_SHAPES["not-recorded"];
            return (
              <li key={group.group} className={modeInsetHairline}>
                <Link
                  href={`${ADMIN_PAGE_HREFS.renewals}#admin-renewals-group-${group.group}`}
                  data-testid={`admin-compliance-first-use-${group.group}`}
                  className={cn(
                    focusRing,
                    modePressable,
                    "flex min-h-13 min-w-0 items-center gap-3 py-1 pl-3 pr-2 no-underline",
                  )}
                >
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="text-base-minus font-medium text-[color:var(--text-heading)]">{group.label}</span>
                    <span className="flex flex-wrap items-center gap-x-2 text-sm text-[color:var(--text-muted)]">
                      <span className="inline-flex items-center gap-1 font-medium text-[color:var(--text-heading)]">
                        {Shape ? <Shape aria-hidden="true" strokeWidth={1.75} className="size-icon-xs" /> : null}
                        {COMPLIANCE_BUCKET_LABELS["not-recorded"]}
                      </span>
                      <span className="nums">{`${group.items.length} ${group.items.length === 1 ? "item" : "items"}`}</span>
                    </span>
                    <span className="text-sm text-[color:var(--text-muted)]">{complianceGroupNames(group)}</span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/**
 * Admin · Compliance (doctor's side, 5 Oct mock-up v2, screens 8 and 22): the
 * requirements a health service asks for, grouped, with what is recorded, one
 * "Record dates" action, filter chips and an Excel export. A view over the
 * same rows as Renewals (`src/lib/admin/compliance-overview.ts`), which stays
 * the one place dates are recorded.
 */
export function AdminCompliancePage({ now: nowProp }: { now?: Date } = {}) {
  const state = useOnCallEntries();
  const mountedAt = useMemo(() => new Date(), []);
  const now = nowProp ?? mountedAt;
  const today = perthCalendarDate(now);
  const loadState = adminLoadState(state);
  const [signInOpen, setSignInOpen] = useState(false);
  const [filter, setFilter] = useState<ComplianceFilter>("all");

  const overview = useMemo(() => {
    const own = selectAdminOwnEntries(state);
    const shared = selectAdminSharedEntries(state);
    const start = selectNewJobStart({ own, shared });
    return buildComplianceOverview(ADMIN_REQUIREMENTS_CATALOGUE, own, now, start?.startsOn ?? null);
  }, [state, now]);

  return (
    <InformationPageShell testId="admin-compliance-main">
      <div className="grid min-w-0 gap-1">
        <h1 className="text-2xl font-semibold text-[color:var(--text-heading)]">Compliance</h1>
        <p className={cn(textMuted, "text-sm")}>What your health service asks you to keep current</p>
      </div>

      {loadState === "loading" ? (
        <ModeModuleSkeleton rows={6} twoLine testId="admin-compliance-loading" />
      ) : loadState === "failed" ? (
        <AdminLoadFailed
          reason={state.isOffline ? "offline" : "failed"}
          onRetry={state.retry}
          testId="admin-compliance-failed"
        />
      ) : loadState === "signed-out" ? (
        <>
          <EmptyState
            title="Sign in to see your compliance"
            body="Your records are kept for your signed-in account only."
            actions={
              <Button variant="primary" onClick={() => setSignInOpen(true)}>
                Sign in
              </Button>
            }
            testId="admin-compliance-signed-out"
          />
          <AccountSetupDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
        </>
      ) : (
        <div className="grid min-w-0 gap-5" data-testid="admin-compliance-ready">
          {state.demoMode ? (
            <ModeNotice testId="admin-compliance-demo-notice">
              Example records. These dates are made up, and nothing here is your own.
            </ModeNotice>
          ) : null}
          {complianceIsFirstUse(overview) ? (
            <FirstUse overview={overview} />
          ) : (
            <>
              <SummaryCard overview={overview} />
              <Actions />
              <FilterChips overview={overview} filter={filter} onFilter={setFilter} />
              <GroupLists overview={overview} filter={filter} today={today} />
            </>
          )}
          <p className={cn(textMuted, "px-3 text-xs")}>
            Linked to your account only, not shared with your health service. Rules from the statewide requirements
            list; Rule to confirm means its source did not state it clearly.
          </p>
        </div>
      )}
    </InformationPageShell>
  );
}
