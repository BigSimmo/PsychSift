// A high-risk record marked `coverageReviewed: true` may read green again. Uses an
// in-memory fixture copy of the index; no real record is marked reviewed.

import { describe, expect, it, vi } from "vitest";

vi.mock("../data/medication-interaction-index.json", async (importOriginal) => {
  const original = (await importOriginal()) as { default: { bySlug: Record<string, object> } };
  const index = structuredClone(original.default);
  index.bySlug["lithium-carbonate-ir-sr"] = { ...index.bySlug["lithium-carbonate-ir-sr"], coverageReviewed: true };
  // A non-boolean value must not count as reviewed.
  index.bySlug["phenelzine"] = { ...index.bySlug["phenelzine"], coverageReviewed: "yes" };
  return { default: index };
});

const { composeMedicationVerdict, evaluateMedicationInteractions, isInteractionCoverageReviewed } =
  await import("@/lib/medication-interactions");

function tone(viewed: string, entered: string) {
  const result = evaluateMedicationInteractions(viewed, [entered]);
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

describe("coverageReviewed fixture", () => {
  it("lets a reviewed high-risk record read green", () => {
    expect(isInteractionCoverageReviewed("lithium-carbonate-ir-sr")).toBe(true);
    expect(tone("lithium-carbonate-ir-sr", "carbamazepine")).toBe("success");
    expect(tone("carbamazepine", "lithium-carbonate-ir-sr")).toBe("success");
  });

  it("only counts a literal true", () => {
    expect(isInteractionCoverageReviewed("phenelzine")).toBe(false);
    expect(tone("phenelzine", "paracetamol")).toBe("neutral");
  });
});
