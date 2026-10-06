import { CPD_CATEGORY_RULE_SET } from "@/lib/cme/category-rules-source";
import { cpdYearOf } from "@/lib/cme/cpd-year";
import type { TrainingPosition } from "@/lib/cme/training-timeline";

/**
 * The CPD rule shown read-only on Training and on the Report, worked out from
 * the training record. There is no stored rule setting yet, so both pages use
 * this one reading and can never disagree.
 *
 * Only a training stage covering today counts as being in a college programme.
 * A rotation or a break on its own does not, and a break inside a stage leaves
 * the rule unworked-out: a doctor on leave from a programme is never told their
 * CPD is covered. The lane is `null`, and no rule is ticked, whenever the
 * record was not read or is empty (callers pass `null` for an empty record),
 * and whenever the year asked about is not the CPD year today falls in, because
 * the record is only ever read as at today. Not signed off.
 */
export type CpdRuleLane = "trainee" | "everyone";

export type CpdRuleReading = {
  readonly lane: CpdRuleLane | null;
  /** One plain sentence on how the lane was worked out. */
  readonly basis: string;
};

/** The Medical Board standard in one line, from the signed rule set's hour figure. */
export const CPD_STANDARD_RULE_TEXT = `${CPD_CATEGORY_RULE_SET.rules.totalHours.hours} h a year with a CPD home, a written plan and category minimums`;

export function cpdRuleFromTraining(
  position: TrainingPosition | null | undefined,
  options: { readonly forYear?: number; readonly now?: Date } = {},
): CpdRuleReading {
  if (options.forYear !== undefined && options.forYear !== cpdYearOf(options.now ?? new Date())) {
    return {
      lane: null,
      basis: `Your rule for ${options.forYear} is not worked out here, because your training record is only read as at today.`,
    };
  }
  if (!position) {
    return { lane: null, basis: "Your training record is empty or was not read here, so no rule is ticked." };
  }
  if (position.stage && position.onBreak) {
    return {
      lane: null,
      basis: `Your training record shows a break within ${position.stage.label} today, so whether your programme covers your CPD is not worked out here.`,
    };
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
