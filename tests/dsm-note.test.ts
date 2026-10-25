import { describe, expect, it } from "vitest";

import { dsmDiagnoses, dsmSpecifierSplit } from "@/lib/dsm";
import {
  buildDsmDiagnosisNote,
  dsmNoteBuilderRecord,
  dsmSelectableSpecifiers,
  plainClinicalText,
  type DsmNoteCriterion,
  type DsmNoteInput,
} from "@/lib/dsm-note";

const panic = dsmDiagnoses.find((diagnosis) => diagnosis.slug === "panic-disorder")!;

function noteInput(criteria: DsmNoteCriterion[], overrides: Partial<DsmNoteInput> = {}): DsmNoteInput {
  return {
    title: "Panic disorder",
    icdCode: "F41.0",
    // These cases exercise the note mechanics against real criteria. The
    // key-feature wording is held separately in dsm-criteria-provenance.test.ts.
    isDsmCriteria: true,
    criteria,
    specifiers: [],
    specifierText: "",
    excludedDifferentials: [],
    includeCriterionText: true,
    ...overrides,
  };
}

describe("plainClinicalText", () => {
  it("spells out threshold characters rather than dropping them", () => {
    expect(plainClinicalText("≥4 of 13 symptoms")).toBe("at least 4 of 13 symptoms");
    expect(plainClinicalText("BMI ≤17 kg/m²")).toBe("BMI no more than 17 kg/m2");
    expect(plainClinicalText("within ≈1 minute")).toBe("within approximately 1 minute");
    expect(plainClinicalText("≥3×/week")).toBe("at least 3x/week");
  });

  it("replaces arrows, dashes and curly quotes", () => {
    expect(plainClinicalText("Restriction of energy intake → low body weight")).toBe(
      "Restriction of energy intake leading to low body weight",
    );
    expect(plainClinicalText("mood + ↑energy")).toBe("mood + increased energy");
    expect(plainClinicalText("2–3 days")).toBe("2-3 days");
    expect(plainClinicalText("the “index” episode")).toBe('the "index" episode');
  });

  it("folds semicolons to commas", () => {
    expect(plainClinicalText("palpitations; sweating; trembling")).toBe("palpitations, sweating, trembling");
  });

  it("leaves accented clinical terms intact", () => {
    expect(plainClinicalText("khyâl-related anxiety")).toBe("khyâl-related anxiety");
    expect(plainClinicalText("Guillain-Barré")).toBe("Guillain-Barré");
  });

  it("emits no character outside Latin-1 across the whole catalogue", () => {
    const allowed = /^[\x20-\x7E -ÿ\n]*$/;
    for (const diagnosis of dsmDiagnoses) {
      for (const criterion of diagnosis.key_features) {
        expect(allowed.test(plainClinicalText(criterion.text))).toBe(true);
      }
    }
  });
});

describe("buildDsmDiagnosisNote", () => {
  it("returns nothing until something has been recorded", () => {
    expect(buildDsmDiagnosisNote(noteInput([{ label: "A", text: "x", status: "not-assessed" }]))).toBe("");
  });

  it("never asserts a criterion the clinician did not mark met", () => {
    const note = buildDsmDiagnosisNote(
      noteInput([
        { label: "A", text: "Recurrent unexpected panic attacks", status: "met" },
        { label: "B", text: "Persistent concern about further attacks", status: "not-assessed" },
        { label: "C", text: "Not attributable to substances", status: "not-met" },
      ]),
    );
    expect(note).toContain("Criteria met (A):");
    expect(note).toContain("Criteria not met (C):");
    expect(note).toContain("Not assessed (B):");
    // The unassessed criterion is named, not quietly dropped.
    expect(note).toContain("B. Persistent concern about further attacks");
  });

  it("opens each criterion line as a sentence", () => {
    // "≥1 attack ..." sanitises to "at least 1 attack ...", which must not be
    // pasted into a note starting mid-word.
    const note = buildDsmDiagnosisNote(
      noteInput([{ label: "B", text: "≥1 attack followed by ≥1 month of concern", status: "met" }]),
    );
    expect(note).toContain("B. At least 1 attack followed by at least 1 month of concern");
  });

  it("spells out an unassessed criterion even in label-only mode", () => {
    const note = buildDsmDiagnosisNote(
      noteInput(
        [
          { label: "A", text: "Recurrent unexpected panic attacks", status: "met" },
          { label: "D", text: "Not better explained by another mental disorder", status: "not-assessed" },
        ],
        { includeCriterionText: false },
      ),
    );
    expect(note).toContain("Criteria met (A).");
    expect(note).not.toContain("A. Recurrent");
    expect(note).toContain("D. Not better explained by another mental disorder");
  });

  it("carries ticked and typed specifiers onto the diagnosis line", () => {
    const note = buildDsmDiagnosisNote(
      noteInput([{ label: "A", text: "Recurrent unexpected panic attacks", status: "met" }], {
        specifiers: ["With panic attacks"],
        specifierText: "moderate, recurrent",
      }),
    );
    expect(note.split("\n")[0]).toBe("Panic disorder (F41.0), With panic attacks, moderate, recurrent");
  });

  it("lists excluded differentials and always closes with the caveat", () => {
    const note = buildDsmDiagnosisNote(
      noteInput([{ label: "A", text: "Recurrent unexpected panic attacks", status: "met" }], {
        excludedDifferentials: ["Agoraphobia", "GAD"],
      }),
    );
    expect(note).toContain("Differentials considered and excluded: Agoraphobia, GAD.");
    expect(note.trimEnd().endsWith("Confirm against the full assessment.")).toBe(true);
  });
});

describe("specifier handling", () => {
  it("does not count a 'no specifiers' row as a specifier", () => {
    const split = dsmSpecifierSplit(panic);
    expect(panic.specifiers).toHaveLength(1);
    expect(split.specifiers).toHaveLength(0);
    expect(split.absentNotes[0].name).toBe("No DSM-5-TR specifiers for this disorder");
  });

  it("treats every 'no specifiers' record as having none, on all ten", () => {
    const affected = dsmDiagnoses.filter((diagnosis) => dsmSpecifierSplit(diagnosis).absentNotes.length > 0);
    expect(affected).toHaveLength(10);
    for (const diagnosis of affected) {
      expect(dsmSpecifierSplit(diagnosis).specifiers).toHaveLength(0);
    }
  });

  it("offers no slash menu as a tick box, because none can be split safely", () => {
    for (const diagnosis of dsmDiagnoses) {
      for (const specifier of dsmSelectableSpecifiers(diagnosis.specifiers)) {
        expect(specifier.name).not.toContain(" / ");
      }
    }
  });

  it("still offers the overwhelming majority of specifiers as tick boxes", () => {
    const all = dsmDiagnoses.flatMap((diagnosis) => dsmSpecifierSplit(diagnosis).specifiers);
    const selectable = dsmDiagnoses.flatMap((diagnosis) =>
      dsmSelectableSpecifiers(dsmSpecifierSplit(diagnosis).specifiers),
    );
    expect(selectable.length / all.length).toBeGreaterThan(0.9);
  });
});

describe("dsmNoteBuilderRecord", () => {
  it("does not ship the discarded documentation template to the browser", () => {
    // The builder is a Client Component, so anything on its props crosses into
    // the RSC payload. Handing it the whole record sent `documentation_template`
    // with it — the prose this change exists to stop people pasting — on all 146
    // diagnosis pages.
    for (const diagnosis of dsmDiagnoses) {
      const serialised = JSON.stringify(dsmNoteBuilderRecord(diagnosis));
      expect(serialised).not.toContain(diagnosis.documentation_template);
    }
  });

  it("carries exactly the fields the builder reads", () => {
    expect(Object.keys(dsmNoteBuilderRecord(panic)).sort()).toEqual([
      "criteria",
      "differentials",
      "icdCode",
      "isDsmCriteria",
      "slug",
      "specifiers",
      "title",
    ]);
  });

  it("offers no unsplittable specifier menu through the projection", () => {
    for (const diagnosis of dsmDiagnoses) {
      for (const specifier of dsmNoteBuilderRecord(diagnosis).specifiers) {
        expect(specifier.name).not.toContain(" / ");
      }
    }
  });
});
