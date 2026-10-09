"use client";

import type { ReactNode } from "react";

import { modeSummarySurface } from "@/components/mode-kit/recipes";
import { modeDisplayNumberText } from "@/components/mode-kit/type";
import { cn } from "@/components/ui-primitives";
import { formatCalendarDateShort } from "@/lib/cme/cpd-year";
import { buildCmeWeekBars, cmeSeasonLine, cmeTargetReachedOn, cmeWeeklyPace } from "@/lib/cme/pace";
import type { CmeEntry } from "@/lib/cme/types";

/**
 * TODAY'S HERO SUMMARY: mode design standard module 8, used once in CPD.
 *
 * Four lines, each readable in two seconds:
 *   1. the season and the year's end ("Last quarter · year ends 31 Dec 2026, in 13 weeks");
 *   2. hours logged against the target ("32.5 of 50 h"), the page's one
 *      40 px figure at weight 300;
 *   3. 53 seven-day bars from 1 January, showing when hours were logged;
 *   4. the pace line ("About 1.3 h a week reaches 50 h by 31 Dec"; in the last
 *      six days "17.5 h to go by 31 Dec"; none once the year is closed), or,
 *      once the target is reached, the day it was reached ("50 h reached on 12 Nov").
 *
 * The panel is dark in both themes through the shared `--surface-summary*`
 * tokens: the command fill in light mode, `--surface-lux` with a hairline in
 * dark mode. Earlier weeks use the hero's indigo graphic token and this week
 * uses product blue. Screen readers get a short summary of the chart.
 */

export type CmeHeroSummaryProps = {
  readonly year: number;
  /** Perth calendar date, `YYYY-MM-DD`. */
  readonly today: string;
  /** Hours logged this year, archived activities excluded (`evaluateYear`'s `totalHours`). */
  readonly loggedHours: number;
  readonly targetHours: number;
  /** The year's activities, for the day the target was reached. */
  readonly entries: readonly CmeEntry[];
  /** The year is closed (`set.closedAt`): no pace line, since nothing more is asked of it. */
  readonly closed?: boolean;
  /** When given, the whole panel is one button that opens the hours detail. */
  readonly onOpenDetail?: () => void;
};

/** The kit's dark summary panel at the 16 px panel radius (spec §7.1, standard module 8). */
const PANEL = cn(modeSummarySurface, "rounded-xl");

/** The one display figure: 40 px at 300 (the kit's recipe). */
const FIGURE = cn(modeDisplayNumberText, "text-display text-[color:var(--surface-summary-ink)]");

/** "32.5", "50", "0": never "32.50". */
function formatHours(hours: number): string {
  return Number(hours.toFixed(2)).toString();
}

function paceLine({ year, today, loggedHours, targetHours, entries, closed }: CmeHeroSummaryProps): string | null {
  if (targetHours > 0 && loggedHours >= targetHours) {
    const reachedOn = cmeTargetReachedOn(
      entries.filter((entry) => entry.date.startsWith(`${year}-`)),
      targetHours,
    );
    return reachedOn ? `${formatHours(targetHours)} h reached on ${formatCalendarDateShort(reachedOn)}` : null;
  }
  // A closed year asks nothing more of the doctor, so it shows no pace.
  if (closed) return null;
  const pace = cmeWeeklyPace({ targetHours, loggedHours, today, year });
  if (!pace) return null;
  // Fewer than 7 days left (from 25 Dec): a weekly figure would overstate it ("About 17.5 h a week"
  // on 31 Dec), so say what is left instead.
  if (pace.weeksLeft < 1) return `${formatHours(targetHours - loggedHours)} h to go by 31 Dec`;
  return `About ${pace.weeklyHours.toFixed(1)} h a week reaches ${formatHours(targetHours)} h by 31 Dec`;
}

// Literal classes (4 px steps up to 32 px) so bar heights need no inline style.
const WEEK_BAR_HEIGHTS = ["h-[3px]", "h-1", "h-2", "h-3", "h-4", "h-5", "h-6", "h-7", "h-8"] as const;

function weekBarHeightClass(hours: number, tallest: number): string {
  if (!(hours > 0) || !(tallest > 0)) return WEEK_BAR_HEIGHTS[0];
  const step = Math.round((Math.min(hours, tallest) / tallest) * 8);
  return WEEK_BAR_HEIGHTS[Math.max(1, step)];
}

export function CmeHeroSummary(props: CmeHeroSummaryProps) {
  const { year, today, loggedHours, targetHours, onOpenDetail } = props;
  const weeks = buildCmeWeekBars(props.entries, year, today);
  const tallest = Math.max(1, ...weeks.map(({ hours }) => hours));
  const weeksLeft = weeks.filter(({ state }) => state === "future").length;
  const pace = paceLine(props);

  // Spans, not paragraphs: the same lines sit inside a <button> when the panel opens the detail.
  const body: ReactNode = (
    <>
      <span data-testid="cme-hero-season" className="block text-sm text-[color:var(--surface-summary-muted)]">
        {cmeSeasonLine({ year, today })}
      </span>
      <span data-testid="cme-total-hours" className="mt-1 block">
        <span className={FIGURE}>{formatHours(loggedHours)}</span>
        <span className="text-base-minus text-[color:var(--surface-summary-muted)]">{` of ${formatHours(targetHours)} h`}</span>
      </span>
      <span className="sr-only">
        Hours logged in each week of {year}, with {weeksLeft} weeks to go.
      </span>
      <span data-testid="cme-hero-bar" aria-hidden="true" className="mt-3 flex h-8 items-end gap-px">
        {weeks.map(({ index, hours, state }) => (
          <span
            key={index}
            data-testid="cme-week-bar"
            data-state={state}
            data-hours={hours}
            className={cn(
              "min-w-0 flex-1 rounded-t-sm forced-colors:bg-[CanvasText]",
              weekBarHeightClass(state === "future" ? 0 : hours, tallest),
              state === "future"
                ? "bg-[color:var(--surface-summary-line)]"
                : state === "now"
                  ? "bg-[color:var(--clinical-accent)]"
                  : "bg-[color:var(--cme-hero-fill)]",
            )}
          />
        ))}
      </span>
      {pace ? (
        <span data-testid="cme-pace-sentence" className="mt-3 block text-sm">
          {pace}
        </span>
      ) : null}
    </>
  );

  return (
    <section
      data-testid="cme-hero-summary"
      aria-label={`CPD hours for ${year}`}
      className={cn(PANEL, !onOpenDetail && "p-4")}
    >
      {onOpenDetail ? (
        <button
          type="button"
          onClick={onOpenDetail}
          className="block min-h-12 w-full rounded-xl p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        >
          {body}
        </button>
      ) : (
        body
      )}
    </section>
  );
}
