import { describe, expect, it } from "vitest";

import * as rules from "@/lib/teaching/assessments/year-rules";

const allLines = (): string[] =>
  Object.values(rules).flatMap((value) => (Array.isArray(value) ? [...value] : [value])) as string[];

describe("Assessments: year-end and PGY2 rules as data", () => {
  it("lists the panel's four decisions from the AMC guide", () => {
    expect(rules.PANEL_OUTCOMES).toEqual([
      "Ask for more information",
      "Recommend progression, with or without specific feedback",
      "Recommend delayed progression, with specific feedback",
      "Refer to the Director of Medical Services",
    ]);
    expect(rules.PANEL_LOOKS_AT).toMatch(/EPAs, end-of-term forms and record of learning/);
  });

  it("says the Medical Board decides PGY1 general registration, within 3 years", () => {
    expect(rules.PGY1_REGISTRATION).toMatch(/^The Medical Board decides/);
    expect(rules.PGY1_REGISTRATION).toMatch(/certificate of completion of an accredited internship/);
    expect(rules.PGY1_TIME_LIMIT).toBe("PGY1 must be finished within 3 years, part-time included.");
  });

  it("states the year length with the annual leave and professional development leave limits", () => {
    expect(rules.YEAR_LENGTH_RULE).toBe(
      "At least 47 weeks full-time equivalent, not counting annual leave. Up to 2 weeks of professional development leave counts.",
    );
    expect(rules.ABSENCE_RULE).toMatch(/sick, personal or carer's leave/);
    expect(rules.ABSENCE_RULE).not.toMatch(/not confirmed/);
  });

  it("keeps the sourced PGY2 rules and the certificate", () => {
    expect(rules.PGY2_RULES).toHaveLength(8);
    expect(rules.PGY2_RULES[0]).toBe("At least 3 terms, each at least 10 weeks");
    expect(rules.PGY2_RULES).toContain("At most 25% in any one subspecialty");
    expect(rules.PGY2_RULES).toContain("Finished within 4 years");
    expect(rules.PGY2_CERTIFICATE).toMatch(/Ahpra number/);
  });

  it("writes every line in plain sentence-case English: no semicolons, dashes or arrows", () => {
    for (const line of allLines()) {
      expect(line, line).not.toMatch(/[;—–→]|->|=>/);
      expect(line.charAt(0), line).toBe(line.charAt(0).toUpperCase());
      expect(line, line).not.toMatch(/(\d) (h|min|sessions?|of|weeks?|items?|members?|terms?|years?)(?![\w-])/);
    }
  });
});
