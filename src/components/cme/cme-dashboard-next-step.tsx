"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { CmeYearEndActions } from "@/components/cme/cme-year-close-panel";
import { cn, textMuted } from "@/components/ui-primitives";
import {
  CPD_PACE_MINIMUM_ELAPSED_DAYS,
  cpdYearOf,
  daysElapsedInCpdYear,
  daysRemainingInCpdYear,
} from "@/lib/cme/cpd-year";
import type { CmePlanGoal } from "@/lib/cme/plan-goals";
import { furthestFromMet } from "@/lib/cme/requirement-gaps";
import type { CmeEntry, CmeRequirementSet, CmeRequirementStatus } from "@/lib/cme/types";
import { CME_CLOSE_WINDOW_DAYS } from "@/lib/cme/year-close";

/** A quiet note: hairline border on the raised surface, no shadow and no tint (the 5 Oct mock-up). */
const NOTE = "rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)]";

/**
 * Today's one next step, by season — driven entirely by `now` against the CPD
 * year in `set`, never by anything Today decides on its own:
 *   - **Closed year**: the annual summary, for its snapshot.
 *   - **Every target reached**: keep logging.
 *   - **Closing the year** (the last fortnight): the year-end checklist,
 *     regardless of what is or is not yet met.
 *   - **Early year** (fewer than `CPD_PACE_MINIMUM_ELAPSED_DAYS` elapsed) with
 *     a task not started: that task, usually the development plan.
 *   - **Only the total is short**: the total, so it stays actionable.
 *   - **Tracking** (the rest of the year): whichever requirement is furthest
 *     from met.
 * The last two are rows of the Year page's "What's left" list (`rowId`), so
 * the page marks that row rather than saying the same thing twice.
 */
export type CmeNextStep = {
  readonly label: string;
  readonly href: string;
  /** The "What's left" row that IS this step ("total" or "requirement-<id>"), or null when it has none. */
  readonly rowId: string | null;
};

/** "32.5", never "32.50" — and a whole number drops its decimal point, so a legitimate zero reads as a plain "0". */
export function formatCmeHours(hours: number): string {
  return Number(hours.toFixed(2)).toString();
}

export function computeCmeNextStep(args: {
  set: CmeRequirementSet;
  unmet: readonly CmeRequirementStatus[];
  now: Date;
  totalHours: number;
}): CmeNextStep {
  const { set, unmet, now, totalHours } = args;
  const inRequestedYear = cpdYearOf(now) === set.year;
  const summaryHref = `/cme/summary?year=${set.year}`;

  if (set.closedAt) {
    return {
      label: "This CPD year is closed. Open the annual summary for its snapshot and any amendments.",
      href: summaryHref,
      rowId: null,
    };
  }

  if (unmet.length === 0 && totalHours >= set.totalHours) {
    return {
      label: "Every target is reached for this year. Keep logging activities as you go.",
      href: `/cme/new?year=${set.year}`,
      rowId: null,
    };
  }

  if (inRequestedYear && daysRemainingInCpdYear(now, set.year) <= CME_CLOSE_WINDOW_DAYS) {
    // Closing happens on the annual summary, which also shows what the year looks like
    // before it is frozen, so the action sends the owner there rather than closing from here.
    return {
      label: "Year end: check each entry against the records you keep, then close the year from your annual summary.",
      href: summaryHref,
      rowId: null,
    };
  }

  const earlyTask = set.requirements.find(
    (requirement) => requirement.spec.shape === "task" && requirement.completedOn === null,
  );
  if (inRequestedYear && daysElapsedInCpdYear(now, set.year) < CPD_PACE_MINIMUM_ELAPSED_DAYS && earlyTask) {
    return {
      label: `It's early in the year for a pace projection — a good place to start is ${earlyTask.label.toLowerCase()}.`,
      href: `/cme/setup?year=${set.year}#cme-requirement-${encodeURIComponent(earlyTask.id)}`,
      rowId: null,
    };
  }

  if (unmet.length === 0) {
    return {
      label: `Next: Total CPD hours — ${formatCmeHours(set.totalHours - totalHours)} h to go`,
      href: `/cme/new?year=${set.year}`,
      rowId: "total",
    };
  }

  const next = furthestFromMet(set, unmet)!;
  const requirement = set.requirements.find((item) => item.id === next.requirementId);
  return {
    label: `Next: ${requirement?.label ?? "Next requirement"} — ${next.summary}`,
    href:
      requirement?.spec.shape === "task"
        ? `/cme/setup?year=${set.year}#cme-requirement-${encodeURIComponent(requirement.id)}`
        : `/cme/new?year=${set.year}`,
    rowId: `requirement-${next.requirementId}`,
  };
}

/**
 * The next step as its own row, for every season whose step is not already
 * the first row of "What's left" — the dashboard decides, because a step that
 * would sit in that list still needs this row when the owner has hidden the
 * module. In the year-end window (and for an earlier year not yet closed) the
 * row is the year-end checklist itself.
 */
export function CmeNextStepRow({
  step,
  offerYearEnd,
  set,
  entries,
  goals,
  now,
  nextYearConfirmed,
  nextYearGoals,
}: {
  step: CmeNextStep;
  offerYearEnd: boolean;
  set: CmeRequirementSet;
  entries: readonly CmeEntry[];
  goals: readonly CmePlanGoal[];
  now: Date;
  nextYearConfirmed: boolean | null;
  nextYearGoals?: readonly CmePlanGoal[];
}) {
  if (offerYearEnd) {
    return (
      <div data-testid="cme-next-action" className={cn(NOTE, "p-3")}>
        <CmeYearEndActions
          set={set}
          entries={entries}
          goals={goals}
          now={now}
          nextYearConfirmed={nextYearConfirmed}
          nextYearGoals={nextYearGoals}
        />
      </div>
    );
  }
  return (
    <Link
      data-testid="cme-next-action"
      href={step.href}
      className={cn(
        NOTE,
        focusRing,
        "flex min-h-12 items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium text-[color:var(--text-heading)] no-underline",
      )}
    >
      <span className="min-w-0">{step.label}</span>
      <ChevronRight aria-hidden="true" className={cn("size-icon-sm shrink-0", textMuted)} />
    </Link>
  );
}
