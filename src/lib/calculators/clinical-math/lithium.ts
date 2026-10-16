import type {
  LithiumDoseAdjustmentInput,
  LithiumDoseAdjustmentResult,
  LithiumLevelEvaluation,
  LithiumLevelInput,
  LithiumLevelStatus,
  LithiumToxicitySeverity,
} from "./types";

const SEVERE_TOXICITY_GUIDANCE =
  "CRITICAL: Serum lithium >= 2.0 mmol/L represents severe toxicity requiring immediate cessation, urgent hospital admission, and toxicology/nephrology review. Haemodialysis decisions depend on clinical neurotoxicity, renal function, and EXTRIP extracorporeal criteria (recommended for severe clinical signs regardless of level or > 4.0 mmol/L with impaired kidney function; suggested > 5.0 mmol/L or with significant confusion) rather than an automatic dialysis cutoff at 2.0 mmol/L.";

const MODERATE_TOXICITY_GUIDANCE =
  "TOXICITY ALERT: Serum lithium >= 1.2 mmol/L. Withhold lithium, assess for dehydration, tremor, ataxia, dysarthria, and nausea. Check renal function (eGFR) and electrolytes.";

/**
 * Evaluates serum lithium 12-hour post-dose trough concentration against
 * Australian Therapeutic Guidelines (eTG) and RANZCP clinical monitoring standards.
 */
export function evaluateLithiumLevel(input: LithiumLevelInput): LithiumLevelEvaluation {
  const level = input.serumLevelMmolL;
  const ageKnown = Number.isFinite(input.age) && input.age > 0;
  // The toxicity thresholds do not depend on age, so a toxic level is flagged even before an age
  // is entered. Only the target range, which does depend on age, is withheld.
  if (!ageKnown && Number.isFinite(level) && level >= 1.2) {
    const severe = level >= 2.0;
    return {
      status: "toxic",
      isWithinTarget: false,
      severity: severe ? "severe" : "moderate",
      toxicitySeverity: severe ? "severe" : "moderate",
      requiresUrgentAction: true,
      targetRange: { min: 0, max: 0 },
      targetRangeKnown: false,
      clinicalGuidance: [
        severe ? SEVERE_TOXICITY_GUIDANCE : MODERATE_TOXICITY_GUIDANCE,
        "Enter patient age to see the target range.",
      ],
    };
  }
  if (!ageKnown || !Number.isFinite(level) || level < 0) {
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

  if (level >= 2.0) {
    status = "toxic";
    severity = "severe";
    clinicalGuidance.push(SEVERE_TOXICITY_GUIDANCE);
  } else if (level >= 1.2) {
    status = "toxic";
    severity = "moderate";
    clinicalGuidance.push(MODERATE_TOXICITY_GUIDANCE);
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
    targetRangeKnown: true,
    clinicalGuidance,
  };
}

const VALID_DOSE_INCREMENTS = new Set([50, 125, 225, 250, 450]);

/**
 * Validates inputs for proportional lithium dose adjustment.
 */
export function validateLithiumDoseInput(input: LithiumDoseAdjustmentInput): string[] {
  const errors: string[] = [];
  const incrementMg = input.doseIncrementMg ?? input.tabletIncrementMg ?? 125;

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
    errors.push("Target lithium level must be below the toxic threshold (<1.2 mmol/L)");
  }
  if (!VALID_DOSE_INCREMENTS.has(incrementMg)) {
    errors.push("Dose increment must be a supported tablet strength fraction (50, 125, 225, or 250 mg)");
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
  const incrementMg = input.doseIncrementMg ?? input.tabletIncrementMg ?? 125;
  const suggestedDoseMg = Math.round(rawDose / incrementMg) * incrementMg;
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
  const predictedLevelMmolL = input.currentLevelMmolL * (suggestedDoseMg / input.currentDoseMg);
  if (
    suggestedDoseMg <= 0 ||
    suggestedDoseMg > 2000 ||
    suggestedDoseMg / input.currentDoseMg < 0.5 ||
    suggestedDoseMg / input.currentDoseMg > 2 ||
    predictedLevelMmolL >= 1.2
  ) {
    const error =
      suggestedDoseMg <= 0
        ? "Calculated dose rounds to zero; clinical review required"
        : "Rounded dose exceeds safe dose or predicted lithium level limits and requires clinical review";
    return {
      isValid: false,
      suggestedDoseMg: null,
      rawDoseMg,
      warnings,
      errors: [error],
      note: "Do not use a rounded dose that exceeds safe limits without specialist review.",
    };
  }
  if (suggestedDoseMg !== rawDoseMg) {
    warnings.push(
      `Raw proportional dose (${rawDoseMg} mg) was rounded to the nearest practical Australian tablet increment (${incrementMg} mg -> ${suggestedDoseMg} mg; e.g. Lithicarb 250 mg IR half-tablet = 125 mg, Priadel/Quilonum SR 450 mg half-tablet = 225 mg).`,
    );
  }
  return {
    isValid: true,
    suggestedDoseMg,
    rawDoseMg,
    warnings,
    errors: [],
    note: `Linear kinetics assumed (rounded to nearest ${incrementMg} mg tablet increment). Confirm patient has reached steady state (>=5 days at current dose) and sample was drawn exactly 12 hours post-dose. Recheck trough 5-7 days after dosage modification.`,
  };
}
