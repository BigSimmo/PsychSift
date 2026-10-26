import { describe, expect, it } from "vitest";

import { dsmDiagnoses } from "@/lib/dsm";

/**
 * The 26 Oct 2026 clinical content re-audit (MD-F-01) found about 15 hand-entered ICD-10-CM
 * codes that were swapped, belonged to another condition, or do not exist. Each expected code
 * below was checked against the FY2027 ICD-10-CM code set and the DSM-5-TR coding.
 */
const expectedCodes: Record<string, string> = {
  "reactive-attachment-disorder-rad": "F94.1",
  "disinhibited-social-engagement-disorder-dsed": "F94.2",
  "medication-induced-acute-dystonia": "G24.02",
  "medication-induced-acute-akathisia": "G25.71",
  "tardive-dyskinesia": "G24.01",
  "tardive-dystonia-tardive-akathisia": "G24.09/G25.71",
  "other-medication-induced-movement-disorder": "G25.79",
  "voyeuristic-disorder": "F65.3",
  "restless-legs-syndrome": "G25.81",
  "cannabis-intoxication-withdrawal": "F12.129/F12.23",
  "opioid-intoxication-withdrawal": "F11.129/F11.23",
  "stimulant-intoxication-withdrawal": "F15.129/F15.23",
  "neurocognitive-disorder-due-to-hiv-infection": "B20/F02.80",
  "catatonia-associated-due-to-gmc-or-unspecified": "F06.1",
  "prolonged-grief-disorder": "F43.81",
  "insomnia-disorder": "F51.01",
  "hypersomnolence-disorder": "F51.11",
  "other-specified-unspecified-depressive-disorder": "F32.89/F32.A",
};

// Codes that do not exist in ICD-10-CM, or that name a different condition from the record.
const retiredCodes = ["F12.239", "F11.239", "F15.239", "B22.0", "G31.9", "G47.61", "G21.1", "G47.00", "G47.10"];

describe("DSM catalogue ICD-10-CM codes", () => {
  const bySlug = new Map(dsmDiagnoses.map((diagnosis) => [diagnosis.slug, diagnosis.icd_code]));

  it.each(Object.entries(expectedCodes))("codes %s as %s", (slug, code) => {
    expect(bySlug.get(slug)).toBe(code);
  });

  it("shows none of the codes the re-audit found wrong or non-existent", () => {
    for (const diagnosis of dsmDiagnoses) {
      const parts = diagnosis.icd_code.split("/");
      for (const code of retiredCodes) expect(parts, diagnosis.slug).not.toContain(code);
    }
  });
});
