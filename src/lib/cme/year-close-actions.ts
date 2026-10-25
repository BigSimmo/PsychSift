import type { CmePlanGoal } from "@/lib/cme/plan-goals";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import { canCloseCmeYear } from "@/lib/cme/year-close";

export type CmeYearEndActionId = "copy" | "evaluation" | "goals" | "targets" | "summary";
export type CmeYearEndAction = {
  readonly id: CmeYearEndActionId;
  readonly label: string;
  readonly status: string;
  readonly href: string;
};

/** The December checklist stays available in January while this year is still open. */
export function canOfferCmeYearEnd(set: CmeRequirementSet, now: Date): boolean {
  return !set.closedAt && canCloseCmeYear(now, set.year);
}

/** Goal carry closes at the end of January in Perth, matching the database writer. */
export function canCarryCmeGoals(set: CmeRequirementSet, now: Date): boolean {
  return canOfferCmeYearEnd(set, now) && perthCalendarDate(now) <= `${set.year + 1}-01-31`;
}

/** There is no goal-completion flag: the owner decides which goals still need work. */
export function carryableCmeGoals(
  goals: readonly CmePlanGoal[],
  nextYearGoals: readonly CmePlanGoal[] = [],
): CmePlanGoal[] {
  const nextTexts = new Set(nextYearGoals.map((goal) => goal.goal.trim().toLocaleLowerCase("en-AU")));
  return goals.filter((goal) => !nextTexts.has(goal.goal.trim().toLocaleLowerCase("en-AU")));
}

/** Plain status lines over records already loaded for the owner; no action here saves anything. */
export function buildCmeYearEndActions({
  set,
  entries,
  goals,
  now,
  nextYearConfirmed,
  nextYearGoals = [],
}: {
  set: CmeRequirementSet;
  entries: readonly CmeEntry[];
  goals: readonly CmePlanGoal[];
  now: Date;
  nextYearConfirmed: boolean | null;
  nextYearGoals?: readonly CmePlanGoal[];
}): CmeYearEndAction[] {
  const active = entries.filter((entry) => !entry.archivedAt && entry.date.startsWith(`${set.year}-`));
  const toCopy = active.filter((entry) => !entry.transcribed).length;
  const evaluation = set.requirements.find((requirement) => requirement.id === "self-evaluation");
  const toCarry = carryableCmeGoals(goals, nextYearGoals).length;
  const actions: CmeYearEndAction[] = [
    {
      id: "copy",
      label: "Copy next for your CPD home",
      status: toCopy ? `${toCopy} to copy` : "All copied",
      href: `/cme/log?year=${set.year}&copy=todo`,
    },
    {
      id: "evaluation",
      label: "Self-evaluation",
      status: evaluation?.completedOn ? "Recorded" : "Not recorded",
      href: `/cme/setup?year=${set.year}&edit=1#cme-setup-steps`,
    },
    {
      id: "goals",
      label: `Carry goals into ${set.year + 1}`,
      status: goals.length === 0 ? "No goals to carry" : toCarry ? `${toCarry} to consider` : "All carried",
      href: `/cme/plan?year=${set.year}#cme-carry-goals`,
    },
    {
      id: "targets",
      label: `Confirm ${set.year + 1} targets`,
      status: nextYearConfirmed === null ? "Not checked" : nextYearConfirmed ? "Confirmed" : "Not confirmed",
      href: `/cme/setup?year=${set.year + 1}`,
    },
    {
      id: "summary",
      label: "Annual summary",
      status: active.length
        ? `${active.length} ${active.length === 1 ? "activity" : "activities"} recorded`
        : "No activities yet",
      href: `/cme/summary?year=${set.year}`,
    },
  ];
  return canCarryCmeGoals(set, now) ? actions : actions.filter((action) => action.id !== "goals");
}
