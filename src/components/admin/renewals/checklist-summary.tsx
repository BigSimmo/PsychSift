import { Diamond, Triangle } from "lucide-react";

import { AdminStatusWord } from "@/components/admin/admin-status-word";
import { requirementDateLine, requirementRowUrgency } from "@/components/admin/renewals/urgency";
import { focusRing } from "@/components/card-recipes";
import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import type { ComplianceBucket } from "@/lib/admin/compliance-overview";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import type { RequirementChecklistRow } from "@/lib/admin/requirements";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** `YYYY-MM-DD` -> its parts, as numbers (month 0-11). */
function dateParts(date: string): { year: number; month: number; day: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) - 1, day: Number(date.slice(8, 10)) };
}

/**
 * Where a date sits on the twelve-month track, in months from the first day
 * of today's month (fractional, so a date late in a month sits late in its
 * column). Clamped to the track: a date beyond the twelfth month sits at its
 * right edge rather than overflowing the chart.
 */
function trackOffset(date: string, today: string): number {
  const start = dateParts(today);
  const { year, month, day } = dateParts(date);
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const months = (year - start.year) * 12 + (month - start.month) + (day - 1) / daysInMonth;
  return Math.min(Math.max(months, 0), 11.96);
}

const percent = (offset: number) => `${(offset / 12) * 100}%`;

/**
 * The twelve-month timeline (final design, screens-v3): one row per item due
 * for action — its full name on its own line, then a track with a mark at its
 * expiry (a filled triangle for a row still open to renew, a filled diamond
 * for one already passed) and a line at today. Three-letter months run under
 * the tracks; on a phone every other month is labelled so they never collide.
 *
 * The drawing is decorative to assistive technology: a plain list beside it
 * says the same thing in words (name, recorded date, status word).
 *
 * Shown for at most the five soonest rows with a usable date, so the chart
 * never grows taller than the list below it; the list itself carries the
 * full count.
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
  const dated = rows.filter((row): row is RequirementChecklistRow & { expiresOn: string } => Boolean(row.expiresOn));
  if (dated.length === 0) return null;
  const items = dated.slice(0, 5);
  const startMonth = dateParts(today).month;
  const monthLabels = Array.from({ length: 12 }, (_, offset) => MONTH_NAMES[(startMonth + offset) % 12]);
  const todayLeft = percent(trackOffset(today, today));
  return (
    <div data-testid={testId} className="grid gap-3 border-t border-[color:var(--border)] pt-3">
      <ul className="sr-only" aria-label="Coming up in the next twelve months">
        {items.map((row) => (
          <li key={row.item.id}>
            {`${row.item.title}: ${requirementDateLine(row.expiresOn, now) ?? row.expiresOn} · ${requirementRowUrgency(row, now).word}`}
          </li>
        ))}
      </ul>
      <div aria-hidden="true" className="grid gap-3">
        <div className="grid gap-2.5">
          {items.map((row) => {
            const passed = row.expiresOn < today;
            const Mark = passed ? Diamond : Triangle;
            return (
              <div key={row.item.id} className="grid min-w-0 gap-1">
                <span className="break-words text-xs leading-4 text-[color:var(--text)]">{row.item.title}</span>
                <span className="relative block h-4">
                  <span className="absolute inset-x-0 top-1/2 h-px bg-[color:var(--border)]" />
                  <span
                    className="absolute inset-y-0 w-px bg-[color:var(--clinical-accent)]"
                    style={{ left: todayLeft }}
                    data-today-line="true"
                  />
                  {/* Shape, not shade (M8): a triangle still open to renew, a
                      diamond already passed — the same shapes the list's status
                      words carry, so the mark never depends on colour alone. */}
                  <Mark
                    aria-hidden="true"
                    data-mark={passed ? "diamond" : "triangle"}
                    strokeWidth={1.75}
                    className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 fill-current text-[color:var(--text-muted)]"
                    style={{ left: percent(trackOffset(row.expiresOn, today)) }}
                  />
                </span>
              </div>
            );
          })}
        </div>
        <span
          className={cn(textMuted, "grid grid-cols-12 text-xs")}
          data-testid={testId ? `${testId}-months` : undefined}
        >
          {monthLabels.map((name, index) => (
            // Every other month is left unlabelled on a phone, keeping its column.
            <span key={index} className={cn("whitespace-nowrap", index % 2 === 1 && "max-sm:invisible")}>
              {name}
            </span>
          ))}
        </span>
        <span className={cn(textMuted, "flex flex-wrap items-center gap-x-4 gap-y-1 text-xs")}>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-px bg-[color:var(--clinical-accent)]" />
            Today
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Triangle aria-hidden="true" strokeWidth={1.75} className="size-3 fill-current" />
            Expiry ahead
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Diamond aria-hidden="true" strokeWidth={1.75} className="size-3 fill-current" />
            Expiry passed
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * The count module at the top of the Checklist tab: "7 of 10 recorded · 1 not
 * for this job", "Dates you entered, not a check", then the timeline above.
 * The count is in words, never a percentage or a verdict (spec rule 10).
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
    <div className={cn(modeModuleSurface, "grid min-w-0 gap-3 p-3")} data-testid={testId}>
      <div className="grid gap-0.5">
        <p className="text-base-minus font-medium text-[color:var(--text-heading)]">
          {`${recorded} of ${total} recorded`}
          {notForThisJob > 0 ? (
            <span className={cn(textMuted, "font-normal")}>{` · ${notForThisJob} not for this job`}</span>
          ) : null}
        </p>
        <p className={cn(textMuted, "text-xs")}>Dates you entered, not a check</p>
      </div>
      <ChecklistTimeline rows={soonest} now={now} testId={testId ? `${testId}-timeline` : undefined} />
    </div>
  );
}

/** The at-a-glance rows, most urgent first, as the mock-up orders them. */
const GLANCE_ORDER: readonly ComplianceBucket[] = ["date-passed", "start-renewing", "not-recorded", "recorded"];

/**
 * The count module at the top of the Checklist tab (5 Oct mock-up v2, screen
 * 1): "At a glance · N items", four count rows with a shape and a word that
 * filter the list below, then the twelve-month timeline. Counts in words,
 * never a percentage or a verdict (spec rule 10), from the same buckets
 * Compliance counts with, so the two pages cannot disagree.
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
    <div className={cn(modeModuleSurface, "grid min-w-0 gap-3 p-3")} data-testid={testId}>
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 className={eyebrowText}>{`At a glance · ${total} items`}</h2>
        {notForThisJob > 0 ? (
          <span className={cn(textMuted, "text-xs")}>{`${notForThisJob} not for this job`}</span>
        ) : null}
      </div>
      <ul role="list" className="grid min-w-0 gap-0.5" aria-label="Filter the list">
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
                className={cn(
                  focusRing,
                  "flex min-h-12 w-full min-w-0 items-center gap-3 rounded-lg px-2 text-left disabled:cursor-default",
                  on ? "bg-[color:var(--surface-wash)]" : "enabled:hover:bg-[color:var(--surface-subtle)]",
                )}
              >
                <span className="w-8 shrink-0 text-right text-lg font-semibold tabular-nums text-[color:var(--text-heading)]">
                  {count}
                </span>
                <AdminStatusWord bucket={bucket} className="font-normal" />
              </button>
            </li>
          );
        })}
      </ul>
      <p className={cn(textMuted, "px-2 text-xs")}>Dates you entered, not a check</p>
      <ChecklistTimeline rows={soonest} now={now} testId={testId ? `${testId}-timeline` : undefined} />
    </div>
  );
}
