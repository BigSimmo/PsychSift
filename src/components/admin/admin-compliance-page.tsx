"use client";

import { CalendarClock, CalendarPlus, ClipboardList, FileSpreadsheet } from "lucide-react";
import { useMemo, useState } from "react";

import { AdminNote, AdminPage, AdminRow, AdminSection, AdminSkeleton, adminStyles } from "@/components/admin/admin-kit";
import { AdminLoadFailed } from "@/components/admin/admin-load-failed";
import {
  AdminRuleToConfirm,
  AdminStatusIcon,
  AdminStatusShape,
  AdminStatusTag,
} from "@/components/admin/admin-status-tag";
import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { PageTitleUnderBand, useModeBandHeading } from "@/components/mode-band/mode-band";
import { WorkButton, WorkCard, WorkChip, WorkDock, WorkEmpty, WorkIconCircle } from "@/components/mode-kit/work";
import { WorkStateNotice } from "@/components/mode-kit/work-state";
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
  nextJobReasonText,
} from "@/lib/admin/compliance-overview";
import { selectNewJobStart } from "@/lib/admin/new-job-progress";
import { adminLoadState, selectAdminOwnEntries, selectAdminSharedEntries } from "@/lib/admin/own-entries";
import { ADMIN_PAGE_HREFS } from "@/lib/admin/page-hrefs";
import { formatDateEcho } from "@/lib/admin/renewal-dates";
import { ADMIN_REQUIREMENTS_CATALOGUE } from "@/lib/admin/requirements";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { useOnCallEntries } from "@/lib/on-call/entry-store";

const RECORD_DATES_HREF = `${ADMIN_PAGE_HREFS.renewals}?record=missing`;

/** Each item opens on Renewals, where its dates are recorded and edited, so there is one editor. */
function itemHref(itemId: string): string {
  return `${ADMIN_PAGE_HREFS.renewals}?item=${encodeURIComponent(itemId)}`;
}

/**
 * The recorded share as one ring in Admin's slate: the arc is what is
 * recorded, the track the rest. A count, never a percentage or a verdict, and
 * spoken as words.
 */
function RecordedRing({ recorded, total }: { readonly recorded: number; readonly total: number }) {
  const radius = 37;
  const circumference = 2 * Math.PI * radius;
  const share = total > 0 ? recorded / total : 0;
  return (
    <span className={adminStyles.ring} role="img" aria-label={`${recorded} of ${total} recorded`}>
      <svg aria-hidden="true" viewBox="0 0 84 84" width="100%" height="100%">
        <circle cx="42" cy="42" r={radius} fill="none" strokeWidth="7" className={adminStyles.ringTrack} />
        <circle
          cx="42"
          cy="42"
          r={radius}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${(share * circumference).toFixed(1)} ${circumference.toFixed(1)}`}
          className={adminStyles.ringValue}
        />
      </svg>
      <span aria-hidden="true">
        <span className={adminStyles.ringFigure}>{recorded}</span>
        <span className={adminStyles.ringLabel}>{`of ${total}`}</span>
      </span>
    </span>
  );
}

/**
 * The summary (work-mode redesign, owner request 6 Oct 2026): the ring beside
 * a four-row legend (shape, word, count), then one plain sentence. The legend
 * is a key, not a set of buttons: the chips below filter.
 */
function SummaryCard({ overview }: { readonly overview: ComplianceOverview }) {
  const recorded = overview.total - overview.counts["not-recorded"];
  const startsOn = overview.nextJob?.startsOn;
  return (
    <AdminSection
      label={
        <span data-testid="admin-compliance-summary-eyebrow">
          {startsOn ? `Before your next job, ${formatDateEcho(startsOn)}` : "Your requirements"}
        </span>
      }
      labelId="admin-compliance-summary-heading"
    >
      <WorkCard padded>
        <div className={adminStyles.ringRow}>
          <RecordedRing recorded={recorded} total={overview.total} />
          <ul role="list" aria-label="By status" className={adminStyles.legend}>
            {COMPLIANCE_BUCKETS.map((bucket) => (
              <li key={bucket} className={adminStyles.legendRow} data-testid={`admin-compliance-count-${bucket}`}>
                <AdminStatusShape status={bucket} />
                <span className="min-w-0 flex-1">{COMPLIANCE_BUCKET_LABELS[bucket]}</span>
                <span className={adminStyles.legendCount}>{overview.counts[bucket]}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="work-row__sub mt-3 mb-0" data-testid="admin-compliance-recorded">
          <span className="work-row__title">{`${recorded} of ${overview.total} recorded.`}</span>
          {overview.notForThisJob.length > 0 ? ` ${overview.notForThisJob.length} not for this job.` : null}
          {" Dates you entered, not a check."}
        </p>
      </WorkCard>
    </AdminSection>
  );
}

/**
 * What is still to do before the recorded start date, with the reason in
 * words, including dates that run out before the start (which no status word
 * shows). New job's signpost points here, so the reader can see what it counts.
 */
function BeforeNextJob({ overview }: { readonly overview: ComplianceOverview }) {
  const pass = overview.nextJob;
  if (!pass || pass.toDo.length === 0) return null;
  // Passed and unrecorded items already carry their status word in the lists below;
  // a date that runs out before the start has no status word, so it is named here.
  const endsBefore = pass.toDo.filter((todo) => todo.reason === "ends-before-start");
  const others = pass.toDo.length - endsBefore.length;
  return (
    <AdminSection
      label={`To do before ${formatDateEcho(pass.startsOn)}`}
      count={pass.toDo.length}
      labelId="admin-compliance-before-next-job-heading"
      testId="admin-compliance-before-next-job"
    >
      {endsBefore.length > 0 ? (
        <WorkCard as="ul" testId="admin-compliance-before-next-job-list">
          {endsBefore.map((todo) => (
            <AdminRow
              key={todo.item.row.item.id}
              lead={<WorkIconCircle icon={CalendarClock} tone="neutral" />}
              href={itemHref(todo.item.row.item.id)}
              title={todo.item.row.item.title}
              sub={nextJobReasonText(todo)}
              testId={`admin-compliance-todo-${todo.item.row.item.id}`}
            />
          ))}
        </WorkCard>
      ) : null}
      {others > 0 ? (
        <p className="work-row__sub m-0 px-1" data-testid="admin-compliance-before-next-job-others">
          {`${endsBefore.length > 0 ? "And " : ""}${others} ${others === 1 ? "item" : "items"} with a date passed or not recorded yet, marked in the lists below.`}
        </p>
      ) : null}
    </AdminSection>
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
    // One line that scrolls sideways, as the mockup keeps its chips: six wrapped chips took three rows on a phone.
    <div role="group" aria-label="Show" className="work-chips" data-scroll="">
      {complianceFilterChips(overview).map((chip) => (
        <WorkChip
          key={chip.filter}
          selected={chip.filter === filter}
          onClick={() => onFilter(chip.filter)}
          count={chip.count}
          testId={`admin-compliance-filter-${chip.filter}`}
        >
          {chip.label}
        </WorkChip>
      ))}
    </div>
  );
}

/** One row: the status icon, the title, the date the doctor typed, the status tag and the rule mark. */
function ItemRow({ item, today }: { readonly item: ComplianceItem; readonly today: string }) {
  const dateLine = complianceDateLine(item, today);
  return (
    <AdminRow
      lead={<AdminStatusIcon status={item.bucket} />}
      href={itemHref(item.row.item.id)}
      title={item.row.item.title}
      sub={dateLine ? <span className="tabular-nums">{dateLine}</span> : undefined}
      tags={
        <>
          <AdminStatusTag status={item.bucket} testId={`admin-compliance-status-${item.row.item.id}`} />
          {item.ruleToConfirm ? <AdminRuleToConfirm /> : null}
        </>
      }
      testId={`admin-compliance-item-${item.row.item.id}`}
    />
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
        return (
          <AdminSection
            key={group.group}
            id={`admin-compliance-group-${group.group}`}
            label={group.label}
            count={`${group.recorded} of ${group.items.length} recorded`}
            labelId={`admin-compliance-group-${group.group}-heading`}
            testId={`admin-compliance-group-${group.group}`}
          >
            <WorkCard as="ul">
              {items.map((item) => (
                <ItemRow key={item.row.item.id} item={item} today={today} />
              ))}
            </WorkCard>
          </AdminSection>
        );
      })}
      {filter === "all" && overview.notForThisJob.length > 0 ? (
        <AdminSection
          label="Not for this job"
          count={overview.notForThisJob.length}
          labelId="admin-compliance-not-for-this-job-heading"
          testId="admin-compliance-not-for-this-job"
        >
          <WorkCard as="ul">
            {overview.notForThisJob.map((item) => (
              <AdminRow
                key={item.id}
                lead={<AdminStatusIcon status="not-for-job" />}
                href={itemHref(item.id)}
                title={item.title}
                tags={
                  <>
                    <AdminStatusTag status="not-for-job" />
                    {item.status === "needs-checking" ? <AdminRuleToConfirm /> : null}
                  </>
                }
              />
            ))}
          </WorkCard>
        </AdminSection>
      ) : null}
    </>
  );
}

/**
 * First use: nothing recorded yet, so a to-do list rather than twenty rows of
 * "Not recorded yet". One job: record dates.
 */
function FirstUse({ overview, canEdit }: { readonly overview: ComplianceOverview; readonly canEdit: boolean }) {
  return (
    <div className={adminStyles.column} data-testid="admin-compliance-first-use">
      <WorkCard>
        <WorkEmpty
          icon={ClipboardList}
          title="Add your dates once"
          body="Type the end dates from your certificates. Compliance then shows what to renew next and what to sort out before your next job."
          action={
            canEdit ? (
              <WorkButton icon={CalendarPlus} href={RECORD_DATES_HREF} testId="admin-compliance-record-dates">
                Record dates
              </WorkButton>
            ) : undefined
          }
        />
      </WorkCard>
      <AdminSection
        label={`${overview.total} items on the statewide list`}
        labelId="admin-compliance-first-use-heading"
      >
        <WorkCard as="ul">
          {overview.groups.map((group) => (
            <AdminRow
              key={group.group}
              href={`${ADMIN_PAGE_HREFS.renewals}#admin-renewals-group-${group.group}`}
              testId={`admin-compliance-first-use-${group.group}`}
              title={group.label}
              sub={complianceGroupNames(group)}
              tags={
                <AdminStatusTag
                  status="not-recorded"
                  label={`Not recorded yet · ${group.items.length} ${group.items.length === 1 ? "item" : "items"}`}
                />
              }
            />
          ))}
        </WorkCard>
      </AdminSection>
      <AdminNote>Your service&apos;s own list may differ.</AdminNote>
    </div>
  );
}

/**
 * Admin · Compliance (More, work-mode redesign, owner request 6 Oct 2026): the
 * requirements a health service asks for, grouped, with what is recorded, the
 * export, filter chips and "Record dates" in the dock. A view over the same
 * rows as Renewals (`src/lib/admin/compliance-overview.ts`), which stays the
 * one place dates are recorded. A failed load stays fail-closed.
 */
export function AdminCompliancePage({ now: nowProp }: { now?: Date } = {}) {
  const state = useOnCallEntries();
  // The example data banner already says these are example records; this notice is for the demo build.
  const mountedAt = useMemo(() => new Date(), []);
  const now = nowProp ?? mountedAt;
  const today = perthCalendarDate(now);
  const loadState = adminLoadState(state);
  const [signInOpen, setSignInOpen] = useState(false);
  const [filter, setFilter] = useState<ComplianceFilter>("all");
  const canEdit = loadState === "ready" && !state.demoMode;
  useModeBandHeading({ eyebrow: "What your health service asks you to keep current" });

  const overview = useMemo(() => {
    const own = selectAdminOwnEntries(state);
    const shared = selectAdminSharedEntries(state);
    const start = selectNewJobStart({ own, shared });
    return buildComplianceOverview(ADMIN_REQUIREMENTS_CATALOGUE, own, now, start?.startsOn ?? null);
  }, [state, now]);
  const firstUse = complianceIsFirstUse(overview);

  return (
    <AdminPage testId="admin-compliance-main">
      <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
        Compliance
      </PageTitleUnderBand>

      {loadState === "loading" ? (
        <div className={adminStyles.column} data-testid="admin-compliance-loading" aria-busy="true">
          <span className="sr-only">Loading your compliance</span>
          <AdminSkeleton className="h-36" />
          <AdminSkeleton className="h-16" />
          <AdminSkeleton className="h-64" />
        </div>
      ) : loadState === "failed" ? (
        <AdminLoadFailed reason={state.loadError ?? "failed"} onRetry={state.retry} testId="admin-compliance-failed" />
      ) : loadState === "signed-out" ? (
        <>
          <WorkStateNotice
            kind="signed-out"
            title="Sign in to see your compliance"
            body="Your records are kept for your signed-in account only."
            onSignIn={() => setSignInOpen(true)}
            testId="admin-compliance-signed-out"
          />
          <AccountSetupDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
        </>
      ) : (
        <div className={adminStyles.column} data-testid="admin-compliance-ready">
          {firstUse ? (
            <FirstUse overview={overview} canEdit={canEdit} />
          ) : (
            <>
              <SummaryCard overview={overview} />
              <WorkCard as="ul" testId="admin-compliance-actions">
                <AdminRow
                  lead={<WorkIconCircle icon={FileSpreadsheet} />}
                  href={ADMIN_PAGE_HREFS.complianceExport}
                  title="Export a copy for yourself"
                  sub="Excel, saved on this device"
                  testId="admin-compliance-export-link"
                />
              </WorkCard>
              <BeforeNextJob overview={overview} />
              <FilterChips overview={overview} filter={filter} onFilter={setFilter} />
              <GroupLists overview={overview} filter={filter} today={today} />
            </>
          )}
          <AdminNote>
            Linked to your account only, not shared with your health service. Rules come from the statewide requirements
            list. Rule to confirm means its source did not state it clearly.
          </AdminNote>
          {canEdit && !firstUse ? (
            <WorkDock aria-label="Compliance actions">
              <WorkButton icon={CalendarPlus} href={RECORD_DATES_HREF} testId="admin-compliance-record-dates">
                Record dates
              </WorkButton>
            </WorkDock>
          ) : null}
        </div>
      )}
    </AdminPage>
  );
}
