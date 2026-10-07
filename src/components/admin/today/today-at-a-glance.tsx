import Link from "next/link";

import { adminStyles } from "@/components/admin/admin-kit";
import { AdminStatusShape, type AdminStatus } from "@/components/admin/admin-status-tag";
import { renewalsShowHref } from "@/components/admin/today/today-hrefs";
import { RENEWALS_SHOW_FILTERS, RENEWALS_SHOW_LABELS, type RenewalsShowFilter } from "@/lib/admin/renewals-filters";

/** Each count's shape: the same mark its rows carry on Renewals. */
const COUNT_STATUS: Record<RenewalsShowFilter, AdminStatus> = {
  "date-passed": "date-passed",
  "due-90": "start-renewing",
  "not-recorded": "not-recorded",
};

/**
 * The three counts (work-mode redesign, owner request 6 Oct 2026): Date
 * passed, Due in 90 days and Not recorded as three white cards, each with its
 * status shape beside the number, each opening Renewals already filtered to
 * the rows it counted. The counts come from `renewalsShowCounts`, the same
 * function Renewals filters through, so a number and its list cannot
 * disagree. A zero still shows (an absent card would read as "not checked"),
 * just quieter.
 */
export function TodayAtAGlance({ counts }: { counts: Record<RenewalsShowFilter, number> }) {
  return (
    <section aria-labelledby="admin-today-at-a-glance-heading" data-testid="admin-today-at-a-glance">
      <h2 id="admin-today-at-a-glance-heading" className="sr-only">
        At a glance
      </h2>
      <ul role="list" className={adminStyles.counts}>
        {RENEWALS_SHOW_FILTERS.map((filter) => {
          const count = counts[filter];
          const label = RENEWALS_SHOW_LABELS[filter];
          return (
            <li key={filter} className="min-w-0">
              <Link
                href={renewalsShowHref(filter)}
                aria-label={`${label}: ${count}`}
                className={adminStyles.countCard}
                data-testid={`admin-today-at-a-glance-${filter}`}
                data-zero={count === 0 ? "" : undefined}
              >
                <span aria-hidden="true" className={adminStyles.countFigure}>
                  {count}
                  <AdminStatusShape status={COUNT_STATUS[filter]} />
                </span>
                <span aria-hidden="true" className={adminStyles.countWord}>
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
