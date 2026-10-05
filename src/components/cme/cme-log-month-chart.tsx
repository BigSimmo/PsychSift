import { focusRing } from "@/components/card-recipes";
import { CmeGroupLabel } from "@/components/cme/cme-flat-list";
import { formatHoursShort, monthAnchorId, round2, type MonthGroup } from "@/components/cme/cme-log-shared";
import { cn } from "@/components/ui-primitives";
import { formatCalendarMonthLabel } from "@/lib/cme/cpd-year";

const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"] as const;

/** A logged month never shrinks below a visible sliver, however small next to the busiest month (percent of the bar box). */
const MIN_BAR = 4;

/**
 * Hours per month for the year shown, as twelve slim bars (J to D), mock-up
 * screen 02: every bar grey, the current month's bar the one indigo mark, and
 * months still to come a dashed baseline with no figure. Each bar is as tall as
 * that month's hours in the list below, so the figures add up to the total at
 * the right of the label and agree with the month headers. A logged month is a
 * link to its section (the in-page anchor the headers carry); an empty or
 * future month is not tappable but still reads its hours to a screen reader.
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
    <nav aria-label="Jump to month" data-testid="cme-log-month-strip" className="grid gap-2">
      <CmeGroupLabel
        label="Hours by month · tap to jump"
        end={
          <p
            data-testid="cme-log-month-total"
            className="nums text-sm-minus font-normal text-[color:var(--text-heading)]"
          >
            <span aria-hidden="true">{`${formatHoursShort(total)}\u00a0h`}</span>
            <span className="sr-only">{`${formatHoursShort(total)} hours in ${year}`}</span>
          </p>
        }
      />
      <ol className="grid grid-cols-12 gap-0.5">
        {MONTHS.map((month) => {
          const key = `${year}-${month}`;
          const group = byKey.get(key);
          const hours = group?.hours ?? 0;
          const name = formatCalendarMonthLabel(key).split(" ")[0] ?? key;
          const current = key === currentKey;
          const future = key > currentKey;
          const barPercent = max > 0 && hours > 0 ? Math.max(MIN_BAR, Math.round((hours / max) * 100)) : 0;
          const face = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "nums h-4 text-2xs leading-4",
                  current ? "font-normal text-[color:var(--text-heading)]" : "text-[color:var(--text-muted)]",
                )}
                data-testid={`cme-log-month-hours-${key}`}
              >
                {future ? "" : formatHoursShort(hours)}
              </span>
              <span aria-hidden="true" className="flex h-10 w-full items-end justify-center">
                <span
                  data-month-bar={key}
                  data-hours={hours}
                  style={future ? undefined : { height: `${barPercent}%` }}
                  className={cn(
                    "block w-3 forced-colors:bg-[CanvasText]",
                    future
                      ? "h-0 border-b border-dashed border-[color:var(--border-strong)]"
                      : current
                        ? "min-h-0.5 rounded-t-[2px] bg-[color:var(--clinical-accent)]"
                        : "min-h-0.5 rounded-t-[2px] bg-[color:var(--border-strong)]",
                  )}
                />
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "text-2xs leading-4",
                  current ? "font-normal text-[color:var(--text-heading)]" : "text-[color:var(--text-muted)]",
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
                  aria-label={`${name}, ${formatHoursShort(hours)} ${hoursWord}, jump to month`}
                  aria-current={current ? "date" : undefined}
                  data-testid={`cme-log-month-jump-${key}`}
                  className={cn(
                    focusRing,
                    "flex min-h-tap w-full flex-col items-center justify-end gap-0.5 rounded-md pb-0.5 transition-colors duration-[var(--duration-instant)] hover:bg-[color:var(--surface-subtle)] active:bg-[color:var(--surface-wash)]",
                  )}
                >
                  {face}
                </a>
              ) : (
                <span className="flex min-h-tap w-full flex-col items-center justify-end gap-0.5 pb-0.5">
                  {face}
                  <span className="sr-only">{future ? `${name}, still to come` : `${name}, 0 hours`}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
