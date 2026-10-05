"use client";

import {
  Briefcase,
  CalendarClock,
  CircleDashed,
  Diamond,
  FileSpreadsheet,
  Fingerprint,
  GraduationCap,
  IdCard,
  Syringe,
  Triangle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { AdminLoadFailed } from "@/components/admin/admin-load-failed";
import { requirementDateLine } from "@/components/admin/renewals/urgency";
import { focusRing } from "@/components/card-recipes";
import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeInsetHairline, modeModuleSurface, modePressable } from "@/components/mode-kit/recipes";
import { EmptyState } from "@/components/primitive-recipes/feedback";
import { Button } from "@/components/ui/button";
import { announce } from "@/components/ui/live-announcer";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import {
  buildComplianceOverview,
  COMPLIANCE_BUCKET_LABELS,
  COMPLIANCE_BUCKETS,
  complianceExportAboutRows,
  complianceExportFileName,
  complianceExportRows,
  nextJobReasonText,
  type ComplianceBucket,
  type ComplianceItem,
  type ComplianceOverview,
} from "@/lib/admin/compliance-overview";
import { downloadTextFile } from "@/lib/admin/download-file";
import { selectNewJobStart } from "@/lib/admin/new-job-progress";
import { adminLoadState, selectAdminOwnEntries, selectAdminSharedEntries } from "@/lib/admin/own-entries";
import { ADMIN_PAGE_HREFS } from "@/lib/admin/page-hrefs";
import { formatDateEcho, formatRecordedDate, formatRelativeDate } from "@/lib/admin/renewal-dates";
import { ADMIN_REQUIREMENTS_CATALOGUE, type AdminRequirementGroup } from "@/lib/admin/requirements";
import { buildXlsx, XLSX_MIME } from "@/lib/admin/xlsx-lite";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { useOnCallEntries } from "@/lib/on-call/entry-store";

const GROUP_ICONS: Record<AdminRequirementGroup, LucideIcon> = {
  registration: IdCard,
  checks: Fingerprint,
  health: Syringe,
  training: GraduationCap,
  job: Briefcase,
};

/** The same grey shapes Renewals draws: shape and word, never colour. */
const BUCKET_SHAPES: Record<ComplianceBucket, LucideIcon | null> = {
  recorded: null,
  "start-renewing": Triangle,
  "date-passed": Diamond,
  "not-recorded": CircleDashed,
};

/** Each item opens on Renewals, where its dates are recorded and edited, so there is one editor. */
function itemHref(item: ComplianceItem): string {
  return `${ADMIN_PAGE_HREFS.renewals}?item=${encodeURIComponent(item.row.item.id)}`;
}

function BucketWord({ bucket, testId }: { readonly bucket: ComplianceBucket; readonly testId?: string }) {
  const Shape = BUCKET_SHAPES[bucket];
  return (
    <span
      data-testid={testId}
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm text-[color:var(--text-muted)]"
    >
      {Shape ? <Shape aria-hidden="true" strokeWidth={1.75} className="size-icon-xs shrink-0" /> : null}
      {COMPLIANCE_BUCKET_LABELS[bucket]}
    </span>
  );
}

function RuleToConfirm() {
  return (
    <span className="inline-flex w-fit items-center rounded-full border border-[color:var(--border)] px-2 text-xs leading-5 text-[color:var(--text-muted)]">
      Rule to confirm
    </span>
  );
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

function SummaryCard({
  overview,
  filter,
  onFilter,
}: {
  readonly overview: ComplianceOverview;
  readonly filter: ComplianceBucket | null;
  readonly onFilter: (bucket: ComplianceBucket | null) => void;
}) {
  const recorded = overview.total - overview.counts["not-recorded"];
  return (
    <section aria-labelledby="admin-compliance-summary-heading" className={cn(modeModuleSurface, "grid gap-3 p-3")}>
      <div className="flex min-w-0 items-center gap-4">
        <RecordedRing recorded={recorded} total={overview.total} />
        <div className="grid min-w-0 gap-0.5">
          <h2
            id="admin-compliance-summary-heading"
            className="text-base-minus font-medium text-[color:var(--text-heading)]"
            data-testid="admin-compliance-recorded"
          >
            {`${recorded} of ${overview.total} recorded`}
            {overview.notForThisJob.length > 0 ? (
              <span
                className={cn(textMuted, "font-normal")}
              >{` · ${overview.notForThisJob.length} not for this job`}</span>
            ) : null}
          </h2>
          <p className={cn(textMuted, "text-xs")}>Dates you entered, not a check</p>
        </div>
      </div>
      <ul role="list" aria-label="Show only" className="grid border-t border-[color:var(--border)]">
        {COMPLIANCE_BUCKETS.map((bucket) => {
          const count = overview.counts[bucket];
          const selected = filter === bucket;
          return (
            <li key={bucket} className={modeInsetHairline}>
              <button
                type="button"
                aria-pressed={selected}
                disabled={count === 0 && !selected}
                onClick={() => onFilter(selected ? null : bucket)}
                data-testid={`admin-compliance-count-${bucket}`}
                className={cn(
                  focusRing,
                  modePressable,
                  "flex min-h-12 w-full items-center justify-between gap-3 px-1 text-left disabled:cursor-default",
                  selected && "bg-[color:var(--clinical-accent-soft)]",
                )}
              >
                <BucketWord bucket={bucket} />
                <span className="nums text-base-minus font-medium text-[color:var(--text-heading)]">{count}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function NextDeadlines({ overview, today }: { readonly overview: ComplianceOverview; readonly today: string }) {
  if (overview.nextDeadlines.length === 0) return null;
  return (
    <ModeGroupedList eyebrow="Next dates" testId="admin-compliance-next-dates">
      {overview.nextDeadlines.map(({ item, date }) => (
        <ModeRow
          key={item.row.item.id}
          href={itemHref(item)}
          title={item.row.item.title}
          subtitle={`${formatRecordedDate(date)} · ${formatRelativeDate(date, today)}`}
        />
      ))}
    </ModeGroupedList>
  );
}

/**
 * Before the next job: one mark per item (filled carries over, hollow still to
 * do) and the short list of what to do, with why. Built only from a start date
 * the doctor recorded in New job; without one, a signpost to add it.
 */
function NextJobCard({ overview, today }: { readonly overview: ComplianceOverview; readonly today: string }) {
  const pass = overview.nextJob;
  if (!pass) {
    return (
      <ModeGroupedList eyebrow="Before your next job" testId="admin-compliance-next-job-empty">
        <ModeRow
          href={ADMIN_PAGE_HREFS.newJob}
          title="Add your start date"
          subtitle="In New job. Then this shows what carries over and what to do first."
        />
      </ModeGroupedList>
    );
  }
  const relative = formatRelativeDate(pass.startsOn, today);
  return (
    <section
      aria-labelledby="admin-compliance-next-job-heading"
      className="grid min-w-0 gap-2"
      data-testid="admin-compliance-next-job"
    >
      <h2 id="admin-compliance-next-job-heading" className={cn(eyebrowText, "px-3")}>
        Before your next job
      </h2>
      <div className={cn(modeModuleSurface, "grid gap-3 p-3")}>
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[color:var(--clinical-accent-soft)]"
          >
            <CalendarClock
              aria-hidden="true"
              strokeWidth={1.5}
              className="size-icon-md text-[color:var(--clinical-accent)]"
            />
          </span>
          <div className="grid min-w-0 gap-0.5">
            <p className="text-base-minus font-medium text-[color:var(--text-heading)]">
              {`Starts ${formatDateEcho(pass.startsOn)}`}
            </p>
            <p className={cn(textMuted, "text-sm")} data-testid="admin-compliance-next-job-counts">
              {`${relative ? `${relative[0].toUpperCase()}${relative.slice(1)} · ` : ""}${pass.carriesOver.length} carry over · ${pass.toDo.length} still to do`}
            </p>
          </div>
        </div>
        <span aria-hidden="true" className="flex flex-wrap gap-1">
          {pass.carriesOver.map((item) => (
            <span key={item.row.item.id} className="h-2 w-3 rounded-full bg-[color:var(--clinical-accent)]" />
          ))}
          {pass.toDo.map(({ item }) => (
            <span key={item.row.item.id} className="h-2 w-3 rounded-full border border-[color:var(--text-muted)]" />
          ))}
        </span>
        {pass.toDo.length > 0 ? (
          <ul role="list" aria-label="Still to do" className="-mx-3 -mb-3 border-t border-[color:var(--border)]">
            {pass.toDo.map((todo) => (
              <ModeRow
                key={todo.item.row.item.id}
                href={itemHref(todo.item)}
                title={todo.item.row.item.title}
                subtitle={nextJobReasonText(todo)}
                testId={`admin-compliance-todo-${todo.item.row.item.id}`}
              />
            ))}
          </ul>
        ) : (
          <p className={cn(textMuted, "text-sm")}>Every recorded date runs past your start date.</p>
        )}
      </div>
    </section>
  );
}

function GroupLists({
  overview,
  filter,
  now,
}: {
  readonly overview: ComplianceOverview;
  readonly filter: ComplianceBucket | null;
  readonly now: Date;
}) {
  return (
    <>
      {overview.groups.map((group) => {
        const items = filter ? group.items.filter((item) => item.bucket === filter) : group.items;
        if (items.length === 0) return null;
        return (
          <ModeGroupedList
            key={group.group}
            eyebrow={`${group.label} · ${group.recorded} of ${group.items.length} recorded`}
            headerIcon={GROUP_ICONS[group.group]}
            mode="my-work"
            id={`admin-compliance-group-${group.group}`}
            testId={`admin-compliance-group-${group.group}`}
          >
            {items.map((item) => {
              const dateLine =
                item.row.state === "no-end-date"
                  ? "No end date"
                  : item.row.state === "not-recorded"
                    ? null
                    : requirementDateLine(item.row.expiresOn, now);
              return (
                <ModeRow
                  key={item.row.item.id}
                  href={itemHref(item)}
                  title={item.row.item.title}
                  subtitle={dateLine ?? undefined}
                  meta={
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <BucketWord bucket={item.bucket} testId={`admin-compliance-status-${item.row.item.id}`} />
                      {item.ruleToConfirm ? <RuleToConfirm /> : null}
                    </span>
                  }
                  testId={`admin-compliance-item-${item.row.item.id}`}
                />
              );
            })}
          </ModeGroupedList>
        );
      })}
    </>
  );
}

function ExportCard({ onSave }: { readonly onSave: () => void }) {
  return (
    <section aria-labelledby="admin-compliance-export-heading" className="grid min-w-0 gap-2">
      <h2 id="admin-compliance-export-heading" className={cn(eyebrowText, "px-3")}>
        Export for work
      </h2>
      <div className={cn(modeModuleSurface, "grid gap-3 p-3")}>
        <p className="text-sm text-[color:var(--text)]">
          A spreadsheet of every item, its status, the date you recorded and the rule&apos;s source. It saves to this
          device; nothing is sent.
        </p>
        <Button
          variant="primary"
          icon={FileSpreadsheet}
          onClick={onSave}
          testId="admin-compliance-export-excel"
          className="w-full sm:w-fit"
        >
          Save as Excel
        </Button>
      </div>
    </section>
  );
}

/**
 * Admin · Compliance (doctor's side, 5 Oct mock-up): the requirements a
 * health service asks for, grouped, with what is recorded, what falls due
 * next, what to do before the next job, and an Excel export. A view over the
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
  const [filter, setFilter] = useState<ComplianceBucket | null>(null);

  const overview = useMemo(() => {
    const own = selectAdminOwnEntries(state);
    const shared = selectAdminSharedEntries(state);
    const start = selectNewJobStart({ own, shared });
    return buildComplianceOverview(ADMIN_REQUIREMENTS_CATALOGUE, own, now, start?.startsOn ?? null);
  }, [state, now]);

  function saveExcel() {
    const bytes = buildXlsx([
      { name: "Compliance", rows: complianceExportRows(overview), widths: [34, 14, 18, 18, 44, 16, 34, 16] },
      { name: "About", rows: complianceExportAboutRows(overview, now), widths: [110] },
    ]);
    downloadTextFile(bytes, complianceExportFileName(now), XLSX_MIME);
    announce("Compliance spreadsheet saved.");
  }

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
          <SummaryCard overview={overview} filter={filter} onFilter={setFilter} />
          {filter ? null : <NextJobCard overview={overview} today={today} />}
          {filter ? null : <NextDeadlines overview={overview} today={today} />}
          {filter ? (
            <div className="flex min-w-0 items-center justify-between gap-2 px-3">
              <p className="text-sm text-[color:var(--text)]" data-testid="admin-compliance-filter-line">
                {`Showing ${COMPLIANCE_BUCKET_LABELS[filter].toLowerCase()} only`}
              </p>
              <button
                type="button"
                onClick={() => setFilter(null)}
                className={cn(focusRing, "min-h-tap px-2 text-sm font-medium text-[color:var(--clinical-accent)]")}
                data-testid="admin-compliance-show-all"
              >
                Show all
              </button>
            </div>
          ) : null}
          <GroupLists overview={overview} filter={filter} now={now} />
          {overview.notForThisJob.length > 0 && !filter ? (
            <p className={cn(textMuted, "px-3 text-sm")}>
              {`${overview.notForThisJob.length} not for this job. `}
              <Link
                href={ADMIN_PAGE_HREFS.renewals}
                className={cn(focusRing, "font-medium text-[color:var(--clinical-accent)]")}
              >
                See them in Renewals
              </Link>
            </p>
          ) : null}
          {filter ? null : <ExportCard onSave={saveExcel} />}
          <p className={cn(textMuted, "px-3 text-xs")}>
            Linked to your account only, not shared with your health service. Rules from the statewide requirements
            list; Rule to confirm means its source did not state it clearly.
          </p>
        </div>
      )}
    </InformationPageShell>
  );
}
