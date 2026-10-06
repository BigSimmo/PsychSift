"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";

import { formatCmeHours } from "@/components/cme/cme-dashboard-next-step";
import { CmeCategoryDot, cmeCategoryShadeFill } from "@/components/cme/cme-flat-list";
import { CmeYearInWeeks } from "@/components/cme/cme-year-in-weeks";
import { cn } from "@/components/ui-primitives";
import type { CmeCatchUpPlan } from "@/lib/cme/catch-up-plan";
import { formatCalendarDateShort } from "@/lib/cme/cpd-year";
import { cmeTargetReachedOn } from "@/lib/cme/pace";
import { cmeCategories, type CmeCategory, type CmeEntry } from "@/lib/cme/types";

const formatHours = formatCmeHours;

/**
 * The Year page's summary card (`CmeYearSummary`, below) and the catch-up
 * planner inside it. It lives here, not beside `CmeHeroSummary`, because My
 * Day imports the hero, and this card should not ride along into My Day.
 *
 * THE CATCH-UP PLANNER, as the Year summary's last line and legend row: the
 * hours still to reach the year's total, the weekly figure that would get
 * there, and how much of it the owner's own routines would likely add by
 * 31 December.
 *
 * It is an estimate, and says so: a routine is a reminder to log something,
 * never a log of it. Pace is a number ("about 1.4 h a week"), never "ahead"
 * or "behind", and nothing here is a status colour.
 */

/**
 * The pace sentence under the summary bar:
 *   - while there is something to plan: "17.5 h to go, about 1.4 h a week.
 *     After routines, 8.5 h is still to find." (no weekly figure in the first
 *     four weeks or the last week, matching `cmeWeeklyPace`);
 *   - once the total is reached: "50 h reached on 12 Nov";
 *   - a year that has ended or been closed asks nothing more: no sentence.
 */
function CmeCatchUpSentence({
  plan,
  weeklyHours,
  entries,
  year,
}: {
  readonly plan: CmeCatchUpPlan;
  /** `cmeWeeklyPace(...).weeklyHours` when a weekly figure is meaningful, else null. */
  readonly weeklyHours: number | null;
  /** The year's activities, for the day the target was reached. */
  readonly entries: readonly CmeEntry[];
  readonly year: number;
}) {
  if (plan.status === "met") {
    const reachedOn = cmeTargetReachedOn(
      entries.filter((entry) => entry.date.startsWith(`${year}-`)),
      plan.targetHours,
    );
    if (!reachedOn) return null;
    return (
      <p data-testid="cme-pace-sentence" className="m-0 text-sm-minus text-[color:var(--text-muted)]">
        {`${formatCmeHours(plan.targetHours)} h reached on ${formatCalendarDateShort(reachedOn)}.`}
      </p>
    );
  }
  if (plan.status !== "plan") return null;
  const afterRoutines =
    plan.routineEstimateHours > 0
      ? plan.remainingAfterRoutines > 0
        ? ` After routines, ${formatCmeHours(plan.remainingAfterRoutines)} h is still to find.`
        : " Your routines would likely cover the rest."
      : "";
  return (
    <p data-testid="cme-pace-sentence" className="nums m-0 text-sm-minus text-[color:var(--text-muted)]">
      <b className="font-medium text-[color:var(--text-heading)]">{`${formatCmeHours(plan.hoursToGo)} h to go`}</b>
      {weeklyHours !== null ? `, about ${weeklyHours.toFixed(1)} h a week.` : "."}
      {afterRoutines}
    </p>
  );
}

/**
 * The hatched legend dot for the routines estimate: the same diagonal stripes
 * as its part of the bar, so the eye can pair them. Colour only helps; the
 * words beside it say what it is.
 */
function CmeRoutineEstimateDot() {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-2 shrink-0 rounded-full bg-[repeating-linear-gradient(135deg,var(--cme-cat-1)_0_1.5px,transparent_1.5px_3.5px)] ring-1 ring-inset ring-[color:var(--cme-cat-2)] forced-colors:bg-[GrayText]"
    />
  );
}

/**
 * The legend row "Your routines will likely add 9 h". It opens the routine
 * scenarios behind the estimate (the "Close the gap" detail), so the estimate
 * can always be checked. Shown only while there is something to plan and a
 * routine would add hours.
 */
function CmeRoutineEstimateRow({
  plan,
  onOpenDetail,
}: {
  readonly plan: CmeCatchUpPlan;
  readonly onOpenDetail: () => void;
}) {
  if (plan.status !== "plan" || plan.routineEstimateHours <= 0) return null;
  return (
    <li className="relative flex min-w-0 items-center before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[color:var(--border)] before:content-['']">
      <button
        type="button"
        data-testid="cme-close-gap"
        onClick={onOpenDetail}
        aria-label={`Your routines will likely add ${formatCmeHours(plan.routineEstimateHours)} h. See how they would close the gap`}
        className={cn(
          "flex min-h-12 w-full min-w-0 items-center gap-3 py-1.5 text-left",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
        )}
      >
        <CmeRoutineEstimateDot />
        <span className="min-w-0 flex-1 text-sm-minus text-[color:var(--text)]">Your routines will likely add</span>
        <span
          data-testid="cme-catch-up-routine-hours"
          className="nums whitespace-nowrap text-sm text-[color:var(--text-heading)]"
        >
          {`${formatCmeHours(plan.routineEstimateHours)} h`}
        </span>
      </button>
    </li>
  );
}

/* The Year page's summary card (the 5 Oct mock-up: screens 01, 08, 10 and 11). */

/** The legend's short names; the full names are on the Log and the year check. */
const CATEGORY_SHORT: Record<CmeCategory, string> = {
  educational: "Educational",
  reviewing: "Reviewing performance",
  measuring: "Measuring outcomes",
};

const SUMMARY_CARD =
  "grid min-w-0 gap-3.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-4";

const LABEL = "text-2xs font-semibold uppercase leading-4 tracking-label text-[color:var(--text-muted)]";

/** The one figure: numbers are never heavier than 400 in CPD (tests/cme-type-weight.test.ts). */
const KPI = "nums whitespace-nowrap text-xl font-normal tracking-tight text-[color:var(--text-heading)]";
/** The same line when it is words, not a number ("Nothing logged yet"). */
const KPI_WORDS = "text-xl font-semibold tracking-tight text-[color:var(--text-heading)]";

const MS_PER_DAY = 86_400_000;

function dayNumber(dateOnly: string): number {
  return Math.round(Date.parse(`${dateOnly}T00:00:00Z`) / MS_PER_DAY);
}

/**
 * "2026 · about 13 weeks left"; in the last week "2026 · 3 days left"; "2026 · closed",
 * "2026 · year ended" or "2026 · starts 1 January" outside the year. Never a verdict.
 */
function cmeYearLabel({ year, today, closed }: { year: number; today: string; closed: boolean }): string {
  if (closed) return `${year} · closed`;
  if (today < `${year}-01-01`) return `${year} · starts 1 January`;
  if (today > `${year}-12-31`) return `${year} · year ended`;
  const daysLeft = dayNumber(`${year}-12-31`) - dayNumber(today);
  if (daysLeft === 0) return `${year} · last day`;
  if (daysLeft < 7) return `${year} · ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`;
  const weeks = Math.round(daysLeft / 7);
  return `${year} · about ${weeks} ${weeks === 1 ? "week" : "weeks"} left`;
}

/** One summary bar: the three category shades, then the routines estimate hatched, on the inset track. */
function SummaryBar({
  categoryHours,
  routineHours,
  scale,
}: {
  categoryHours: Record<CmeCategory, number>;
  routineHours: number;
  scale: number;
}) {
  const hatchId = useId();
  const percent = (hours: number) => Math.max(0, Math.min(100, (hours / scale) * 100));
  // Each part starts where the ones before it ended. Percent lengths with no viewBox, so the
  // widths need no inline style and the hatching keeps its true angle at any width.
  const parts = [
    ...cmeCategories
      .filter((category) => categoryHours[category] > 0)
      .map((category) => ({ id: category, width: percent(categoryHours[category]) })),
    ...(routineHours > 0 ? [{ id: "routines", width: percent(routineHours) }] : []),
  ];
  let x = 0;
  const placed = parts.map((part) => {
    const start = x;
    x += part.width;
    return { ...part, x: start };
  });
  return (
    <div
      data-testid="cme-summary-bar"
      aria-hidden="true"
      className="h-2.5 overflow-hidden rounded-full bg-[color:var(--surface-inset)] forced-colors:border forced-colors:border-[CanvasText]"
    >
      <svg className="block h-full w-full" focusable="false">
        <defs>
          <pattern id={hatchId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="2" height="5" className="fill-[color:var(--cme-cat-2)] forced-colors:fill-[GrayText]" />
          </pattern>
        </defs>
        {placed.map((part, index) => (
          <rect
            key={part.id}
            data-category={part.id}
            x={`${part.x}%`}
            // A hairline gap between parts, as in the mock-up: each part but the last stops just short.
            width={`${index < placed.length - 1 ? Math.max(0, part.width - 0.5) : part.width}%`}
            height="100%"
            fill={part.id === "routines" ? `url(#${hatchId})` : undefined}
            className={
              part.id === "routines"
                ? undefined
                : cn("forced-colors:fill-[CanvasText]", cmeCategoryShadeFill[part.id as CmeCategory])
            }
          />
        ))}
      </svg>
    </div>
  );
}

/** The three categories as legend rows: inside the summary, and as their own group when no target is confirmed. */
export function CmeCategoryLegend({
  categoryHours,
  children,
  label = "Hours by category",
}: {
  readonly categoryHours: Record<CmeCategory, number>;
  /** Extra rows after the categories (the routines estimate). */
  readonly children?: ReactNode;
  readonly label?: string;
}) {
  return (
    <ul role="list" aria-label={label} data-testid="cme-category-legend" className="grid min-w-0">
      {cmeCategories.map((category) => (
        <li
          key={category}
          className="relative flex min-h-9 min-w-0 items-center gap-3 py-1.5 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[color:var(--border)] before:content-[''] first:before:hidden"
        >
          <CmeCategoryDot category={category} />
          <span className="min-w-0 flex-1 text-sm-minus text-[color:var(--text)]">{CATEGORY_SHORT[category]}</span>
          <span className="nums whitespace-nowrap text-sm text-[color:var(--text-heading)]">
            {`${formatHours(categoryHours[category])} h`}
          </span>
        </li>
      ))}
      {children}
    </ul>
  );
}

export type CmeYearSummaryProps = {
  readonly year: number;
  /** Perth calendar date, `YYYY-MM-DD`. */
  readonly today: string;
  /** Hours logged this year, archived activities excluded (`evaluateYear`'s `totalHours`). */
  readonly loggedHours: number;
  /** The confirmed yearly total. Zero or less means no target is confirmed: hours are shown without one. */
  readonly targetHours: number;
  readonly categoryHours: Record<CmeCategory, number>;
  readonly plan: CmeCatchUpPlan;
  /** The weekly figure, or null in the first four weeks and the last week. */
  readonly weeklyHours: number | null;
  /** The year's activities: the week chart and the day the target was reached. */
  readonly entries: readonly CmeEntry[];
  readonly closed: boolean;
  /** Opens the routine scenarios behind the estimate. */
  readonly onOpenGap: () => void;
};

/**
 * The Year page's one summary card, read top to bottom:
 *   1. "2026 · ABOUT 13 WEEKS LEFT" and the percent of the target;
 *   2. "32.5 of 50 h logged";
 *   3. one bar in the three CPD indigo shades, then the routines estimate hatched;
 *   4. the legend in words (each category, and what routines will likely add);
 *   5. the pace sentence;
 *   6. "EACH WEEK": a thin bar per week, grouped by month.
 *
 * Two honest variants: nothing logged yet (screen 08) says so rather than
 * drawing an empty chart, and no confirmed target (screen 10) shows hours
 * without measuring them against anything.
 */
export function CmeYearSummary(props: CmeYearSummaryProps) {
  const { year, today, loggedHours, targetHours, categoryHours, plan, weeklyHours, entries, closed, onOpenGap } = props;

  if (!(targetHours > 0)) {
    return (
      <section data-testid="cme-year-summary" aria-label={`CPD hours for ${year}`} className={SUMMARY_CARD}>
        <div data-testid="cme-year-label" className={LABEL}>
          {year}
        </div>
        <p data-testid="cme-total-hours" className="m-0 flex items-baseline gap-1.5">
          {loggedHours > 0 ? (
            <>
              <b className={KPI}>{`${formatHours(loggedHours)} h`}</b>
              <span className="text-sm-minus text-[color:var(--text-muted)]">logged</span>
            </>
          ) : (
            <b className={KPI_WORDS}>Nothing logged yet</b>
          )}
        </p>
        <p className="m-0 text-sm-minus text-[color:var(--text-muted)]">
          You have not confirmed a yearly target, so nothing is measured against one. Set one up whenever you like.
        </p>
        <Link
          href={`/cme/setup?year=${year}`}
          data-testid="cme-set-up-year"
          className="inline-flex min-h-12 items-center justify-self-start text-sm-minus font-medium text-[color:var(--clinical-accent)] no-underline hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        >
          Set up your year
        </Link>
      </section>
    );
  }

  const label = cmeYearLabel({ year, today, closed });

  if (!(loggedHours > 0)) {
    return (
      <section data-testid="cme-year-summary" aria-label={`CPD hours for ${year}`} className={SUMMARY_CARD}>
        <div data-testid="cme-year-label" className={LABEL}>
          {label}
        </div>
        <p data-testid="cme-total-hours" className="m-0">
          <b className={KPI_WORDS}>Nothing logged yet</b>
        </p>
        <div aria-hidden="true" className="h-2.5 rounded-full bg-[color:var(--surface-inset)]" />
        <p data-testid="cme-empty-target-line" className="m-0 text-sm-minus text-[color:var(--text-muted)]">
          {`Your target is ${formatHours(targetHours)} h for ${year}. Log your first activity and it will show here.`}
        </p>
      </section>
    );
  }

  const routineHours = plan.status === "plan" ? plan.routineCoverHours : 0;
  const scale = Math.max(targetHours, loggedHours + routineHours, 1);
  const percent = Math.round((loggedHours / targetHours) * 100);

  return (
    <section data-testid="cme-year-summary" aria-label={`CPD hours for ${year}`} className={SUMMARY_CARD}>
      <div className={cn(LABEL, "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5")}>
        <span data-testid="cme-year-label">{label}</span>
        <span
          data-testid="cme-year-percent"
          className="nums font-normal normal-case tracking-normal"
        >{`${percent}%`}</span>
      </div>
      <p data-testid="cme-total-hours" className="m-0 flex items-baseline gap-1.5">
        <b className={KPI}>{formatHours(loggedHours)}</b>
        <span className="text-sm-minus text-[color:var(--text-muted)]">{`of ${formatHours(targetHours)} h logged`}</span>
      </p>
      <SummaryBar categoryHours={categoryHours} routineHours={routineHours} scale={scale} />
      <CmeCategoryLegend categoryHours={categoryHours}>
        <CmeRoutineEstimateRow plan={plan} onOpenDetail={onOpenGap} />
      </CmeCategoryLegend>
      <CmeCatchUpSentence plan={plan} weeklyHours={weeklyHours} entries={entries} year={year} />
      <div className="grid min-w-0 gap-1">
        <h2 className={LABEL}>Each week</h2>
        <CmeYearInWeeks entries={entries} year={year} today={today} />
      </div>
    </section>
  );
}
