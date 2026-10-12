import { CalendarDays } from "lucide-react";

import { AdminRow, AdminSection, adminStyles } from "@/components/admin/admin-kit";
import { AdminStatusShape } from "@/components/admin/admin-status-tag";
import { ADMIN_PAGE_HREFS } from "@/components/admin/admin-page-sections";
import { renewalsItemHref } from "@/components/admin/today/today-hrefs";
import { WorkCard, WorkDateRow, WorkEmpty } from "@/components/mode-kit/work";
import { TextLink } from "@/components/ui/link";
import { formatRecordedDate, formatRelativeDate } from "@/lib/admin/renewal-dates";
import type { ComingUp, ComingUpGroup } from "@/lib/admin/today-selectors";
import type { RenewalsShowFilter } from "@/lib/admin/renewals-filters";
import { TodayAtAGlance } from "@/components/admin/today/today-at-a-glance";
import { onCallTeachingDateParts } from "@/lib/on-call/teaching-schedule";

function GroupHeading({ group }: { group: ComingUpGroup }) {
  return (
    <h3 className={adminStyles.monthHead} data-testid={`admin-today-coming-up-group-${group.key}`}>
      {group.kind === "passed" ? <AdminStatusShape status="date-passed" /> : null}
      {group.label}
    </h3>
  );
}

/**
 * "Coming up" (work-mode redesign, owner request 6 Oct 2026): the doctor's
 * recorded dates over the next 12 months as date-tile rows, grouped by month,
 * with anything whose date has passed first under "Date passed" and its shape.
 * Each row opens that item on Renewals. The list stops at the selector's
 * limit; "See all in Renewals" follows when there are more. With nothing dated
 * it says so plainly instead of disappearing, because an absent list would
 * read as "nothing is due".
 */
export function TodayComingUpModule({
  comingUp,
  today,
  counts,
}: {
  comingUp: ComingUp;
  today: string;
  /** The three Renewals counts, drawn as the card's top strip (12 Oct 2026 simplify plan). */
  counts?: Record<RenewalsShowFilter, number>;
}) {
  const more = comingUp.total > comingUp.shown;
  return (
    <AdminSection
      label="Coming up"
      action={comingUp.groups.length > 0 ? { label: "Renewals", href: ADMIN_PAGE_HREFS.renewals } : undefined}
      testId="admin-today-coming-up"
    >
      {comingUp.groups.length === 0 ? (
        <WorkCard testId="admin-today-coming-up-empty">
          {counts ? <TodayAtAGlance counts={counts} /> : null}
          <WorkEmpty
            icon={CalendarDays}
            title="No recorded dates in the next 12 months"
            action={
              <TextLink href={ADMIN_PAGE_HREFS.renewals} className="inline-flex min-h-12 items-center">
                Open Renewals
              </TextLink>
            }
          />
        </WorkCard>
      ) : (
        <WorkCard>
          {counts ? <TodayAtAGlance counts={counts} /> : null}
          {comingUp.groups.map((group) => (
            <div key={group.key} data-group-kind={group.kind}>
              <GroupHeading group={group} />
              <ul className="work-rows">
                {group.rows.map((row) => {
                  const { day, month } = onCallTeachingDateParts(row.expiresOn);
                  const relative = formatRelativeDate(row.expiresOn, today);
                  const recorded = formatRecordedDate(row.expiresOn);
                  return (
                    <li key={row.entryId}>
                      <WorkDateRow
                        month={month ?? ""}
                        day={day ?? ""}
                        title={row.title}
                        sub={
                          <span className="tabular-nums">
                            {group.kind === "passed"
                              ? `Passed ${recorded} · ${relative}`
                              : `Renew by ${recorded} · ${relative}`}
                          </span>
                        }
                        href={renewalsItemHref(row.entryId)}
                        testId="admin-today-coming-up-row"
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {more ? (
            <ul className="work-rows">
              <AdminRow
                title="See all in Renewals"
                href={ADMIN_PAGE_HREFS.renewals}
                testId="admin-today-coming-up-see-all"
              />
            </ul>
          ) : null}
        </WorkCard>
      )}
    </AdminSection>
  );
}
