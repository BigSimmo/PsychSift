// Audit 26 Oct 2026 (#9, wording only): the increment error must list exactly the
// increments validateLithiumDoseInput accepts. 450 mg was accepted but not listed.

import { describe, expect, it } from "vitest";

import { validateLithiumDoseInput } from "@/lib/calculators/clinical-math";

const base = { currentDoseMg: 750, currentLevelMmolL: 0.5, targetLevelMmolL: 0.7 };
const accepted = [50, 125, 225, 250, 450] as const;

describe("lithium dose increment validation message", () => {
  it.each(accepted)("accepts %i mg", (tabletIncrementMg) => {
    expect(validateLithiumDoseInput({ ...base, tabletIncrementMg })).toEqual([]);
  });

  it("lists exactly the accepted increments, including 450 mg", () => {
    const errors = validateLithiumDoseInput({ ...base, doseIncrementMg: 300 as never });
    expect(errors).toEqual([
      "Dose increment must be a supported tablet strength fraction (50, 125, 225, 250, or 450 mg)",
    ]);
    const listed = errors[0].match(/\d+/g)?.map(Number);
    expect(listed).toEqual([...accepted]);
  });
});
