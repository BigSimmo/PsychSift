import { CalendarCheck, Plus } from "lucide-react";

import { AdminNote, adminStyles } from "@/components/admin/admin-kit";
import { AdminRuleToConfirm, AdminStatusIcon, adminStatusForWord } from "@/components/admin/admin-status-tag";
import { ChecklistPressableRow, ChecklistRowActionButton } from "@/components/admin/renewals/checklist-row";
import { personalStatus } from "@/components/admin/renewals/personal-list";
import { requirementActionLine, requirementDateLine } from "@/components/admin/renewals/urgency";
import { WorkButton, WorkCard, WorkEmpty } from "@/components/mode-kit/work";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { complianceBucket } from "@/lib/admin/compliance-overview";
import { RENEWALS_SHOW_LABELS, type RenewalsFilterItem, type RenewalsShowFilter } from "@/lib/admin/renewals-filters";
import type { AdminRequirementCatalogueItem } from "@/lib/admin/requirements";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import type { OnCallEntry } from "@/lib/on-call/entry-model";

/**
 * The Checklist narrowed by a link from Today (`?show=date-passed|due-90|
 * not-recorded`): a "Showing: <label> · N" card with Clear, then the matching
 * rows, catalogue items and personal renewals alike, read through the same
 * `renewalsShowMatches` Today counted with, so the count Today showed and the
 * rows here always agree.
 */
export function RenewalsShowFilterList({
  filter,
  matches,
  now,
  canEdit,
  onClear,
  onOpenCatalogue,
  onOpenPersonal,
  onAddDate,
  onRecordDates,
  testId = "admin-renewals-show",
}: {
  readonly filter: RenewalsShowFilter;
  readonly matches: readonly RenewalsFilterItem[];
  readonly now: Date;
  readonly canEdit: boolean;
  readonly onClear: () => void;
  readonly onOpenCatalogue: (item: AdminRequirementCatalogueItem, entry: OnCallEntry | null) => void;
  readonly onOpenPersonal: (entry: OnCallEntry) => void;
  readonly onAddDate: (item: AdminRequirementCatalogueItem) => void;
  /** Offered with the "Not recorded" view when editing is available. */
  readonly onRecordDates?: () => void;
  readonly testId?: string;
}) {
  const label = RENEWALS_SHOW_LABELS[filter];
  const today = perthCalendarDate(now);
  return (
    <div className={adminStyles.column} data-testid={testId}>
      <WorkCard padded testId={`${testId}-notice`}>
        <div className={adminStyles.glanceHead}>
          <p className="work-row__title m-0 tabular-nums" role="status">
            {`Showing: ${label} · ${matches.length}`}
          </p>
          <span className="flex flex-wrap items-center justify-end gap-x-1">
            {onRecordDates && matches.length > 0 ? (
              <WorkButton variant="tinted" onClick={onRecordDates} testId={`${testId}-record-dates`}>
                Record dates
              </WorkButton>
            ) : null}
            <WorkButton variant="quiet" onClick={onClear} testId={`${testId}-clear`}>
              Clear
            </WorkButton>
          </span>
        </div>
      </WorkCard>

      {matches.length === 0 ? (
        <WorkEmpty
          icon={CalendarCheck}
          title="Nothing to show here right now"
          body="Clear the filter to see every renewal."
          testId={`${testId}-empty`}
        />
      ) : (
        <WorkCard as="ul" testId={`${testId}-list`}>
          {matches.map((match) => {
            if (match.kind === "personal") {
              const { entry } = match;
              const word = personalStatus(entry, now).word;
              return (
                <ChecklistPressableRow
                  key={entry.id}
                  lead={<AdminStatusIcon status={adminStatusForWord(word)} />}
                  title={entry.title}
                  subtitle={requirementDateLine(match.expiresOn, now) ?? undefined}
                  meta={<span className="work-row__sub">Personal</span>}
                  onOpen={() => onOpenPersonal(entry)}
                  anchorId={onCallEntryAnchorId(entry.id)}
                  testId={`${testId}-personal-row-${entry.slug}`}
                />
              );
            }
            const { row } = match;
            const notRecorded = row.state === "not-recorded";
            return (
              <ChecklistPressableRow
                key={row.item.id}
                lead={<AdminStatusIcon status={complianceBucket(row, today)} />}
                title={row.item.title}
                subtitle={<span className="tabular-nums">{requirementActionLine(row, now)}</span>}
                meta={row.item.status === "needs-checking" ? <AdminRuleToConfirm /> : null}
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
                onOpen={() => onOpenCatalogue(row.item, row.entry)}
                anchorId={row.entry ? onCallEntryAnchorId(row.entry.id) : undefined}
                testId={`${testId}-row-${row.item.id}`}
              />
            );
          })}
        </WorkCard>
      )}
      <AdminNote>Dates you entered, not a check</AdminNote>
    </div>
  );
}
