import { ruleGate, type ApprovedRuleSigner, type RuleGate, type RuleSignOff } from "@/lib/admin/rule-sign-off";
import { CPD_CATEGORY_RULE_SET, CPD_CATEGORY_RULES_SIGN_OFF } from "@/lib/cme/category-rules-source";
import { evaluateRequirement, totalAllocatedHours } from "@/lib/cme/evaluate";
import type { CmeCategory, CmeEntry, CmeRequirement, CmeRequirementSet } from "@/lib/cme/types";

/**
 * CPD category coaching: how the year's logged hours stand against the Medical Board's national
 * minimums, and whether the owner's own confirmed targets have drifted below them.
 *
 * Every figure comes from `category-rules-source.ts` (verbatim quotes of the Board's standard).
 * The arithmetic is `evaluateRequirement` itself, run on requirements built from those figures, so
 * the coaching can never disagree with the CPD page about what counts.
 *
 * Coaching states facts ("8 h short in measuring outcomes") with the Board's words; it never
 * lowers a target and takes no part-time or working-pattern input, for the reason given on
 * `evaluateRequirement`.
 *
 * Off until a named clinician signs `CPD_CATEGORY_RULES_SIGN_OFF`.
 */

const rules = CPD_CATEGORY_RULE_SET.rules;

export type CpdCoachingLineId = "total" | "educational" | "reviewing-and-measuring" | "reviewing" | "measuring";

export type CpdCoachingLine = {
  readonly id: CpdCoachingLineId;
  readonly label: string;
  readonly met: boolean;
  readonly hoursLogged: number;
  readonly hoursRequired: number;
  /** The least still to log before this line is met; 0 once met. */
  readonly hoursShort: number;
  /** The Board's words this line is checked against. */
  readonly quote: string;
};

export type CpdStandardMismatch = {
  readonly id: "total" | "educational" | "reviewing-and-measuring";
  /** The owner's confirmed figure, or null when the set has no matching requirement. */
  readonly yours: number | null;
  readonly standard: number;
  readonly words: string;
  readonly quote: string;
};

export type CpdCoaching = {
  readonly lines: readonly CpdCoachingLine[];
  /** Where the owner's confirmed targets sit below the Board's minimums. Higher targets are fine. */
  readonly mismatches: readonly CpdStandardMismatch[];
};

export type CpdCoachingResult =
  | { readonly gate: Extract<RuleGate, { on: false }>; readonly coaching: null }
  | { readonly gate: Extract<RuleGate, { on: true }>; readonly coaching: CpdCoaching };

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function standardRequirement(id: string, spec: CmeRequirement["spec"]): CmeRequirement {
  return { id, label: id, source: "national", completedOn: null, spec };
}

function hoursLine(
  id: CpdCoachingLineId,
  label: string,
  category: CmeCategory,
  hoursRequired: number,
  quote: string,
  entries: readonly CmeEntry[],
): CpdCoachingLine {
  const status = evaluateRequirement(
    standardRequirement(id, { shape: "hours-in-category", category, minimumHours: hoursRequired }),
    entries,
  );
  const hoursLogged = status.progress?.value ?? 0;
  return {
    id,
    label,
    met: status.met,
    hoursLogged,
    hoursRequired,
    hoursShort: round2(Math.max(0, hoursRequired - hoursLogged)),
    quote,
  };
}

/** The owner's confirmed national targets compared with the Board's minimums. */
export function cpdStandardMismatches(set: CmeRequirementSet): CpdStandardMismatch[] {
  const mismatches: CpdStandardMismatch[] = [];
  const national = set.requirements.filter((requirement) => requirement.source === "national");

  if (set.totalHours < rules.totalHours.hours) {
    mismatches.push({
      id: "total",
      yours: set.totalHours,
      standard: rules.totalHours.hours,
      words: `Your total target is ${set.totalHours} hours, and the Board's minimum is ${rules.totalHours.hours}.`,
      quote: rules.totalHours.quote,
    });
  }

  const educational = national.find(
    (requirement) => requirement.spec.shape === "hours-in-category" && requirement.spec.category === "educational",
  );
  const educationalHours = educational?.spec.shape === "hours-in-category" ? educational.spec.minimumHours : null;
  if (educationalHours === null || educationalHours < rules.educationalHours.hours) {
    mismatches.push({
      id: "educational",
      yours: educationalHours,
      standard: rules.educationalHours.hours,
      words:
        educationalHours === null
          ? `Your targets have no educational activities line. The Board asks for at least ${rules.educationalHours.hours} hours.`
          : `Your educational target is ${educationalHours} hours, and the Board asks for at least ${rules.educationalHours.hours}.`,
      quote: rules.educationalHours.quote,
    });
  }

  const combined = national.find(
    (requirement) =>
      requirement.spec.shape === "hours-across-categories" &&
      requirement.spec.categories.length === 2 &&
      requirement.spec.categories.includes("reviewing") &&
      requirement.spec.categories.includes("measuring"),
  );
  const spec = combined?.spec.shape === "hours-across-categories" ? combined.spec : null;
  const combinedRule = rules.reviewingAndMeasuringHours;
  if (
    spec === null ||
    spec.minimumHours < combinedRule.hours ||
    spec.minimumEachHours < combinedRule.minimumEachHours
  ) {
    mismatches.push({
      id: "reviewing-and-measuring",
      yours: spec?.minimumHours ?? null,
      standard: combinedRule.hours,
      words:
        spec === null
          ? `Your targets have no reviewing performance and measuring outcomes line. The Board asks for at least ${combinedRule.hours} hours, with ${combinedRule.minimumEachHours} in each.`
          : `Your reviewing and measuring target is ${spec.minimumHours} hours with ${spec.minimumEachHours} in each, and the Board asks for at least ${combinedRule.hours}, with ${combinedRule.minimumEachHours} in each.`,
      quote: combinedRule.quote,
    });
  }

  return mismatches;
}

/** The coaching, with no switch: exported for tests and for the signer's preview only. */
export function cpdCategoryCoachingUngated(set: CmeRequirementSet, entries: readonly CmeEntry[]): CpdCoaching {
  const combinedRule = rules.reviewingAndMeasuringHours;
  const combined = evaluateRequirement(
    standardRequirement("reviewing-and-measuring", {
      shape: "hours-across-categories",
      categories: ["reviewing", "measuring"],
      minimumHours: combinedRule.hours,
      minimumEachHours: combinedRule.minimumEachHours,
    }),
    entries,
  );
  const combinedLogged = combined.progress?.value ?? 0;
  const totalLogged = totalAllocatedHours(entries);

  const lines: CpdCoachingLine[] = [
    {
      id: "total",
      label: "All CPD hours",
      met: totalLogged >= rules.totalHours.hours,
      hoursLogged: totalLogged,
      hoursRequired: rules.totalHours.hours,
      hoursShort: round2(Math.max(0, rules.totalHours.hours - totalLogged)),
      quote: rules.totalHours.quote,
    },
    hoursLine(
      "educational",
      "Educational activities",
      "educational",
      rules.educationalHours.hours,
      rules.educationalHours.quote,
      entries,
    ),
    {
      id: "reviewing-and-measuring",
      label: "Reviewing performance and measuring outcomes",
      met: combined.met,
      hoursLogged: combinedLogged,
      hoursRequired: combinedRule.hours,
      hoursShort: combined.hoursShort ?? round2(Math.max(0, combinedRule.hours - combinedLogged)),
      quote: combinedRule.quote,
    },
    hoursLine(
      "reviewing",
      "Reviewing performance",
      "reviewing",
      combinedRule.minimumEachHours,
      combinedRule.quote,
      entries,
    ),
    hoursLine(
      "measuring",
      "Measuring outcomes",
      "measuring",
      combinedRule.minimumEachHours,
      combinedRule.quote,
      entries,
    ),
  ];

  return { lines, mismatches: cpdStandardMismatches(set) };
}

/** CPD category coaching, or none while the rule set is unsigned or switched off. */
export function cpdCategoryCoaching(
  set: CmeRequirementSet,
  entries: readonly CmeEntry[],
  signOff: RuleSignOff = CPD_CATEGORY_RULES_SIGN_OFF,
  approvedSigners?: readonly ApprovedRuleSigner[],
  now: number = Date.now(),
): CpdCoachingResult {
  const gate = ruleGate(signOff, CPD_CATEGORY_RULE_SET, approvedSigners, now);
  if (!gate.on) return { gate, coaching: null };
  // The standard applies from its effective year; earlier years get no coaching against it.
  const effectiveYear = Number(CPD_CATEGORY_RULE_SET.source.effectiveFrom.slice(0, 4));
  if (set.year < effectiveYear) return { gate: { on: false, reason: "standard-not-in-force" }, coaching: null };
  return { gate, coaching: cpdCategoryCoachingUngated(set, entries) };
}
