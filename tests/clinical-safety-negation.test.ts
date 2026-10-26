// Negation guards on the Contraindication tier (audit 26 Oct 2026). A negated
// "contraindicated" or "avoid" must not take the danger colour on that word alone,
// and every existing true-positive must still reach Contraindication.

import { describe, expect, it } from "vitest";

import { __safetyPatternLabelForTests as labelFor } from "@/lib/clinical-safety";

describe("contraindication negation guards", () => {
  it.each([
    "Lithium is not contraindicated in mild renal impairment.",
    "There are no contraindications to this agent.",
    "No known contraindication was identified.",
    "This combination is non-contraindicated.",
    "There is no need to avoid grapefruit juice.",
    "Patients need not avoid dairy with this formulation.",
    "You do not need to avoid driving after the first week.",
  ])("does not label %o Contraindication", (text) => {
    expect(labelFor(text)).not.toBe("Contraindication");
  });

  it.each([
    "This medication is contraindicated in pregnancy.",
    "Contraindications include severe hepatic impairment.",
    "Do not use in severe hepatic impairment.",
    "Avoid in patients with QT prolongation.",
    "Avoid if eGFR is below 30.",
    "Use is not recommended in children.",
    "Clozapine must not be restarted after agranulocytosis.",
    "Patients with known hypersensitivity should not receive this drug.",
    "Hypersensitivity to sertraline is a contraindication.",
    "Avoid delay in transferring the patient.",
    // A negated word does not cancel another danger token in the same passage.
    "Not contraindicated in pregnancy, but must not be stopped abruptly.",
    "No contraindications are listed; avoid in porphyria.",
    "Not contraindicated, but avoid in the first trimester.",
  ])("still labels %o Contraindication", (text) => {
    expect(labelFor(text)).toBe("Contraindication");
  });

  it("keeps 'avoid if' on the Contraindication tier, never demoted to Exclusion", () => {
    expect(labelFor("Avoid if the patient is dehydrated.")).toBe("Contraindication");
  });

  it("still labels the remaining Exclusion tokens", () => {
    expect(labelFor("Exclude patients under 18.")).toBe("Exclusion");
    expect(labelFor("Not applicable to inpatients.")).toBe("Exclusion");
  });
});
