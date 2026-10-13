import { describe, expect, it } from "vitest";

import { chunkTextWithOverlap } from "@/lib/chunking";

describe("Semantic Chunking Negation Boundary Preservation (CHK-01)", () => {
  it("does not sever clinical prohibitions across chunk boundaries", () => {
    const text = [
      "Clinical guideline for rapid tranquilisation in psychiatric emergencies.",
      "Ensure continuous monitoring of pulse oximetry, respiratory rate, and blood pressure following administration.",
      "DO NOT administer intramuscular olanzapine concomitantly with intravenous benzodiazepines due to high risk of fatal cardiorespiratory arrest and profound hypotension.",
      "Appropriate resuscitation equipment and flumazenil must be readily accessible in the clinical environment.",
    ].join(" ");

    // Using a chunk size that would otherwise slice right through the "DO NOT administer..." sentence
    const chunks = chunkTextWithOverlap(text, 220, 30);

    expect(chunks.length).toBeGreaterThan(1);

    // Verify that NO chunk starts with the severed positive action ("administer intramuscular olanzapine...")
    // without the leading prohibition "DO NOT"
    for (const chunk of chunks) {
      if (chunk.includes("intramuscular olanzapine concomitantly with intravenous benzodiazepines")) {
        expect(chunk).toMatch(/\bDO NOT administer\b/i);
      }
    }
  });

  it("completes sentences within modest elongation budget rather than cutting mid-sentence", () => {
    const s1 = "This is the initial guideline context that provides standard guidance.";
    const s2 = "CONTRAINDICATED in patients with known hypersensitivity or history of neuroleptic malignant syndrome.";
    const text = `${s1} ${s2}`;

    const chunks = chunkTextWithOverlap(text, 100, 20);
    // Neither chunk should slice "CONTRAINDICATED in patients" into "CONTRAINDICATED" and "in patients"
    for (const chunk of chunks) {
      if (chunk.includes("neuroleptic malignant syndrome")) {
        expect(chunk).toContain("CONTRAINDICATED");
      }
    }
  });
});
