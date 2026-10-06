"use client";

import { AdminRuleToConfirm } from "@/components/admin/admin-status-word";
import { catalogueItemForEntry } from "@/components/admin/renewals/catalogue-lookup";
import { ChecklistPressableRow, ChecklistRowActionButton } from "@/components/admin/renewals/checklist-row";
import { ChecklistStatus } from "@/components/admin/renewals/checklist-status";
import type { ChecklistKindFilter } from "@/components/admin/renewals/kind-chips";
import { checklistKindLabel } from "@/components/admin/renewals/kind-chips";
import { requirementDateLine, requirementRowUrgency } from "@/components/admin/renewals/urgency";
import { ModeGroupedList } from "@/components/mode-kit/grouped-list";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { Button } from "@/components/ui/button";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import { complianceBucket, type ComplianceBucket } from "@/lib/admin/compliance-overview";
import {
  ADMIN_REQUIREMENT_GROUPS,
  type AdminRequirementCatalogueItem,
  type RequirementChecklistRow,
  type RequirementRowState,
} from "@/lib/admin/requirements";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { complianceExpiresOn } from "@/lib/on-call/compliance";
import type { OnCallEntry } from "@/lib/on-call/entry-model";

const STATE_ORDER: Record<RequirementRowState, number> = { "needs-action": 0, "no-end-date": 1, "not-recorded": 2 };

/** Within a group: dated rows soonest first, then rows with no end date, then rows not recorded yet. */
function byStateThenDate(a: RequirementChecklistRow, b: RequirementChecklistRow): number {
  const state = STATE_ORDER[a.state] - STATE_ORDER[b.state];
  if (state !== 0) return state;
  return (a.expiresOn ?? "").localeCompare(b.expiresOn ?? "");
}

/**
 * Grouped by the catalogue's own groups (Registration, Checks, Health,
 * Training, Job), as the 5 Oct mock-up v2 lists them; a kind chip narrows the
 * rows to its one group before this runs.
 */
function groupRows(rows: readonly RequirementChecklistRow[]) {
  return ADMIN_REQUIREMENT_GROUPS.map((group) => ({
    group,
    heading: checklistKindLabel(group),
    rows: rows.filter((row) => row.item.group === group).sort(byStateThenDate),
  })).filter((group) => group.rows.length > 0);
}

/**
 * What the "Record dates" slot above the list offers: the button that opens
 * the step-through sheet, or — when editing is unavailable — the plain
 * reason, never a button that pretends to work.
 */
export type RecordDatesSlot =
  { readonly kind: "button"; readonly onOpen: () => void } | { readonly kind: "note"; readonly text: string };

/**
 * The checklist's main list (5 Oct mock-up v2, screen 1): grouped by the
 * catalogue's groups, each with its count, narrowed by a kind chip or an
 * at-a-glance count row. Ends in the "Not for this job" section, always
 * last, with its own "Move back" action.
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
  /** The "Record dates" slot shown above the list (under "All" only). */
  readonly recordDates?: RecordDatesSlot;
  /** An at-a-glance count row's status, narrowing the list to that status. */
  readonly bucket?: ComplianceBucket | null;
  readonly testId?: string;
}) {
  const today = perthCalendarDate(now);
  const filtered = rows.filter(
    (row) => (filter === "all" || row.item.group === filter) && (!bucket || complianceBucket(row, today) === bucket),
  );
  const groups = groupRows(filtered);
  const notRecordedCount = filtered.filter((row) => row.state === "not-recorded").length;
  const filteredNotForThisJob = notForThisJob.filter((entry) => {
    if (bucket) return false;
    if (filter === "all") return true;
    return catalogueItemForEntry(entry)?.group === filter;
  });

  const renderRow = (row: RequirementChecklistRow) => {
    const urgency = requirementRowUrgency(row, now);
    const showAddDate = row.state === "not-recorded";
    // Groups mix recorded and unrecorded rows, so an unrecorded row says so on its own line.
    const notRecordedLine = showAddDate ? "Not recorded yet" : undefined;
    return (
      <ChecklistPressableRow
        key={row.item.id}
        title={row.item.title}
        subtitle={requirementDateLine(row.expiresOn, now) ?? notRecordedLine}
        meta={row.item.status === "needs-checking" ? <AdminRuleToConfirm /> : null}
        statusTrailing={showAddDate ? undefined : <ChecklistStatus urgency={urgency} />}
        actionTrailing={
          showAddDate && canEdit ? (
            <ChecklistRowActionButton
              label="Add date"
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

  return (
    <div className="grid min-w-0 gap-5" data-testid={testId}>
      {recordDates && notRecordedCount > 0 && filter === "all" && (!bucket || bucket === "not-recorded") ? (
        <div
          className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3"
          data-testid={`${testId}-record-dates-slot`}
        >
          <span className={cn(textMuted, "text-sm")}>{`${notRecordedCount} not recorded yet`}</span>
          {recordDates.kind === "button" ? (
            <Button variant="secondary" size="sm" onClick={recordDates.onOpen} testId="admin-renewals-record-dates">
              Record dates
            </Button>
          ) : (
            <span className={cn(textMuted, "text-xs")} data-testid="admin-renewals-record-dates-note">
              {recordDates.text}
            </span>
          )}
        </div>
      ) : null}

      {groups.length === 0 ? (
        <p className={cn(textMuted, "px-3 text-sm")} data-testid={`${testId}-nothing`}>
          Nothing in this view.
        </p>
      ) : null}

      {groups.map((group) => (
        <ModeGroupedList
          key={group.group}
          id={`admin-renewals-group-${group.group}`}
          eyebrow={`${group.heading} · ${group.rows.length}`}
          testId={`${testId}-group-${group.group}`}
        >
          {group.rows.map(renderRow)}
        </ModeGroupedList>
      ))}

      {filteredNotForThisJob.length > 0 ? (
        <section aria-labelledby={`${testId}-not-for-this-job-heading`} className="grid gap-2">
          <h2 id={`${testId}-not-for-this-job-heading`} className={eyebrowText}>
            Not for this job
          </h2>
          <ModeGroupedList testId={`${testId}-not-for-this-job`}>
            {filteredNotForThisJob.map((entry) => {
              const item = catalogueItemForEntry(entry);
              const expiresOn = complianceExpiresOn(entry);
              return (
                <ChecklistPressableRow
                  key={entry.id}
                  title={item?.title ?? entry.title}
                  subtitle={requirementDateLine(expiresOn, now) ?? "Not recorded yet"}
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
          </ModeGroupedList>
        </section>
      ) : null}

      <p className={cn(textMuted, "px-3 text-xs")}>
        Dates you entered, not a check. Linked to your account only, not shared with your health service. Rule to
        confirm means its source did not state it clearly: check it with your service.
      </p>
    </div>
  );
}
