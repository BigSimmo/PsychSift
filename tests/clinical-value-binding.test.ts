import { describe, expect, it } from "vitest";
import { explicitlyBindsEntityToClinicalValue, type ClinicalTextSpan } from "@/lib/clinical-value-binding";

describe("explicitlyBindsEntityToClinicalValue", () => {
  it("binds entity preceding value within 12 characters", () => {
    const text = "olanzapine 5 mg orally";
    const entity: ClinicalTextSpan = { start: 0, end: 10 }; // "olanzapine"
    const value: ClinicalTextSpan = { start: 11, end: 15 }; // "5 mg"
    expect(explicitlyBindsEntityToClinicalValue(entity, value, text)).toBe(true);
  });

  it("binds value preceding entity within 12 characters (leading dosage)", () => {
    const text = "5 mg olanzapine orally";
    const value: ClinicalTextSpan = { start: 0, end: 4 }; // "5 mg"
    const entity: ClinicalTextSpan = { start: 5, end: 15 }; // "olanzapine"
    expect(explicitlyBindsEntityToClinicalValue(entity, value, text)).toBe(true);
  });

  it("binds entity to value via clinical binding pattern across greater distance", () => {
    const text = "lithium target concentration should be 0.8 mmol/L";
    const entity: ClinicalTextSpan = { start: 0, end: 7 }; // "lithium"
    const value: ClinicalTextSpan = { start: 39, end: 49 }; // "0.8 mmol/L"
    expect(explicitlyBindsEntityToClinicalValue(entity, value, text)).toBe(true);
  });

  it("refuses binding across clause boundaries", () => {
    const text = "olanzapine was stopped, but 5 mg was continued";
    const entity: ClinicalTextSpan = { start: 0, end: 10 }; // "olanzapine"
    const value: ClinicalTextSpan = { start: 28, end: 32 }; // "5 mg"
    expect(explicitlyBindsEntityToClinicalValue(entity, value, text)).toBe(false);
  });

  it("refuses binding when distance exceeds 12 characters and no pattern matches", () => {
    const text = "olanzapine was reviewed in clinic yesterday and the patient took 5 mg";
    const entity: ClinicalTextSpan = { start: 0, end: 10 }; // "olanzapine"
    const value: ClinicalTextSpan = { start: 65, end: 69 }; // "5 mg"
    expect(explicitlyBindsEntityToClinicalValue(entity, value, text)).toBe(false);
  });
});
