import { cn } from "@/components/ui-primitives";
import type { CmePlanGoal } from "@/lib/cme/plan-goals";

/**
 * HOURS BY GOAL — the year's logged hours as one figure, one split bar with a
 * part per goal and a grey part for hours not linked to any goal, then one row
 * per goal with a matching dot, its activity count and its hours.
 *
 * The bar shares out hours actually logged; it never shows a percentage of a
 * goal "done", because goals have no targets. Goals take CPD's three indigo
 * shades in order (the cycle repeats past three); "Not linked to a goal" is
 * grey on purpose, so it reads as the gap. Colour only tells the parts apart:
 * every figure is also written in the rows, so the bar is `aria-hidden` and
 * still reads in greyscale and forced colours.
 *
 * The shades resolve inside `data-mode-identity="cme"`, which the Plan page
 * sets on its own `<main>`.
 */

type GoalTally = { goal: CmePlanGoal | null; hours: number; entryCount: number };

const GOAL_SVG_FILLS = [
  "fill-[color:var(--cme-cat-1)] forced-colors:fill-[Highlight]",
  "fill-[color:var(--cme-cat-2)] forced-colors:fill-[CanvasText]",
  "fill-[color:var(--cme-cat-3)] forced-colors:fill-[GrayText]",
] as const;
const GOAL_DOT_FILLS = [
  "bg-[color:var(--cme-cat-1)] forced-colors:bg-[Highlight]",
  "bg-[color:var(--cme-cat-2)] forced-colors:bg-[CanvasText]",
  "bg-[color:var(--cme-cat-3)] forced-colors:bg-[GrayText]",
] as const;
const UNLINKED_SVG_FILL = "fill-[color:var(--border-strong)] forced-colors:fill-[GrayText]";
const UNLINKED_DOT_FILL = "bg-[color:var(--border-strong)] forced-colors:bg-[GrayText]";
/** The gap between two parts of the bar, in the bar's 0–100 units (about 2px on a phone). */
const PART_GAP = 0.6;

function formatHours(hours: number): string {
  return Number(hours.toFixed(2)).toString();
}

function activities(count: number): string {
  return `${count} ${count === 1 ? "activity" : "activities"}`;
}

export function CmePlanGoalSplit({ tally }: { tally: readonly GoalTally[] }) {
  const total = tally.reduce((sum, row) => sum + row.hours, 0);
  const linkedCount = tally.reduce((sum, row) => sum + (row.goal ? row.entryCount : 0), 0);
  const activityCount = tally.reduce((sum, row) => sum + row.entryCount, 0);
  const scale = Math.max(total, 1);
  const withFill = tally.map((row, index) => ({
    row,
    svgFill: row.goal ? GOAL_SVG_FILLS[index % GOAL_SVG_FILLS.length] : UNLINKED_SVG_FILL,
    dotFill: row.goal ? GOAL_DOT_FILLS[index % GOAL_DOT_FILLS.length] : UNLINKED_DOT_FILL,
  }));
  // Each part starts where the ones before it ended, with a small gap between them.
  const present = withFill.filter(({ row }) => row.hours > 0);
  const segments = present.map((item, index) => {
    const x = present.slice(0, index).reduce((sum, earlier) => sum + (earlier.row.hours / scale) * 100, 0);
    const width = (item.row.hours / scale) * 100;
    const last = index === present.length - 1;
    return {
      key: item.row.goal?.id ?? "none",
      fill: item.svgFill,
      x,
      width: Math.max(0, width - (last ? 0 : PART_GAP)),
    };
  });

  return (
    <div data-testid="cme-plan-goal-split" className="grid min-w-0 gap-3">
      <p className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="nums whitespace-nowrap text-xl font-normal text-[color:var(--text-heading)]">{`${formatHours(total)} h`}</span>
        <span className="nums text-sm-minus text-[color:var(--text-muted)]">
          {`logged · ${linkedCount} of ${activities(activityCount)} linked`}
        </span>
      </p>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-[color:var(--surface-inset)] forced-colors:border">
        <svg aria-hidden="true" viewBox="0 0 100 10" preserveAspectRatio="none" className="block h-full w-full">
          {segments.map((segment) => (
            <rect
              key={segment.key}
              data-testid="cme-plan-tally-bar"
              x={segment.x}
              width={segment.width}
              y={0}
              height={10}
              className={segment.fill}
            />
          ))}
        </svg>
      </div>
      <ul role="list" className="grid min-w-0" data-testid="cme-plan-tally">
        {withFill.map(({ row, dotFill }) => (
          <li
            key={row.goal?.id ?? "none"}
            className="flex min-h-9 items-center gap-3 border-t border-[color:var(--border)] py-1.5 first:border-t-0"
          >
            <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", dotFill)} />
            <span className="grid min-w-0 flex-1">
              <span
                className={cn(
                  "break-words text-sm-minus",
                  row.goal ? "text-[color:var(--text)]" : "text-[color:var(--text-muted)]",
                )}
              >
                {row.goal ? row.goal.goal : "Not linked to a goal"}
              </span>
              <span className="text-xs text-[color:var(--text-muted)]">{activities(row.entryCount)}</span>
            </span>
            <span className="nums shrink-0 whitespace-nowrap text-sm font-normal text-[color:var(--text-heading)]">
              {`${formatHours(row.hours)} h`}
              <span className="sr-only">{` from ${activities(row.entryCount)}`}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SOURCE_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-10-03" as "Oct 2026", a source's check month. */
export function formatSourceMonth(dateOnly: string): string {
  const [year, month] = dateOnly.split("-");
  return `${SOURCE_MONTHS[Number.parseInt(month, 10) - 1]} ${year}`;
}
