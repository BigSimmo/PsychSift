import { describe, expect, it } from "vitest";

import { getMedicationRecord } from "@/lib/medication-snapshot";

/**
 * Pins the medicine corrections from the 26 October 2026 clinical content audit
 * (stream S3: findings MB-F-02, MB-F-03, MB-F-05 to MB-F-17 and the matching MA-F
 * items). Each correction follows the Australian PI or the TGA pregnancy database.
 * The medication snapshot is refreshed by importing the separate Medications
 * export, so an import that carries the old wording back in fails here instead of
 * reaching the site.
 */

function record(slug: string) {
  const found = getMedicationRecord(slug);
  expect(found, `${slug} record`).toBeTruthy();
  return found!;
}

function recordText(slug: string): string {
  return JSON.stringify(record(slug));
}

function maxDose(slug: string): string | undefined {
  return record(slug).stats.find((stat) => stat.label === "Max Dose")?.value;
}

function rows(slug: string, key: string) {
  return record(slug).sections.flatMap((section) => (section.rows ?? []).filter((row) => row.key === key));
}

describe("26 Oct 2026 medicine corrections stay corrected", () => {
  it("dose chips follow the Australian PI", () => {
    expect(maxDose("clomipramine")).toBe("Usual 100-150 mg/day");
    expect(maxDose("clonazepam")).toBe("20 mg/day");
    expect(maxDose("prochlorperazine")).toBe("40 mg/day");
    expect(maxDose("amitriptyline")).toBe("150 mg/day (PI 200 inpatient)");
    expect(maxDose("imipramine")).toBe("200 mg/day (PI 300 inpatient)");
    expect(maxDose("sotalol")).toBe("320 mg/day (PI 640 specialist)");
  });

  it("methotrexate folic acid is advised, not a PI requirement", () => {
    expect(record("methotrexate").stats.find((stat) => stat.label === "Folic Acid")?.value).toBe("ADVISED");
  });

  it("no fixed dose cut is claimed where the PI only advises monitoring", () => {
    for (const slug of ["warfarin-vka", "warfarin-anticoagulant"]) {
      expect(recordText(slug)).not.toMatch(/MUST halve/);
    }
    expect(recordText("escitalopram")).not.toMatch(/Max Escitalopram dose is 10mg if on Omeprazole/);
  });

  it("opioid substitution records warn about accidental exposure in children", () => {
    for (const slug of ["buprenorphine-naloxone", "methadone"]) {
      const [pearl] = rows(slug, "Paediatric Exposure");
      expect(pearl?.val, slug).toMatch(/respiratory depression/);
    }
  });

  it("records that lacked pregnancy text now carry the TGA category", () => {
    const expected: Record<string, string> = {
      quetiapine: "Category C",
      risperidone: "Category C",
      imipramine: "Category C",
      lorazepam: "Category C",
      midazolam: "Category C",
      nitrazepam: "Category C",
      "hyoscine-hydrobromide": "Category B2",
      naloxone: "Category B1",
    };
    for (const [slug, category] of Object.entries(expected)) {
      const pregnancy = rows(slug, "Pregnancy");
      expect(pregnancy.length, slug).toBeGreaterThan(0);
      expect(
        pregnancy.some((row) => row.val.includes(category)),
        slug,
      ).toBe(true);
    }
    expect(rows("copper", "Pregnancy")[0]?.val).toMatch(/exempt from pregnancy categorisation/);
  });

  it("every pregnancy alert matches the record's own contraindication row", () => {
    for (const slug of [
      "lithium-carbonate-ir-sr",
      "methotrexate",
      "phenytoin",
      "warfarin-vka",
      "warfarin-anticoagulant",
    ]) {
      for (const row of rows(slug, "Pregnancy")) {
        if (!row.patient) continue;
        expect(row.patient.action, slug).toBe("contraindication");
      }
    }
  });

  it("ondansetron QT prolongation is a caution, not a contraindication", () => {
    const [absolute] = rows("ondansetron", "Absolute");
    expect(absolute?.val).toMatch(/Apomorphine/);
    expect(absolute?.patient).toBeUndefined();
    const [qt] = rows("ondansetron", "QT Prolongation");
    expect(qt?.patient?.action).toBe("caution");
  });

  it("asenapine hepatic warning sits in its own row, matched to severe impairment", () => {
    const [hepatic] = rows("asenapine", "Hepatic Impairment");
    expect(hepatic?.patient?.match).toEqual({ hepatic: ["severe"] });
  });
});
