import { describe, expect, it } from "vitest";

import { composeMedicationVerdict } from "@/lib/medication-interactions";
import { getMedicationRecord, loadMedicationSnapshot } from "@/lib/medication-snapshot";
import {
  DEFAULT_THRESHOLD_MARKER,
  ELDERLY_AGE_YEARS,
  evaluatePatientAlerts,
  formatUnassessedSentence,
  isProfileEmpty,
  noticeToneForSemanticTone,
  PAEDIATRIC_AGE_YEARS,
  QTC_PROLONGED_MS,
  RENAL_IMPAIRMENT_EGFR,
  unassessedGateCount,
  type MedicationConsideration,
  type PatientProfile,
} from "@/lib/medication-patient-alerts";
import type { MedicationPatientMetadata, MedicationRecord } from "@/lib/medications";

function recordWith(patient: MedicationPatientMetadata, sectionType = "contra", key = "Test"): MedicationRecord {
  return {
    slug: "test-med",
    name: "Test Med",
    class: "",
    subclass: "",
    category: "",
    accent: "#0f766e",
    tag: "",
    schedule: "",
    stats: [],
    quick: [],
    sections: [{ title: "Test section", type: sectionType, rows: [{ key, val: "row text", patient }] }],
  };
}

function reasons(considerations: MedicationConsideration[]): string[] {
  return considerations.flatMap((consideration) => consideration.reasons);
}

describe("evaluatePatientAlerts — match-key gates", () => {
  it("age gte fires at the boundary and clears below it", () => {
    const record = recordWith({
      factors: ["elderly"],
      action: "caution",
      severity: "danger",
      match: { age: { gte: 65 } },
    });
    expect(reasons(evaluatePatientAlerts(record, { ageYears: 65 }).considerations)).toContain("Age 65 ≥ 65");
    expect(evaluatePatientAlerts(record, { ageYears: 64 }).considerations).toHaveLength(0);
  });

  it("age gt is strict and age lt catches paediatric", () => {
    const gt = recordWith({ factors: ["elderly"], action: "caution", match: { age: { gt: 65 } } });
    expect(evaluatePatientAlerts(gt, { ageYears: 65 }).considerations).toHaveLength(0);
    expect(reasons(evaluatePatientAlerts(gt, { ageYears: 66 }).considerations)).toContain("Age 66 > 65");

    const lt = recordWith({ factors: ["paediatric"], action: "contraindication", match: { age: { lt: 18 } } });
    expect(reasons(evaluatePatientAlerts(lt, { ageYears: 17 }).considerations)).toContain("Age 17 < 18");
    expect(evaluatePatientAlerts(lt, { ageYears: 18 }).considerations).toHaveLength(0);
  });

  it("egfr lt fires below the threshold only", () => {
    const record = recordWith({ factors: ["renal"], action: "caution", match: { egfr: { lt: 30 } } });
    expect(reasons(evaluatePatientAlerts(record, { egfr: 29 }).considerations)).toContain("eGFR 29 < 30 mL/min");
    expect(evaluatePatientAlerts(record, { egfr: 30 }).considerations).toHaveLength(0);
  });

  it("crcl lt is strict while lte includes the edge", () => {
    const lt = recordWith({ factors: ["renal"], action: "dose-adjust", match: { crcl: { lt: 10 } } });
    expect(evaluatePatientAlerts(lt, { crcl: 10 }).considerations).toHaveLength(0);
    expect(reasons(evaluatePatientAlerts(lt, { crcl: 9 }).considerations)).toContain("CrCl 9 < 10 mL/min");

    const lte = recordWith({ factors: ["renal"], action: "dose-adjust", match: { crcl: { lte: 50 } } });
    expect(reasons(evaluatePatientAlerts(lte, { crcl: 50 }).considerations)).toContain("CrCl 50 ≤ 50 mL/min");
    expect(evaluatePatientAlerts(lte, { crcl: 51 }).considerations).toHaveLength(0);
  });

  it("scr gt respects the µmol/L default and converts mg/dL", () => {
    const record = recordWith({ factors: ["renal"], action: "contraindication", match: { scr: { gt: 120 } } });
    expect(reasons(evaluatePatientAlerts(record, { scr: 121 }).considerations)).toContain("SCr 121 > 120 µmol/L");
    expect(evaluatePatientAlerts(record, { scr: 120 }).considerations).toHaveLength(0);
    // 1.5 mg/dL × 88.4 = 132.6 µmol/L > 120
    const converted = evaluatePatientAlerts(record, { scr: 1.5, scrUnit: "mg/dL" });
    expect(reasons(converted.considerations)).toContain("SCr 133 > 120 µmol/L");
    // 1.3 mg/dL × 88.4 = 114.9 µmol/L < 120
    expect(evaluatePatientAlerts(record, { scr: 1.3, scrUnit: "mg/dL" }).considerations).toHaveLength(0);
  });

  it("qtc gte includes the boundary", () => {
    const record = recordWith({ factors: ["qtc"], action: "monitor", match: { qtc: { gte: 450 } } });
    expect(reasons(evaluatePatientAlerts(record, { qtc: 450 }).considerations)).toContain("QTc 450 ≥ 450 ms");
    expect(evaluatePatientAlerts(record, { qtc: 449 }).considerations).toHaveLength(0);
  });

  it("hepatic matches only the listed severities and ignores none", () => {
    const record = recordWith({ factors: ["hepatic"], action: "contraindication", match: { hepatic: ["severe"] } });
    expect(reasons(evaluatePatientAlerts(record, { hepatic: "severe" }).considerations)).toContain(
      "Severe hepatic impairment",
    );
    expect(evaluatePatientAlerts(record, { hepatic: "moderate" }).considerations).toHaveLength(0);
    expect(evaluatePatientAlerts(record, { hepatic: "none" }).considerations).toHaveLength(0);
  });

  it("multiple match keys fire on OR (either criterion)", () => {
    const record = recordWith({
      factors: ["renal", "qtc"],
      action: "contraindication",
      match: { egfr: { lt: 15 }, qtc: { gte: 450 } },
    });
    expect(evaluatePatientAlerts(record, { egfr: 10 }).considerations).toHaveLength(1);
    expect(evaluatePatientAlerts(record, { qtc: 480 }).considerations).toHaveLength(1);
    expect(reasons(evaluatePatientAlerts(record, { egfr: 10, qtc: 480 }).considerations)).toEqual(
      expect.arrayContaining(["eGFR 10 < 15 mL/min", "QTc 480 ≥ 450 ms"]),
    );
  });
});

describe("evaluatePatientAlerts — factor triggers", () => {
  it("pregnancy and lactation fire from profile booleans", () => {
    const preg = recordWith({ factors: ["pregnancy", "lactation"], action: "contraindication", match: {} });
    expect(reasons(evaluatePatientAlerts(preg, { pregnant: true }).considerations)).toContain("Pregnancy");
    expect(reasons(evaluatePatientAlerts(preg, { breastfeeding: true }).considerations)).toContain("Breastfeeding");
    expect(evaluatePatientAlerts(preg, { pregnant: false, breastfeeding: false }).considerations).toHaveLength(0);
  });

  it("allergy factors fire only when the matching class is selected", () => {
    const record = recordWith({ factors: ["allergy-sulfa"], action: "contraindication", match: {} });
    expect(reasons(evaluatePatientAlerts(record, { allergies: ["sulfa"] }).considerations)).toContain("Sulfa allergy");
    expect(evaluatePatientAlerts(record, { allergies: ["penicillin"] }).considerations).toHaveLength(0);
  });

  it("derives renal/qtc/elderly/paediatric factors when no match covers them", () => {
    // Every reason here is marked: none of these numbers came from the medication's own record.
    const renal = recordWith({ factors: ["renal"], action: "dose-adjust", match: {} });
    expect(reasons(evaluatePatientAlerts(renal, { egfr: 45 }).considerations)).toContain(
      `Renal impairment (eGFR 45)${DEFAULT_THRESHOLD_MARKER}`,
    );
    expect(evaluatePatientAlerts(renal, { egfr: 80 }).considerations).toHaveLength(0);

    const qtc = recordWith({ factors: ["qtc"], action: "monitor", match: {} });
    expect(reasons(evaluatePatientAlerts(qtc, { qtc: 470 }).considerations)).toContain(
      `QTc 470 ≥ 450 ms${DEFAULT_THRESHOLD_MARKER}`,
    );

    const elderly = recordWith({ factors: ["elderly"], action: "caution", match: {} });
    expect(reasons(evaluatePatientAlerts(elderly, { ageYears: 80 }).considerations)).toContain(
      `Age 80 ≥ 65${DEFAULT_THRESHOLD_MARKER}`,
    );

    const paed = recordWith({ factors: ["paediatric"], action: "caution", match: {} });
    expect(reasons(evaluatePatientAlerts(paed, { ageYears: 5 }).considerations)).toContain(
      `Age 5 < 18${DEFAULT_THRESHOLD_MARKER}`,
    );
  });

  /**
   * The fallback constants are not the defect -- they are correctly reached only when the
   * medication's own record has no covering `match` key, and that precedence is already pinned
   * below. The defect is that a reason they produce used to read EXACTLY like a catalogue-derived
   * one: `QTc 465 ≥ 470 ms` from the record and `QTc 465 ≥ 450 ms` from this file, same shape,
   * same badge, nothing to tell a prescriber which number they are looking at.
   *
   * The `unassessed` machinery does not cover it. That reports a missing INPUT; this is an
   * unsourced THRESHOLD, and a prescriber would treat the two differently.
   *
   * Raised by the 2026-09-17 external audit (its finding C5), which framed it as the fallbacks
   * firing wrongly. They do not. This is the part of that finding that survived checking.
   */
  describe("provenance of fallback thresholds", () => {
    it("marks a reason derived from a default threshold", () => {
      const record = recordWith({ factors: ["qtc"], action: "monitor", match: {} });
      const [reason] = reasons(evaluatePatientAlerts(record, { qtc: 470 }).considerations);
      expect(reason).toContain(DEFAULT_THRESHOLD_MARKER);
    });

    it("leaves a catalogue-derived reason unmarked, so the marker means something", () => {
      // A test that only checked the marker's presence would pass just as happily if every
      // reason carried it, which would make it noise rather than information.
      const record = recordWith({ factors: ["qtc"], action: "monitor", match: { qtc: { gte: 500 } } });
      const [reason] = reasons(evaluatePatientAlerts(record, { qtc: 510 }).considerations);
      expect(reason).toBe("QTc 510 ≥ 500 ms");
      expect(reason).not.toContain(DEFAULT_THRESHOLD_MARKER);
    });

    it("pins the threshold values themselves", () => {
      // These are clinical numbers with no citation in the repository, and the comment beside
      // them still carries an undischarged "confirm against the BigSimmo/Medications reference".
      // Pinned so changing one is a deliberate, reviewed act rather than a drive-by edit.
      expect(RENAL_IMPAIRMENT_EGFR).toBe(60);
      expect(QTC_PROLONGED_MS).toBe(450);
      expect(ELDERLY_AGE_YEARS).toBe(65);
      expect(PAEDIATRIC_AGE_YEARS).toBe(18);
    });

    it("records that QTc cannot be sex-specific here, because sex is not collected", () => {
      // Conventional QTc thresholds differ by sex (~450 ms male, ~470 ms female). PatientProfile
      // has no sex field at all, so the single value is not a shortcut -- the input does not
      // exist. The direction is the safe one: 450 is the LOWER cut-off, so it over-triggers for
      // a female patient rather than missing her. Recorded here rather than silently changed,
      // because collecting sex is a product and privacy decision, not a code fix.
      const record = recordWith({ factors: ["qtc"], action: "monitor", match: {} });
      const profile: Record<string, unknown> = { qtc: 460, sex: "female" };
      const fired = reasons(evaluatePatientAlerts(record, profile as never).considerations);
      expect(fired).toEqual([`QTc 460 ≥ 450 ms${DEFAULT_THRESHOLD_MARKER}`]);
    });
  });

  it("does not double-report a factor already covered by a match key", () => {
    // acamprosate "Absolute" row: factors:["renal"] + match:{scr:{gt:120}}
    const record = getMedicationRecord("acamprosate");
    expect(record).toBeTruthy();
    const result = evaluatePatientAlerts(record!, { scr: 150 });
    const absolute = result.considerations.filter((c) => c.rowKey === "Absolute");
    expect(absolute).toHaveLength(1);
    expect(absolute[0].reasons).toEqual(["SCr 150 > 120 µmol/L"]);
    expect(reasons(result.considerations).some((r) => r.startsWith("Renal impairment"))).toBe(false);
  });
});

describe("evaluatePatientAlerts — partial / empty profile and unassessed", () => {
  it("only evaluates supplied fields, and reports the unread gate in the advisory tier", () => {
    const record = recordWith({ factors: ["renal"], action: "caution", match: { egfr: { lt: 30 } } });
    // eGFR not supplied → the caution row does not fire, but the criterion was
    // never evaluated, so it is stated as an advisory gap. It must NOT reach the
    // contraindication tier, which drives the verdict's green→grey degrade.
    const result = evaluatePatientAlerts(record, { ageYears: 40 });
    expect(result.considerations).toHaveLength(0);
    expect(result.unassessed).toHaveLength(0);
    expect(result.unassessedAdvisory).toEqual(["eGFR"]);
    expect(result.unassessedAdvisoryCount).toBe(1);
    // Supplied and non-firing: assessed, so neither tier reports a gap.
    const assessed = evaluatePatientAlerts(record, { ageYears: 40, egfr: 50 });
    expect(assessed.considerations).toHaveLength(0);
    expect(assessed.unassessed).toHaveLength(0);
    expect(assessed.unassessedAdvisory).toHaveLength(0);
    expect(assessed.unassessedAdvisoryCount).toBe(0);
  });

  it("keeps collecting a row's remaining gates after it fires on another one", () => {
    // Fires on pregnancy while eGFR is blank: the renal criterion is still
    // unevaluated, and a fired row reporting no gap was the second discard.
    const contra = recordWith({
      factors: ["pregnancy", "renal"],
      action: "contraindication",
      match: { egfr: { lt: 30 } },
    });
    const fired = evaluatePatientAlerts(contra, { pregnant: true });
    expect(reasons(fired.considerations)).toContain("Pregnancy");
    expect(fired.unassessed).toEqual(["eGFR"]);
    expect(fired.unassessedAdvisory).toHaveLength(0);

    const advisory = recordWith({
      factors: ["pregnancy", "renal"],
      action: "dose-adjust",
      match: { egfr: { lt: 30 } },
    });
    const firedAdvisory = evaluatePatientAlerts(advisory, { pregnant: true });
    expect(reasons(firedAdvisory.considerations)).toContain("Pregnancy");
    expect(firedAdvisory.unassessed).toHaveLength(0);
    expect(firedAdvisory.unassessedAdvisory).toEqual(["eGFR"]);
    expect(firedAdvisory.unassessedAdvisoryCount).toBe(1);
  });

  it("lets an advisory-tier gap block the result-row all-clear, matching the detail page", () => {
    // Owner decision 25 Oct 2026: the list verdict reads both tiers, exactly as
    // the detail-page considerations notice does, so an unread eGFR on a
    // caution row degrades a would-be green row to grey instead of reading clear.
    const record = recordWith({ factors: ["renal"], action: "caution", match: { egfr: { lt: 30 } } });
    const alerts = evaluatePatientAlerts(record, { ageYears: 40 });
    expect(alerts.unassessed).toHaveLength(0);
    expect(alerts.unassessedAdvisory).toHaveLength(1);
    expect(unassessedGateCount(alerts)).toBe(1);
    const verdict = composeMedicationVerdict({
      considerationTone: alerts.highestTone,
      considerationCount: alerts.considerations.length,
      unassessedCount: unassessedGateCount(alerts),
      interactionTone: null,
      interactionCount: 0,
      unresolvedRowCount: 0,
      unreachableCounterpartyCount: 0,
    });
    expect(verdict.tone).toBe("neutral");
    expect(verdict.incomplete).toBe(true);
  });

  it("routes info rows with missing gates to the advisory tier, never contraindication", () => {
    const record = recordWith({ factors: ["renal"], action: "info", match: { egfr: { lt: 30 } } });
    const result = evaluatePatientAlerts(record, { ageYears: 40 });
    expect(result.unassessed).toHaveLength(0);
    expect(result.unassessedAdvisory).toEqual(["eGFR"]);
    expect(result.unassessedAdvisoryCount).toBe(1);
  });

  it("counts advisory entries as rows, not as inputs", () => {
    const record: MedicationRecord = {
      ...recordWith({ factors: ["renal"], action: "monitor", match: { egfr: { lt: 30 } } }),
      sections: [
        {
          title: "Test section",
          type: "mon",
          rows: [
            {
              key: "A",
              val: "row text",
              patient: { factors: ["renal"], action: "monitor", match: { egfr: { lt: 30 } } },
            },
            {
              key: "B",
              val: "row text",
              patient: { factors: ["renal"], action: "dose-adjust", match: { egfr: { lt: 20 } } },
            },
            {
              key: "C",
              val: "row text",
              patient: { factors: ["qtc"], action: "caution", match: { qtc: { gte: 450 } } },
            },
          ],
        },
      ],
    };
    const result = evaluatePatientAlerts(record, { ageYears: 40 });
    // One shared input across two rows plus a second input: three entries, two inputs.
    expect(result.unassessedAdvisory).toEqual(["QTc", "eGFR"]);
    expect(result.unassessedAdvisoryCount).toBe(3);
  });

  it("flags a contraindication gate that could not be assessed", () => {
    const record = recordWith({ factors: ["renal"], action: "contraindication", match: { egfr: { lt: 30 } } });
    // Some input present (so profile is non-empty) but eGFR missing.
    const result = evaluatePatientAlerts(record, { pregnant: true });
    expect(result.considerations).toHaveLength(0);
    expect(result.unassessed).toContain("eGFR");
    // Once eGFR is supplied and safe, it is neither a consideration nor unassessed.
    const assessed = evaluatePatientAlerts(record, { egfr: 50 });
    expect(assessed.considerations).toHaveLength(0);
    expect(assessed.unassessed).toHaveLength(0);
  });

  it("treats a recorded hepatic 'none' as assessed, and a never-entered one as a gap", () => {
    const record = recordWith({ factors: ["hepatic"], action: "contraindication", match: { hepatic: ["severe"] } });
    // "None" is a real answer: the criterion was evaluated and did not fire.
    const recorded = evaluatePatientAlerts(record, { ageYears: 40, hepatic: "none" });
    expect(recorded.considerations).toHaveLength(0);
    expect(recorded.unassessed).toHaveLength(0);
    expect(recorded.unassessedAdvisory).toHaveLength(0);
    // Never entered: the same blank the panel used to store for "None".
    const notRecorded = evaluatePatientAlerts(record, { ageYears: 40 });
    expect(notRecorded.considerations).toHaveLength(0);
    expect(notRecorded.unassessed).toEqual(["hepatic status"]);
  });

  it("treats an empty profile as empty and surfaces no considerations", () => {
    expect(isProfileEmpty({})).toBe(true);
    expect(isProfileEmpty({ scrUnit: "umol/L", allergies: [] })).toBe(true);
    expect(isProfileEmpty({ pregnant: true })).toBe(false);
    expect(isProfileEmpty({ egfr: 40 })).toBe(false);
    expect(isProfileEmpty({ hepatic: "none" })).toBe(false);
    const record = getMedicationRecord("acamprosate");
    expect(evaluatePatientAlerts(record!, {}).considerations).toHaveLength(0);
  });
});

describe("evaluatePatientAlerts — bare-renal fail-safe (no false all-clear on partial input)", () => {
  it("surfaces unassessed when one renal input is missing and the other is present-and-normal", () => {
    const record = recordWith({ factors: ["renal"], action: "contraindication", match: {} });
    // eGFR missing, CrCl present and non-firing (>=60): must NOT read as a silent
    // all-clear — a renal contraindication clears only when BOTH inputs are present.
    const egfrMissing = evaluatePatientAlerts(record, { crcl: 90 });
    expect(egfrMissing.considerations).toHaveLength(0);
    expect(egfrMissing.unassessed).toContain("eGFR or CrCl");
    // Symmetric: CrCl missing, eGFR present-and-normal.
    const crclMissing = evaluatePatientAlerts(record, { egfr: 90 });
    expect(crclMissing.unassessed).toContain("eGFR or CrCl");
  });

  it("clears only when both renal inputs are present and non-firing", () => {
    const record = recordWith({ factors: ["renal"], action: "contraindication", match: {} });
    const result = evaluatePatientAlerts(record, { egfr: 90, crcl: 90 });
    expect(result.considerations).toHaveLength(0);
    expect(result.unassessed).toHaveLength(0);
  });

  it("still fires renal impairment on a low input", () => {
    const record = recordWith({ factors: ["renal"], action: "contraindication", match: {} });
    expect(reasons(evaluatePatientAlerts(record, { egfr: 20 }).considerations)).toContain(
      `Renal impairment (eGFR 20)${DEFAULT_THRESHOLD_MARKER}`,
    );
  });

  it("routes a non-contraindication bare-renal row to the advisory tier, never the blocking one", () => {
    // Every existing bare-renal row in the corpus is advisory
    // (monitor/dose-adjust/caution/info). The ||-guard fires for them too, but
    // its gate belongs in the advisory tier: `unassessed` stays
    // contraindication-only so the verdict's green→grey degrade keeps its meaning.
    const record = recordWith({ factors: ["renal"], action: "monitor", match: {} });
    const result = evaluatePatientAlerts(record, { crcl: 90 });
    expect(result.considerations).toHaveLength(0);
    expect(result.unassessed).toHaveLength(0);
    expect(result.unassessedAdvisory).toEqual(["eGFR or CrCl"]);
    expect(result.unassessedAdvisoryCount).toBe(1);
    // Both renal inputs present and non-firing: assessed at the advisory tier too.
    const both = evaluatePatientAlerts(record, { egfr: 90, crcl: 90 });
    expect(both.unassessed).toHaveLength(0);
    expect(both.unassessedAdvisory).toHaveLength(0);
  });

  it("surfaces unassessedAdvisory for info rows with missing gates", () => {
    const record = recordWith({ factors: ["renal"], action: "info", match: { egfr: { lt: 30 } } });
    const result = evaluatePatientAlerts(record, { ageYears: 40 });
    expect(result.considerations).toHaveLength(0);
    expect(result.unassessed).toHaveLength(0);
    expect(result.unassessedAdvisory).toEqual(["eGFR"]);
    expect(result.unassessedAdvisoryCount).toBe(1);

    // Supplying the gate clears the unassessed advisory
    const assessed = evaluatePatientAlerts(record, { egfr: 90 });
    expect(assessed.considerations).toHaveLength(0);
    expect(assessed.unassessed).toHaveLength(0);
    expect(assessed.unassessedAdvisory).toHaveLength(0);
    expect(assessed.unassessedAdvisoryCount).toBe(0);
  });
});

describe("evaluatePatientAlerts — real records", () => {
  it("flags celecoxib for both NSAID and sulfa allergy", () => {
    const record = getMedicationRecord("celecoxib");
    expect(record).toBeTruthy();
    const nsaid = evaluatePatientAlerts(record!, { allergies: ["nsaid"] });
    expect(reasons(nsaid.considerations)).toContain("NSAID allergy");
    const sulfa = evaluatePatientAlerts(record!, { allergies: ["sulfa"] });
    expect(reasons(sulfa.considerations)).toContain("Sulfa allergy");
    expect(sulfa.considerations.some((c) => c.tone === "danger")).toBe(true);
  });

  it("orders considerations by severity, danger first", () => {
    const record = getMedicationRecord("acamprosate");
    const result = evaluatePatientAlerts(record!, { scr: 200, ageYears: 80, hepatic: "severe", pregnant: true });
    expect(result.considerations.length).toBeGreaterThan(1);
    const priority = { danger: 6, warning: 5, clinical: 4, success: 3, neutral: 2, info: 1 } as const;
    for (let i = 1; i < result.considerations.length; i += 1) {
      expect(priority[result.considerations[i - 1].tone]).toBeGreaterThanOrEqual(
        priority[result.considerations[i].tone],
      );
    }
    expect(result.highestTone).toBe("danger");
  });

  it("evaluates the whole corpus with a full profile without throwing", () => {
    const records = loadMedicationSnapshot();
    const profile: PatientProfile = {
      ageYears: 82,
      egfr: 20,
      crcl: 18,
      scr: 200,
      hepatic: "severe",
      qtc: 520,
      pregnant: true,
      breastfeeding: true,
      allergies: ["penicillin", "sulfa", "nsaid", "cephalosporin", "macrolide", "fluoroquinolone"],
    };
    for (const record of records) {
      const result = evaluatePatientAlerts(record, profile);
      for (const consideration of result.considerations) {
        expect(consideration.reasons.length).toBeGreaterThan(0);
        expect(consideration.tone).toBeTruthy();
      }
    }
    // A broadly-affected drug should surface at least one consideration.
    const acamprosate = evaluatePatientAlerts(getMedicationRecord("acamprosate")!, profile);
    expect(acamprosate.considerations.length).toBeGreaterThan(0);
  });
});

describe("noticeToneForSemanticTone", () => {
  it("maps clinical to info and passes the rest through", () => {
    expect(noticeToneForSemanticTone("clinical")).toBe("info");
    expect(noticeToneForSemanticTone("danger")).toBe("danger");
    expect(noticeToneForSemanticTone("warning")).toBe("warning");
    expect(noticeToneForSemanticTone("success")).toBe("success");
    expect(noticeToneForSemanticTone("info")).toBe("info");
    expect(noticeToneForSemanticTone("neutral")).toBe("neutral");
  });
});

describe("formatUnassessedSentence", () => {
  it("returns empty string for empty unassessed list", () => {
    expect(formatUnassessedSentence([])).toBe("");
  });

  it("formats single unassessed gate into sentence", () => {
    expect(formatUnassessedSentence(["eGFR"])).toBe(
      "Enter eGFR to fully assess this medication's contraindications and clinical advisories.",
    );
  });

  it("formats multiple unassessed gates separated by comma", () => {
    expect(formatUnassessedSentence(["eGFR", "hepatic function", "QTc"])).toBe(
      "Enter eGFR, hepatic function, QTc to fully assess this medication's contraindications and clinical advisories.",
    );
  });
});
