import { CalendarPlus, Check, CircleDashed } from "lucide-react";

import { AdminRow, AdminRowButton, AdminSection } from "@/components/admin/admin-kit";
import { AdminRuleToConfirm, AdminStatusIcon, AdminStatusTag } from "@/components/admin/admin-status-tag";
import { ADMIN_PAGE_HREFS } from "@/components/admin/admin-page-sections";
import { RENEWALS_RECORD_MISSING_HREF, renewalsItemHref, renewalsShowHref } from "@/components/admin/today/today-hrefs";
import { WorkButton, WorkCard, WorkIconCircle } from "@/components/mode-kit/work";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { formatRecordedDate, formatRelativeDate } from "@/lib/admin/renewal-dates";
import type { NeedsYou, NeedsYouRow } from "@/lib/admin/today-selectors";

/**
 * A passed row opens that item's detail on Renewals; the grouped
 * not-recorded row opens Renewals' checklist filtered to what has no date.
 */
function rowHref(row: NeedsYouRow): string {
  return row.kind === "passed" ? renewalsItemHref(row.entry.id) : renewalsShowHref("not-recorded");
}

const NAMED_TITLES = 3;

function notRecordedHeading(titles: readonly string[]): string {
  return `${titles.length} ${titles.length === 1 ? "date" : "dates"} not recorded`;
}

/** The first few names, then "and N more", so a long gap list stays one line or two. */
function notRecordedNames(titles: readonly string[]): string {
  const named = titles.slice(0, NAMED_TITLES).join(", ");
  const more = titles.length - NAMED_TITLES;
  return more > 0 ? `${named} and ${more} more` : named;
}

function NeedsYouItem({ row, today, featured }: { row: NeedsYouRow; today: string; featured?: boolean }) {
  if (row.kind === "passed") {
    return (
      <AdminRow
        lead={<AdminStatusIcon status="date-passed" />}
        title={row.entry.title}
        sub={
          <span className="tabular-nums">{`${formatRecordedDate(row.expiresOn)} · ${formatRelativeDate(row.expiresOn, today)}`}</span>
        }
        tags={
          <>
            <AdminStatusTag status="date-passed" />
            {row.needsChecking ? <AdminRuleToConfirm /> : null}
          </>
        }
        href={rowHref(row)}
        testId={featured ? "admin-today-needs-you-featured" : undefined}
        action={
          featured ? (
            <AdminRowButton
              label="Renewed"
              icon={Check}
              href={`${ADMIN_PAGE_HREFS.renewals}#${onCallEntryAnchorId(row.entry.id)}`}
              accessibleLabel={`Renewed: ${row.entry.title}`}
              testId="admin-today-needs-you-renewed"
            />
          ) : undefined
        }
      />
    );
  }
  return (
    <AdminRow
      lead={<WorkIconCircle icon={CircleDashed} tone="neutral" />}
      title={notRecordedHeading(row.titles)}
      sub={notRecordedNames(row.titles)}
      href={rowHref(row)}
      testId={featured ? "admin-today-needs-you-featured" : undefined}
    />
  );
}

/**
 * "Needs you" (work-mode redesign, owner request 6 Oct 2026): the most urgent
 * row first, with "Renewed" beside a passed date, then at most two more, then
 * "Record dates" while anything is unrecorded. Every row opens its item, or
 * Renewals filtered to what has no date. Only real recorded data appears here:
 * the mockup's task rows (sign a form, book a fit test) have no data source.
 */
export function TodayNeedsYouModule({ needsYou, today }: { needsYou: NeedsYou; today: string }) {
  const { featured, rows, recordableCount } = needsYou;
  return (
    <AdminSection label="Needs you" count={1 + rows.length} testId="admin-today-needs-you">
      <WorkCard>
        <ul className="work-rows">
          <NeedsYouItem row={featured} today={today} featured />
        </ul>
        {rows.length > 0 ? (
          <ul className="work-rows" data-testid="admin-today-needs-you-rows">
            {rows.map((row) => (
              <NeedsYouItem key={row.key} row={row} today={today} />
            ))}
          </ul>
        ) : null}
        {recordableCount > 0 ? (
          <div className="border-t border-[color:var(--border)] p-3">
            <WorkButton
              variant="tinted"
              size="wide"
              icon={CalendarPlus}
              href={RENEWALS_RECORD_MISSING_HREF}
              testId="admin-today-needs-you-record"
            >
              Record dates
            </WorkButton>
          </div>
        ) : null}
      </WorkCard>
    </AdminSection>
  );
}
