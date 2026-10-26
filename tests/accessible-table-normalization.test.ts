import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeAccessibleTable } from "../src/lib/accessible-table-normalization";

describe("normalizeAccessibleTable", () => {
  it("drops empty OCR spacer columns instead of rendering generic column names", () => {
    const table = normalizeAccessibleTable([
      [
        "Code/ description",
        "",
        "",
        "Response type/",
        "Typical presentations",
        "",
        "",
        "MH Service action/ response",
        "",
        "",
        "Additional actions to be considered",
      ],
      ["", "", "", "time to face-to-", "", "", "", "", "", "", ""],
      [
        "A Current actions endangering self or others",
        "",
        "",
        "Emergency services response IMMEDIATE REFERRAL",
        "Overdose. Other medical emergency.",
        "",
        "",
        "Community clinician notify ambulance, police or fire brigade.",
        "",
        "",
        "Keeping caller on line until emergency services arrive.",
      ],
    ]);

    expect(table?.header).toEqual([
      "Code/ description",
      "Response type/ time to face-to-",
      "Typical presentations",
      "MH Service action/ response",
      "Additional actions to be considered",
    ]);
    expect(table?.header.join(" ")).not.toMatch(/Column \d/i);
    expect(table?.body[0]?.[3]).toContain("Community clinician notify ambulance");
  });

  it("merges sparse unnamed continuation columns and rows into the nearest real column", () => {
    const table = normalizeAccessibleTable([
      [
        "Code/ description",
        "",
        "",
        "Response type/",
        "Typical presentations",
        "",
        "",
        "MH Service action/ response",
        "",
        "",
        "Additional actions to be considered",
      ],
      [
        "C High risk of harm to self or others",
        "",
        "",
        "Urgent MH response WITHIN 12 HOURS",
        "",
        "Suicidal ideation with no plan",
        "",
        "Community clinician face-to-face assessment within 8 hours",
        "",
        "",
        "As above",
      ],
      ["", "", "", "", "", "and/or history of suicidal", "", "", "", "", ""],
      ["", "", "", "", "", "ideation", "", "", "", "", ""],
      [
        "",
        "F",
        "",
        "Requires further triage contact/ follow up",
        "",
        "Other service more appropriate",
        "",
        "",
        "Community clinician to",
        "",
        "Facilitating appointment with alternative provider",
      ],
      ["", "Referral: not requiring face-to-face response", "", "", "", "", "", "", "provide formal referral", "", ""],
    ]);

    expect(table?.body[0]).toEqual([
      "C High risk of harm to self or others",
      "Urgent MH response WITHIN 12 HOURS",
      "Suicidal ideation with no plan and/or history of suicidal ideation",
      "Community clinician face-to-face assessment within 8 hours",
      "As above",
    ]);
    expect(table?.body[1]).toEqual([
      "F Referral: not requiring face-to-face response",
      "Requires further triage contact/ follow up",
      "Other service more appropriate",
      "Community clinician to provide formal referral",
      "Facilitating appointment with alternative provider",
    ]);
  });

  it("flags a clinical table with a two-line body cell as low confidence (#180)", () => {
    const table = normalizeAccessibleTable([
      ["Parameter", "Threshold", "Action"],
      ["ANC", "< 1.5\nx10^9/L", "Withhold clozapine"],
    ]);

    expect(table?.lowConfidence).toBe(true);
    expect(table?.lowConfidenceReason).toBe("multiline_clinical_cell");
    expect(table?.body[0]).toEqual(["ANC", "< 1.5 x10^9/L", "Withhold clozapine"]);
  });

  it("keeps the mobile table presentation on one visible semantic table", () => {
    const source = readFileSync(new URL("../src/components/AccessibleTable.tsx", import.meta.url), "utf8");

    expect(source).not.toContain("<dl");
    expect(source).not.toContain("hidden md:block");
    expect(source).toContain("md:table-row");
    expect(source).toContain("rowActions");
  });
});
