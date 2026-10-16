import type {
  BiologicalSex,
  CkdEpiInput,
  CkdEpiResult,
  CockcroftGaultInput,
  CockcroftGaultResult,
  RenalStage,
} from "./types";

function classifyRenalStage(value: number): RenalStage {
  if (value >= 90) return "normal";
  if (value >= 60) return "mild_impairment";
  if (value >= 30) return "moderate_impairment";
  if (value >= 15) return "severe_impairment";
  return "kidney_failure";
}

/**
 * Devine formula for Ideal Body Weight (IBW) in kilograms.
 * Used by Australian Medicines Handbook (AMH) and Therapeutic Guidelines (eTG)
 * when actual body weight exceeds IBW in Cockcroft-Gault renal clearance estimation.
 */
export function calculateIdealBodyWeightKg(heightCm: number, sex: BiologicalSex): number {
  const baseKg = sex === "female" ? 45.5 : 50;
  const ibw = baseKg + 0.9 * (heightCm - 152.4);
  return Math.round(ibw * 10) / 10;
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
    errors.push(
      "Cockcroft-Gault is validated only for adult populations (>=18 years). Use bedside Schwartz equation for pediatric patients.",
    );
  } else if (input.age > 120) {
    errors.push("Age exceeds physiological bounds (>120 years)");
  }

  if (!Number.isFinite(input.weightKg) || input.weightKg <= 0) {
    errors.push("Weight must be greater than zero kg");
  } else if (input.weightKg < 20) {
    errors.push("Weight is below adult physiological bounds (<20 kg)");
  } else if (input.weightKg > 350) {
    errors.push("Weight exceeds physiological bounds (>350 kg)");
  } else if (input.weightKg < 35) {
    warnings.push(
      "Low body weight (<35 kg): Cockcroft-Gault may overestimate creatinine clearance in cachexia or low muscle mass.",
    );
  }

  if (input.heightCm !== undefined) {
    if (!Number.isFinite(input.heightCm) || input.heightCm < 120 || input.heightCm > 230) {
      errors.push("Height must be within adult physiological range (120–230 cm)");
    }
  }

  if (!Number.isFinite(input.serumCreatinine) || input.serumCreatinine <= 0) {
    errors.push("Serum creatinine must be greater than zero");
  } else if (input.creatinineUnit === "umol/L" && (input.serumCreatinine < 15 || input.serumCreatinine > 3000)) {
    errors.push("Serum creatinine must be within physiological range (15–3000 umol/L; check unit selection)");
  } else if (input.creatinineUnit === "mg/dL" && (input.serumCreatinine < 0.17 || input.serumCreatinine > 34.0)) {
    errors.push("Serum creatinine must be within physiological range (0.17–34.0 mg/dL; check unit selection)");
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      crClMlMin: null,
      stage: null,
      ibwKg: null,
      effectiveWeightKg: null,
      errors,
      warnings,
    };
  }

  let ibwKg: number | null = null;
  let effectiveWeightKg = input.weightKg;
  let weightBasis: "actual" | "ideal" = "actual";

  if (input.heightCm !== undefined) {
    ibwKg = calculateIdealBodyWeightKg(input.heightCm, input.sex);
    if (ibwKg < 20) {
      warnings.push(
        "Devine Ideal Body Weight formula is not validated at this height (computed IBW < 20 kg); actual body weight was used. Seek specialist pharmacist input for renal dosing.",
      );
    } else if (input.weightKg > ibwKg) {
      effectiveWeightKg = ibwKg;
      weightBasis = "ideal";
      warnings.push(
        `Actual weight (${input.weightKg} kg) exceeds Ideal Body Weight (${ibwKg} kg): using IBW per AMH / eTG guidance to prevent Cockcroft-Gault overestimation in overweight or obesity.`,
      );
    }
  } else if (input.weightKg >= 85) {
    warnings.push(
      "Weight >= 85 kg without height supplied: Cockcroft-Gault using actual body weight overestimates renal clearance in overweight or obese patients. Supply height to use Ideal Body Weight (IBW) per AMH / eTG.",
    );
  }

  let crCl: number;
  if (input.creatinineUnit === "umol/L") {
    // Standard Australasian formula: (140 - age) * weight * factor / SCr (umol/L)
    // Factor: 1.23 for males, 1.04 for females
    const factor = input.sex === "female" ? 1.04 : 1.23;
    crCl = ((140 - input.age) * effectiveWeightKg * factor) / input.serumCreatinine;
  } else {
    // US formula: (140 - age) * weight / (72 * SCr) * (0.85 if female)
    const factor = input.sex === "female" ? 0.85 : 1.0;
    crCl = (((140 - input.age) * effectiveWeightKg) / (72 * input.serumCreatinine)) * factor;
  }

  const rounded = Math.round(crCl * 100) / 100;
  if (!Number.isFinite(rounded)) {
    return {
      isValid: false,
      crClMlMin: null,
      stage: null,
      ibwKg,
      effectiveWeightKg,
      weightBasis,
      errors: ["Calculated creatinine clearance is not finite"],
      warnings,
    };
  }

  const lithiumClinicalNote =
    rounded < 60
      ? "Renal impairment (CrCl < 60 mL/min): lithium clearance is reduced; lower doses and closer serum monitoring are required (avoid or seek specialist advice in severe impairment)."
      : "Confirm baseline renal function before initiating renally cleared psychotropics (lithium, amisulpride, pregabalin, gabapentin, paliperidone).";

  return {
    isValid: true,
    crClMlMin: rounded,
    stage: classifyRenalStage(rounded),
    ibwKg,
    effectiveWeightKg,
    weightBasis,
    lithiumClinicalNote,
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
    errors.push(
      "CKD-EPI 2021 is validated only for adult populations (>=18 years). Use pediatric equations for patients under 18.",
    );
  }
  if (!Number.isFinite(input.serumCreatinine) || input.serumCreatinine <= 0) {
    errors.push("Serum creatinine must be greater than zero");
  } else if (input.creatinineUnit === "umol/L" && (input.serumCreatinine < 15 || input.serumCreatinine > 3000)) {
    errors.push("Serum creatinine must be within physiological range (15–3000 umol/L; check unit selection)");
  } else if (input.creatinineUnit === "mg/dL" && (input.serumCreatinine < 0.17 || input.serumCreatinine > 34.0)) {
    errors.push("Serum creatinine must be within physiological range (0.17–34.0 mg/dL; check unit selection)");
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
