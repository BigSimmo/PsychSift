import { Check, ExternalLink } from "lucide-react";
import Link from "next/link";

import { adminStyles } from "@/components/admin/admin-kit";
import { ADMIN_PAGE_HREFS } from "@/components/admin/admin-page-sections";
import { AdminWindow } from "@/components/admin/renewals/window-bar";
import { WorkHero } from "@/components/mode-kit/work";
import type { RenewalsShowFilter } from "@/lib/admin/renewals-filters";
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
 * The hero's answer: what has passed and what is due, in Admin's own count words.
 * Null when neither has anything, so the hero keeps naming the next item.
 */
function renewalsAnswer(counts: Record<RenewalsShowFilter, number>): string | null {
  const parts = [
    counts["date-passed"] > 0 ? `${counts["date-passed"]} date passed` : null,
    counts["due-90"] > 0 ? `${counts["due-90"]} due in 90 days` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
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
  counts,
}: {
  item: RenewNextItem;
  ownEntries: readonly OnCallEntry[];
  today: string;
  /**
   * Admin Today passes the renewal counts so the hero title answers the page
   * ("1 date passed, 4 due in 90 days", the same words as the counts) and the item becomes the line under it
   * (Ward Flow review, owner approved 12 Oct 2026). The same counts drive
   * Coming up, so the title and the list cannot disagree. My Day leaves this
   * out and keeps the item as the title.
   */
  counts?: Record<RenewalsShowFilter, number>;
}) {
  const relative = formatRelativeDate(item.date, today);
  const dateLine =
    item.state === "passed"
      ? `Date passed ${formatDateEcho(item.date, today)} · ${relative}`
      : item.kind === "new-job"
        ? `Starts ${formatDateEcho(item.date, today)} · ${relative}`
        : `Renew by ${formatDateEcho(item.date, today)} · ${relative}`;

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
  const answer = counts && item.kind === "compliance" ? renewalsAnswer(counts) : null;

  return (
    <WorkHero
      testId="admin-today-renew-next"
      aria-label={item.kind === "new-job" ? "New job starts" : "Renew next"}
      eyebrow={answer ? "Renewals" : item.kind === "new-job" ? "New job starts" : "Renew next"}
      title={answer ?? item.title}
      sub={<span className="tabular-nums">{answer ? `Next: ${item.title} · ${dateLine}` : dateLine}</span>}
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
