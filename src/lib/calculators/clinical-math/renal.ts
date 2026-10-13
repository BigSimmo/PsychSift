import type { CkdEpiInput, CkdEpiResult, CockcroftGaultInput, CockcroftGaultResult, RenalStage } from "./types";

/**
 * CKD-EPI and Cockcroft-Gault are adult equations. Under 18 they give no result
 * (owner decision, 13 Oct 2026 10:23 PM AWST).
 */
export const PAEDIATRIC_RENAL_MESSAGE =
  "Not calculated: CKD-EPI and Cockcroft-Gault are validated for adults (18 years and over) only. For patients under 18, use a paediatric method such as the bedside Schwartz equation and seek paediatric advice.";

function classifyRenalStage(value: number): RenalStage {
  if (value >= 90) return "normal";
  if (value >= 60) return "mild_impairment";
  if (value >= 30) return "moderate_impairment";
  if (value >= 15) return "severe_impairment";
  return "kidney_failure";
}

/**
 * Cockcroft-Gault Creatinine Clearance (CrCl) calculation.
 * Standard Australian and international nephrology formula for psychotropic dose adjustment
 * (e.g. Lithium, Gabapentin, Pregabalin, Amisulpride).
 */
export function calculateCockcroftGault(input: CockcroftGaultInput): CockcroftGaultResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Missing or NaN inputs give no result, never a guessed value (owner ruling, 13 Oct 2026).
  if (!Number.isFinite(input.age) || input.age <= 0) {
    errors.push("Age must be greater than zero");
  } else if (input.age < 18) {
    errors.push(PAEDIATRIC_RENAL_MESSAGE);
  } else if (input.age > 120) {
    errors.push("Age exceeds physiological bounds (>120 years)");
  }

  if (!Number.isFinite(input.weightKg) || input.weightKg <= 0) {
    errors.push("Weight must be greater than zero kg");
  } else if (input.weightKg > 350) {
    errors.push("Weight exceeds physiological bounds (>350 kg)");
  }

  if (!Number.isFinite(input.serumCreatinine) || input.serumCreatinine <= 0) {
    errors.push("Serum creatinine must be greater than zero");
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      crClMlMin: null,
      stage: null,
      errors,
      warnings,
    };
  }

  let crCl: number;
  if (input.creatinineUnit === "umol/L") {
    // Standard Australasian formula: (140 - age) * weight * factor / SCr (umol/L)
    // Factor: 1.23 for males, 1.04 for females
    const factor = input.sex === "female" ? 1.04 : 1.23;
    crCl = ((140 - input.age) * input.weightKg * factor) / input.serumCreatinine;
  } else {
    // US formula: (140 - age) * weight / (72 * SCr) * (0.85 if female)
    const factor = input.sex === "female" ? 0.85 : 1.0;
    crCl = (((140 - input.age) * input.weightKg) / (72 * input.serumCreatinine)) * factor;
  }

  const rounded = Math.round(crCl * 100) / 100;
  if (!Number.isFinite(rounded)) {
    return {
      isValid: false,
      crClMlMin: null,
      stage: null,
      errors: ["Calculated creatinine clearance is not finite"],
      warnings,
    };
  }
  return {
    isValid: true,
    crClMlMin: rounded,
    stage: classifyRenalStage(rounded),
    errors: [],
    warnings,
  };
}

/**
 * 2021 CKD-EPI Creatinine Equation (Race-Free).
 * Recommended by KDIGO and Australian guidelines for estimated glomerular filtration rate (eGFR).
 */
export function calculateCkdEpi2021(input: CkdEpiInput): CkdEpiResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Number.isFinite(input.age) || input.age <= 0 || input.age > 120) {
    errors.push("Age must be between 1 and 120 years");
  } else if (input.age < 18) {
    errors.push(PAEDIATRIC_RENAL_MESSAGE);
  }
  if (!Number.isFinite(input.serumCreatinine) || input.serumCreatinine <= 0) {
    errors.push("Serum creatinine must be greater than zero");
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      egfr: null,
      stage: null,
      errors,
      warnings,
    };
  }

  // Convert to mg/dL if supplied in umol/L
  const scrMgDl = input.creatinineUnit === "umol/L" ? input.serumCreatinine / 88.42 : input.serumCreatinine;

  const isFemale = input.sex === "female";
  const kappa = isFemale ? 0.7 : 0.9;
  const alpha = isFemale ? -0.241 : -0.302;
  const sexMultiplier = isFemale ? 1.012 : 1.0;

  const scrOverKappa = scrMgDl / kappa;
  const minTerm = Math.min(scrOverKappa, 1) ** alpha;
  const maxTerm = Math.max(scrOverKappa, 1) ** -1.2;
  const ageTerm = 0.9938 ** input.age;

  const egfr = 142 * minTerm * maxTerm * ageTerm * sexMultiplier;
  const rounded = Math.round(egfr * 10) / 10;
  if (!Number.isFinite(rounded)) {
    return { isValid: false, egfr: null, stage: null, errors: ["Calculated eGFR is not finite"], warnings };
  }

  return {
    isValid: true,
    egfr: rounded,
    stage: classifyRenalStage(rounded),
    errors: [],
    warnings,
  };
}
