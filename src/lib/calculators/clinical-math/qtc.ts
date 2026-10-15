import type { QtcInput, QtcResult, QtcRiskCategory } from "./types";

/**
 * Calculates corrected QT interval using Bazett, Fridericia, Framingham, and Hodges equations.
 * Essential for monitoring cardiac repolarization in psychotropic prescribing
 * (antipsychotics, tricyclics, citalopram/escitalopram, methadone).
 */
export function calculateQtc(input: QtcInput): QtcResult {
  const errors: string[] = [];
  const alerts: string[] = [];

  if (!Number.isFinite(input.qtMs) || input.qtMs < 150 || input.qtMs > 800) {
    errors.push("QT interval must be within physiological range (150–800 ms; enter milliseconds, not seconds)");
  }

  let rrSeconds: number;
  let hr: number;

  // Missing or NaN inputs give no result, never a guessed value (owner ruling, 13 Oct 2026).
  if (
    input.rrIntervalSeconds !== undefined &&
    Number.isFinite(input.rrIntervalSeconds) &&
    input.rrIntervalSeconds > 0
  ) {
    rrSeconds = input.rrIntervalSeconds;
    if (rrSeconds < 0.24 || rrSeconds > 3.0) {
      errors.push("RR interval must be between 0.24 and 3.00 seconds (convert milliseconds to seconds first)");
    }
    hr = 60 / rrSeconds;
  } else if (input.heartRateBpm !== undefined && Number.isFinite(input.heartRateBpm) && input.heartRateBpm > 0) {
    hr = input.heartRateBpm;
    rrSeconds = 60 / hr;
  } else {
    errors.push("Heart rate must be greater than zero");
    return {
      isValid: false,
      bazettMs: null,
      fridericiaMs: null,
      framinghamMs: null,
      hodgesMs: null,
      riskCategory: null,
      alerts: [],
      errors,
    };
  }

  if (hr < 20 || hr > 250) {
    errors.push("Heart rate must be within physiological range (20–250 bpm)");
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      bazettMs: null,
      fridericiaMs: null,
      framinghamMs: null,
      hodgesMs: null,
      riskCategory: null,
      alerts: [],
      errors,
    };
  }

  // Formula calculations (QT in ms, RR in seconds)
  const bazett = input.qtMs / Math.sqrt(rrSeconds);
  const fridericia = input.qtMs / Math.cbrt(rrSeconds);
  const framingham = input.qtMs + 154 * (1 - rrSeconds);
  const hodges = input.qtMs + 1.75 * (hr - 60);

  if (![bazett, fridericia, framingham, hodges].every(Number.isFinite)) {
    return {
      isValid: false,
      bazettMs: null,
      fridericiaMs: null,
      framinghamMs: null,
      hodgesMs: null,
      riskCategory: null,
      alerts: [],
      errors: ["Calculated QTc is not finite"],
    };
  }

  // Kinetic rate cautions
  if (hr > 85) {
    alerts.push(
      "Bazett formula exhibits substantial kinetic overcorrection at heart rates >85 bpm; Fridericia is clinically preferred for tachycardia.",
    );
  } else if (hr < 60) {
    alerts.push("Bazett formula exhibits undercorrection at bradycardic heart rates (<60 bpm).");
  }

  // Risk categorization (use Fridericia when HR > 85 bpm to avoid kinetic overcorrection; Bazett at normal/low rates)
  const isFemale = input.sex === "female";
  const primaryQtc = hr > 85 ? fridericia : bazett;

  let riskCategory: QtcRiskCategory;
  if (primaryQtc >= 500) {
    riskCategory = "critical_torsades_risk";
    alerts.push(
      "High risk of Torsades de Pointes (QTc >= 500 ms). Strongly consider suspending QTc-prolonging psychotropics, check electrolytes (K+, Mg2+, Ca2+), and obtain cardiology consultation.",
    );
  } else if ((isFemale && primaryQtc > 480) || (!isFemale && primaryQtc > 470)) {
    riskCategory = "prolonged";
    alerts.push("Prolonged QTc interval. Monitor serial ECGs and avoid adding concurrent QTc-prolonging agents.");
  } else if ((isFemale && primaryQtc > 460) || (!isFemale && primaryQtc > 450)) {
    riskCategory = "borderline";
  } else {
    riskCategory = "normal";
  }

  return {
    isValid: true,
    bazettMs: Math.round(bazett),
    fridericiaMs: Math.round(fridericia),
    framinghamMs: Math.round(framingham),
    hodgesMs: Math.round(hodges),
    riskCategory,
    alerts,
    errors: [],
  };
}
