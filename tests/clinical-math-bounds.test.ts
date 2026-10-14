// @vitest-environment jsdom
import "./setup/jsdom.setup";

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement as h } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PatientProfileProvider } from "@/components/clinical-dashboard/patient-profile-context";
import { PatientProfilePanel } from "@/components/clinical-dashboard/patient-profile-panel";
import { TextField } from "@/components/ui/text-field";
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
    it("rejects adult weight below 25 kg in calculateCockcroftGault", () => {
      const lowWeight = calculateCockcroftGault({
        age: 45,
        weightKg: 24.9,
        sex: "female",
        serumCreatinine: 80,
        creatinineUnit: "umol/L",
      });
      expect(lowWeight.isValid).toBe(false);
      expect(lowWeight.crClMlMin).toBeNull();
      expect(lowWeight.errors).toContain("Weight is below adult physiological bounds (<25 kg)");

      const minWeight = calculateCockcroftGault({
        age: 45,
        weightKg: 25,
        sex: "female",
        serumCreatinine: 80,
        creatinineUnit: "umol/L",
      });
      expect(minWeight.isValid).toBe(true);
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
  });

  describe("TextField wheel-blur and PatientProfilePanel creatinine step (P1-6)", () => {
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
  });
});
