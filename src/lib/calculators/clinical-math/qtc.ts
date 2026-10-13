import type { QtcInput, QtcResult, QtcRiskCategory } from "./types";

/**
 * Calculates corrected QT interval using Bazett, Fridericia, Framingham, and Hodges equations.
 * Essential for monitoring cardiac repolarization in psychotropic prescribing
 * (antipsychotics, tricyclics, citalopram/escitalopram, methadone).
 */
export function calculateQtc(input: QtcInput): QtcResult {
  const errors: string[] = [];
  const alerts: string[] = [];

  if (!Number.isFinite(input.qtMs) || input.qtMs <= 0 || input.qtMs > 1000) {
    errors.push("QT interval must be greater than zero and within physiological range (<=1000 ms)");
  }

  let rrSeconds: number;
  let hr: number;

  if (input.rrIntervalSeconds !== undefined && input.rrIntervalSeconds > 0) {
    rrSeconds = input.rrIntervalSeconds;
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

  if (hr > 250) {
    errors.push("Heart rate exceeds physiological range (>250 bpm)");
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

  // Kinetic rate cautions
  if (hr > 85) {
    alerts.push(
      "Bazett formula exhibits substantial kinetic overcorrection at heart rates >85 bpm; Fridericia is clinically preferred for tachycardia.",
    );
  } else if (hr < 60) {
    alerts.push("Bazett formula exhibits undercorrection at bradycardic heart rates (<60 bpm).");
  }

  // Risk categorization (primarily based on Bazett as standard Australian baseline, with Fridericia comparison)
  const isFemale = input.sex === "female";
  const primaryQtc = bazett;

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
