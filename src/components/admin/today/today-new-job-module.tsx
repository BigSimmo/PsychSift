import { ArrowRight, BriefcaseBusiness } from "lucide-react";
import Link from "next/link";

import { AdminMeter, AdminSection, adminStyles } from "@/components/admin/admin-kit";
import { ADMIN_NEW_JOB_SECTIONS, ADMIN_PAGE_HREFS } from "@/components/admin/admin-page-sections";
import { WorkCard, WorkIconCircle } from "@/components/mode-kit/work";
import { formatDateEcho, formatRelativeDate } from "@/lib/admin/renewal-dates";
import type { NewJobProgress } from "@/lib/admin/new-job-progress";

/**
 * "New job" (work-mode redesign, owner request 6 Oct 2026): shown only while
 * `selectNewJobProgress` returns non-null (a start date is set). The start
 * date, how far off it is, "3 of 7" with a thin meter, and the next step.
 */
export function TodayNewJobModule({ progress, today }: { progress: NewJobProgress; today: string }) {
  const fraction = progress.total > 0 ? progress.done / progress.total : 0;
  return (
    <AdminSection
      label="New job"
      action={{ label: "Open", href: ADMIN_PAGE_HREFS.newJob }}
      testId="admin-today-new-job"
    >
      <WorkCard padded>
        <div className="flex min-w-0 items-center gap-3">
          <WorkIconCircle icon={BriefcaseBusiness} />
          <span className="work-row__text">
            <span className="work-row__title">{`Starts ${formatDateEcho(progress.startsOn)}`}</span>
            <span className="work-row__sub">{formatRelativeDate(progress.startsOn, today)}</span>
          </span>
          <span className="work-row__end tabular-nums">{`${progress.done} of ${progress.total}`}</span>
        </div>
        <div className="mt-3">
          <AdminMeter fraction={fraction} label={`${progress.done} of ${progress.total} steps done`} />
        </div>
        {progress.nextStep ? (
          <Link
            href={`${ADMIN_PAGE_HREFS.newJob}#${ADMIN_NEW_JOB_SECTIONS[0].id}`}
            className={adminStyles.nextLine}
            data-testid="admin-today-new-job-next-step"
          >
            <ArrowRight aria-hidden="true" strokeWidth={2} />
            {`Next: ${progress.nextStep}`}
          </Link>
        ) : (
          <p className={adminStyles.nextLine}>All steps done</p>
        )}
      </WorkCard>
    </AdminSection>
  );
}
