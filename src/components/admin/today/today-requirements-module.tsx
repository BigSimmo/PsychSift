import { Clock, IdCard } from "lucide-react";

import { AdminRow, AdminSection } from "@/components/admin/admin-kit";
import { ADMIN_PAGE_HREFS } from "@/components/admin/admin-page-sections";
import { WorkCard, WorkIconCircle } from "@/components/mode-kit/work";
import type { RequirementsSummary } from "@/lib/admin/today-selectors";

/**
 * "Requirements": "7 of 10 recorded · 1 not for this job" in words, plus
 * "Dates you entered, not a check". No score bar, no verdict. The whole row is
 * the one link to Renewals.
 */
export function TodayRequirementsModule({ summary }: { summary: RequirementsSummary }) {
  const count = `${summary.recorded} of ${summary.total} recorded${
    summary.notForThisJob > 0 ? ` · ${summary.notForThisJob} not for this job` : ""
  }`;
  return (
    <AdminSection label="Requirements" testId="admin-today-requirements">
      <WorkCard as="ul">
        <AdminRow
          lead={<WorkIconCircle icon={IdCard} />}
          title={<span className="tabular-nums">{count}</span>}
          sub="Dates you entered, not a check"
          href={ADMIN_PAGE_HREFS.renewals}
          testId="admin-today-requirements-link"
        />
      </WorkCard>
    </AdminSection>
  );
}

/**
 * Overtime (idea assigned to Admin, work-mode redesign, owner request 6 Oct
 * 2026): a plain row into Roster's extra time view. Admin holds no hours of
 * its own, so this is navigation only.
 */
export function TodayOvertimeRow() {
  return (
    <AdminSection label="Pay and hours" testId="admin-today-overtime">
      <WorkCard as="ul">
        <AdminRow
          lead={<WorkIconCircle icon={Clock} leadsTo="roster" />}
          title="Overtime and extra time"
          sub="Log a late finish or extra hours in Roster"
          href="/roster?view=hours"
          testId="admin-today-overtime-link"
        />
      </WorkCard>
    </AdminSection>
  );
}
