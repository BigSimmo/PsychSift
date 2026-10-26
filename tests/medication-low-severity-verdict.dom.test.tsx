// The rendered half of "a documented interaction is never an all-clear".
//
// `medication-interactions.test.ts` pins that a LOW-severity row keeps the
// composed verdict off the success tone. That is worth nothing if the headline
// still reads as reassurance: the verdict band is the safety hierarchy for a
// result row, and its success copy is the words "No alert found" — printed, in
// the reported defect, directly above the line "1 interaction".

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PatientVerdictSignal } from "@/components/clinical-dashboard/medication-considerations";
import {
  composeMedicationVerdict,
  evaluateMedicationInteractions,
  type MedicationVerdict,
} from "@/lib/medication-interactions";
import { getMedicationRecord } from "@/lib/medication-snapshot";

function verdictFor(slug: string, patientMedications: string[]): MedicationVerdict {
  const result = evaluateMedicationInteractions(slug, patientMedications, getMedicationRecord(slug));
  return composeMedicationVerdict({
    considerationTone: null,
    considerationCount: 0,
    unassessedCount: 0,
    interactionTone: result.highestTone,
    interactionCount: result.interactions.length,
    unresolvedRowCount: result.unresolvedRowCount,
    unreachableCounterpartyCount: result.unreachableCounterparties.length,
    unreviewedHighRiskCount: result.unreviewedHighRiskMedications.length,
  });
}

describe("patient verdict band over a documented low-severity interaction", () => {
  it("does not headline a catalogued interaction as 'No alert found'", () => {
    render(<PatientVerdictSignal verdict={verdictFor("mesalazine", ["digoxin"])} />);

    const band = screen.getByRole("group");
    expect(band.getAttribute("data-tone")).not.toBe("success");
    expect(band.textContent).not.toMatch(/no alert found/i);
    // The finding itself still has to be stated, not merely un-reassured. Count-agnostic
    // so a catalogue change that adds or removes an interaction for this pair does not
    // make this assertion fail for an unrelated reason.
    expect(band.textContent).toMatch(/\d+ interactions?\b/);
    expect(band.getAttribute("aria-label")).not.toMatch(/no alert found/i);
  });

  it("still says so when the check ran clean", () => {
    // The guard must stay narrow: an all-clear over a genuinely empty, complete
    // check is the one place that copy belongs.
    render(<PatientVerdictSignal verdict={verdictFor("sertraline", ["paracetamol"])} />);

    const band = screen.getByRole("group");
    expect(band.getAttribute("data-tone")).toBe("success");
    expect(band.textContent).toMatch(/no alert found/i);
    expect(band.textContent).toMatch(/no interaction found/i);
  });
});
