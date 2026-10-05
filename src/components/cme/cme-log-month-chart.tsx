import { focusRing } from "@/components/card-recipes";
import { formatLogHours, monthAnchorId, round2, type MonthGroup } from "@/components/cme/cme-log-shared";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { formatCalendarMonthLabel } from "@/lib/cme/cpd-year";

const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"] as const;

/** Bar drawing space. Heights are rects in this box, scaled to the column. */
const BAR_BOX = { width: 10, height: 100 } as const;
/** A logged month never shrinks below a visible sliver, however small next to the busiest month. */
const MIN_BAR = 12;

/**
 * Hours per month for the year shown, as twelve slim bars (J to D). Each bar is
 * as tall as that month's hours in the list below, so the bars add up to the
 * year total in the heading and agree with the month headers. A logged month
 * is a link to its section (the same in-page anchor the headers carry); an
 * empty month, and any month still to come, is a faint stub that is not
 * tappable but still reads "0 hours" to a screen reader. The current month's
 * bar is the one accent on the chart.
 */
export function CmeLogMonthChart({
  year,
  groups,
  today,
}: {
  year: number;
  groups: readonly MonthGroup[];
  today: string;
}) {
  const byKey = new Map(groups.map((group) => [group.key, group]));
  const max = Math.max(0, ...groups.map((group) => group.hours));
  const total = round2(groups.reduce((sum, group) => sum + group.hours, 0));
  const currentKey = today.slice(0, 7);
  return (
    <nav aria-label="Jump to month" data-testid="cme-log-month-strip">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className={eyebrowText}>Jump to month</h2>
        <p data-testid="cme-log-month-total" className="nums text-sm text-[color:var(--text-muted)]">
          {formatLogHours(total)} hours in {year}
        </p>
      </div>
      <ol className="grid grid-cols-12 gap-0.5">
        {MONTHS.map((month) => {
          const key = `${year}-${month}`;
          const group = byKey.get(key);
          const hours = group?.hours ?? 0;
          const name = formatCalendarMonthLabel(key).split(" ")[0] ?? key;
          const current = key === currentKey;
          const barHeight = max > 0 && hours > 0 ? Math.max(MIN_BAR, Math.round((hours / max) * BAR_BOX.height)) : 0;
          const face = (
            <>
              <span
                aria-hidden="true"
                className="nums h-4 text-2xs leading-4 text-[color:var(--text-muted)]"
                data-testid={`cme-log-month-hours-${key}`}
              >
                {hours > 0 ? formatLogHours(hours) : ""}
              </span>
              <svg
                aria-hidden="true"
                viewBox={`0 0 ${BAR_BOX.width} ${BAR_BOX.height}`}
                preserveAspectRatio="none"
                className="block h-12 w-full"
              >
                <rect
                  data-month-bar={key}
                  data-hours={hours}
                  x={2}
                  width={6}
                  y={BAR_BOX.height - Math.max(barHeight, 2)}
                  height={Math.max(barHeight, 2)}
                  className={
                    barHeight === 0
                      ? "fill-[color:var(--border)] forced-colors:fill-[GrayText]"
                      : current
                        ? "fill-[color:var(--clinical-accent)] forced-colors:fill-[CanvasText]"
                        : "fill-[color:var(--tone-indigo)] opacity-60 forced-colors:fill-[CanvasText]"
                  }
                />
              </svg>
              <span
                aria-hidden="true"
                className={cn(
                  "text-xs leading-4",
                  current ? "font-semibold text-[color:var(--clinical-accent)]" : "text-[color:var(--text-muted)]",
                )}
              >
                {name.charAt(0)}
              </span>
            </>
          );
          const hoursWord = hours === 1 ? "hour" : "hours";
          return (
            <li key={key} className="min-w-0">
              {group ? (
                <a
                  href={`#${monthAnchorId(key)}`}
                  aria-label={`${name}, ${formatLogHours(hours)} ${hoursWord}, jump to month`}
                  aria-current={current ? "date" : undefined}
                  data-testid={`cme-log-month-jump-${key}`}
                  className={cn(
                    focusRing,
                    "flex min-h-tap w-full flex-col items-center justify-end rounded-md pb-0.5 transition-colors duration-[var(--duration-instant)] hover:bg-[color:var(--surface-subtle)] active:bg-[color:var(--surface-wash)]",
                  )}
                >
                  {face}
                </a>
              ) : (
                <span className="flex min-h-tap w-full flex-col items-center justify-end pb-0.5">
                  {face}
                  <span className="sr-only">{`${name}, 0 hours`}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
