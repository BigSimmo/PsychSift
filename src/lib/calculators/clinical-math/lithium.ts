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
    // A level alone is not a dialysis threshold (owner decision, 13 Oct 2026 10:23 PM AWST).
    // Extracorporeal treatment is decided on clinical criteria, EXTRIP-style.
    status = "toxic";
    severity = "severe";
    clinicalGuidance.push(
      "URGENT: Serum lithium > 2.0 mmol/L. Stop lithium and arrange urgent medical assessment. Discuss with a toxicologist or Poisons Information Centre (13 11 26).",
      "Whether to use haemodialysis depends on clinical criteria, not this level alone: severity and clinical features (reduced consciousness, seizures, dysrhythmias, confusion), renal function, the trajectory of repeat levels, and acute versus chronic exposure (EXTRIP).",
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

  if (!Number.isFinite(input.currentDoseMg) || input.currentDoseMg <= 0) {
    errors.push("Current dose must be greater than zero mg");
  }
  if (!Number.isFinite(input.currentLevelMmolL) || input.currentLevelMmolL <= 0) {
    errors.push("Current lithium level must be greater than zero mmol/L");
  }
  if (!Number.isFinite(input.targetLevelMmolL) || input.targetLevelMmolL <= 0) {
    errors.push("Target lithium level must be greater than zero mmol/L");
  } else if (input.targetLevelMmolL > 1.2) {
    errors.push("Target lithium level must not exceed 1.2 mmol/L");
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      suggestedDoseMg: null,
      errors,
      note: "Invalid calculation inputs",
    };
  }

  const ratio = input.targetLevelMmolL / input.currentLevelMmolL;
  const rawDose = input.currentDoseMg * ratio;
  // Fail closed on adjustments beyond a two-fold change or an unsafe absolute dose.
  if (!Number.isFinite(ratio) || ratio < 0.5 || ratio > 2 || rawDose > 2000) {
    return {
      isValid: false,
      suggestedDoseMg: null,
      errors: ["Calculated dose adjustment is outside safe limits and requires clinical review"],
      note: "Do not use an extreme proportional adjustment without specialist review.",
    };
  }
  const suggestedDoseMg = Math.round(rawDose / 50) * 50;

  return {
    isValid: true,
    suggestedDoseMg,
    errors: [],
    note: "Linear kinetics assumed. Confirm patient has reached steady state (>=5 days at current dose) and sample was drawn exactly 12 hours post-dose. Recheck trough 5-7 days after dosage modification.",
  };
}
