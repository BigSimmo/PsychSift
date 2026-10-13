import type {
  LithiumDoseAdjustmentInput,
  LithiumDoseAdjustmentResult,
  LithiumLevelEvaluation,
  LithiumLevelInput,
  LithiumLevelStatus,
  LithiumToxicitySeverity,
} from "./types";

/**
 * Evaluates serum lithium 12-hour post-dose trough concentration against
 * Australian Therapeutic Guidelines (eTG) and RANZCP clinical monitoring standards.
 */
export function evaluateLithiumLevel(input: LithiumLevelInput): LithiumLevelEvaluation {
  const isElderly = input.age >= 65;

  let minTarget: number;
  let maxTarget: number;

  if (input.indication === "acute_mania") {
    minTarget = 0.8;
    maxTarget = 1.0;
  } else {
    // Maintenance therapy
    minTarget = isElderly ? 0.4 : 0.6;
    maxTarget = isElderly ? 0.6 : 0.8;
  }

  const level = input.serumLevelMmolL;
  const isWithinTarget = level >= minTarget && level <= maxTarget;

  let status: LithiumLevelStatus;
  let severity: LithiumToxicitySeverity = "none";
  const clinicalGuidance: string[] = [];

  if (level > 2.0) {
    status = "toxic";
    severity = "severe_dialysis_threshold";
    clinicalGuidance.push(
      "CRITICAL: Serum lithium > 2.0 mmol/L is a medical emergency. High risk of neurotoxicity, acute renal failure, and seizures. Immediate cessation, urgent hospital admission, and consideration of hemodialysis required.",
    );
  } else if (level > 1.2) {
    status = "toxic";
    severity = "moderate";
    clinicalGuidance.push(
      "TOXICITY ALERT: Serum lithium > 1.2 mmol/L. Withhold lithium, assess for dehydration, tremor, ataxia, dysarthria, and nausea. Check renal function (eGFR) and electrolytes.",
    );
  } else if (level > maxTarget) {
    status = "supratherapeutic";
    severity = "mild";
    clinicalGuidance.push(
      "Level is above target range. Consider dosage reduction and check for concurrent interacting drugs (NSAIDs, ACE inhibitors, thiazides).",
    );
  } else if (level < minTarget) {
    status = "subtherapeutic";
    clinicalGuidance.push(
      "Level is below target range. Assess adherence, timing of last dose (must be exactly 12h post-dose), or need for titration.",
    );
  } else {
    status = "therapeutic";
    clinicalGuidance.push(
      "Level is within standard therapeutic window. Ensure routine 3-6 monthly monitoring of lithium level, eGFR, electrolytes, and thyroid function (TSH).",
    );
  }

  return {
    status,
    isWithinTarget,
    severity,
    targetRange: { min: minTarget, max: maxTarget },
    clinicalGuidance,
  };
}

/**
 * Calculates suggested proportional dose adjustment based on lithium's linear first-order pharmacokinetics.
 * Formula: New Dose = Current Dose * (Target Level / Current Level)
 */
export function calculateProportionalLithiumDose(input: LithiumDoseAdjustmentInput): LithiumDoseAdjustmentResult {
  const errors: string[] = [];

  if (input.currentDoseMg <= 0) {
    errors.push("Current dose must be greater than zero mg");
  }
  if (input.currentLevelMmolL <= 0) {
    errors.push("Current lithium level must be greater than zero mmol/L");
  }
  if (input.targetLevelMmolL <= 0) {
    errors.push("Target lithium level must be greater than zero mmol/L");
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      suggestedDoseMg: null,
      errors,
      note: "Invalid calculation inputs",
    };
  }

  const rawDose = input.currentDoseMg * (input.targetLevelMmolL / input.currentLevelMmolL);
  // Round to nearest practical dosage increment (standard 250mg or 450mg increments, rounded to nearest 50mg)
  const suggestedDoseMg = Math.round(rawDose / 50) * 50;

  return {
    isValid: true,
    suggestedDoseMg,
    errors: [],
    note: "Linear kinetics assumed. Confirm patient has reached steady state (>=5 days at current dose) and sample was drawn exactly 12 hours post-dose. Recheck trough 5-7 days after dosage modification.",
  };
}
