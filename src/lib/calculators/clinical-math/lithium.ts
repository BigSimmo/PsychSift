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
  const level = input.serumLevelMmolL;
  if (!Number.isFinite(input.age) || input.age <= 0 || !Number.isFinite(level) || level < 0) {
    return {
      status: "invalid",
      isWithinTarget: false,
      severity: "none",
      toxicitySeverity: "none",
      requiresUrgentAction: false,
      targetRange: { min: 0, max: 0 },
      clinicalGuidance: ["Invalid lithium age or serum concentration; do not use this result for clinical decisions."],
    };
  }
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

  const isWithinTarget = level >= minTarget && level <= maxTarget;

  let status: LithiumLevelStatus;
  let severity: LithiumToxicitySeverity = "none";
  const clinicalGuidance: string[] = [];

  if (level > 2.0) {
    status = "toxic";
    severity = "severe";
    clinicalGuidance.push(
      "CRITICAL: Serum lithium > 2.0 mmol/L is a medical emergency. High risk of severe neurotoxicity, acute renal injury, and seizures. Immediate cessation, urgent hospital assessment, IV hydration, and Toxicology / Nephrology consultation are required (hemodialysis is typically indicated at > 4.0 mmol/L, or > 2.5 mmol/L with severe neurological toxicity or renal impairment).",
    );
  } else if (level >= 1.2) {
    status = "toxic";
    severity = "moderate";
    clinicalGuidance.push(
      "TOXICITY ALERT: Serum lithium >= 1.2 mmol/L. Withhold lithium, assess for dehydration, tremor, ataxia, dysarthria, and nausea. Check renal function (eGFR/CrCl) and electrolytes.",
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
    toxicitySeverity: severity,
    requiresUrgentAction: status === "toxic",
    targetRange: { min: minTarget, max: maxTarget },
    clinicalGuidance,
  };
}

/**
 * Validates inputs for proportional lithium dose adjustment.
 */
export function validateLithiumDoseInput(input: LithiumDoseAdjustmentInput): string[] {
  const errors: string[] = [];

  if (!Number.isFinite(input.currentDoseMg) || input.currentDoseMg <= 0) {
    errors.push("Current dose must be greater than zero mg");
  }
  if (!Number.isFinite(input.currentLevelMmolL) || input.currentLevelMmolL <= 0) {
    errors.push("Current lithium level must be greater than zero mmol/L");
  } else if (input.currentLevelMmolL >= 1.2) {
    errors.push(
      "Current lithium level is in the toxic range (>=1.2 mmol/L); evaluate for toxicity rather than titrating dose",
    );
  }
  if (!Number.isFinite(input.targetLevelMmolL) || input.targetLevelMmolL <= 0) {
    errors.push("Target lithium level must be greater than zero mmol/L");
  } else if (input.targetLevelMmolL >= 1.2) {
    errors.push("Target lithium level must not reach or exceed the toxic threshold (>=1.2 mmol/L)");
  }
  if (
    input.tabletIncrementMg !== undefined &&
    (!Number.isFinite(input.tabletIncrementMg) || input.tabletIncrementMg <= 0)
  ) {
    errors.push("Tablet increment must be a positive number.");
  }

  return errors;
}

/**
 * Calculates suggested proportional dose adjustment based on lithium's linear first-order pharmacokinetics.
 * Formula: New Dose = Current Dose * (Target Level / Current Level)
 */
export function calculateProportionalLithiumDose(input: LithiumDoseAdjustmentInput): LithiumDoseAdjustmentResult {
  const errors = validateLithiumDoseInput(input);
  const warnings: string[] = [];

  if (errors.length > 0) {
    return {
      isValid: false,
      suggestedDoseMg: null,
      rawDoseMg: null,
      warnings,
      errors,
      note: "Invalid calculation inputs",
    };
  }

  const ratio = input.targetLevelMmolL / input.currentLevelMmolL;
  const rawDose = input.currentDoseMg * ratio;
  const rawDoseMg = Math.round(rawDose);
  const increment = input.tabletIncrementMg ?? 125;
  const suggestedDoseMg = Math.round(rawDose / increment) * increment;
  // Fail closed on adjustments beyond a two-fold change or an unsafe absolute dose (raw or rounded).
  if (!Number.isFinite(ratio) || ratio < 0.5 || ratio > 2 || rawDose > 2000 || suggestedDoseMg > 2000) {
    return {
      isValid: false,
      suggestedDoseMg: null,
      rawDoseMg: Number.isFinite(rawDoseMg) ? rawDoseMg : null,
      warnings,
      errors: ["Calculated dose adjustment is outside safe limits and requires clinical review"],
      note: "Do not use an extreme proportional adjustment without specialist review.",
    };
  }
  if (suggestedDoseMg <= 0) {
    return {
      isValid: false,
      suggestedDoseMg: null,
      rawDoseMg,
      warnings,
      errors: ["Calculated dose rounds to zero; clinical review required"],
      note: "Calculated dose rounds to zero; clinical review required.",
    };
  }

  if (suggestedDoseMg !== rawDoseMg) {
    warnings.push(
      `Raw proportional dose (${rawDoseMg} mg) was rounded to the nearest practical Australian tablet increment (${increment} mg -> ${suggestedDoseMg} mg; e.g. Lithicarb 250 mg IR half-tablet = 125 mg, Priadel/Quilonum SR 450 mg half-tablet = 225 mg).`,
    );
  }

  return {
    isValid: true,
    suggestedDoseMg,
    rawDoseMg,
    warnings,
    errors: [],
    note: "Linear kinetics assumed. Confirm patient has reached steady state (>=5 days at current dose) and sample was drawn exactly 12 hours post-dose. Recheck trough 5-7 days after dosage modification.",
  };
}
