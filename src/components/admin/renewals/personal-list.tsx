import { CalendarPlus, Copy, Plus, UserRound } from "lucide-react";

import { AdminNote, AdminRow, AdminSection, adminStyles } from "@/components/admin/admin-kit";
import { AdminStatusIcon, AdminStatusTag, adminStatusForWord } from "@/components/admin/admin-status-tag";
import { ChecklistPressableRow, ChecklistRowActionButton } from "@/components/admin/renewals/checklist-row";
import { WorkButton, WorkCard, WorkDateRow, WorkEmpty, WorkIconCircle } from "@/components/mode-kit/work";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { formatRelativeDate } from "@/lib/admin/renewal-dates";
import { complianceExpiresOn } from "@/lib/on-call/compliance";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { onCallTeachingDateParts } from "@/lib/on-call/teaching-schedule";
import { shortDateFrom } from "@/components/admin/renewals/urgency";

/** The Personal tab's own, simpler status word: this axis has no catalogue
 *  "start renewing" lead time to draw from unless the entry itself carries a
 *  `leadTimeDays`, so a personal row reads "Recorded" once a date exists, a
 *  diamond once that date has passed, or "Not recorded yet" with a dashed ring. */
export function personalStatus(entry: OnCallEntry, now: Date) {
  const expiresOn = complianceExpiresOn(entry);
  if (!expiresOn) return { shape: "ring" as const, word: "Not recorded yet" };
  if (expiresOn < perthCalendarDate(now)) return { shape: "diamond" as const, word: "Date passed" };
  return { shape: null, word: "Recorded" };
}

/** Soonest first; rows with no date after every dated one. */
function bySoonest(a: OnCallEntry, b: OnCallEntry): number {
  return (complianceExpiresOn(a) ?? "~").localeCompare(complianceExpiresOn(b) ?? "~");
}

/**
 * The Personal tab (Josh's locked mockup): "Personal · soonest first" as
 * date-tile rows, an undated row with "+ Add" that opens it, then a card with
 * "Add all to my calendar" and "Copy for workforce", and the privacy note.
 */
export function PersonalRenewalsList({
  entries,
  now,
  canEdit = true,
  onOpen,
  onAdd,
  onAddDate,
  onAddAllToCalendar,
  onCopyForWorkforce,
  testId = "admin-renewals-personal",
}: {
  readonly entries: readonly OnCallEntry[];
  readonly now: Date;
  readonly canEdit?: boolean;
  readonly onOpen: (entry: OnCallEntry) => void;
  readonly onAdd: () => void;
  /** "+ Add" on an undated row: records its date straight away. */
  readonly onAddDate?: (entry: OnCallEntry) => void;
  /** Both live in the page's ••• menu too; offered here as rows, as the mockup draws them. */
  readonly onAddAllToCalendar?: () => void;
  readonly onCopyForWorkforce?: () => void;
  readonly testId?: string;
}) {
  const today = perthCalendarDate(now);
  const tools =
    onAddAllToCalendar || onCopyForWorkforce ? (
      <WorkCard as="ul">
        {onAddAllToCalendar ? (
          <AdminRow
            lead={<WorkIconCircle icon={CalendarPlus} />}
            title="Add all to my calendar"
            sub="Every date you recorded"
            onClick={onAddAllToCalendar}
            testId={`${testId}-calendar-all`}
          />
        ) : null}
        {onCopyForWorkforce ? (
          <AdminRow
            lead={<WorkIconCircle icon={Copy} />}
            title="Copy for workforce"
            sub="Plain text of your dates"
            onClick={onCopyForWorkforce}
            testId={`${testId}-copy`}
          />
        ) : null}
      </WorkCard>
    ) : null;

  if (entries.length === 0) {
    return (
      <div className={adminStyles.column}>
        <WorkCard testId={`${testId}-empty`}>
          <WorkEmpty
            icon={UserRound}
            title="No personal renewals"
            body={
              canEdit
                ? "Add one that is not on the checklist, like a parking permit or a college membership."
                : "Renewals you add yourself, off the checklist, show here."
            }
            action={
              canEdit ? (
                <WorkButton icon={Plus} onClick={onAdd} testId={`${testId}-empty-add`}>
                  Add a renewal
                </WorkButton>
              ) : undefined
            }
          />
        </WorkCard>
        <AdminNote>Your own items, not on the statewide list</AdminNote>
      </div>
    );
  }
  const sorted = [...entries].sort(bySoonest);
  return (
    <div className={adminStyles.column}>
      <AdminSection label="Personal · soonest first" count={entries.length}>
        <WorkCard as="ul" testId={testId}>
          {sorted.map((entry) => {
            const expiresOn = complianceExpiresOn(entry);
            const word = personalStatus(entry, now).word;
            const status = adminStatusForWord(word);
            if (!expiresOn) {
              return (
                <ChecklistPressableRow
                  key={entry.id}
                  lead={<AdminStatusIcon status="not-recorded" />}
                  title={entry.title}
                  subtitle="Not recorded yet"
                  actionTrailing={
                    canEdit && onAddDate ? (
                      <ChecklistRowActionButton
                        label="Add"
                        icon={Plus}
                        accessibleLabel={`Add date for ${entry.title}`}
                        onClick={() => onAddDate(entry)}
                        testId={`${testId}-add-date-${entry.slug}`}
                      />
                    ) : undefined
                  }
                  onOpen={() => onOpen(entry)}
                  anchorId={onCallEntryAnchorId(entry.id)}
                  testId={`${testId}-row-${entry.slug}`}
                />
              );
            }
            const { day, month } = onCallTeachingDateParts(expiresOn);
            return (
              <li key={entry.id} id={onCallEntryAnchorId(entry.id)} className="scroll-mt-24">
                <WorkDateRow
                  month={month ?? ""}
                  day={day ?? ""}
                  title={entry.title}
                  sub={
                    <span className="tabular-nums">
                      {`${status === "date-passed" ? "Passed" : "Renew by"} ${shortDateFrom(expiresOn, today)} · ${formatRelativeDate(expiresOn, today)}`}
                    </span>
                  }
                  end={status === "date-passed" ? <AdminStatusTag status="date-passed" /> : undefined}
                  onClick={() => onOpen(entry)}
                  testId={`${testId}-row-${entry.slug}`}
                />
              </li>
            );
          })}
        </WorkCard>
      </AdminSection>
      {tools}
      <AdminNote>Your own items, not on the statewide list</AdminNote>
    </div>
  );
}
