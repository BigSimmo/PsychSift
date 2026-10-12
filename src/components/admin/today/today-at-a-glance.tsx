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

/** The tally's short words: the Coming up card already says these are dates. */
const TALLY_WORDS: Record<RenewalsShowFilter, string> = {
  "date-passed": "Passed",
  "due-90": "In 90 days",
  "not-recorded": "Not recorded",
};

/**
 * The three counts as one hairline strip at the top of the Coming up card
 * (12 Oct 2026 simplify plan: Admin Today showed the same dates four ways; the
 * three count cards folded into Coming up). Each third keeps its status shape
 * and opens Renewals already filtered to the rows it counted. The counts come
 * from `renewalsShowCounts`, the same function Renewals filters through, so a
 * number and its list cannot disagree. A zero still shows (an absent count
 * would read as "not checked"), just quieter.
 */
export function TodayAtAGlance({ counts }: { counts: Record<RenewalsShowFilter, number> }) {
  return (
    <ul role="list" aria-label="At a glance" className={adminStyles.tally} data-testid="admin-today-at-a-glance">
      {RENEWALS_SHOW_FILTERS.map((filter) => {
        const count = counts[filter];
        const label = RENEWALS_SHOW_LABELS[filter];
        return (
          <li key={filter} className="min-w-0">
            <Link
              href={renewalsShowHref(filter)}
              aria-label={`${label}: ${count}`}
              className={adminStyles.tallyItem}
              data-testid={`admin-today-at-a-glance-${filter}`}
              data-zero={count === 0 ? "" : undefined}
            >
              <span aria-hidden="true" className={adminStyles.tallyFigure}>
                {count}
                <AdminStatusShape status={COUNT_STATUS[filter]} />
              </span>
              <span aria-hidden="true" className={adminStyles.tallyWord}>
                {TALLY_WORDS[filter]}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
