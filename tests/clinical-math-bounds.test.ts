// @vitest-environment jsdom
import "./setup/jsdom.setup";

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement as h } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ClinicalMathPanel } from "@/components/calculators/clinical-math-panel";
import { PatientProfileProvider } from "@/components/clinical-dashboard/patient-profile-context";
import { PatientProfilePanel } from "@/components/clinical-dashboard/patient-profile-panel";
import { TextField } from "@/components/ui/text-field";
import { calculateProportionalLithiumDose, evaluateLithiumLevel } from "@/lib/calculators/clinical-math/lithium";
import { calculateQtc } from "@/lib/calculators/clinical-math/qtc";
import { calculateCkdEpi2021, calculateCockcroftGault } from "@/lib/calculators/clinical-math/renal";

describe("Clinical Math Physiological Bounds & Input Ergonomics", () => {
  describe("calculateQtc physiological bounds (P0-2)", () => {
    it("rejects QT interval below 150 ms (e.g. seconds entered instead of milliseconds) and above 800 ms", () => {
      const tooLowSeconds = calculateQtc({ qtMs: 0.42, heartRateBpm: 60, sex: "male" });
      expect(tooLowSeconds.isValid).toBe(false);
      expect(tooLowSeconds.bazettMs).toBeNull();
      expect(tooLowSeconds.errors).toContain(
        "QT interval must be within physiological range (150–800 ms; enter milliseconds, not seconds)",
      );

      const belowMin = calculateQtc({ qtMs: 149, heartRateBpm: 60, sex: "female" });
      expect(belowMin.isValid).toBe(false);
      expect(belowMin.errors).toContain(
        "QT interval must be within physiological range (150–800 ms; enter milliseconds, not seconds)",
      );

      const aboveMax = calculateQtc({ qtMs: 801, heartRateBpm: 60, sex: "female" });
      expect(aboveMax.isValid).toBe(false);
      expect(aboveMax.errors).toContain(
        "QT interval must be within physiological range (150–800 ms; enter milliseconds, not seconds)",
      );
    });

    it("accepts QT interval at exact boundaries (150 ms and 800 ms)", () => {
      expect(calculateQtc({ qtMs: 150, heartRateBpm: 60, sex: "male" }).isValid).toBe(true);
      expect(calculateQtc({ qtMs: 800, heartRateBpm: 60, sex: "male" }).isValid).toBe(true);
    });

    it("rejects RR interval outside 0.24–3.00 seconds (e.g. milliseconds entered as seconds)", () => {
      const msEnteredAsSeconds = calculateQtc({ qtMs: 400, rrIntervalSeconds: 800, sex: "male" });
      expect(msEnteredAsSeconds.isValid).toBe(false);
      expect(msEnteredAsSeconds.errors).toContain(
        "RR interval must be between 0.24 and 3.00 seconds (convert milliseconds to seconds first)",
      );

      const tooShortRr = calculateQtc({ qtMs: 400, rrIntervalSeconds: 0.23, sex: "female" });
      expect(tooShortRr.isValid).toBe(false);
      expect(tooShortRr.errors).toContain(
        "RR interval must be between 0.24 and 3.00 seconds (convert milliseconds to seconds first)",
      );

      const tooLongRr = calculateQtc({ qtMs: 400, rrIntervalSeconds: 3.01, sex: "female" });
      expect(tooLongRr.isValid).toBe(false);
      expect(tooLongRr.errors).toContain(
        "RR interval must be between 0.24 and 3.00 seconds (convert milliseconds to seconds first)",
      );
    });

    it("accepts RR interval at exact boundaries (0.24 s and 3.00 s)", () => {
      expect(calculateQtc({ qtMs: 400, rrIntervalSeconds: 0.24, sex: "male" }).isValid).toBe(true);
      expect(calculateQtc({ qtMs: 400, rrIntervalSeconds: 3.0, sex: "male" }).isValid).toBe(true);
    });

    it("rejects heart rate below 20 bpm and above 250 bpm", () => {
      const bradyOut = calculateQtc({ qtMs: 400, heartRateBpm: 19, sex: "male" });
      expect(bradyOut.isValid).toBe(false);
      expect(bradyOut.errors).toContain("Heart rate must be within physiological range (20–250 bpm)");

      const tachyOut = calculateQtc({ qtMs: 400, heartRateBpm: 251, sex: "female" });
      expect(tachyOut.isValid).toBe(false);
      expect(tachyOut.errors).toContain("Heart rate must be within physiological range (20–250 bpm)");
    });

    it("accepts heart rate at exact boundaries (20 bpm and 250 bpm)", () => {
      expect(calculateQtc({ qtMs: 400, heartRateBpm: 20, sex: "male" }).isValid).toBe(true);
      expect(calculateQtc({ qtMs: 400, heartRateBpm: 250, sex: "female" }).isValid).toBe(true);
    });
  });

  describe("calculateCockcroftGault & calculateCkdEpi2021 physiological bounds (P0-1)", () => {
    it("rejects adult weight below 20 kg and warns below 35 kg in calculateCockcroftGault", () => {
      const lowWeight = calculateCockcroftGault({
        age: 45,
        weightKg: 19.9,
        sex: "female",
        serumCreatinine: 80,
        creatinineUnit: "umol/L",
      });
      expect(lowWeight.isValid).toBe(false);
      expect(lowWeight.crClMlMin).toBeNull();
      expect(lowWeight.errors).toContain("Weight is below adult physiological bounds (<20 kg)");

      const minWeight = calculateCockcroftGault({
        age: 45,
        weightKg: 20,
        sex: "female",
        serumCreatinine: 80,
        creatinineUnit: "umol/L",
      });
      expect(minWeight.isValid).toBe(true);
      expect(minWeight.warnings).toContain(
        "Low body weight (<35 kg): Cockcroft-Gault may overestimate creatinine clearance in cachexia or low muscle mass.",
      );
    });

    it("rejects height outside 120–230 cm when heightCm is provided", () => {
      const tooShort = calculateCockcroftGault({
        age: 45,
        weightKg: 70,
        heightCm: 119,
        sex: "female",
        serumCreatinine: 80,
        creatinineUnit: "umol/L",
      });
      expect(tooShort.isValid).toBe(false);
      expect(tooShort.errors).toContain("Height must be within adult physiological range (120–230 cm)");

      const tooTall = calculateCockcroftGault({
        age: 45,
        weightKg: 70,
        heightCm: 231,
        sex: "male",
        serumCreatinine: 80,
        creatinineUnit: "umol/L",
      });
      expect(tooTall.isValid).toBe(false);
      expect(tooTall.errors).toContain("Height must be within adult physiological range (120–230 cm)");
    });

    it("enforces unit-aware serum creatinine bounds (15–3000 umol/L and 0.17–34.0 mg/dL) in Cockcroft-Gault", () => {
      const unitMismatchLowUmol = calculateCockcroftGault({
        age: 50,
        weightKg: 70,
        sex: "male",
        serumCreatinine: 1.1,
        creatinineUnit: "umol/L",
      });
      expect(unitMismatchLowUmol.isValid).toBe(false);
      expect(unitMismatchLowUmol.errors).toContain(
        "Serum creatinine must be within physiological range (15–3000 umol/L; check unit selection)",
      );

      const aboveMaxUmol = calculateCockcroftGault({
        age: 50,
        weightKg: 70,
        sex: "male",
        serumCreatinine: 3001,
        creatinineUnit: "umol/L",
      });
      expect(aboveMaxUmol.isValid).toBe(false);
      expect(aboveMaxUmol.errors).toContain(
        "Serum creatinine must be within physiological range (15–3000 umol/L; check unit selection)",
      );

      const unitMismatchHighMgDl = calculateCockcroftGault({
        age: 50,
        weightKg: 70,
        sex: "male",
        serumCreatinine: 90,
        creatinineUnit: "mg/dL",
      });
      expect(unitMismatchHighMgDl.isValid).toBe(false);
      expect(unitMismatchHighMgDl.errors).toContain(
        "Serum creatinine must be within physiological range (0.17–34.0 mg/dL; check unit selection)",
      );

      const belowMinMgDl = calculateCockcroftGault({
        age: 50,
        weightKg: 70,
        sex: "male",
        serumCreatinine: 0.16,
        creatinineUnit: "mg/dL",
      });
      expect(belowMinMgDl.isValid).toBe(false);
      expect(belowMinMgDl.errors).toContain(
        "Serum creatinine must be within physiological range (0.17–34.0 mg/dL; check unit selection)",
      );

      expect(
        calculateCockcroftGault({
          age: 50,
          weightKg: 70,
          sex: "male",
          serumCreatinine: 15,
          creatinineUnit: "umol/L",
        }).isValid,
      ).toBe(true);
      expect(
        calculateCockcroftGault({
          age: 50,
          weightKg: 70,
          sex: "male",
          serumCreatinine: 3000,
          creatinineUnit: "umol/L",
        }).isValid,
      ).toBe(true);
      expect(
        calculateCockcroftGault({
          age: 50,
          weightKg: 70,
          sex: "male",
          serumCreatinine: 0.17,
          creatinineUnit: "mg/dL",
        }).isValid,
      ).toBe(true);
      expect(
        calculateCockcroftGault({
          age: 50,
          weightKg: 70,
          sex: "male",
          serumCreatinine: 34.0,
          creatinineUnit: "mg/dL",
        }).isValid,
      ).toBe(true);
    });

    it("enforces unit-aware serum creatinine bounds (15–3000 umol/L and 0.17–34.0 mg/dL) in CKD-EPI 2021", () => {
      const lowUmol = calculateCkdEpi2021({
        age: 50,
        sex: "female",
        serumCreatinine: 14.9,
        creatinineUnit: "umol/L",
      });
      expect(lowUmol.isValid).toBe(false);
      expect(lowUmol.errors).toContain(
        "Serum creatinine must be within physiological range (15–3000 umol/L; check unit selection)",
      );

      const highUmol = calculateCkdEpi2021({
        age: 50,
        sex: "female",
        serumCreatinine: 3001,
        creatinineUnit: "umol/L",
      });
      expect(highUmol.isValid).toBe(false);
      expect(highUmol.errors).toContain(
        "Serum creatinine must be within physiological range (15–3000 umol/L; check unit selection)",
      );

      const lowMgDl = calculateCkdEpi2021({
        age: 50,
        sex: "female",
        serumCreatinine: 0.16,
        creatinineUnit: "mg/dL",
      });
      expect(lowMgDl.isValid).toBe(false);
      expect(lowMgDl.errors).toContain(
        "Serum creatinine must be within physiological range (0.17–34.0 mg/dL; check unit selection)",
      );

      const highMgDl = calculateCkdEpi2021({
        age: 50,
        sex: "female",
        serumCreatinine: 34.1,
        creatinineUnit: "mg/dL",
      });
      expect(highMgDl.isValid).toBe(false);
      expect(highMgDl.errors).toContain(
        "Serum creatinine must be within physiological range (0.17–34.0 mg/dL; check unit selection)",
      );

      expect(
        calculateCkdEpi2021({ age: 50, sex: "female", serumCreatinine: 15, creatinineUnit: "umol/L" }).isValid,
      ).toBe(true);
      expect(
        calculateCkdEpi2021({ age: 50, sex: "female", serumCreatinine: 0.17, creatinineUnit: "mg/dL" }).isValid,
      ).toBe(true);
    });

    it("provides Devine IBW and Adjusted Body Weight warnings and flags unassessed weight selection when heightCm is omitted", () => {
      const standardWithoutHeight = calculateCockcroftGault({
        age: 50,
        weightKg: 70,
        sex: "male",
        serumCreatinine: 100,
        creatinineUnit: "umol/L",
      });
      expect(standardWithoutHeight.crClMlMin).toBeCloseTo(77.49, 1);
      expect(standardWithoutHeight.warnings).toEqual([
        expect.stringMatching(/Height omitted \(weight selection unassessed\)/i),
      ]);

      const standardWithHeight = calculateCockcroftGault({
        age: 50,
        weightKg: 70,
        heightCm: 175,
        sex: "male",
        serumCreatinine: 100,
        creatinineUnit: "umol/L",
      });
      expect(standardWithHeight.warnings).toEqual([]);

      const withHeightOverweight = calculateCockcroftGault({
        age: 50,
        weightKg: 88,
        heightCm: 165,
        sex: "female",
        serumCreatinine: 80,
        creatinineUnit: "umol/L",
      });
      expect(withHeightOverweight.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/Devine IBW:.*Adjusted Body Weight:/i)]),
      );
    });
  });

  describe("Lithium >= 1.2 mmol/L boundary and Australian 125 mg tablet rounding (#08216B)", () => {
    it("treats 1.2 mmol/L consistently as toxic across evaluateLithiumLevel and calculateProportionalLithiumDose", () => {
      const evalAtBoundary = evaluateLithiumLevel({
        serumLevelMmolL: 1.2,
        indication: "acute_mania",
        age: 35,
      });
      expect(evalAtBoundary.status).toBe("toxic");
      expect(evalAtBoundary.severity).toBe("moderate");

      const doseAtCurrentBoundary = calculateProportionalLithiumDose({
        currentDoseMg: 1000,
        currentLevelMmolL: 1.2,
        targetLevelMmolL: 0.8,
      });
      expect(doseAtCurrentBoundary.isValid).toBe(false);

      const doseAtTargetBoundary = calculateProportionalLithiumDose({
        currentDoseMg: 750,
        currentLevelMmolL: 0.8,
        targetLevelMmolL: 1.2,
      });
      expect(doseAtTargetBoundary.isValid).toBe(false);
    });

    it("rounds proportional lithium doses to 125 mg (half of a 250 mg Australian tablet) by default", () => {
      const res = calculateProportionalLithiumDose({
        currentDoseMg: 500,
        currentLevelMmolL: 0.45,
        targetLevelMmolL: 0.7,
      });
      // 500 * (0.7 / 0.45) = 777.78 mg -> nearest 125 mg is 750 mg (3 x 250 mg tablets)
      expect(res.isValid).toBe(true);
      expect(res.suggestedDoseMg).toBe(750);
    });
  });

  describe("TextField wheel-blur, PatientProfilePanel, and ClinicalMathPanel bedside UI (P1-6)", () => {
    beforeEach(() => {
      window.sessionStorage.clear();
    });

    it("blurs type='number' inputs on wheel events while preserving caller onWheel", () => {
      const onWheel = vi.fn();
      render(
        h(
          "div",
          null,
          h(TextField, { label: "Numeric field", type: "number", onWheel }),
          h(TextField, { label: "Text field", type: "text" }),
        ),
      );

      const numberInput = screen.getByLabelText("Numeric field");
      numberInput.focus();
      expect(document.activeElement).toBe(numberInput);

      fireEvent.wheel(numberInput);
      expect(document.activeElement).not.toBe(numberInput);
      expect(onWheel).toHaveBeenCalledTimes(1);

      const textInput = screen.getByLabelText("Text field");
      textInput.focus();
      expect(document.activeElement).toBe(textInput);
      fireEvent.wheel(textInput);
      expect(document.activeElement).toBe(textInput);
    });

    it("sets step='1' for µmol/L and step='0.01' for mg/dL on the PatientProfilePanel Serum creatinine input", async () => {
      const user = userEvent.setup();
      render(h(PatientProfileProvider, null, h(PatientProfilePanel, { defaultOpen: true })));

      const scrUmolInput = screen.getByTestId("patient-scr");
      expect(scrUmolInput).toHaveAttribute("step", "1");

      await user.click(screen.getByRole("radio", { name: "mg/dL" }));
      const scrMgDlInput = screen.getByTestId("patient-scr");
      expect(scrMgDlInput).toHaveAttribute("step", "0.01");
    });

    it("renders ClinicalMathPanel bedside tabs for Renal, QTc, and Lithium calculators", async () => {
      const user = userEvent.setup();
      render(h(ClinicalMathPanel, { defaultOpen: true }));

      // 1. Verify empty-state prompts with zero fabricated patient numbers or error banners
      const renalResults = screen.getByTestId("clinical-math-renal-results");
      expect(renalResults).toBeInTheDocument();
      expect(renalResults).toHaveTextContent(
        "Enter patient age and serum creatinine above to calculate eGFR. Add weight for Cockcroft-Gault CrCl.",
      );
      expect(renalResults).not.toHaveTextContent("92.25");
      expect(screen.queryByTestId("clinical-math-renal-errors")).toBeNull();

      await user.click(screen.getByTestId("clinical-math-tab-qtc"));
      const qtcResults = screen.getByTestId("clinical-math-qtc-results");
      expect(qtcResults).toBeInTheDocument();
      expect(qtcResults).toHaveTextContent(
        "Enter measured QT interval and heart rate above to calculate corrected QT (QTc).",
      );
      expect(qtcResults).not.toHaveTextContent("417 ms");
      expect(screen.queryByTestId("clinical-math-qtc-errors")).toBeNull();

      await user.click(screen.getByTestId("clinical-math-tab-lithium"));
      const lithiumResults = screen.getByTestId("clinical-math-lithium-results");
      expect(lithiumResults).toBeInTheDocument();
      expect(lithiumResults).toHaveTextContent(
        "Enter current 12-hour trough level and patient age above to evaluate lithium status.",
      );
      expect(lithiumResults).not.toHaveTextContent("Level status: invalid");
      expect(lithiumResults).not.toHaveTextContent("875 mg/day");
      expect(screen.getByTestId("clinical-math-lithium-suggested-dose")).toHaveTextContent(
        "Enter current daily dose and target level above to calculate proportional dose adjustment.",
      );
      expect(screen.queryByTestId("clinical-math-lithium-dose-errors")).toBeNull();

      // 2. Populate Renal inputs and verify CKD-EPI partial state + full Cockcroft-Gault (97.38 mL/min)
      await user.click(screen.getByTestId("clinical-math-tab-renal"));
      fireEvent.change(screen.getByTestId("clinical-math-age"), { target: { value: "45" } });
      fireEvent.change(screen.getByTestId("clinical-math-creatinine"), { target: { value: "90" } });
      expect(screen.getByTestId("clinical-math-renal-results")).toHaveTextContent("Enter weight to calculate CrCl");
      expect(screen.queryByTestId("clinical-math-renal-errors")).toBeNull();

      fireEvent.change(screen.getByTestId("clinical-math-weight"), { target: { value: "75" } });
      expect(screen.getByTestId("clinical-math-renal-results")).toHaveTextContent("97.38 mL/min");

      // 3. Populate QTc inputs and verify Fridericia QTc (417 ms)
      await user.click(screen.getByTestId("clinical-math-tab-qtc"));
      fireEvent.change(screen.getByTestId("clinical-math-qt"), { target: { value: "400" } });
      fireEvent.change(screen.getByTestId("clinical-math-hr"), { target: { value: "68" } });
      expect(screen.getByTestId("clinical-math-qtc-results")).toHaveTextContent("417 ms");

      // 4. Populate Lithium inputs and verify therapeutic status and proportional dose (875 mg/day)
      await user.click(screen.getByTestId("clinical-math-tab-lithium"));
      fireEvent.change(screen.getByTestId("clinical-math-lithium-level"), { target: { value: "0.7" } });
      expect(screen.getByTestId("clinical-math-lithium-results")).toHaveTextContent(
        "Level status: therapeutic (target 0.6–0.8 mmol/L)",
      );
      expect(screen.queryByTestId("clinical-math-lithium-dose-errors")).toBeNull();

      fireEvent.change(screen.getByTestId("clinical-math-lithium-dose"), { target: { value: "750" } });
      fireEvent.change(screen.getByTestId("clinical-math-lithium-target"), { target: { value: "0.8" } });
      expect(screen.getByTestId("clinical-math-lithium-suggested-dose")).toHaveTextContent("875 mg/day");
    });
  });
});
