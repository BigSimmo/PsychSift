"use client";

import { Award, ChevronRight, TrendingUp } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { formatCmeHours } from "@/components/cme/cme-dashboard-next-step";
import { CmeCategoryDot } from "@/components/cme/cme-flat-list";
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
 * The pace panel at the foot of the hero (work-mode redesign, owner request
 * 6 Oct 2026), which opens "Close the gap":
 *   - while there is something to plan: "17.5 h to go · about 1.4 h a week",
 *     then "After routines, 8.5 h is still to find" (no weekly figure in the
 *     first four weeks or the last week, matching `cmeWeeklyPace`);
 *   - once the total is reached: "50 h reached on 12 Nov", with nothing to open;
 *   - a year that has ended or been closed asks nothing more: no panel.
 * Pace is a number, never "ahead" or "behind", and nothing here is a status colour.
 */
function CmePacePanel({
  plan,
  weeklyHours,
  entries,
  year,
  onOpenGap,
}: {
  readonly plan: CmeCatchUpPlan;
  /** `cmeWeeklyPace(...).weeklyHours` when a weekly figure is meaningful, else null. */
  readonly weeklyHours: number | null;
  /** The year's activities, for the day the target was reached. */
  readonly entries: readonly CmeEntry[];
  readonly year: number;
  readonly onOpenGap: () => void;
}) {
  if (plan.status === "met") {
    const reachedOn = cmeTargetReachedOn(
      entries.filter((entry) => entry.date.startsWith(`${year}-`)),
      plan.targetHours,
    );
    if (!reachedOn) return null;
    return (
      <div className="cpd-hero-pace cursor-default">
        <TrendingUp aria-hidden="true" strokeWidth={2} />
        <span data-testid="cme-pace-sentence" className="nums min-w-0 flex-1">
          <b>{`${formatCmeHours(plan.targetHours)} h reached on ${formatCalendarDateShort(reachedOn)}.`}</b>
        </span>
      </div>
    );
  }
  if (plan.status !== "plan") return null;
  const afterRoutines =
    plan.routineEstimateHours > 0
      ? plan.remainingAfterRoutines > 0
        ? `After routines, ${formatCmeHours(plan.remainingAfterRoutines)} h is still to find`
        : "Your routines would likely cover the rest"
      : null;
  return (
    <button type="button" className="cpd-hero-pace" onClick={onOpenGap} data-testid="cme-pace-panel">
      <TrendingUp aria-hidden="true" strokeWidth={2} />
      <span data-testid="cme-pace-sentence" className="nums min-w-0 flex-1">
        <b>
          {`${formatCmeHours(plan.hoursToGo)} h to go`}
          {weeklyHours !== null ? ` · about ${weeklyHours.toFixed(1)} h a week` : ""}
        </b>
        {afterRoutines ? (
          <>
            <span className="sr-only">. </span>
            <small>{afterRoutines}</small>
          </>
        ) : null}
      </span>
      <ChevronRight aria-hidden="true" className="size-icon-sm shrink-0 opacity-80" />
    </button>
  );
}

/* The Year page's summary card: the work-mode hero (cpd_sum, cpd_empty). */

/**
 * The legend's short names ("Reviewing", "Outcomes"), as the mockup draws them.
 * The full name is still read out ("Reviewing performance", "Measuring
 * outcomes"), so a screen reader hears the category the Log and the year check use.
 */
function categoryName(category: CmeCategory): ReactNode {
  if (category === "measuring") {
    return (
      <>
        <span className="sr-only">Measuring outcomes</span>
        <span aria-hidden="true">Outcomes</span>
      </>
    );
  }
  if (category === "reviewing") {
    return (
      <>
        Reviewing<span className="sr-only"> performance</span>
      </>
    );
  }
  return <>Educational</>;
}

/** The plain white card for the no-target variant. */
const SUMMARY_CARD = "work-card work-card--pad grid min-w-0 gap-3";

const LABEL = "work-label";

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

/** Each category keeps its own hero shade, whichever others are empty. */
const HERO_TOKEN: Record<CmeCategory, string> = {
  educational: "var(--cme-hero-cat-1)",
  reviewing: "var(--cme-hero-cat-2)",
  measuring: "var(--cme-hero-cat-3)",
};

/**
 * The hero's one bar: the three categories (white, pale and mid apricot on the
 * copper), then the routines estimate hatched. Widths are hours over the
 * target, so it never runs past the end. Hidden from screen readers: the
 * legend under it says every part in words.
 */
function SummaryBar({
  categoryHours,
  routineHours,
  scale,
}: {
  categoryHours: Record<CmeCategory, number>;
  routineHours: number;
  scale: number;
}) {
  const percent = (hours: number) => Math.max(0, Math.min(100, (hours / scale) * 100));
  return (
    <div data-testid="cme-summary-bar" aria-hidden="true" className="cpd-hero-bar">
      {cmeCategories
        .filter((category) => categoryHours[category] > 0)
        .map((category) => (
          <i
            key={category}
            data-category={category}
            style={{ width: `${percent(categoryHours[category])}%`, background: HERO_TOKEN[category] }}
          />
        ))}
      {routineHours > 0 ? (
        <i data-category="routines" data-cat="routines" style={{ width: `${percent(routineHours)}%` }} />
      ) : null}
    </div>
  );
}

/** The hero's legend: two columns, each category then what routines would likely add. */
function HeroLegend({
  categoryHours,
  plan,
  onOpenGap,
}: {
  readonly categoryHours: Record<CmeCategory, number>;
  readonly plan: CmeCatchUpPlan;
  readonly onOpenGap: () => void;
}) {
  const routines = plan.status === "plan" && plan.routineEstimateHours > 0 ? plan.routineEstimateHours : 0;
  return (
    <ul role="list" aria-label="Hours by category" data-testid="cme-category-legend" className="cpd-hero-legend">
      {cmeCategories.map((category) => (
        <li key={category}>
          <i aria-hidden="true" data-cat={category} />
          <span className="min-w-0 truncate">{categoryName(category)}</span>
          <b>{`${formatHours(categoryHours[category])} h`}</b>
        </li>
      ))}
      {routines > 0 ? (
        <li>
          <button
            type="button"
            data-testid="cme-close-gap"
            onClick={onOpenGap}
            aria-label={`Your routines will likely add ${formatCmeHours(routines)} h. See how they would close the gap`}
            className="-my-3 flex min-h-12 w-full min-w-0 items-center gap-1.75 text-left text-inherit focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--mode-identity-contrast)]"
          >
            <i aria-hidden="true" data-cat="routines" />
            <span className="min-w-0 truncate">Routines likely</span>
            <b data-testid="cme-catch-up-routine-hours">{`${formatCmeHours(routines)} h`}</b>
          </button>
        </li>
      ) : null}
    </ul>
  );
}

/** The three categories as legend rows, as their own group when no target is confirmed. */
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
          <span className="min-w-0 flex-1 text-sm-minus text-[color:var(--text)]">{categoryName(category)}</span>
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
  /** The year's activities: the day the target was reached. */
  readonly entries: readonly CmeEntry[];
  readonly closed: boolean;
  /** Opens the routine scenarios behind the estimate. */
  readonly onOpenGap: () => void;
  /** The empty variant's one action ("Log your first activity"). */
  readonly firstLogAction?: ReactNode;
};

/**
 * The Year page's one summary card, the work-mode copper hero (cpd_sum), read
 * top to bottom:
 *   1. "2026 · ABOUT 13 WEEKS LEFT" and the percent of the target in a pill;
 *   2. "32.5 of 50 h logged", read out as one sentence with the percent;
 *   3. one bar: the three categories, then the routines estimate hatched;
 *   4. the legend in two columns (each category, and what routines will likely add);
 *   5. the pace panel, which opens "Close the gap" (where the week chart now lives).
 *
 * Two honest variants: nothing logged yet (screen 08) says so rather than
 * drawing an empty chart, and no confirmed target (screen 10) shows hours
 * without measuring them against anything.
 */
export function CmeYearSummary(props: CmeYearSummaryProps) {
  const { year, today, loggedHours, targetHours, categoryHours, plan, weeklyHours, entries, closed, onOpenGap } = props;
  const { firstLogAction } = props;

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
    // cpd_empty: one calm empty state, no hero.
    return (
      <section data-testid="cme-year-summary" aria-label={`CPD hours for ${year}`} className="work-card">
        <div className="work-empty">
          <span aria-hidden="true" className="work-empty__badge">
            <Award aria-hidden="true" strokeWidth={2} />
          </span>
          <span data-testid="cme-year-label" className="sr-only">
            {label}
          </span>
          <p data-testid="cme-total-hours" className="work-empty__title">
            Nothing logged yet
          </p>
          <p data-testid="cme-empty-target-line" className="work-empty__body">
            {`Your target is ${formatHours(targetHours)} h for ${year}. Log your first activity and it shows here.`}
          </p>
          {firstLogAction}
        </div>
      </section>
    );
  }

  const routineHours = plan.status === "plan" ? plan.routineCoverHours : 0;
  const scale = Math.max(targetHours, loggedHours + routineHours, 1);
  const percent = Math.round((loggedHours / targetHours) * 100);

  const spoken = `${formatHours(loggedHours)} of ${formatHours(targetHours)} hours logged, ${percent} percent`;
  return (
    <section data-testid="cme-year-summary" aria-label={`CPD hours for ${year}`} className="work-hero">
      <div className="cpd-hero-top">
        <div className="min-w-0">
          <div data-testid="cme-year-label" className="cpd-hero-kicker nums">
            {label}
          </div>
          {/* Read as one sentence: "32.5 of 50 hours logged, 65 percent". */}
          <p data-testid="cme-total-hours" className="cpd-hero-big m-0" role="img" aria-label={spoken}>
            <b>{formatHours(loggedHours)}</b>
            <small>{`of ${formatHours(targetHours)} h logged`}</small>
          </p>
        </div>
        <span data-testid="cme-year-percent" className="cpd-hero-pct nums" aria-hidden="true">{`${percent}%`}</span>
      </div>
      <SummaryBar categoryHours={categoryHours} routineHours={routineHours} scale={scale} />
      <HeroLegend categoryHours={categoryHours} plan={plan} onOpenGap={onOpenGap} />
      <CmePacePanel plan={plan} weeklyHours={weeklyHours} entries={entries} year={year} onOpenGap={onOpenGap} />
    </section>
  );
}
