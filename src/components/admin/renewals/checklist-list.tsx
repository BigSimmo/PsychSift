"use client";

import {
  Award,
  BookOpen,
  BriefcaseBusiness,
  ChevronRight,
  Plus,
  Shield,
  Syringe,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { AdminNote, AdminRow, AdminSection, adminStyles } from "@/components/admin/admin-kit";
import { AdminRuleToConfirm, AdminStatusIcon, AdminStatusTag } from "@/components/admin/admin-status-tag";
import { catalogueItemForEntry } from "@/components/admin/renewals/catalogue-lookup";
import { ChecklistPressableRow, ChecklistRowActionButton } from "@/components/admin/renewals/checklist-row";
import type { ChecklistKindFilter } from "@/components/admin/renewals/kind-chips";
import { checklistKindLabel } from "@/components/admin/renewals/kind-chips";
import { requirementActionLine, requirementDateLine, shortDateFrom } from "@/components/admin/renewals/urgency";
import { WorkCard, WorkIconCircle } from "@/components/mode-kit/work";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { cn } from "@/components/ui-primitives";
import { complianceBucket, type ComplianceBucket } from "@/lib/admin/compliance-overview";
import {
  ADMIN_REQUIREMENT_GROUPS,
  type AdminRequirementCatalogueItem,
  type AdminRequirementGroup,
  type RequirementChecklistRow,
} from "@/lib/admin/requirements";
import { renewalStartOn } from "@/lib/admin/renewal-dates";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { complianceExpiresOn } from "@/lib/on-call/compliance";
import type { OnCallEntry } from "@/lib/on-call/entry-model";

const GROUP_ICONS: Record<AdminRequirementGroup, LucideIcon> = {
  registration: Shield,
  checks: Users,
  health: Syringe,
  training: BookOpen,
  job: BriefcaseBusiness,
};

const NEEDS_ACTION: ReadonlySet<ComplianceBucket> = new Set(["date-passed", "start-renewing", "not-recorded"]);
const BUCKET_ORDER: Record<ComplianceBucket, number> = {
  "date-passed": 0,
  "start-renewing": 1,
  "not-recorded": 2,
  recorded: 3,
};

/** Most urgent first: passed dates, then start renewing, each soonest first, then rows with no date. */
function byUrgency(today: string) {
  return (a: RequirementChecklistRow, b: RequirementChecklistRow) => {
    const order = BUCKET_ORDER[complianceBucket(a, today)] - BUCKET_ORDER[complianceBucket(b, today)];
    if (order !== 0) return order;
    return (a.expiresOn ?? "~").localeCompare(b.expiresOn ?? "~");
  };
}

/** "Medical registration to 30 Sep 2027", or the first names and "and 2 more". */
function groupSummary(rows: readonly RequirementChecklistRow[], today: string): string {
  if (rows.length === 1) {
    const [row] = rows;
    return row.expiresOn ? `${row.item.title} to ${shortDateFrom(row.expiresOn, today)}` : row.item.title;
  }
  const named = rows
    .slice(0, 2)
    .map((row) => row.item.title)
    .join(", ");
  return rows.length > 2 ? `${named} and ${rows.length - 2} more` : named;
}

/** A recorded row's end: when renewing starts, or plain Recorded. */
function recordedEnd(row: RequirementChecklistRow, today: string) {
  const startOn = row.entry && row.expiresOn ? renewalStartOn(row.entry) : undefined;
  return startOn ? (
    <AdminStatusTag status="plain" label={`Start ${shortDateFrom(startOn, today)}`} />
  ) : (
    <AdminStatusTag status="recorded" />
  );
}

/**
 * What the "Record dates" slot offers when editing is unavailable: the plain
 * reason, never a button that pretends to work. The working button lives in
 * the page's dock.
 */
export type RecordDatesSlot =
  { readonly kind: "button"; readonly onOpen: () => void } | { readonly kind: "note"; readonly text: string };

/**
 * The checklist (work-mode redesign, owner request 6 Oct 2026, Josh's locked
 * mockup): "Needs action, soonest first" as status rows, then "Recorded"
 * folded into one row per kind that opens in place, then "Not for this job"
 * with Move back, the CPD signpost and the honesty note. A kind chip or an
 * at-a-glance count narrows every part to its rows.
 */
export function ChecklistList({
  rows,
  notForThisJob,
  filter,
  now,
  canEdit = true,
  onOpen,
  onAddDate,
  onMoveBack,
  recordDates,
  bucket = null,
  testId = "admin-renewals-checklist",
}: {
  readonly rows: readonly RequirementChecklistRow[];
  readonly notForThisJob: readonly OnCallEntry[];
  readonly filter: ChecklistKindFilter;
  readonly now: Date;
  readonly canEdit?: boolean;
  readonly onOpen: (item: AdminRequirementCatalogueItem, entry: OnCallEntry | null) => void;
  readonly onAddDate: (item: AdminRequirementCatalogueItem) => void;
  readonly onMoveBack: (entry: OnCallEntry) => void;
  readonly recordDates?: RecordDatesSlot;
  /** An at-a-glance count row's status, narrowing the list to that status. */
  readonly bucket?: ComplianceBucket | null;
  readonly testId?: string;
}) {
  const [opened, setOpened] = useState<ReadonlySet<AdminRequirementGroup>>(() => new Set());
  const today = perthCalendarDate(now);
  const filtered = rows.filter(
    (row) => (filter === "all" || row.item.group === filter) && (!bucket || complianceBucket(row, today) === bucket),
  );
  const needsAction = filtered.filter((row) => NEEDS_ACTION.has(complianceBucket(row, today))).sort(byUrgency(today));
  const recordedGroups = ADMIN_REQUIREMENT_GROUPS.map((group) => ({
    group,
    rows: filtered
      .filter((row) => row.item.group === group && complianceBucket(row, today) === "recorded")
      .sort(byUrgency(today)),
  })).filter((group) => group.rows.length > 0);
  const recordedCount = recordedGroups.reduce((sum, group) => sum + group.rows.length, 0);
  const filteredNotForThisJob = notForThisJob.filter((entry) => {
    if (bucket) return false;
    if (filter === "all") return true;
    return catalogueItemForEntry(entry)?.group === filter;
  });
  const isOpen = (group: AdminRequirementGroup) => opened.has(group) || filter === group || bucket === "recorded";

  function toggle(group: AdminRequirementGroup) {
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  const renderRow = (row: RequirementChecklistRow, recorded: boolean) => {
    const status = complianceBucket(row, today);
    const notRecorded = row.state === "not-recorded";
    return (
      <ChecklistPressableRow
        key={row.item.id}
        lead={recorded ? undefined : <AdminStatusIcon status={status} />}
        title={row.item.title}
        subtitle={<span className="tabular-nums">{requirementActionLine(row, now)}</span>}
        meta={row.item.status === "needs-checking" ? <AdminRuleToConfirm /> : null}
        statusTrailing={recorded ? recordedEnd(row, today) : undefined}
        actionTrailing={
          notRecorded && canEdit ? (
            <ChecklistRowActionButton
              label="Add"
              icon={Plus}
              accessibleLabel={`Add date for ${row.item.title}`}
              onClick={() => onAddDate(row.item)}
              testId={`${testId}-add-date-${row.item.id}`}
            />
          ) : undefined
        }
        onOpen={() => onOpen(row.item, row.entry)}
        anchorId={row.entry ? onCallEntryAnchorId(row.entry.id) : undefined}
        testId={`${testId}-row-${row.item.id}`}
      />
    );
  };

  const nothing = needsAction.length === 0 && recordedGroups.length === 0 && filteredNotForThisJob.length === 0;

  return (
    <div
      className={adminStyles.column}
      data-testid={testId}
      id={filter !== "all" ? `admin-renewals-group-${filter}` : undefined}
    >
      {nothing ? (
        <WorkCard padded testId={`${testId}-nothing`}>
          <p className="work-row__sub m-0">Nothing in this view.</p>
        </WorkCard>
      ) : null}

      {needsAction.length > 0 ? (
        <AdminSection label="Needs action · soonest first" count={needsAction.length} testId={`${testId}-needs-action`}>
          <WorkCard as="ul">{needsAction.map((row) => renderRow(row, false))}</WorkCard>
        </AdminSection>
      ) : null}

      {recordedGroups.length > 0 ? (
        <AdminSection label="Recorded" count={recordedCount} testId={`${testId}-recorded`}>
          <WorkCard as="ul">
            {recordedGroups.map(({ group, rows: groupRows }) => {
              const open = isOpen(group);
              const label = `${checklistKindLabel(group)} · ${groupRows.length}`;
              const subId = `${testId}-group-${group}-sub`;
              const Icon = GROUP_ICONS[group];
              return (
                <li
                  key={group}
                  id={filter === "all" ? `admin-renewals-group-${group}` : undefined}
                  className="scroll-mt-24"
                  data-testid={`${testId}-group-${group}`}
                >
                  {/* The accordion pattern: a heading that holds the disclosure button. */}
                  <h3 className="m-0">
                    <button
                      type="button"
                      className={cn("work-row", adminStyles.disclosure)}
                      aria-expanded={open}
                      aria-label={label}
                      aria-describedby={subId}
                      onClick={() => toggle(group)}
                      data-testid={`${testId}-group-${group}-toggle`}
                    >
                      <WorkIconCircle icon={Icon} />
                      <span className="work-row__text">
                        <span className="work-row__title">{label}</span>
                        <span className="work-row__sub" id={subId}>
                          {groupSummary(groupRows, today)}
                        </span>
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className={cn("work-row__chev", adminStyles.disclosureChev)}
                        strokeWidth={2}
                      />
                    </button>
                  </h3>
                  {open ? (
                    <ul className={cn("work-rows", adminStyles.nested)}>
                      {groupRows.map((row) => renderRow(row, true))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </WorkCard>
        </AdminSection>
      ) : null}

      {filteredNotForThisJob.length > 0 ? (
        <AdminSection
          label="Not for this job"
          count={filteredNotForThisJob.length}
          labelId={`${testId}-not-for-this-job-heading`}
        >
          <WorkCard as="ul" testId={`${testId}-not-for-this-job`}>
            {filteredNotForThisJob.map((entry) => {
              const item = catalogueItemForEntry(entry);
              const expiresOn = complianceExpiresOn(entry);
              return (
                <ChecklistPressableRow
                  key={entry.id}
                  lead={<AdminStatusIcon status="not-for-job" />}
                  title={item?.title ?? entry.title}
                  subtitle={requirementDateLine(expiresOn, now) ?? "Not for this job"}
                  meta={item?.status === "needs-checking" ? <AdminRuleToConfirm /> : null}
                  actionTrailing={
                    canEdit ? (
                      <ChecklistRowActionButton
                        label="Move back"
                        onClick={() => onMoveBack(entry)}
                        testId={`${testId}-move-back-${entry.slug}`}
                      />
                    ) : undefined
                  }
                  onOpen={() => (item ? onOpen(item, entry) : undefined)}
                  anchorId={onCallEntryAnchorId(entry.id)}
                  testId={`${testId}-not-for-this-job-row-${entry.slug}`}
                />
              );
            })}
          </WorkCard>
        </AdminSection>
      ) : null}

      <WorkCard as="ul">
        <AdminRow
          lead={<WorkIconCircle icon={Award} leadsTo="cme" />}
          title="CPD hours are tracked in CPD"
          sub="Your CPD year, logs and evidence"
          href="/cme"
          testId={`${testId}-cpd`}
        />
      </WorkCard>

      {recordDates?.kind === "note" && rows.some((row) => row.state === "not-recorded") ? (
        <p className="work-row__sub m-0 text-center" data-testid="admin-renewals-record-dates-note">
          {recordDates.text}
        </p>
      ) : null}

      <AdminNote>Dates you entered, not a check. Not shared with your health service.</AdminNote>
      <p className="work-row__sub m-0 px-3 text-center">
        Rule to confirm means its source did not state it clearly. Check it with your service.
      </p>
    </div>
  );
}
