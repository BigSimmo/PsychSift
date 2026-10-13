import { describe, expect, it } from "vitest";

import {
  calculateCockcroftGault,
  calculateCkdEpi2021,
  calculateQtc,
  evaluateLithiumLevel,
  calculateProportionalLithiumDose,
} from "@/lib/calculators/clinical-math";

describe("Clinical Math Calculators (CS-001)", () => {
  describe("Renal Clearance: Cockcroft-Gault", () => {
    it("calculates Cockcroft-Gault CrCl for standard male with µmol/L", () => {
      // 50yo male, 70kg, Cr 100 µmol/L:
      // CrCl = (140 - 50) * 70 * 1.23 / 100 = 90 * 70 * 1.23 / 100 = 77.49 mL/min
      const result = calculateCockcroftGault({
        age: 50,
        weightKg: 70,
        sex: "male",
        serumCreatinine: 100,
        creatinineUnit: "umol/L",
      });

      expect(result.isValid).toBe(true);
      expect(result.crClMlMin).toBeCloseTo(77.49, 1);
      expect(result.stage).toBe("mild_impairment"); // 60-89 mL/min
    });

    it("calculates Cockcroft-Gault CrCl for standard female with µmol/L", () => {
      // 50yo female, 70kg, Cr 100 µmol/L:
      // CrCl = (140 - 50) * 70 * 1.04 / 100 = 90 * 70 * 1.04 / 100 = 65.52 mL/min
      const result = calculateCockcroftGault({
        age: 50,
        weightKg: 70,
        sex: "female",
        serumCreatinine: 100,
        creatinineUnit: "umol/L",
      });

      expect(result.isValid).toBe(true);
      expect(result.crClMlMin).toBeCloseTo(65.52, 1);
      expect(result.stage).toBe("mild_impairment");
    });

    it("calculates Cockcroft-Gault CrCl with mg/dL creatinine", () => {
      // 60yo male, 80kg, Cr 1.0 mg/dL:
      // CrCl = (140 - 60) * 80 / (72 * 1.0) = 80 * 80 / 72 = 88.89 mL/min
      const result = calculateCockcroftGault({
        age: 60,
        weightKg: 80,
        sex: "male",
        serumCreatinine: 1.0,
        creatinineUnit: "mg/dL",
      });

      expect(result.isValid).toBe(true);
      expect(result.crClMlMin).toBeCloseTo(88.89, 1);
    });

    it("fails closed on non-physiological or zero/negative inputs", () => {
      const zeroAge = calculateCockcroftGault({
        age: 0,
        weightKg: 70,
        sex: "male",
        serumCreatinine: 100,
        creatinineUnit: "umol/L",
      });
      expect(zeroAge.isValid).toBe(false);
      expect(zeroAge.errors).toContain("Age must be greater than zero");

      const zeroCreatinine = calculateCockcroftGault({
        age: 40,
        weightKg: 70,
        sex: "male",
        serumCreatinine: 0,
        creatinineUnit: "umol/L",
      });
      expect(zeroCreatinine.isValid).toBe(false);
      expect(zeroCreatinine.errors).toContain("Serum creatinine must be greater than zero");

      const negativeWeight = calculateCockcroftGault({
        age: 40,
        weightKg: -5,
        sex: "female",
        serumCreatinine: 80,
        creatinineUnit: "umol/L",
      });
      expect(negativeWeight.isValid).toBe(false);
    });
  });

  describe("Renal Clearance: CKD-EPI 2021 eGFR", () => {
    it("calculates CKD-EPI 2021 eGFR accurately", () => {
      // 55yo female, SCr 0.9 mg/dL
      const result = calculateCkdEpi2021({
        age: 55,
        sex: "female",
        serumCreatinine: 0.9,
        creatinineUnit: "mg/dL",
      });

      expect(result.isValid).toBe(true);
      expect(result.egfr).toBeGreaterThan(60);
      expect(result.stage).toBeDefined();
    });
  });

  describe("Cardiac Safety: QTc Interval Correction", () => {
    it("calculates Bazett, Fridericia, Framingham, and Hodges corrections", () => {
      // QT = 400ms, HR = 60 bpm (RR = 1.0 s)
      // At HR 60, Bazett and Fridericia equal the uncorrected QT: 400ms
      const result = calculateQtc({
        qtMs: 400,
        heartRateBpm: 60,
        sex: "male",
      });

      expect(result.isValid).toBe(true);
      expect(result.bazettMs).toBeCloseTo(400, 0);
      expect(result.fridericiaMs).toBeCloseTo(400, 0);
      expect(result.framinghamMs).toBeCloseTo(400, 0);
      expect(result.hodgesMs).toBeCloseTo(400, 0);
      expect(result.riskCategory).toBe("normal");
    });

    it("identifies prolonged and critical QTc risk (>500ms)", () => {
      // QT = 480ms, HR = 80 bpm -> RR = 0.75s -> sqrt(0.75) = 0.866
      // Bazett QTc = 480 / 0.866 = 554 ms (Critical / TdP risk)
      const result = calculateQtc({
        qtMs: 480,
        heartRateBpm: 80,
        sex: "male",
      });

      expect(result.isValid).toBe(true);
      expect(result.bazettMs).toBeGreaterThan(500);
      expect(result.riskCategory).toBe("critical_torsades_risk");
      expect(result.alerts).toEqual(
        expect.arrayContaining([expect.stringContaining("High risk of Torsades de Pointes")]),
      );
    });

    it("identifies borderline QTc in females (461-480ms)", () => {
      // QT = 440ms, HR = 64 bpm -> RR = 60/64 = 0.9375s -> Fridericia = 440 / (0.9375)^(1/3) ~ 449ms
      // But Bazett = 440 / sqrt(0.9375) ~ 454ms (Normal for female <=460)
      // Let's test female with Bazett 465ms:
      const result = calculateQtc({
        qtMs: 450,
        heartRateBpm: 65,
        sex: "female",
      });

      expect(result.isValid).toBe(true);
      expect(result.bazettMs).toBeGreaterThan(460);
      expect(result.bazettMs).toBeLessThanOrEqual(480);
      expect(result.riskCategory).toBe("borderline");
    });

    it("flags tachycardia kinetic distortion for Bazett formula when HR > 85 bpm", () => {
      const result = calculateQtc({
        qtMs: 340,
        heartRateBpm: 100,
        sex: "female",
      });

      expect(result.isValid).toBe(true);
      expect(result.alerts).toEqual(
        expect.arrayContaining([expect.stringContaining("Fridericia is clinically preferred")]),
      );
    });

    it("fails closed on invalid HR or QT", () => {
      const zeroHr = calculateQtc({
        qtMs: 400,
        heartRateBpm: 0,
        sex: "male",
      });
      expect(zeroHr.isValid).toBe(false);
      expect(zeroHr.errors).toContain("Heart rate must be greater than zero");

      const negativeQt = calculateQtc({
        qtMs: -400,
        heartRateBpm: 75,
        sex: "male",
      });
      expect(negativeQt.isValid).toBe(false);
    });
  });

  describe("Lithium Dosing & Therapeutic Range Helper", () => {
    it("evaluates therapeutic maintenance range (0.6 - 0.8 mmol/L)", () => {
      const result = evaluateLithiumLevel({
        serumLevelMmolL: 0.7,
        indication: "maintenance",
        age: 35,
      });

      expect(result.status).toBe("therapeutic");
      expect(result.isWithinTarget).toBe(true);
      expect(result.targetRange).toEqual({ min: 0.6, max: 0.8 });
    });

    it("evaluates acute mania target (0.8 - 1.0 mmol/L)", () => {
      const result = evaluateLithiumLevel({
        serumLevelMmolL: 0.7,
        indication: "acute_mania",
        age: 35,
      });

      expect(result.status).toBe("subtherapeutic");
      expect(result.isWithinTarget).toBe(false);
      expect(result.targetRange).toEqual({ min: 0.8, max: 1.0 });
    });

    it("flags toxic levels > 1.2 and severe toxicity > 2.0 mmol/L", () => {
      const mildTox = evaluateLithiumLevel({
        serumLevelMmolL: 1.4,
        indication: "maintenance",
        age: 40,
      });
      expect(mildTox.status).toBe("toxic");
      expect(mildTox.severity).toBe("moderate");

      const severeTox = evaluateLithiumLevel({
        serumLevelMmolL: 2.3,
        indication: "maintenance",
        age: 40,
      });
      expect(severeTox.status).toBe("toxic");
      expect(severeTox.severity).toBe("severe_dialysis_threshold");
    });

    it("calculates proportional dose adjustment accurately", () => {
      // Current dose 750mg yields 0.5 mmol/L. Desired target 0.8 mmol/L.
      // New dose = 750 * (0.8 / 0.5) = 1200 mg
      const adjustment = calculateProportionalLithiumDose({
        currentDoseMg: 750,
        currentLevelMmolL: 0.5,
        targetLevelMmolL: 0.8,
      });

      expect(adjustment.isValid).toBe(true);
      expect(adjustment.suggestedDoseMg).toBe(1200);
      expect(adjustment.note).toContain("Linear kinetics");
    });
  });
});

// Owner ruling, 13 Oct 2026: a missing or NaN input shows no result, never a guessed value.
describe("clinical calculators give no result for missing or NaN inputs", () => {
  const bad = [Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number];

  it.each(bad)("Cockcroft-Gault with age %s", (age) => {
    const r = calculateCockcroftGault({
      age,
      weightKg: 70,
      sex: "male",
      serumCreatinine: 80,
      creatinineUnit: "umol/L",
    });
    expect(r.isValid).toBe(false);
    expect(r.crClMlMin).toBeNull();
    expect(r.stage).toBeNull();
  });

  it.each(bad)("CKD-EPI with age %s", (age) => {
    const r = calculateCkdEpi2021({ age, sex: "female", serumCreatinine: 80, creatinineUnit: "umol/L" });
    expect(r.isValid).toBe(false);
    expect(r.egfr).toBeNull();
    expect(r.stage).toBeNull();
  });

  it.each(bad)("CKD-EPI with creatinine %s", (serumCreatinine) => {
    const r = calculateCkdEpi2021({ age: 40, sex: "male", serumCreatinine, creatinineUnit: "umol/L" });
    expect(r.egfr).toBeNull();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("QTc with RR interval %s and no heart rate", (rrIntervalSeconds) => {
    const r = calculateQtc({ qtMs: 400, rrIntervalSeconds, sex: "male" });
    expect(r.isValid).toBe(false);
    expect(r.bazettMs).toBeNull();
    expect(r.riskCategory).toBeNull();
  });

  it.each(bad)("QTc with QT %s", (qtMs) => {
    const r = calculateQtc({ qtMs, heartRateBpm: 60, sex: "female" });
    expect(r.isValid).toBe(false);
    expect(r.bazettMs).toBeNull();
  });

  it("QTc with no heart rate or RR interval", () => {
    expect(calculateQtc({ qtMs: 400, sex: "male" }).bazettMs).toBeNull();
  });

  it.each(bad)("lithium level %s is not classified", (serumLevelMmolL) => {
    const r = evaluateLithiumLevel({ serumLevelMmolL, indication: "maintenance", age: 40 });
    expect(r.status).toBe("invalid");
    expect(r.isWithinTarget).toBe(false);
  });

  it.each(bad)("lithium dose with current level %s", (currentLevelMmolL) => {
    const r = calculateProportionalLithiumDose({ currentDoseMg: 900, currentLevelMmolL, targetLevelMmolL: 0.7 });
    expect(r.isValid).toBe(false);
    expect(r.suggestedDoseMg).toBeNull();
  });
});
