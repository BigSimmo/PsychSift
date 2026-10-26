// Owner decision 26 Oct 2026: lithium, clozapine, valproate, methadone and the MAOIs
// never compose to green ("No interaction found") unless their interaction record has
// been reviewed as complete (`coverageReviewed: true`). Lithium carried one row and no
// unresolved rows, so before this it composed to green against carbamazepine,
// sertraline and SGLT2 inhibitors.

import { describe, expect, it } from "vitest";

import {
  composeMedicationVerdict,
  evaluateMedicationInteractions,
  highRiskInteractionMedicineId,
  HIGH_RISK_INTERACTION_MEDICINES,
  type MedicationInteractionResult,
} from "@/lib/medication-interactions";

function verdictTone(result: MedicationInteractionResult) {
  return composeMedicationVerdict({
    considerationTone: null,
    considerationCount: 0,
    unassessedCount: 0,
    interactionTone: result.highestTone,
    interactionCount: result.interactions.length,
    unresolvedRowCount: result.unresolvedRowCount,
    unreachableCounterpartyCount: result.unreachableCounterparties.length,
    reverseUnresolvedCounterpartyCount: result.reverseUnresolvedCounterparties.length,
    unreviewedHighRiskCount: result.unreviewedHighRiskMedications.length,
  }).tone;
}

const LITHIUM = "lithium-carbonate-ir-sr";

describe("high-risk medicines never read green without a coverage review", () => {
  it.each(["carbamazepine", "sertraline", "empagliflozin", "dapagliflozin"])(
    "lithium with %s is not green, in either direction",
    (other) => {
      for (const [viewed, entered] of [
        [LITHIUM, other],
        [other, LITHIUM],
      ]) {
        const result = evaluateMedicationInteractions(viewed, [entered]);
        expect(result.unreviewedHighRiskMedications).toEqual([LITHIUM]);
        expect(verdictTone(result)).not.toBe("success");
      }
    },
  );

  it("lithium with carbamazepine is held off green by the coverage flag alone", () => {
    // Every older route to "incomplete" is clear here, which is exactly the false green.
    const result = evaluateMedicationInteractions(LITHIUM, ["carbamazepine"]);
    expect(result.interactions).toEqual([]);
    expect(result.unresolvedRowCount).toBe(0);
    expect(result.unreachableCounterparties).toEqual([]);
    expect(result.reverseUnresolvedCounterparties).toEqual([]);
    expect(verdictTone(result)).toBe("neutral");
  });

  it.each([
    ["clozapine", "sertraline"],
    ["sodium-valproate-oral-iv", "carbamazepine"],
    ["methadone", "sertraline"],
    ["phenelzine", "paracetamol"],
    ["tranylcypromine", "amoxicillin"],
    ["moclobemide", "paracetamol"],
  ])("%s with %s is not green, in either direction", (highRisk, other) => {
    for (const [viewed, entered] of [
      [highRisk, other],
      [other, highRisk],
    ]) {
      const result = evaluateMedicationInteractions(viewed, [entered]);
      expect(result.unreviewedHighRiskMedications).toContain(highRisk);
      expect(verdictTone(result)).not.toBe("success");
    }
  });

  it("flags a high-risk drug anywhere in a longer list", () => {
    const result = evaluateMedicationInteractions("paracetamol", ["amoxicillin", "phenelzine"]);
    expect(result.unreviewedHighRiskMedications).toEqual(["phenelzine"]);
    expect(verdictTone(result)).not.toBe("success");
  });

  it("keeps an ordinary pair that is green today green", () => {
    const result = evaluateMedicationInteractions("sertraline", ["acamprosate"]);
    expect(result.unreviewedHighRiskMedications).toEqual([]);
    expect(verdictTone(result)).toBe("success");
  });

  it("flags nothing when no medication list is entered", () => {
    expect(evaluateMedicationInteractions(LITHIUM, []).unreviewedHighRiskMedications).toEqual([]);
  });

  it("composeMedicationVerdict treats an unreviewed high-risk medicine as incomplete", () => {
    const verdict = composeMedicationVerdict({
      considerationTone: null,
      considerationCount: 0,
      unassessedCount: 0,
      interactionTone: null,
      interactionCount: 0,
      unresolvedRowCount: 0,
      unreachableCounterpartyCount: 0,
      reverseUnresolvedCounterpartyCount: 0,
      unreviewedHighRiskCount: 1,
    });
    expect(verdict).toMatchObject({ tone: "neutral", incomplete: true });
  });
});

describe("highRiskInteractionMedicineId", () => {
  it.each([
    ["lithium-carbonate-ir-sr", "lithium"],
    ["clozapine", "clozapine"],
    ["sodium-valproate-oral-iv", "valproate"],
    ["methadone", "methadone"],
    ["moclobemide", "maoi"],
    ["phenelzine", "maoi"],
    ["tranylcypromine", "maoi"],
  ])("matches the catalogue record %s", (slug, id) => {
    expect(highRiskInteractionMedicineId(slug)).toBe(id);
  });

  it.each([
    ["valproic-acid", "valproate"],
    ["selegiline-transdermal", "maoi"],
    ["epilim", "valproate"],
    ["clozaril", "clozapine"],
  ])("matches a salt, form or brand name not yet in the catalogue: %s", (slug, id) => {
    expect(highRiskInteractionMedicineId(slug)).toBe(id);
  });

  it.each(["sertraline", "paracetamol", "carbamazepine", "quetiapine"])("does not match %s", (slug) => {
    expect(highRiskInteractionMedicineId(slug)).toBeNull();
  });

  it("lists the five owner-approved groups", () => {
    expect(HIGH_RISK_INTERACTION_MEDICINES.map((group) => group.id)).toEqual([
      "lithium",
      "clozapine",
      "valproate",
      "methadone",
      "maoi",
    ]);
  });
});
