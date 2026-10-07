import { Check, ExternalLink } from "lucide-react";
import Link from "next/link";

import { adminStyles } from "@/components/admin/admin-kit";
import { ADMIN_PAGE_HREFS } from "@/components/admin/admin-page-sections";
import { AdminWindow } from "@/components/admin/renewals/window-bar";
import { WorkHero } from "@/components/mode-kit/work";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { ADMIN_REQUIREMENTS_CATALOGUE, requirementChecklistRows } from "@/lib/admin/requirements";
import { formatDateEcho, formatRelativeDate } from "@/lib/admin/renewal-dates";
import type { RenewNextItem } from "@/lib/admin/today-selectors";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { onCallTeachingDateParts } from "@/lib/on-call/teaching-schedule";

/** The catalogue source that explains how to renew this entry, if it matches one. */
function howToRenewUrl(entry: OnCallEntry, ownEntries: readonly OnCallEntry[]): string | undefined {
  const row = requirementChecklistRows(ADMIN_REQUIREMENTS_CATALOGUE, ownEntries).find((r) => r.entry?.id === entry.id);
  return row?.item.sourceUrl;
}

const DAY_MS = 86_400_000;

function dayIndex(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS;
}

/** "16 Sep": day and short month, the window's own two end labels. */
function shortDate(date: string): string {
  const { day, month } = onCallTeachingDateParts(date);
  return day && month ? `${day} ${month}` : date;
}

/** Where today sits in the window, 0 at the day renewing opens and 1 at the date. */
function windowShare(start: string, end: string, today: string): number {
  const span = dayIndex(end) - dayIndex(start);
  const raw = span > 0 ? (dayIndex(today) - dayIndex(start)) / span : 1;
  return Math.max(0, Math.min(1, raw));
}

/**
 * "Renew next": Today's one hero card, in Admin's slate (work-mode redesign,
 * owner request 6 Oct 2026). The item's name, its recorded date in words, the
 * renewal window with today marked, then "How to renew" and "Renewed". Nothing
 * renders when there is nothing to renew (the caller decides that).
 */
export function TodayRenewNextCard({
  item,
  ownEntries,
  today,
}: {
  item: RenewNextItem;
  ownEntries: readonly OnCallEntry[];
  today: string;
}) {
  const relative = formatRelativeDate(item.date, today);
  const dateLine =
    item.state === "passed"
      ? `Date passed ${formatDateEcho(item.date)} · ${relative}`
      : item.kind === "new-job"
        ? `Starts ${formatDateEcho(item.date)} · ${relative}`
        : `Renew by ${formatDateEcho(item.date)} · ${relative}`;

  const renewedHref =
    item.kind === "compliance" && item.entry
      ? `${ADMIN_PAGE_HREFS.renewals}#${onCallEntryAnchorId(item.entry.id)}`
      : ADMIN_PAGE_HREFS.newJob;
  const howToRenewHref =
    item.kind === "compliance" && item.entry
      ? (howToRenewUrl(item.entry, ownEntries) ?? renewedHref)
      : ADMIN_PAGE_HREFS.newJob;
  const howToRenewIsExternal = howToRenewHref.startsWith("http");
  const hasWindow = item.kind === "compliance" && item.windowStart && item.windowEnd;

  return (
    <WorkHero
      testId="admin-today-renew-next"
      aria-label={item.kind === "new-job" ? "New job starts" : "Renew next"}
      eyebrow={item.kind === "new-job" ? "New job starts" : "Renew next"}
      title={item.title}
      sub={<span className="tabular-nums">{dateLine}</span>}
      footer={
        <div className="grid gap-3">
          {hasWindow && item.windowStart && item.windowEnd ? (
            <AdminWindow
              onHero
              progress={windowShare(item.windowStart, item.windowEnd, today)}
              start={`${item.windowStart <= today ? "Opened" : "Opens"} ${shortDate(item.windowStart)}`}
              end={item.state === "passed" ? `Passed ${shortDate(item.windowEnd)}` : shortDate(item.windowEnd)}
              testId="admin-today-renew-next-window"
            />
          ) : null}
          <div className={adminStyles.heroButtons}>
            {item.kind === "new-job" ? (
              <Link
                href={ADMIN_PAGE_HREFS.newJob}
                className={adminStyles.heroButton}
                data-solid=""
                data-testid="admin-today-renew-next-new-job"
              >
                Open New job
              </Link>
            ) : (
              <>
                {howToRenewIsExternal ? (
                  <a
                    href={howToRenewHref}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={adminStyles.heroButton}
                    data-testid="admin-today-renew-next-how"
                  >
                    <ExternalLink aria-hidden="true" strokeWidth={2} />
                    How to renew
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <Link
                    href={howToRenewHref}
                    className={adminStyles.heroButton}
                    data-testid="admin-today-renew-next-how"
                  >
                    <ExternalLink aria-hidden="true" strokeWidth={2} />
                    How to renew
                  </Link>
                )}
                <Link
                  href={renewedHref}
                  className={adminStyles.heroButton}
                  data-solid=""
                  data-testid="admin-today-renew-next-renewed"
                >
                  <Check aria-hidden="true" strokeWidth={2} />
                  Renewed
                </Link>
              </>
            )}
          </div>
        </div>
      }
    />
  );
}
