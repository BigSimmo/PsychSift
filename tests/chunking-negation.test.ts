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

  it.each([
    "For adults with stable renal function, lithium is not contraindicated when the specified monitoring conditions are met.",
    "For adults without acute toxicity, do not cease lithium before the responsible clinician has reviewed the current results.",
    "For adults with unstable renal function, lithium should not be administered before the responsible clinician has reviewed the current results.",
  ])("preserves the entire governing sentence in the actual successor: %s", (governing) => {
    const prefix = "General clinical context introduces the following guidance.";
    const following = "The next review records the agreed monitoring plan and the responsible clinician.";
    const chunks = chunkTextWithOverlap(`${prefix} ${governing} ${following}`, 160, 30);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1]).toContain(governing);
    expect(chunks[1].startsWith(governing)).toBe(true);
    expect(
      chunks.every((chunk) => !chunk.includes("lithium is not contraindicated") || chunk.includes(governing)),
    ).toBe(true);
    expect(chunks.every((chunk) => !chunk.includes("cease lithium") || chunk.includes(governing))).toBe(true);
  });

  it("keeps a preceding condition and population with the successor's prohibition", () => {
    const prefix = "General clinical context introduces the following guidance.";
    const governing =
      "When the patient is pregnant and renal function is unstable, do not cease treatment until the responsible clinician has reviewed the risks.";
    const following = "Record the subsequent clinical decision and monitoring plan in the current notes.";
    const chunks = chunkTextWithOverlap(`${prefix} ${governing} ${following}`, 180, 35);

    expect(chunks[1]).toContain(governing);
    expect(chunks[1].startsWith("When the patient is pregnant and renal function is unstable,")).toBe(true);
  });

  it("does not pull an unrelated earlier prohibition into the governing overlap", () => {
    const earlier =
      "The separate medicine review documents the history, current observations and responsible prescriber, and says do not administer the unrelated medicine.";
    const governing = "For stable adults, treatment is not contraindicated when the monitoring conditions are met.";
    const following = "Record the agreed plan after the review.";
    const chunks = chunkTextWithOverlap(`${earlier} ${governing} ${following}`, 200, 30);

    expect(chunks[1]).toContain(governing);
    expect(chunks[1]).not.toContain("do not administer");
    expect(chunks[1].startsWith(governing)).toBe(true);
  });

  it("keeps an overbudget conditional sentence atomic and advances to subsequent content", () => {
    const condition = "documented condition and population qualification ".repeat(12);
    const governing = `For adults meeting the ${condition}specified criteria, do not cease treatment before clinical review.`;
    const following = "The subsequent review records the monitoring plan.";
    const chunks = chunkTextWithOverlap(`${governing} ${following}`, 100, 150);

    expect(governing.length).toBeGreaterThan(135);
    expect(chunks).toEqual([governing, following]);
    expect(chunks.filter((chunk) => chunk.includes("do not cease"))).toEqual([governing]);
  });

  it("omits redundant paragraph overlap rather than cropping its governing scope or exceeding the ordinary budget", () => {
    const governing =
      "For adults with stable renal function, do not cease treatment before the responsible clinician has reviewed the current results.";
    const following =
      "The following review records the monitoring plan, the responsible clinician and the date of the next clinical appointment.";
    const chunks = chunkTextWithOverlap(`${governing}\n\n${following}`, 160, 30);

    expect(chunks).toEqual([governing, following]);
    expect(chunks.every((chunk) => chunk.length <= 216)).toBe(true);
  });

  it("keeps ordinary complete-sentence chunks within the existing elongation budget", () => {
    const sentences = Array.from(
      { length: 12 },
      (_, index) => `Review ${index + 1} documents the current clinical observations and the agreed monitoring plan.`,
    );
    const chunks = chunkTextWithOverlap(sentences.join(" "), 160, 20);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 216)).toBe(true);
    for (const sentence of sentences) expect(chunks.some((chunk) => chunk.includes(sentence))).toBe(true);
  });
});
