import { cn, textMuted } from "@/components/ui-primitives";
import type { CmePlanGoal } from "@/lib/cme/plan-goals";

/**
 * HOURS BY GOAL — one split bar of the year's logged hours, one part per goal
 * and a grey part for hours not linked to any goal, then one row per goal with
 * a matching colour marker, its activity count and its hours.
 *
 * The bar shares out hours actually logged; it never shows a percentage of a
 * goal "done", because goals have no targets. Colour only tells the parts
 * apart: it never means a status, and every figure is also written in the rows,
 * so the picture is decorative (`aria-hidden`) and still reads in greyscale and
 * forced colours. Goals take the mode's three tones in order and the cycle
 * repeats past three; the row text, not the colour, names the goal.
 */

type GoalTally = { goal: CmePlanGoal | null; hours: number; entryCount: number };

const GOAL_SVG_FILLS = [
  "fill-[color:var(--tone-indigo)]",
  "fill-[color:var(--tone-purple)]",
  "fill-[color:var(--tone-rose)]",
] as const;
const GOAL_DOT_FILLS = [
  "bg-[color:var(--tone-indigo)]",
  "bg-[color:var(--tone-purple)]",
  "bg-[color:var(--tone-rose)]",
] as const;
const UNLINKED_SVG_FILL = "fill-[color:var(--tone-slate)]";
const UNLINKED_DOT_FILL = "bg-[color:var(--tone-slate)]";

function formatHours(hours: number): string {
  return Number(hours.toFixed(2)).toString();
}

function activities(count: number): string {
  return `${count} ${count === 1 ? "activity" : "activities"}`;
}

export function CmePlanGoalSplit({ tally }: { tally: readonly GoalTally[] }) {
  const total = tally.reduce((sum, row) => sum + row.hours, 0);
  const linkedCount = tally.reduce((sum, row) => sum + (row.goal ? row.entryCount : 0), 0);
  const scale = Math.max(total, 1);
  const withFill = tally.map((row, index) => ({
    row,
    svgFill: row.goal ? GOAL_SVG_FILLS[index % GOAL_SVG_FILLS.length] : UNLINKED_SVG_FILL,
    dotFill: row.goal ? GOAL_DOT_FILLS[index % GOAL_DOT_FILLS.length] : UNLINKED_DOT_FILL,
  }));
  // Each part starts where the ones before it ended, with a hairline gap between them.
  const present = withFill.filter(({ row }) => row.hours > 0);
  const segments = present.map((item, index) => {
    const x = present.slice(0, index).reduce((sum, earlier) => sum + (earlier.row.hours / scale) * 100, 0);
    const width = (item.row.hours / scale) * 100;
    return { key: item.row.goal?.id ?? "none", fill: item.svgFill, x, width: Math.max(0, width - 0.4) };
  });

  return (
    <div data-testid="cme-plan-goal-split">
      <p className="flex items-baseline justify-between gap-3 text-sm">
        <span className="nums font-semibold text-[color:var(--text)]">{`${formatHours(total)} h logged`}</span>
        <span className={cn(textMuted, "nums")}>{`${activities(linkedCount)} linked`}</span>
      </p>
      <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-[color:var(--surface-inset)] shadow-[var(--shadow-inset)] forced-colors:border">
        <svg aria-hidden="true" viewBox="0 0 100 10" preserveAspectRatio="none" className="block h-full w-full">
          {segments.map((segment) => (
            <rect
              key={segment.key}
              data-testid="cme-plan-tally-bar"
              x={segment.x}
              width={segment.width}
              y={0}
              height={10}
              className={cn("forced-colors:fill-[CanvasText]", segment.fill)}
            />
          ))}
        </svg>
      </div>
      <ul className="mt-3 flex flex-col divide-y divide-[color:var(--border)]" data-testid="cme-plan-tally">
        {withFill.map(({ row, dotFill }) => (
          <li key={row.goal?.id ?? "none"} className="flex items-start gap-3 py-2.5">
            <span aria-hidden="true" className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", dotFill)} />
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className={cn("text-sm", row.goal ? "text-[color:var(--text)]" : textMuted)}>
                {row.goal ? row.goal.goal : "Not linked to a goal"}
              </span>
              <span className={cn(textMuted, "text-xs")}>{activities(row.entryCount)}</span>
            </span>
            <span className="nums shrink-0 text-sm font-semibold text-[color:var(--text)]">
              {`${formatHours(row.hours)} h`}
              <span className="sr-only">{` from ${activities(row.entryCount)}`}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
