import { CPD_CATEGORY_RULE_SET } from "@/lib/cme/category-rules-source";
import type { TrainingPosition } from "@/lib/cme/training-timeline";

/**
 * The CPD rule shown read-only on Training and on the Report, worked out from
 * the training record. There is no stored rule setting yet, so both pages use
 * this one reading and can never disagree.
 *
 * Only a training stage covering today counts as being in a college programme.
 * A rotation or a break on its own does not: a doctor on leave from a
 * programme is never told their CPD is covered. With no record read the lane
 * is `null` and no rule is ticked. Not signed off.
 */
export type CpdRuleLane = "trainee" | "everyone";

export type CpdRuleReading = {
  readonly lane: CpdRuleLane | null;
  /** One plain sentence on how the lane was worked out. */
  readonly basis: string;
};

/** The Medical Board standard in one line, from the signed rule set's hour figure. */
export const CPD_STANDARD_RULE_TEXT = `${CPD_CATEGORY_RULE_SET.rules.totalHours.hours} h a year with a CPD home, a written plan and category minimums`;

export function cpdRuleFromTraining(position: TrainingPosition | null | undefined): CpdRuleReading {
  if (!position) {
    return { lane: null, basis: "Your training record was not read here, so no rule is ticked." };
  }
  if (position.stage) {
    return {
      lane: "trainee",
      basis: `Your training record suggests this: ${position.stage.label} covers today.`,
    };
  }
  return {
    lane: "everyone",
    basis: position.onBreak
      ? "Your training record suggests this: no training stage covers today. A break alone is not counted as training."
      : "Your training record suggests this: no training stage covers today.",
  };
}
