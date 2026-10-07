import { Diamond, Triangle } from "lucide-react";

import { adminStyles } from "@/components/admin/admin-kit";
import { AdminStatusShape, adminStatusColour } from "@/components/admin/admin-status-tag";
import { requirementDateLine, requirementRowUrgency, shortDateFrom } from "@/components/admin/renewals/urgency";
import { WorkCard } from "@/components/mode-kit/work";
import { cn } from "@/components/ui-primitives";
import { COMPLIANCE_BUCKET_LABELS, type ComplianceBucket } from "@/lib/admin/compliance-overview";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import type { RequirementChecklistRow } from "@/lib/admin/requirements";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTH_WORDS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** `YYYY-MM-DD` -> its parts, as numbers (month 0-11). */
function dateParts(date: string): { year: number; month: number; day: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) - 1, day: Number(date.slice(8, 10)) };
}

/** Where a date sits on the twelve-month track, clamped to it. */
function trackOffset(date: string, today: string): number {
  return Math.min(Math.max(monthsFromToday(date, today), 0), 11.96);
}

/** Unclamped months from the first day of today's month. */
function monthsFromToday(date: string, today: string): number {
  const start = dateParts(today);
  const { year, month, day } = dateParts(date);
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return (year - start.year) * 12 + (month - start.month) + (day - 1) / daysInMonth;
}

/** The most rows the chart draws: the soonest ten, as the mockup shows. */
const TIMELINE_ROWS = 10;

const percent = (offset: number) => `${((offset / 12) * 100).toFixed(2)}%`;

/**
 * "Next 12 months" (Josh's locked mockup, work-mode redesign 6 Oct 2026): one
 * row per item due for action, its name and date at the left and a track at
 * the right with a mark at its date (a diamond once passed, a triangle while
 * still ahead) in its status colour, a line at today in the mode colour, and
 * month initials under the tracks.
 *
 * The drawing is decorative to assistive technology: a plain list beside it
 * says the same thing in words (name, recorded date, status word). Positions
 * are SVG attributes, so the chart needs no inline style.
 */
function ChecklistTimeline({
  rows,
  now,
  testId,
}: {
  readonly rows: readonly RequirementChecklistRow[];
  readonly now: Date;
  readonly testId?: string;
}) {
  const today = perthCalendarDate(now);
  // The soonest rows inside the twelve months the chart draws. A date further
  // out is left off rather than pinned to the right edge, where it would read
  // as due within the year.
  const dated = rows
    .filter((row): row is RequirementChecklistRow & { expiresOn: string } => Boolean(row.expiresOn))
    .filter((row) => monthsFromToday(row.expiresOn, today) < 12)
    .sort((a, b) => (a.expiresOn === b.expiresOn ? 0 : a.expiresOn < b.expiresOn ? -1 : 1));
  if (dated.length === 0) return null;
  const items = dated.slice(0, TIMELINE_ROWS);
  const startMonth = dateParts(today).month;
  const months = Array.from({ length: 12 }, (_, offset) => (startMonth + offset) % 12);
  const todayAt = percent(trackOffset(today, today));
  return (
    <div data-testid={testId} className={adminStyles.timeline}>
      <p className="work-label m-0">Next 12 months</p>
      <ul className="sr-only" aria-label="Coming up in the next twelve months">
        {items.map((row) => (
          <li key={row.item.id}>
            {`${row.item.title}: ${requirementDateLine(row.expiresOn, now) ?? row.expiresOn} · ${requirementRowUrgency(row, now).word}`}
          </li>
        ))}
      </ul>
      <div aria-hidden="true" className="grid gap-2">
        <div className={adminStyles.tlRows}>
          {items.map((row) => {
            const passed = row.expiresOn < today;
            const Mark = passed ? Diamond : Triangle;
            return (
              <div key={row.item.id} className={adminStyles.tlRow}>
                <span className={adminStyles.tlName}>
                  <span>{row.item.title}</span>
                  {` · ${passed ? "passed" : shortDateFrom(row.expiresOn, today)}`}
                </span>
                <svg className={adminStyles.tlTrack} width="100%" height="15" overflow="visible">
                  <line x1="0" x2="100%" y1="7.5" y2="7.5" className={adminStyles.tlTrackLine} />
                  <line
                    x1={todayAt}
                    x2={todayAt}
                    y1="-2"
                    y2="17"
                    className={adminStyles.tlTodayLine}
                    data-today-line="true"
                  />
                  {/* Shape and colour together (M8): a triangle still ahead, a
                      diamond already passed, the same shapes the list's tags carry. */}
                  <svg x={percent(trackOffset(row.expiresOn, today))} y="0" overflow="visible">
                    <Mark
                      x={-4.5}
                      y={3}
                      width={9}
                      height={9}
                      aria-hidden="true"
                      data-mark={passed ? "diamond" : "triangle"}
                      strokeWidth={2}
                      {...adminStatusColour(passed ? "date-passed" : "start-renewing")}
                      fill="currentColor"
                    />
                  </svg>
                </svg>
              </div>
            );
          })}
        </div>
        <div className={adminStyles.tlAxis}>
          <span />
          <span className={adminStyles.tlAxisMonths} data-testid={testId ? `${testId}-months` : undefined}>
            {months.map((month, index) => (
              <span key={index} title={MONTH_WORDS[month]}>
                {MONTH_NAMES[month].charAt(0)}
              </span>
            ))}
          </span>
        </div>
        <span className={adminStyles.tlLegend}>
          <span>
            <span className={adminStyles.tlLegendToday} />
            Today
          </span>
          <span>
            <AdminStatusShape status="start-renewing" />
            Renew by date ahead
          </span>
          <span>
            <AdminStatusShape status="date-passed" />
            Date passed
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * The count module My Day shows on Me: "7 of 10 recorded · 1 not for this
 * job", "Dates you entered, not a check", then the timeline. The count is in
 * words, never a percentage or a verdict (spec rule 10).
 */
export function ChecklistSummary({
  rows,
  recorded,
  total,
  notForThisJob,
  now,
  testId,
}: {
  readonly rows: readonly RequirementChecklistRow[];
  readonly recorded: number;
  readonly total: number;
  readonly notForThisJob: number;
  readonly now: Date;
  readonly testId?: string;
}) {
  const soonest = rows.filter((row) => row.state === "needs-action");
  return (
    <WorkCard padded testId={testId}>
      <p className="work-row__title m-0">
        {`${recorded} of ${total} recorded`}
        {notForThisJob > 0 ? <span className="work-row__sub">{` · ${notForThisJob} not for this job`}</span> : null}
      </p>
      <p className="work-row__sub m-0">Dates you entered, not a check</p>
      <ChecklistTimeline rows={soonest} now={now} testId={testId ? `${testId}-timeline` : undefined} />
    </WorkCard>
  );
}

/** The at-a-glance rows, most urgent first, as the mockup orders them. */
const GLANCE_ORDER: readonly ComplianceBucket[] = ["date-passed", "start-renewing", "not-recorded", "recorded"];

/**
 * The count card at the top of the Checklist tab (Josh's locked mockup):
 * "At a glance · N items", four count rows (figure, shape, word) that filter
 * the list below, a Clear link while one is chosen, then "Next 12 months".
 * Counts come from the same buckets Compliance counts with, so the two pages
 * cannot disagree.
 */
export function ChecklistAtAGlance({
  rows,
  counts,
  total,
  notForThisJob,
  now,
  active,
  onFilter,
  testId,
}: {
  readonly rows: readonly RequirementChecklistRow[];
  readonly counts: Readonly<Record<ComplianceBucket, number>>;
  readonly total: number;
  readonly notForThisJob: number;
  readonly now: Date;
  readonly active: ComplianceBucket | null;
  readonly onFilter: (bucket: ComplianceBucket | null) => void;
  readonly testId?: string;
}) {
  const soonest = rows.filter((row) => row.state === "needs-action");
  return (
    <WorkCard padded testId={testId}>
      <div className={adminStyles.glanceHead}>
        <h2 className="work-label m-0">{`At a glance · ${total} items`}</h2>
        {active ? (
          <button
            type="button"
            className="work-label__link"
            onClick={() => onFilter(null)}
            data-testid={testId ? `${testId}-clear` : undefined}
          >
            Clear
          </button>
        ) : notForThisJob > 0 ? (
          <span className="work-label__count">{`${notForThisJob} not for this job`}</span>
        ) : null}
      </div>
      <ul className={adminStyles.glance} aria-label="Filter the list">
        {GLANCE_ORDER.map((bucket) => {
          const count = counts[bucket];
          const on = active === bucket;
          return (
            <li key={bucket}>
              <button
                type="button"
                aria-pressed={on}
                disabled={count === 0 && !on}
                onClick={() => onFilter(on ? null : bucket)}
                data-testid={testId ? `${testId}-count-${bucket}` : undefined}
                className={adminStyles.glanceRow}
              >
                <span className={adminStyles.glanceFigure}>{count}</span>
                <AdminStatusShape status={bucket} />
                <span className={cn(count === 0 && "text-[color:var(--text-muted)]")}>
                  {COMPLIANCE_BUCKET_LABELS[bucket]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {/* Above the list on purpose: a clinical-governance review rejected a design that implied the app had checked these dates. */}
      <p className="work-row__sub m-0">Dates you entered, not a check</p>
      <ChecklistTimeline rows={soonest} now={now} testId={testId ? `${testId}-timeline` : undefined} />
    </WorkCard>
  );
}
