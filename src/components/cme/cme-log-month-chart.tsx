import { focusRing } from "@/components/card-recipes";
import { CmeGroupLabel } from "@/components/cme/cme-flat-list";
import { formatHoursShort, monthAnchorId, round2, type MonthGroup } from "@/components/cme/cme-log-shared";
import { cn } from "@/components/ui-primitives";
import { formatCalendarMonthLabel } from "@/lib/cme/cpd-year";

const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"] as const;

/** A logged month never shrinks below a visible sliver, however small next to the busiest month (percent of the bar box). */
const MIN_BAR = 4;

/**
 * Hours per month for the year shown (work-mode redesign, owner request 6 Oct
 * 2026, mock-up cpd_log): a card of twelve bars over their letters, past months
 * a pale copper wash, the current month a copper gradient, months still to come
 * a dashed outline at a fixed height. Each bar is as tall as that month's hours
 * in the list below, so the bars add up to the total at the right of the label
 * and agree with the month headers. A logged month is a link to its section
 * (the in-page anchor the headers carry); an empty or future month is not
 * tappable but still reads its hours to a screen reader.
 */
export function CmeLogMonthChart({
  year,
  groups,
  today,
  filtered = false,
}: {
  year: number;
  groups: readonly MonthGroup[];
  today: string;
  /** A search, category or attention filter is on, so the bars and total cover only what matches. */
  filtered?: boolean;
}) {
  const byKey = new Map(groups.map((group) => [group.key, group]));
  const max = Math.max(0, ...groups.map((group) => group.hours));
  const total = round2(groups.reduce((sum, group) => sum + group.hours, 0));
  const currentKey = today.slice(0, 7);
  return (
    <nav aria-label="Jump to month" data-testid="cme-log-month-strip" className="work-card work-card--pad">
      <CmeGroupLabel
        label="Hours by month · tap to jump"
        end={
          <p data-testid="cme-log-month-total" className="nums m-0 font-normal normal-case tracking-normal">
            <span aria-hidden="true">{`${formatHoursShort(total)}\u00a0h`}</span>
            <span className="sr-only">
              {`${formatHoursShort(total)} hours in ${year}${filtered ? ", matching your filters" : ""}`}
            </span>
          </p>
        }
      />
      <ol className="cpd-months">
        {MONTHS.map((month) => {
          const key = `${year}-${month}`;
          const group = byKey.get(key);
          const hours = group?.hours ?? 0;
          const name = formatCalendarMonthLabel(key).split(" ")[0] ?? key;
          const current = key === currentKey;
          // A later month is drawn as a placeholder only while nothing is recorded in it.
          const future = key > currentKey && !group;
          const barPercent = max > 0 && hours > 0 ? Math.max(MIN_BAR, Math.round((hours / max) * 100)) : 0;
          const face = (
            <>
              {/* The month's figure, kept in the page for its total but not drawn: the mock-up shows bars only. */}
              <span aria-hidden="true" hidden data-testid={`cme-log-month-hours-${key}`}>
                {future ? "" : formatHoursShort(hours)}
              </span>
              <span aria-hidden="true" className="cpd-months__box">
                <i
                  data-month-bar={key}
                  data-hours={hours}
                  data-current={current ? "" : undefined}
                  data-future={future ? "" : undefined}
                  style={future ? undefined : { height: `${barPercent}%` }}
                />
              </span>
              <span aria-hidden="true" className="cpd-months__letter" data-current={current ? "" : undefined}>
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
                  className={cn(focusRing, "cpd-months__col min-h-tap")}
                >
                  {face}
                </a>
              ) : (
                <span className="cpd-months__col">
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
