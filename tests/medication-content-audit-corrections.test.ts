import { describe, expect, it } from "vitest";

import { getMedicationRecord } from "@/lib/medication-snapshot";

/**
 * Pins the six high-risk corrections from the 20 October 2026 clinical content
 * audit (reviews/2026-10-20-clinical-content-accuracy.md, findings R1-F-01,
 * R2A-F-01, R2A-F-02, R2B-F-01, R2B-F-02 and R2B-F-03). The medication snapshot
 * is refreshed by importing the separate Medications export, so an import that
 * carries the old wording back in fails here instead of reaching the site.
 */

function recordText(slug: string): string {
  const record = getMedicationRecord(slug);
  expect(record, `${slug} record`).toBeTruthy();
  return JSON.stringify(record);
}

describe("clinical content audit corrections stay corrected", () => {
  it("phenytoin albumin correction uses the g/L coefficient", () => {
    const text = recordText("phenytoin");
    expect(text).toContain("0.02 x Albumin [g/L] + 0.1");
    expect(text).not.toMatch(/Measured \/ \(0\.2 x Albumin \+ 0\.1\)/);
  });

  it("buprenorphine no longer says a toddler will just sleep", () => {
    for (const slug of ["buprenorphine-sl-depot", "buprenorphine-naloxone"]) {
      expect(recordText(slug)).not.toMatch(/will likely just sleep/i);
    }
    expect(recordText("buprenorphine-sl-depot")).toMatch(/fatal, respiratory depression in children/i);
  });

  it("methadone induction respects the WA CPOP 25 mg first-dose limit", () => {
    const text = recordText("methadone");
    expect(text).not.toMatch(/usually 20-30 mg daily/i);
    expect(text).toMatch(/first dose (should )?not (above|exceed) 25 mg/i);
  });

  it("tranylcypromine maximum is 30 mg/day everywhere", () => {
    const record = getMedicationRecord("tranylcypromine");
    expect(JSON.stringify(record)).not.toMatch(/60 mg\/day/);
    expect(record?.stats.find((stat) => stat.label === "Max Dose")?.value).toBe("30 mg/day");
  });

  it("droperidol and ziprasidone QTc contraindications follow the Australian PI", () => {
    expect(recordText("droperidol")).toMatch(/QTc > 450 ms \(women\) or > 440 ms \(men\)/);
    for (const slug of ["ziprasidone", "ziprasidone-im"]) {
      expect(recordText(slug)).not.toMatch(/QTc\*\* > 500 ms|QTc > 500 ms/);
    }
  });

  it("flupentixol decanoate no longer claims an Australian 400 mg/week maximum", () => {
    const text = recordText("flupentixol-decanoate");
    expect(text).not.toMatch(/400 mg\/week/);
    expect(text).toMatch(/100 mg per fortnight/);
  });
});
