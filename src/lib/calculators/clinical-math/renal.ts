import type {
  BiologicalSex,
  CkdEpiInput,
  CkdEpiResult,
  CockcroftGaultInput,
  CockcroftGaultResult,
  CreatinineUnit,
  RenalStage,
} from "./types";

function classifyRenalStage(value: number): RenalStage {
  if (value >= 90) return "normal";
  if (value >= 60) return "mild_impairment";
  if (value >= 30) return "moderate_impairment";
  if (value >= 15) return "severe_impairment";
  return "kidney_failure";
}

function computeRawCrCl(
  age: number,
  weightKg: number,
  sex: BiologicalSex,
  serumCreatinine: number,
  creatinineUnit: CreatinineUnit,
): number {
  if (creatinineUnit === "umol/L") {
    // Standard Australasian formula: (140 - age) * weight * factor / SCr (umol/L)
    // Factor: 1.23 for males, 1.04 for females
    const factor = sex === "female" ? 1.04 : 1.23;
    return ((140 - age) * weightKg * factor) / serumCreatinine;
  }
  // US formula: (140 - age) * weight / (72 * SCr) * (0.85 if female)
  const factor = sex === "female" ? 0.85 : 1.0;
  return (((140 - age) * weightKg) / (72 * serumCreatinine)) * factor;
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
      errors,
      warnings,
    };
  }

  if (input.heightCm !== undefined) {
    if (Number.isFinite(input.heightCm) && input.heightCm >= 120 && input.heightCm <= 230) {
      const rawIbw = (input.sex === "male" ? 50 : 45.5) + 0.9 * (input.heightCm - 152.4);
      const ibwKg = Math.round(rawIbw * 10) / 10;
      if (ibwKg > 0 && input.weightKg > ibwKg) {
        const abwKg = Math.round((ibwKg + 0.4 * (input.weightKg - ibwKg)) * 10) / 10;
        const ibwCrCl =
          Math.round(computeRawCrCl(input.age, ibwKg, input.sex, input.serumCreatinine, input.creatinineUnit) * 100) /
          100;
        const abwCrCl =
          Math.round(computeRawCrCl(input.age, abwKg, input.sex, input.serumCreatinine, input.creatinineUnit) * 100) /
          100;
        const excessLabel =
          input.weightKg > ibwKg * 1.2 ? "exceeds Ideal Body Weight by >20%" : "exceeds Ideal Body Weight";
        warnings.push(
          `Actual weight (${input.weightKg} kg) ${excessLabel} (Devine IBW: ${ibwKg.toFixed(1)} kg; Adjusted Body Weight: ${abwKg.toFixed(1)} kg). Australian Therapeutic Guidelines / Cockcroft-Gault use Ideal Body Weight (CrCl ${ibwCrCl} mL/min) or Adjusted Body Weight (CrCl ${abwCrCl} mL/min) in overweight/obese patients so CrCl is not overestimated for renally cleared drugs like lithium.`,
        );
      }
    } else {
      warnings.push(
        "Height outside adult Devine IBW range (120–230 cm); Ideal Body Weight not calculated. Australian Therapeutic Guidelines / Cockcroft-Gault use Ideal or Adjusted Body Weight in overweight/obese patients so CrCl is not overestimated for renally cleared drugs like lithium.",
      );
    }
  } else if (input.weightKg >= 90) {
    warnings.push(
      "Weight >= 90 kg (height omitted): Australian Therapeutic Guidelines / Cockcroft-Gault use Ideal Body Weight (IBW) or Adjusted Body Weight (ABW) in overweight/obese patients so CrCl is not overestimated for renally cleared drugs like lithium (provide heightCm to compute Devine IBW/ABW).",
    );
  }

  const crCl = computeRawCrCl(input.age, input.weightKg, input.sex, input.serumCreatinine, input.creatinineUnit);

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
