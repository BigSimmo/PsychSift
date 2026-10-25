import { describe, expect, it } from "vitest";
import {
  applyNumericVerification,
  containsNumericBandReference,
  detectLabelledNumericBandConflicts,
  extractClinicalValueAtoms,
  extractNumericTokens,
  unboldUnverifiedNumbers,
  verifyAnswerNumbers,
} from "../src/lib/answer-verification";
import { citationFromResult } from "../src/lib/citations";
import type { RagAnswer, SearchResult } from "../src/lib/types";

function source(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "chunk-1",
    document_id: "doc-1",
    title: "Clozapine monitoring",
    file_name: "clozapine.pdf",
    page_number: 4,
    chunk_index: 0,
    section_heading: "Monitoring",
    content: "Start clozapine 12.5 mg on day 1, then titrate to 25-50 mg. Withhold if ANC below 2.0 ×10⁹/L.",
    image_ids: [],
    similarity: 0.9,
    images: [],
    ...overrides,
  };
}

describe("answer-verification (GEN-C2 / GEN-H2)", () => {
  it("extracts the same clinical value atom through markdown emphasis markers (#231)", () => {
    // Measured live 2026-08-17: the pipeline's own high-yield bolding produced
    // "**200 mg**/day", which extracted a bare 200mg atom while the cited source's
    // "200 mg/day" carried denominatorTime — a verbatim-faithful maximum-dose answer
    // then failed the exact atom-key match and degraded to source-only.
    const [plain] = extractClinicalValueAtoms("adjust dose according to response, maximum 200 mg/day");
    const [bolded] = extractClinicalValueAtoms("The maximum recommended dose of sertraline is **200 mg**/day.");
    expect(plain?.denominatorTime).toBe("day");
    expect(bolded?.denominatorTime).toBe("day");
    expect(bolded?.canonicalValue).toBe("200");
    expect(bolded?.canonicalUnit).toBe("mg");
    // The direct numeric-token path folds emphasis too: the bolded dose yields the same
    // normalized per-day token as the unformatted source text.
    expect(extractNumericTokens("The maximum recommended dose of sertraline is **200 mg**/day.")).toContain(
      "200mg/day",
    );
    expect(extractNumericTokens("adjust dose according to response, maximum 200 mg/day")).toContain("200mg/day");
  });

  it("verifies bolded figures against unformatted source text (#231)", () => {
    const doseSource = source({
      id: "chunk-dose",
      content: "sertraline: 50 mg orally once daily initially, adjust dose according to response, maximum 200 mg/day",
    });
    const verification = verifyAnswerNumbers(
      "The maximum recommended dose of sertraline is **200 mg**/day.",
      [{ chunk_id: "chunk-dose" }],
      [doseSource],
    );
    expect(verification.unverifiedTokens).toEqual([]);
    expect(verification.hasUnverifiedNumbers).toBe(false);
  });

  it("still fails a bolded figure absent from the cited source", () => {
    const doseSource = source({
      id: "chunk-dose",
      content: "sertraline: 50 mg orally once daily initially, adjust dose according to response, maximum 200 mg/day",
    });
    const verification = verifyAnswerNumbers(
      "The maximum recommended dose of sertraline is **300 mg**/day.",
      [{ chunk_id: "chunk-dose" }],
      [doseSource],
    );
    expect(verification.hasUnverifiedNumbers).toBe(true);
  });

  it("detects overlapping labelled score bands without inferring corrected cutoffs", () => {
    const conflicts = detectLabelledNumericBandConflicts(
      "Escalate when the LUNSERS score is medium (41-89), high (81-100), or very high (>101).",
    );

    expect(conflicts).toEqual([
      expect.objectContaining({
        reason: "overlap",
        labels: ["medium", "high", "very high"],
        text: "medium (41-89), high (81-100), or very high (>101)",
      }),
    ]);
  });

  it("does not merge a trailing different-scale identity into the active score band list", () => {
    expect(
      detectLabelledNumericBandConflicts("LUNSERS score bands: medium (41-89). High (81-100) applies on PANSS."),
    ).toEqual([]);
    expect(
      detectLabelledNumericBandConflicts("LUNSERS score bands: medium (41-89). High (81-100) applies on LUNSERS."),
    ).toEqual([expect.objectContaining({ reason: "overlap", labels: ["medium", "high"] })]);
    for (const actionAcronym of ["ECG", "CNC", "ED"]) {
      expect(
        detectLabelledNumericBandConflicts(
          `LUNSERS score bands: medium (41-89). High (81-100) requires ${actionAcronym} review.`,
        ),
      ).toEqual([expect.objectContaining({ reason: "overlap", labels: ["medium", "high"] })]);
    }
    expect(
      detectLabelledNumericBandConflicts("LUNSERS score bands: medium (41-89). High (81-100) is reviewed in ICU."),
    ).toEqual([expect.objectContaining({ reason: "overlap", labels: ["medium", "high"] })]);
  });

  it("does not merge a repeated active scale when the same clause switches to another scale", () => {
    expect(
      detectLabelledNumericBandConflicts(
        "LUNSERS score bands: medium (41-89); for comparison, LUNSERS differs because PANSS uses high (81-100).",
      ),
    ).toEqual([]);
    expect(
      detectLabelledNumericBandConflicts(
        "LUNSERS score bands: medium (41-89); for comparison, LUNSERS uses high (81-100).",
      ),
    ).toEqual([expect.objectContaining({ reason: "overlap", labels: ["medium", "high"] })]);
    expect(
      detectLabelledNumericBandConflicts(
        "LUNSERS score bands: medium (41-89); LUNSERS differs from PANSS, where high (81-100).",
      ),
    ).toEqual([]);
    expect(
      detectLabelledNumericBandConflicts(
        "LUNSERS score bands: medium (41-89); unlike PANSS, LUNSERS has high (81-100).",
      ),
    ).toEqual([expect.objectContaining({ reason: "overlap", labels: ["medium", "high"] })]);
    expect(
      detectLabelledNumericBandConflicts("LUNSERS score bands: medium (41-89); after ECG review, high (81-100)."),
    ).toEqual([expect.objectContaining({ reason: "overlap", labels: ["medium", "high"] })]);
  });

  it("respects inclusive boundaries and ignores coherent or unit-mismatched band lists", () => {
    expect(detectLabelledNumericBandConflicts("Severity bands are mild (0-10) and severe (>=10).")).toHaveLength(1);
    expect(detectLabelledNumericBandConflicts("Risk score is low (0-9), medium (10-19), or high (>19).")).toEqual([]);
    expect(detectLabelledNumericBandConflicts("Risk levels are low (1-2 mg) and high (1-2 mmol).")).toEqual([]);
  });

  it.each([
    "Scores 41-89 (medium), 81-100 (high), >101 (very high).",
    "LUNSERS score bands: 41 to 89 are medium; 81 to 100 are high; >101 is very high.",
  ])("detects overlapping value-first labelled bands: %s", (text) => {
    expect(detectLabelledNumericBandConflicts(text)).toEqual([
      expect.objectContaining({ reason: "overlap", labels: ["medium", "high", "very high"] }),
    ]);
  });

  it.each([
    "Scores 0-9 (low), 10-19 (medium), >19 (high).",
    "LUNSERS score bands: 0 to 9 are low; 10 to 19 are medium; >19 is high.",
  ])("leaves coherent value-first labelled bands unchanged: %s", (text) => {
    expect(detectLabelledNumericBandConflicts(text)).toEqual([]);
  });

  it.each([
    "Score bands: between 41 and 89 is medium; between 81 and 100 is high.",
    "Score bands: medium (scores 41-89), high (scores 81-100).",
    "Score bands: medium = 41-89; high = 81-100.",
    "Score bands: 41-89 corresponds to medium; 81-100 corresponds to high.",
    "Score bands:\n- Medium: 41-89.\n- High: 81-100.",
    "| Band | Score |\n| --- | --- |\n| Medium | 41-89 |\n| High | 81-100 |",
    "Score bands: medium (**41-89**), high (**81-100**).",
    "Score bands: **medium** (41-89), **high** (81-100).",
    "Score bands: **41-89** (medium), **81-100** (high).",
    "LUNSERS score bands: medium scores from 41 to 89; high scores from 81 to 100.",
    "LUNSERS bands: medium 41 through 89; high 81 through 100.",
    "LUNSERS scores: medium 41-89. High 81-100.",
    "LUNSERS: medium 41-89; high 81-100.",
    "LUNSERS score bands: medium from 41 to 89; high from 81 to 100.",
    "LUNSERS score bands: medium 41-89, while the score is high 81-100.",
    "| Score | Band |\n| --- | --- |\n| 41-89 | Medium |\n| 81-100 | High |",
  ])("detects overlapping bands in provider formatting: %s", (text) => {
    expect(detectLabelledNumericBandConflicts(text)).toEqual([
      expect.objectContaining({ reason: "overlap", labels: ["medium", "high"] }),
    ]);
  });

  it.each([
    ["LUNSERS scores: medium 41-89. High 81-100. Very high >101.", ["medium", "high", "very high"]],
    ["LUNSERS: medium 41-89; high 81-100; very high >101.", ["medium", "high", "very high"]],
    ["Severity bands are normal 0-10, borderline 8-15, and severe >15.", ["normal", "borderline", "severe"]],
    ["Severity bands are minimal 0-10, moderate 8-15, and severe >15.", ["minimal", "moderate", "severe"]],
    ["Risk bands are low 0-10 mg, medium 8-15 mg, and high 20-30 mmol.", ["low", "medium"]],
  ])("detects an overlapping compatible-unit subset: %s", (text, labels) => {
    expect(detectLabelledNumericBandConflicts(text)).toEqual([expect.objectContaining({ reason: "overlap", labels })]);
  });

  it("detects a single reversed labelled range", () => {
    expect(detectLabelledNumericBandConflicts("Risk score is high (100-81).")).toEqual([
      expect.objectContaining({ reason: "reversed_range", labels: ["high"] }),
    ]);
  });

  it.each([
    "Depression score is low (0-9), while suicide risk is high (0-9).",
    "Score ranges differ: Guideline A uses low (0-10); Guideline B uses high (5-15).",
    "Score ranges differ: Protocol A uses low (0-10); Protocol B uses high (5-15).",
    "PHQ-9 uses low (0-10); GAD-7 uses high (5-15).",
    "Scale A uses low (0-10); Scale B uses high (5-15).",
    "Score ranges differ: HAM-D uses low (0-10); MADRS uses high (5-15).",
    "Score ranges differ: NICE uses low (0-10); Maudsley uses high (5-15).",
    "Score ranges differ: BPRS uses low (0-10); PANSS uses high (5-15).",
    "HAM-D and MADRS score ranges differ: HAM-D uses low (0-10); MADRS uses high (5-15).",
    "Comparing NICE and Maudsley score ranges: NICE uses low (0-10); Maudsley uses high (5-15).",
    "BPRS and PANSS score ranges: BPRS uses low (0-10); PANSS uses high (5-15).",
  ])("does not merge explicitly distinct scales or sources: %s", (text) => {
    expect(detectLabelledNumericBandConflicts(text)).toEqual([]);
  });

  it("detects overlap when the same named scale is repeated for each band", () => {
    expect(
      detectLabelledNumericBandConflicts("LUNSERS score is medium (41-89); LUNSERS score is high (81-100)."),
    ).toEqual([expect.objectContaining({ reason: "overlap", labels: ["medium", "high"] })]);
  });

  it("recognizes an unlabelled actionable score range as a band reference", () => {
    for (const text of [
      "Escalate when the LUNSERS score is 81-100.",
      "Escalate for scores of 81-100.",
      "Escalate for a result of 81-100 on the LUNSERS score.",
      "Escalate when the score is between 81 and 100.",
      "Escalate at 81-100 points.",
      "Escalate in the 81-100 range.",
      "Escalate for LUNSERS values of 81-100.",
    ]) {
      expect(containsNumericBandReference(text)).toBe(true);
    }
    expect(containsNumericBandReference("The patient is 81-100 years old.")).toBe(false);
  });

  it("does not merge independent answer fields into one conflicting scale", () => {
    const evidence = source({
      content: "Renal risk percentage is low (0-10%). Cardiac severity percentage is high (5-15%).",
    });
    const input: RagAnswer = {
      answer: "Renal risk percentage is low (0-10%).",
      grounded: true,
      confidence: "medium",
      citations: [citationFromResult(evidence, "model_selected")],
      sources: [evidence],
      answerSections: [
        {
          heading: "Cardiac scale",
          body: "Cardiac severity percentage is high (5-15%).",
          citation_chunk_ids: [evidence.id],
        },
      ],
    };

    expect(applyNumericVerification(input)).toMatchObject({ grounded: true, confidence: "medium" });
  });

  it("keeps distinct attributed entries in a preformatted comparison matrix", () => {
    const text = "Guideline A uses low (0-10); Guideline B uses high (5-15).";
    const evidence = source({ content: text });
    const input: RagAnswer = {
      answer: text,
      grounded: true,
      confidence: "high",
      citations: [citationFromResult(evidence, "model_selected")],
      sources: [evidence],
      preformatted: true,
      responseMode: "comparison_matrix",
    };

    expect(applyNumericVerification(input)).toMatchObject({ grounded: true, confidence: "high" });
  });

  it("fails closed for an internally contradictory entry in a preformatted comparison matrix", () => {
    const text = "Guideline A score bands are medium (41-89) and high (81-100).";
    const input: RagAnswer = {
      answer: text,
      grounded: true,
      confidence: "high",
      citations: [],
      sources: [source({ content: text })],
      preformatted: true,
      responseMode: "comparison_matrix",
    };

    expect(applyNumericVerification(input)).toMatchObject({ grounded: false, confidence: "unsupported" });
  });

  it("does not promise a citation after failing closed and clearing citations", () => {
    const input: RagAnswer = {
      answer: "Score bands are medium (41-89) and high (81-100).",
      grounded: true,
      confidence: "high",
      citations: [],
      sources: [],
    };

    const output = applyNumericVerification(input);
    expect(output.citations).toEqual([]);
    expect(output.answer).toContain("Review the source material");
    expect(output.answer).not.toContain("cited source");
  });

  it("canonicalizes equivalent microgram spellings without collapsing milligrams", () => {
    const variants = ["100 ug", "100 µg", "100 μg", "100 mcg", "100 microgram", "100 micrograms"];
    const keys = variants.map((value) => extractClinicalValueAtoms(value)[0]?.canonicalValue);
    expect(new Set(keys)).toEqual(new Set(["100"]));
    expect(variants.map((value) => extractClinicalValueAtoms(value)[0]?.canonicalUnit)).toEqual(
      Array(variants.length).fill("microgram"),
    );
    expect(extractClinicalValueAtoms("100 mg")[0]?.canonicalUnit).toBe("mg");
  });

  it("retains comparator, range, denominator, ratio, route, and frequency semantics", () => {
    expect(extractClinicalValueAtoms("below 2.0 mg/kg/day")[0]).toMatchObject({
      kind: "quantity",
      comparator: "below",
      canonicalValue: "2",
      canonicalUnit: "mg",
      denominatorWeight: "kg",
      denominatorTime: "day",
    });
    expect(extractClinicalValueAtoms("25–50 mg")[0]).toMatchObject({ range: ["25", "50"] });
    expect(extractClinicalValueAtoms("adrenaline 1:1000")[0]).toMatchObject({
      kind: "ratio",
      canonicalValue: "1:1000",
    });
    expect(extractClinicalValueAtoms("4 times daily by intramuscular route")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "frequency", frequency: "4/day" }),
        expect.objectContaining({ kind: "route", route: "intramuscular" }),
      ]),
    );
  });

  it("preserves full scientific-notation thresholds and fails closed on changed meaning", () => {
    expect(extractClinicalValueAtoms("ANC below 2 ×10⁹/L")[0]).toMatchObject({
      kind: "quantity",
      comparator: "below",
      canonicalValue: "2",
      canonicalUnit: "x10^9/L",
    });
    expect(extractClinicalValueAtoms("ANC below 2.0 x10^9/L")[0]).toMatchObject({
      canonicalValue: "2",
      canonicalUnit: "x10^9/L",
    });
    expect(extractClinicalValueAtoms("WBC < 3.0 x 109/L")[0]).toMatchObject({
      comparator: "below",
      canonicalValue: "3",
      canonicalUnit: "x10^9/L",
    });

    const verifies = (answer: string, evidence: string) =>
      verifyAnswerNumbers(answer, [{ chunk_id: "chunk-1" }], [source({ content: evidence })]);
    expect(verifies("Withhold below 2.0 ×10⁹/L.", "Withhold below 2.0 x10^9/L.").hasUnverifiedNumbers).toBe(false);
    expect(verifies("Withhold below 3.0 ×10⁹/L.", "Withhold below 3.0 x 109/L.").hasUnverifiedNumbers).toBe(false);
    expect(verifies("Withhold below 2.0 ×10⁹/L.", "Withhold below 2.0 x10^6/L.").hasUnverifiedNumbers).toBe(true);
    expect(verifies("Withhold below 2.0 ×10⁹/L.", "Withhold below 2.0.").hasUnverifiedNumbers).toBe(true);
    expect(verifyAnswerNumbers("Below 2 ×10⁹/L.", [{ chunk_id: "missing" }], [source()]).hasUnverifiedNumbers).toBe(
      true,
    );
  });

  it("preserves counted-frequency periods", () => {
    expect(extractClinicalValueAtoms("4 times weekly")).toContainEqual(
      expect.objectContaining({ kind: "frequency", frequency: "4/week" }),
    );
    const verification = verifyAnswerNumbers(
      "Give 4 times weekly.",
      [{ chunk_id: "chunk-1" }],
      [source({ content: "Give 4 times daily." })],
    );
    expect(verification.hasUnverifiedNumbers).toBe(true);
  });

  it("preserves word and symbolic comparators on unitless thresholds", () => {
    for (const [text, comparator] of [
      ["ANC below 2.0", "below"],
      ["ANC above 2.0", "above"],
      ["ANC < 2.0", "below"],
      ["ANC <= 2.0", "at_most"],
      ["ANC ≥ 2.0", "at_least"],
      ["ANC > 2.0", "above"],
    ] as const) {
      expect(extractClinicalValueAtoms(text)[0]).toMatchObject({ comparator, canonicalValue: "2" });
    }
    const verification = verifyAnswerNumbers(
      "Withhold above 2.0.",
      [{ chunk_id: "chunk-1" }],
      [source({ content: "Withhold below 2.0." })],
    );
    expect(verification.hasUnverifiedNumbers).toBe(true);
  });

  it("captures compact symbolic unitless comparators and keeps direction distinct", () => {
    expect(extractClinicalValueAtoms("ANC<2.0")[0]).toMatchObject({
      comparator: "below",
      canonicalValue: "2",
    });
    expect(extractClinicalValueAtoms("ANC>=2.0")[0]).toMatchObject({
      comparator: "at_least",
      canonicalValue: "2",
    });
    expect(
      verifyAnswerNumbers(
        "Continue when ANC>=2.0.",
        [{ chunk_id: "chunk-1" }],
        [source({ content: "Continue when ANC<2.0." })],
      ).hasUnverifiedNumbers,
    ).toBe(true);
  });

  it("preserves the legacy /dose denominator without matching a bare quantity", () => {
    expect(extractClinicalValueAtoms("5 mg/dose")[0]).toMatchObject({
      canonicalValue: "5",
      canonicalUnit: "mg",
      denominatorUnit: "dose",
    });
    expect(
      verifyAnswerNumbers("Give 5 mg/dose.", [{ chunk_id: "chunk-1" }], [source({ content: "Give 5 mg." })])
        .hasUnverifiedNumbers,
    ).toBe(true);
    expect(
      verifyAnswerNumbers("Give 5 mg/dose.", [{ chunk_id: "chunk-1" }], [source({ content: "Give 5 mg/dose." })])
        .hasUnverifiedNumbers,
    ).toBe(false);
  });

  it("canonicalizes presentation-equivalent decimals without collapsing different magnitudes", () => {
    expect(extractClinicalValueAtoms("2 mg")[0]?.canonicalValue).toBe("2");
    expect(extractClinicalValueAtoms("2.0 mg")[0]?.canonicalValue).toBe("2");
    expect(
      verifyAnswerNumbers("Give 2.0 mg.", [{ chunk_id: "chunk-1" }], [source({ content: "Give 2 mg." })])
        .hasUnverifiedNumbers,
    ).toBe(false);
    expect(
      verifyAnswerNumbers(
        "ANC below 2.0 ×10⁹/L.",
        [{ chunk_id: "chunk-1" }],
        [source({ content: "ANC below 2 ×10⁹/L." })],
      ).hasUnverifiedNumbers,
    ).toBe(false);
    expect(
      verifyAnswerNumbers("Give 1.5 mg.", [{ chunk_id: "chunk-1" }], [source({ content: "Give 15 mg." })])
        .hasUnverifiedNumbers,
    ).toBe(true);
  });

  it("canonicalizes second denominator variants", () => {
    for (const value of ["5 mL/second", "5 mL/seconds", "5 mL/sec", "5 mL/secs"]) {
      expect(extractClinicalValueAtoms(value)[0]).toMatchObject({ denominatorTime: "second" });
    }
    expect(
      verifyAnswerNumbers("Infuse 5 mL/sec.", [{ chunk_id: "chunk-1" }], [source({ content: "Infuse 5 mL/second." })])
        .hasUnverifiedNumbers,
    ).toBe(false);
  });

  it("keeps meaning-changing clinical values distinct while accepting formatting equivalents", () => {
    const verifies = (answer: string, evidence: string) =>
      verifyAnswerNumbers(answer, [{ chunk_id: "chunk-1" }], [source({ content: evidence })]);

    expect(verifies("Give 100 µg daily.", "Give 100 mcg once daily.").hasUnverifiedNumbers).toBe(false);
    expect(verifies("Give 25 - 50 mg.", "Give 25–50 MG.").hasUnverifiedNumbers).toBe(false);
    for (const [answer, evidence] of [
      ["Infuse 5 mL/day.", "Infuse 5 mL/hr."],
      ["Use 1:1000.", "Use 1:10000."],
      ["Give 100 micrograms.", "Give 100 mg."],
      ["Give 10 mg daily.", "Give 10 mg weekly."],
      ["Give 10 mg orally.", "Give 10 mg intramuscularly."],
      ["Give 25-50 mg.", "Give 25 mg."],
      ["Give 1.5 mg.", "Give 15 mg."],
    ]) {
      expect(verifies(answer, evidence).hasUnverifiedNumbers, `${answer} vs ${evidence}`).toBe(true);
    }
  });
  it("extracts dose, threshold, and range tokens from clinical prose", () => {
    const tokens = extractNumericTokens("Start 12.5 mg then titrate 25-50 mg; withhold if ANC below 2.0.");
    expect(tokens).toContain("12.5mg");
    expect(tokens).toContain("25-50mg");
    expect(tokens).toContain("2.0");
  });

  it("preserves rate denominators, dilution ratios, and ASCII microgram aliases", () => {
    expect(extractNumericTokens("Infuse 30 mL/day, not 30 mL/hr.")).toEqual(
      expect.arrayContaining(["30ml/day", "30ml/hr"]),
    );
    expect(extractNumericTokens("Use 1:1000 rather than 1:10000.")).toEqual(
      expect.arrayContaining(["1:1000", "1:10000"]),
    );
    expect(extractNumericTokens("Give 100 ug.")).toContain("100mcg");
  });

  it("rejects a rate or dilution that differs from the cited source", () => {
    const result = source({ content: "Infuse at 30 mL/day using a 1:1000 dilution." });
    const verification = verifyAnswerNumbers(
      "Infuse at 30 mL/hr using a 1:10000 dilution.",
      [{ chunk_id: "chunk-1" }],
      [result],
    );
    expect(verification.unverifiedTokens).toEqual(expect.arrayContaining(["30ml/hr", "1:10000"]));
  });

  it("passes when every numeric token appears in a cited chunk", () => {
    const result = source();
    const verification = verifyAnswerNumbers(
      "Begin clozapine at 12.5 mg, titrate to 25-50 mg, and withhold when ANC is below 2.0 ×10⁹/L.",
      [{ chunk_id: "chunk-1" }],
      [result],
    );
    expect(verification.hasUnverifiedNumbers).toBe(false);
    expect(verification.unverifiedTokens).toEqual([]);
  });

  it("flags a paraphrased/mis-transcribed dose that is absent from cited sources", () => {
    const result = source();
    const verification = verifyAnswerNumbers(
      "Begin clozapine at 15 mg and titrate to 100 mg.",
      [{ chunk_id: "chunk-1" }],
      [result],
    );
    expect(verification.hasUnverifiedNumbers).toBe(true);
    expect(verification.unverifiedTokens).toContain("15mg");
    expect(verification.unverifiedTokens).toContain("100mg");
  });

  it("only credits chunks the answer actually cites", () => {
    const cited = source({ id: "chunk-1", content: "Monitor weekly." });
    const uncited = source({ id: "chunk-2", content: "Dose is 12.5 mg." });
    const verification = verifyAnswerNumbers("Give 12.5 mg.", [{ chunk_id: "chunk-1" }], [cited, uncited]);
    expect(verification.hasUnverifiedNumbers).toBe(true);
    expect(verification.unverifiedTokens).toContain("12.5mg");
  });

  // Verification is union-over-cited-chunks: a figure passes when at least one chunk
  // the answer cites contains it verbatim. The earlier intersection semantics (require
  // the figure in EVERY cited chunk) flagged nearly all legitimate multi-source answers
  // — a stitched answer citing a dose table and a review-interval chunk can never have
  // each figure in both — and demoted correct grounded answers to "unsupported"
  // (4 golden-eval regressions, canary #459). Cross-entity misattribution (drug A's
  // sentence carrying drug B's cited dose) is not detectable by bare atom membership
  // under either semantics; that risk belongs to the claim-support layer
  // (rag-claim-support.ts) and to per-section citation scoping.
  it("verifies figures drawn from different cited chunks (union over citations)", () => {
    const doseChunk = source({ id: "chunk-a", content: "Olanzapine maximum 20 mg in 24 hours." });
    const reviewChunk = source({ id: "chunk-b", content: "Review all oral doses after 60 minutes." });
    const verification = verifyAnswerNumbers(
      "Olanzapine maximum 20 mg in 24 hours; review oral doses after 60 minutes.",
      [{ chunk_id: "chunk-a" }, { chunk_id: "chunk-b" }],
      [doseChunk, reviewChunk],
    );
    expect(verification.hasUnverifiedNumbers).toBe(false);
    expect(verification.unverifiedTokens).toEqual([]);
  });

  it("still flags a figure that appears in no cited chunk even with multiple citations", () => {
    const drugA = source({ id: "chunk-a", content: "Drug A requires renal monitoring." });
    const drugB = source({ id: "chunk-b", content: "Drug B is given at 30 mg daily." });
    const verification = verifyAnswerNumbers(
      "Give drug A at 45 mg daily.",
      [{ chunk_id: "chunk-a" }, { chunk_id: "chunk-b" }],
      [drugA, drugB],
    );
    expect(verification.hasUnverifiedNumbers).toBe(true);
    expect(verification.unverifiedTokens).toContain("45mg");
  });

  // B1: substring matching previously let a wrong dose verify against a longer
  // number ("2.5 mg" inside "12.5 mg" = a 5x dose error). Matching is now by
  // exact normalized token membership, so these must be flagged UNVERIFIED.
  it("flags a dose that is only a substring of a source number (B1: 2.5 vs 12.5)", () => {
    const result = source({ content: "Start clozapine 12.5 mg on day 1." });
    const verification = verifyAnswerNumbers("Give 2.5 mg.", [{ chunk_id: "chunk-1" }], [result]);
    expect(verification.hasUnverifiedNumbers).toBe(true);
    expect(verification.unverifiedTokens).toContain("2.5mg");
  });

  it("flags 500 mg against a source that only contains 1500 mg (B1)", () => {
    const result = source({ content: "Maximum dose is 1500 mg per day." });
    const verification = verifyAnswerNumbers("Use 500 mg.", [{ chunk_id: "chunk-1" }], [result]);
    expect(verification.hasUnverifiedNumbers).toBe(true);
    expect(verification.unverifiedTokens).toContain("500mg");
  });

  it("flags 2.0 against a source that only contains 12.0 (B1)", () => {
    const result = source({ content: "Threshold is 12.0 units." });
    const verification = verifyAnswerNumbers("Use 2.0 units.", [{ chunk_id: "chunk-1" }], [result]);
    expect(verification.hasUnverifiedNumbers).toBe(true);
    expect(verification.unverifiedTokens).toContain("2.0units");
  });

  it("still verifies an exact dose match (B1)", () => {
    const result = source({ content: "Start clozapine 12.5 mg on day 1." });
    const verification = verifyAnswerNumbers("Give 12.5 mg.", [{ chunk_id: "chunk-1" }], [result]);
    expect(verification.hasUnverifiedNumbers).toBe(false);
    expect(verification.unverifiedTokens).toEqual([]);
  });

  // B2: unicode superscript ANC/WBC thresholds must be extracted whole and
  // match a source written in either superscript (×10⁹/L) or ASCII (x10^9/L).
  it("extracts a unicode superscript threshold token whole (B2)", () => {
    const tokens = extractNumericTokens("ANC below 2.0 ×10⁹/L.");
    expect(tokens.some((t) => t.includes("x10^9"))).toBe(true);
    expect(tokens.some((t) => t === "2.0x10")).toBe(false);
  });

  it("matches a superscript answer threshold against an ASCII source (B2)", () => {
    const result = source({ content: "Withhold if ANC below 2.0 x10^9/L." });
    const verification = verifyAnswerNumbers("Withhold below 2.0 ×10⁹/L.", [{ chunk_id: "chunk-1" }], [result]);
    expect(verification.hasUnverifiedNumbers).toBe(false);
  });

  // B3: the percentage branch never matched because of a trailing \b. Percentages
  // must now extract, and a percentage mismatch must be flagged.
  it("extracts percentage tokens (B3)", () => {
    const tokens = extractNumericTokens("Seen in 80% and 50% of cases.");
    expect(tokens).toContain("80%");
    expect(tokens).toContain("50%");
  });

  it("flags a percentage absent from the cited source (B3)", () => {
    const result = source({ content: "Occurs in 80% of patients." });
    const verification = verifyAnswerNumbers("Occurs in 50% of patients.", [{ chunk_id: "chunk-1" }], [result]);
    expect(verification.hasUnverifiedNumbers).toBe(true);
    expect(verification.unverifiedTokens).toContain("50%");
  });

  // N1: with no cited chunk mapping to a known result, fail closed — numbers are
  // unverified rather than checked against the full unfiltered result set.
  it("fails closed when no citation maps to a known chunk (N1)", () => {
    const uncited = source({ id: "chunk-2", content: "Dose is 12.5 mg." });
    const verification = verifyAnswerNumbers("Give 12.5 mg.", [{ chunk_id: "missing" }], [uncited]);
    expect(verification.hasUnverifiedNumbers).toBe(true);
    expect(verification.unverifiedTokens).toContain("12.5mg");
  });

  // H1 (audit 2026-07-01): the verification corpus must include everything the
  // model was shown in buildRagSourceBlock. A number living only in the chunk's
  // retrieval synopsis or a table-crop image's text previously flagged as
  // unverified, blanking a faithful answer.
  it("verifies a number that appears only in the retrieval synopsis (H1)", () => {
    const result = source({
      content: "See the monitoring summary.",
      retrieval_synopsis: "Withhold clozapine when ANC falls below 2.0 ×10⁹/L; restart at 12.5 mg.",
    });
    const verification = verifyAnswerNumbers(
      "Withhold below 2.0 ×10⁹/L and restart at 12.5 mg.",
      [{ chunk_id: "chunk-1" }],
      [result],
    );
    expect(verification.hasUnverifiedNumbers).toBe(false);
  });

  it("verifies a number that appears only in a cited image's table text (H1)", () => {
    const result = source({
      content: "Refer to the threshold table.",
      images: [
        {
          id: "img-1",
          page_number: 4,
          storage_path: "images/doc-1/img-1.png",
          caption: "Monitoring thresholds",
          tableTextSnippet: "Amber: ANC 1.5-2.0, increase monitoring.",
          accessibleTableMarkdown: "| Band | ANC | Action |\n| Amber | 1.5-2.0 | Increase monitoring |",
        },
      ],
    });
    const verification = verifyAnswerNumbers(
      "In the amber band (ANC 1.5-2.0) increase monitoring.",
      [{ chunk_id: "chunk-1" }],
      [result],
    );
    expect(verification.hasUnverifiedNumbers).toBe(false);
  });

  it("matches numbers in table facts of a cited chunk", () => {
    const result = source({
      content: "See monitoring table.",
      table_facts: [
        {
          id: "tf-1",
          document_id: "doc-1",
          source_chunk_id: "chunk-1",
          source_image_id: null,
          page_number: 4,
          table_title: "ANC thresholds",
          row_label: "Green",
          clinical_parameter: "ANC",
          threshold_value: "at least 2.0 ×10⁹/L",
          action: "Continue",
        },
      ],
    });
    const verification = verifyAnswerNumbers(
      "Continue if ANC is at least 2.0 ×10⁹/L.",
      [{ chunk_id: "chunk-1" }],
      [result],
    );
    expect(verification.hasUnverifiedNumbers).toBe(false);
  });
});

describe("P12B exact retained-answer metadata", () => {
  it.each(["not_in_corpus", "source_role_mismatch", "timeout", "provider_failure"] as const)(
    "retains supported prose and names only the missing required part for %s",
    async (reason) => {
      const { retainVerifiedAnswerParts } = await import("../src/lib/rag/rag-extractive-answer");
      const { adaptiveAnswerGenerationContract } = await import("../src/lib/rag/rag-versioning");
      const row = source({ content: "For agitation management, use oral medication when the patient is willing." });
      const coverage: import("../src/lib/types").AnswerCoveragePlan = {
        interpretation: "Agitation management and adolescent monitoring",
        ambiguity: null,
        subquestions: [
          { id: "adult", question: "Agitation management", required: true },
          { id: "adolescent", question: "Adolescent monitoring schedule", required: true },
          { id: "optional", question: "Optional background", required: false },
        ],
        coverage: [
          { subquestionId: "adult", status: "direct", chunkIds: [row.id], reasonCodes: [] },
          { subquestionId: "adolescent", status: "absent", chunkIds: [], reasonCodes: [reason] },
        ],
        conflicts: [],
        overall: "partial",
        insufficiencyReason: reason,
      };
      const input: RagAnswer = {
        answer: row.content,
        grounded: true,
        confidence: "high",
        sources: [row],
        citations: [citationFromResult(row, "model_selected")],
        answerSections: [
          {
            heading: "Invented gap",
            body: "Missing adult treatment.",
            kind: "source_gap",
            supportLevel: "unsupported",
            citation_chunk_ids: [],
          },
        ],
      };
      const context = {
        query: "How is agitation managed?",
        queryClass: "unsupported_or_general" as const,
        contract: adaptiveAnswerGenerationContract,
        resolveCoverage: () => coverage,
      };
      const result = retainVerifiedAnswerParts(input, context);
      expect(result.answer.grounded).toBe(true);
      expect(result.answer.answer.replaceAll("**", "")).toContain(row.content);
      const gap = result.answer.answerSections?.find((s) => s.kind === "source_gap");
      expect(result.gapAdded).toBe(true);
      expect(gap?.body).toContain("Adolescent monitoring schedule");
      expect(gap?.body).not.toMatch(/Agitation management|Optional background|Missing adult/);
      expect(gap?.citation_chunk_ids).toEqual([]);
      expect(retainVerifiedAnswerParts(result.answer, context).answer.answerSections).toEqual(
        result.answer.answerSections,
      );
    },
  );
});

it("P12B consumer retains every supported part when one supporting source is removed", async () => {
  const { retainVerifiedAnswerParts } = await import("../src/lib/rag/rag-extractive-answer");
  const { adaptiveAnswerGenerationContract } = await import("../src/lib/rag/rag-versioning");
  const lead = "For agitation, offer oral medication when the patient is willing.";
  const firstFact = "Record the person's preferred language before discussing agitation care.";
  const secondFact = "Document the agreed care contact after discussing agitation care.";
  const first = source({ id: "first", content: lead + " " + firstFact });
  const second = source({ id: "second", content: secondFact });
  for (const removeSecond of [false, true]) {
    const answer: RagAnswer = {
      answer: lead,
      grounded: true,
      confidence: "high",
      sources: removeSecond ? [first] : [first, second],
      citations: [citationFromResult(first, "model_selected"), citationFromResult(second, "model_selected")],
      answerSections: [
        {
          heading: "Language",
          body: firstFact,
          kind: "required_actions",
          supportLevel: "direct",
          citation_chunk_ids: [first.id],
        },
        {
          heading: "Care contact",
          body: secondFact,
          kind: "required_actions",
          supportLevel: "direct",
          citation_chunk_ids: [second.id],
        },
      ],
    };
    const result = retainVerifiedAnswerParts(answer, {
      query: "Explain agitation management in detail.",
      queryClass: "broad_summary",
      contract: adaptiveAnswerGenerationContract,
      resolveCoverage: (verified) => ({
        interpretation: "Language and care contact",
        ambiguity: null,
        subquestions: [
          { id: "first", question: "Preferred language", required: true },
          { id: "second", question: "Agreed care contact", required: true },
        ],
        coverage: [first, second].map((row) => ({
          subquestionId: row.id,
          status: verified.citations.some((citation) => citation.chunk_id === row.id) ? "direct" : "absent",
          chunkIds: verified.citations.some((citation) => citation.chunk_id === row.id) ? [row.id] : [],
          reasonCodes: [],
        })),
        conflicts: [],
        overall: removeSecond ? "partial" : "complete",
        insufficiencyReason: removeSecond ? "not_in_corpus" : null,
      }),
    });
    expect(result.answer.answer.replaceAll("**", "")).toBe(lead);
    expect(result.answer.answerSections?.[0]?.body).toBe(firstFact);
    expect(result.retainedSectionCount).toBe(removeSecond ? 1 : 2);
    expect(result.droppedSectionCount).toBe(removeSecond ? 1 : 0);
    if (removeSecond) {
      expect(result.answer.answerSections?.[1]?.body).toBe("Agreed care contact: not covered by the active sources.");
      expect(result.answer.citations.map((citation) => citation.chunk_id)).toEqual([first.id]);
    } else expect(result.answer.answerSections?.[1]?.body).toBe(secondFact);
  }
});

it("P12B consolidates only identical evidence and keeps every heading and fact across repeated finalization", async () => {
  const { retainVerifiedAnswerParts } = await import("../src/lib/rag/rag-extractive-answer");
  const { adaptiveAnswerGenerationContract } = await import("../src/lib/rag/rag-versioning");
  const { answerWithinLimits, adaptiveAnswerLimits } = await import("../src/lib/rag/rag-answer-contract-limits");
  const lead = "For agitation, offer oral medication when the patient is willing.";
  const facts = [
    "Record the person's preferred language before discussing agitation care.",
    "Document the agreed care contact after discussing agitation care.",
    "Explain the planned review location before discussing agitation care.",
    "Record the person's communication preferences for the agitation review.",
    "Confirm the agreed support person before discussing agitation care.",
    "Document the person's preferred contact method for the agitation review.",
    "Record the nominated care coordinator for the agitation review.",
    "Confirm the agreed handover destination after the agitation review.",
  ];
  const first = source({ id: "first", content: [lead, ...facts].join(" ") });
  const second = source({ id: "second", content: [lead, ...facts].join(" ") });
  const context = {
    query: "Explain agitation management in detail.",
    queryClass: "broad_summary" as const,
    contract: adaptiveAnswerGenerationContract,
    resolveCoverage: (): import("../src/lib/types").AnswerCoveragePlan => ({
      interpretation: "Care and monitoring",
      ambiguity: null,
      subquestions: [
        { id: "care", question: "Care", required: true },
        { id: "monitoring", question: "Adolescent monitoring", required: true },
      ],
      coverage: [
        { subquestionId: "care", status: "direct", chunkIds: [first.id, second.id], reasonCodes: [] },
        { subquestionId: "monitoring", status: "absent", chunkIds: [], reasonCodes: [] },
      ],
      conflicts: [],
      overall: "partial",
      insufficiencyReason: "not_in_corpus",
    }),
  };
  for (const mixedCitations of [false, true]) {
    const input: RagAnswer = {
      answer: lead,
      grounded: true,
      confidence: "high",
      sources: [first, second],
      citations: [citationFromResult(first, "model_selected"), citationFromResult(second, "model_selected")],
      answerSections: facts.map((body, index) => ({
        heading: "Care " + String.fromCharCode(65 + index),
        body,
        kind: "required_actions",
        supportLevel: "direct",
        citation_chunk_ids: [mixedCitations && index % 2 ? second.id : first.id],
      })),
    };
    const result = retainVerifiedAnswerParts(input, context).answer;
    expect(result.answerSections).toHaveLength(mixedCitations ? 9 : 8);
    expect(answerWithinLimits(result, adaptiveAnswerLimits)).toBe(!mixedCitations);
    const delivered = result.answerSections!.map((section) => section.heading + "\n" + section.body).join("\n");
    for (const fact of facts) expect(delivered).toContain(fact);
    for (let index = 0; index < 8; index++) expect(delivered).toContain("Care " + String.fromCharCode(65 + index));
    expect(retainVerifiedAnswerParts(result, context).answer.answerSections).toEqual(result.answerSections);
  }
});

it.each([
  { withheld: false, sameSource: false, leadOnly: false },
  { withheld: true, sameSource: false, leadOnly: false },
  { withheld: false, sameSource: true, leadOnly: false },
  { withheld: true, sameSource: true, leadOnly: false },
  { withheld: false, sameSource: true, leadOnly: true },
])(
  "P12B R1 reconciles surviving claims (withheld=$withheld, shared=$sameSource, lead=$leadOnly)",
  async ({ withheld, sameSource, leadOnly }) => {
    const { retainVerifiedAnswerParts } = await import("../src/lib/rag/rag-extractive-answer");
    const { adaptiveAnswerGenerationContract } = await import("../src/lib/rag/rag-versioning");
    const lead = "For agitation, offer oral medication when the patient is willing.";
    const firstFact = "Record the person's preferred language before discussing agitation care.";
    const secondFact = "Document the agreed care contact after discussing agitation care.";
    const first = source({ id: "language", content: lead + " " + firstFact + (sameSource ? " " + secondFact : "") });
    const second = source({ id: "contact", content: secondFact });
    const coverage: import("../src/lib/types").AnswerCoveragePlan = {
      interpretation: "Language and care contact",
      ambiguity: null,
      subquestions: [
        { id: "language", question: "Preferred language", required: true },
        { id: "contact", question: "Agreed care contact", required: true },
      ],
      coverage: [first, second].map((row) => ({
        subquestionId: row.id,
        status: "direct",
        chunkIds: [sameSource ? first.id : row.id],
        reasonCodes: [],
      })),
      conflicts: [],
      overall: "complete",
      insufficiencyReason: null,
    };
    const context = {
      query: "Explain agitation management in detail.",
      queryClass: "broad_summary" as const,
      contract: adaptiveAnswerGenerationContract,
      resolveCoverage: () => structuredClone(coverage),
    };
    const rows = sameSource ? [first] : [first, second];
    const input: RagAnswer = {
      answer: leadOnly ? [lead, firstFact, secondFact].join(" ") : lead,
      grounded: true,
      confidence: "high",
      sources: rows,
      citations: rows.map((row) => citationFromResult(row, "model_selected")),
      answerSections: leadOnly
        ? []
        : [
            {
              heading: "Language",
              body: firstFact,
              kind: "required_actions",
              supportLevel: "direct",
              citation_chunk_ids: [first.id],
            },
            {
              heading: "Care contact",
              body: withheld ? "The agreed care contact reduces mortality by 90%." : secondFact,
              kind: "required_actions",
              supportLevel: "direct",
              citation_chunk_ids: [sameSource ? first.id : second.id],
            },
          ],
    };
    const result = retainVerifiedAnswerParts(input, context).answer;
    expect(result.answer.replaceAll("**", "")).toBe(input.answer);
    if (!leadOnly) expect(result.answerSections?.[0]?.body).toBe(firstFact);
    expect(result.sources.map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(result.citations.map((citation) => citation.chunk_id)).toEqual(rows.map((row) => row.id));
    const gap = result.answerSections?.find((section) => section.kind === "source_gap");
    if (withheld) {
      expect(result.answerSections?.some((section) => section.body.includes("90%"))).toBe(false);
      expect(gap?.body).toContain("Agreed care contact");
      expect(gap?.body).not.toContain("not covered by the active sources");
    } else {
      expect(gap).toBeUndefined();
      if (!leadOnly) expect(result.answerSections?.[1]?.body).toBe(secondFact);
    }
    expect(retainVerifiedAnswerParts(result, context).answer.answerSections).toEqual(result.answerSections);
  },
);

it("P12B R1 retains a supported paraphrase and rejects same-topic coverage missing its distinguishing facet", async () => {
  const { retainVerifiedAnswerParts } = await import("../src/lib/rag/rag-extractive-answer");
  const { adaptiveAnswerGenerationContract } = await import("../src/lib/rag/rag-versioning");
  const { deliveredProseRelevance } = await import("../src/lib/evidence-relevance");
  const lead = "For agitation, offer oral medication when the patient is willing.";
  const sourceFact = "Record the person's preferred language before discussing agitation care.";
  const paraphrase = "Before discussing agitation care, document the person's preferred language.";
  const longFact = "For adult inpatient agitation care, record communication preferences.";
  const longQuestion = "For adult inpatient agitation care, record communication preferences and consent.";
  expect(deliveredProseRelevance(longQuestion, longFact).direct).toBe(true);
  for (const sameTopic of [false, true]) {
    const firstFact = sameTopic ? longFact : paraphrase;
    const row = source({
      content: [
        lead,
        sameTopic ? longFact : sourceFact,
        "For adult inpatient agitation care, record the consent decision.",
      ].join(" "),
    });
    const coverage: import("../src/lib/types").AnswerCoveragePlan = {
      interpretation: "Care details",
      ambiguity: null,
      subquestions: [
        { id: "present", question: sameTopic ? longFact : "Preferred language", required: true },
        { id: "absent", question: sameTopic ? longQuestion : "Consent decision", required: true },
      ],
      coverage: ["present", "absent"].map((id) => ({
        subquestionId: id,
        status: "direct",
        chunkIds: [row.id],
        reasonCodes: [],
      })),
      conflicts: [],
      overall: "complete",
      insufficiencyReason: null,
    };
    const result = retainVerifiedAnswerParts(
      {
        answer: lead,
        grounded: true,
        confidence: "high",
        sources: [row],
        citations: [citationFromResult(row, "model_selected")],
        answerSections: [
          {
            heading: "Communication",
            body: firstFact,
            kind: "required_actions",
            supportLevel: "direct",
            citation_chunk_ids: [row.id],
          },
        ],
      },
      {
        query: "Explain agitation management in detail.",
        queryClass: "broad_summary",
        contract: adaptiveAnswerGenerationContract,
        resolveCoverage: () => coverage,
      },
    ).answer;
    expect(result.answerSections?.[0]?.body).toBe(firstFact);
    const gap = result.answerSections?.find((section) => section.kind === "source_gap");
    expect(gap?.body).toContain(sameTopic ? longQuestion : "Consent decision");
    if (!sameTopic) expect(gap?.body).not.toContain("Preferred language");
    expect(gap?.body).not.toContain("not covered by the active sources");
  }
});

async function p12bR2DeliveredCase(
  questions: string[] | import("../src/lib/types").RagQueryPlan,
  facts: string[],
  rowOverrides: Partial<SearchResult> = {},
  options: {
    leadOnly?: boolean;
    alternateKinds?: boolean;
    customizeCoverage?: (coverage: import("../src/lib/types").AnswerCoveragePlan) => void;
  } = {},
) {
  const { retainVerifiedAnswerParts } = await import("../src/lib/rag/rag-extractive-answer");
  const { adaptiveAnswerGenerationContract } = await import("../src/lib/rag/rag-versioning");
  const lead = "For agitation, offer oral medication when the patient is willing.";
  const row = source({
    title: "Care record",
    file_name: "care.pdf",
    section_heading: "Care",
    ...rowOverrides,
    content: lead + " " + (rowOverrides.content ?? facts.join(" ")),
  });
  const parts = Array.isArray(questions)
    ? questions.map((question, index) => ({ id: `sq-${index + 1}`, question, required: true }))
    : questions.subquestions;
  const coverage: import("../src/lib/types").AnswerCoveragePlan = {
    interpretation: "Delivered completeness",
    ambiguity: null,
    subquestions: parts,
    coverage: parts.map((part) => ({ subquestionId: part.id, status: "direct", chunkIds: [row.id], reasonCodes: [] })),
    conflicts: [],
    overall: "complete",
    insufficiencyReason: null,
  };
  options.customizeCoverage?.(coverage);
  let finalCoverage = coverage;
  const context = {
    query: "Explain agitation management in detail.",
    queryClass: "broad_summary" as const,
    contract: adaptiveAnswerGenerationContract,
    ...(!Array.isArray(questions) ? { queryPlan: questions } : {}),
    resolveCoverage: () => structuredClone(coverage),
    reconcileCoverage: (_: RagAnswer, value: import("../src/lib/types").AnswerCoveragePlan | null) => {
      if (value) finalCoverage = value;
    },
  };
  const input: RagAnswer = {
    answer: options.leadOnly ? [lead, ...facts].join(" ") : lead,
    grounded: true,
    confidence: "high",
    sources: [row],
    citations: [citationFromResult(row, "model_selected")],
    answerSections: options.leadOnly
      ? []
      : facts.map((body, index) => ({
          heading: `Fact ${index + 1}`,
          body,
          kind: options.alternateKinds && index % 2 ? "monitoring_timing" : "required_actions",
          supportLevel: "direct",
          citation_chunk_ids: [row.id],
        })),
  };
  const retained = retainVerifiedAnswerParts(input, context);
  const result = retained.answer;
  expect(
    result.answerSections
      ?.filter((section) => section.kind !== "source_gap")
      .map((section) => section.body.replaceAll("**", "")),
  ).toEqual(options.leadOnly ? [] : facts);
  if (options.leadOnly) for (const fact of facts) expect(result.answer.replaceAll("**", "")).toContain(fact);
  expect(result.sources.map((row) => row.id)).toEqual([row.id]);
  expect(result.citations.map((citation) => citation.chunk_id)).toEqual([row.id]);
  expect(retainVerifiedAnswerParts(result, context).answer.answerSections).toEqual(result.answerSections);
  return { answer: result, coverage: finalCoverage, gapAdded: retained.gapAdded };
}

it("P12B R2 binds real canonical individual and grouped facets to delivered prose", async () => {
  const { buildRagQueryPlan } = await import("../src/lib/rag/rag-query-plan");
  const { analyzeClinicalQuery } = await import("../src/lib/clinical-search");
  const monitoring = "Monitor agitation symptoms every three months.";
  const risk = "Agitation carries a risk of injury.";
  for (const grouped of [false, true]) {
    const query = grouped
      ? "Agitation assessment, management, monitoring and risk in detail."
      : "Agitation monitoring and risk in detail.";
    const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
    expect(plan.subquestions.length).toBe(grouped ? 4 : 3);
    expect(plan.subquestions[0]?.requestedFacets).toEqual(
      grouped ? ["assessment", "management", "monitoring", "risk"] : ["monitoring", "risk"],
    );
    expect(plan.subquestions.at(-1)?.requestedFacets).toEqual(grouped ? ["monitoring", "risk"] : ["risk"]);
    const prefix = grouped
      ? ["Assess agitation symptoms before treatment.", "Manage agitation with a calm environment."]
      : [];
    const partial = await p12bR2DeliveredCase(plan, [...prefix, monitoring]);
    expect(partial.coverage.coverage[0]?.status).toBe("absent");
    expect(partial.coverage.coverage.at(-1)?.status).toBe("absent");
    const gap = partial.answer.answerSections?.find((section) => section.kind === "source_gap")?.body ?? "";
    expect(gap).toMatch(/^risk:/);
    expect(gap).not.toMatch(/monitoring|Focus on|Address the requested/);
    expect(gap.match(/risk/g)).toHaveLength(1);
    const complete = await p12bR2DeliveredCase(plan, [...prefix, monitoring, risk]);
    expect(complete.coverage.coverage.every((entry) => entry.status === "direct")).toBe(true);
    const leadOnly = await p12bR2DeliveredCase(plan, [...prefix, monitoring, risk], {}, { leadOnly: true });
    expect(leadOnly.coverage.coverage.every((entry) => entry.status === "direct")).toBe(true);
  }
});

it("P12B R2 requires the sole requested care-contact part without borrowing a same-row language claim", async () => {
  const language = "Record the person's preferred language before discussing agitation care.";
  const contact = "Document the agreed care contact after discussing agitation care.";
  const partial = await p12bR2DeliveredCase(["Agreed care contact"], [language], { content: language + " " + contact });
  expect(partial.coverage.coverage[0]?.status).toBe("absent");
  expect(partial.answer.answerSections?.find((section) => section.kind === "source_gap")?.body).not.toContain(
    "not covered by the active sources",
  );
  const complete = await p12bR2DeliveredCase(["Agreed care contact"], [contact]);
  expect(complete.coverage.coverage[0]?.status).toBe("direct");
});

it("P12B R2 delivered completeness is invariant to undelivered source headings and context", async () => {
  const fact = "Monitor blood tests annually.";
  const plain = await p12bR2DeliveredCase(["Clozapine monitoring"], [fact]);
  const labelled = await p12bR2DeliveredCase(["Clozapine monitoring"], [fact], {
    title: "Clozapine monitoring",
    section_heading: "Clozapine",
    content: fact + " Clozapine monitoring is described in this section.",
  });
  expect(labelled.coverage.coverage).toEqual(plain.coverage.coverage);
  expect(labelled.coverage.coverage[0]?.status).toBe("absent");
});

it.each(["every 3 months", "every three months", "annually", "yearly", ""])(
  "P12B R2 preserves delivered monitoring frequency '%s' with a frequency-missing control",
  async (frequency) => {
    const fact = `Monitor lithium levels${frequency ? " " + frequency : ""}.`;
    const result = await p12bR2DeliveredCase(["How often should lithium monitoring occur?"], [fact]);
    expect(result.coverage.coverage[0]?.status).toBe(frequency ? "direct" : "absent");
  },
);

it("P12B R2 retains unbound plan consumer names and prefers specific canonical missing reasons", async () => {
  const { buildRagQueryPlan } = await import("../src/lib/rag/rag-query-plan");
  const { analyzeClinicalQuery } = await import("../src/lib/clinical-search");
  const query = "Agitation monitoring and risk in detail.";
  const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
  const unbound = {
    ...plan,
    subquestions: [{ id: "sq-1", question: "Agreed care contact", purpose: "primary" as const, required: true }],
  };
  const language = "Record the person's preferred language before discussing agitation care.";
  const unboundResult = await p12bR2DeliveredCase(unbound, [language]);
  expect(unboundResult.coverage.coverage[0]?.status).toBe("absent");
  expect(unboundResult.answer.answerSections?.find((section) => section.kind === "source_gap")?.body).toMatch(
    /^Agreed care contact:/,
  );
  const monitoring = "Monitor agitation symptoms every three months.";
  const result = await p12bR2DeliveredCase(
    plan,
    [monitoring],
    {},
    {
      customizeCoverage: (coverage) => {
        coverage.coverage[0]!.status = "absent";
        coverage.coverage[0]!.chunkIds = [];
        coverage.coverage[0]!.reasonCodes = ["retrieval_miss"];
        const risk = coverage.coverage.at(-1)!;
        risk.status = "absent";
        risk.chunkIds = [];
        risk.reasonCodes = ["not_in_corpus"];
        coverage.overall = "partial";
        coverage.insufficiencyReason = "insufficient_claim_support";
      },
    },
  );
  expect(result.answer.answerSections?.find((section) => section.kind === "source_gap")?.body).toBe(
    "risk: not covered by the active sources.",
  );
  const explainQuery = "Explain agitation monitoring and risk in detail.";
  const explainPlan = buildRagQueryPlan(explainQuery, analyzeClinicalQuery(explainQuery));
  const missingRationale = await p12bR2DeliveredCase(explainPlan, [monitoring, "Agitation carries a risk of injury."]);
  expect(missingRationale.answer.answerSections?.find((section) => section.kind === "source_gap")?.body).toMatch(
    /^rationale:/,
  );
});

it.each(["", "every 3 months", "every three months", "annually", "yearly"])(
  "P12B R3 enforces canonical monitoring frequency '%s' without withholding risk",
  async (frequency) => {
    const { buildRagQueryPlan } = await import("../src/lib/rag/rag-query-plan");
    const { analyzeClinicalQuery } = await import("../src/lib/clinical-search");
    const query = "What monitoring frequency and risks apply to lithium?";
    const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
    expect(plan.subquestions.map((part) => part.requestedFacets)).toEqual([
      ["monitoring", "risk"],
      ["monitoring"],
      ["risk"],
    ]);
    const monitoring = `Monitor lithium levels${frequency ? " " + frequency : ""}.`;
    const risk = "Lithium carries a risk of tremor.";
    const result = await p12bR2DeliveredCase(plan, [monitoring, risk], {
      content: [monitoring, risk, "Monitor lithium levels every three months."].join(" "),
    });
    expect(result.coverage.coverage.at(-1)?.status).toBe("direct");
    expect(result.coverage.coverage[0]?.status).toBe(frequency ? "direct" : "absent");
    const gap = result.answer.answerSections?.find((section) => section.kind === "source_gap");
    if (frequency) expect(gap).toBeUndefined();
    else {
      expect(gap?.body).toMatch(/^monitoring frequency:/);
      expect(gap?.body).not.toMatch(/risk|not covered by the active sources/);
      const aggregateAbsent = await p12bR2DeliveredCase(
        plan,
        [monitoring, risk],
        {},
        {
          customizeCoverage: (coverage) => {
            coverage.coverage[0]!.status = "absent";
            coverage.coverage[0]!.chunkIds = [];
            coverage.coverage[0]!.reasonCodes = ["retrieval_miss"];
            coverage.overall = "partial";
          },
        },
      );
      expect(aggregateAbsent.answer.answerSections?.find((section) => section.kind === "source_gap")?.body).toBe(
        gap?.body,
      );
    }
  },
);

it.each([
  [
    "compound dosing",
    "Start lithium at 300 mg daily and monitor lithium levels.",
    "Start lithium at 300 mg daily and monitor lithium levels every 3 months.",
  ],
  [
    "during treatment",
    "Monitor lithium levels during daily lithium treatment.",
    "Monitor lithium levels every three months during daily lithium treatment.",
  ],
  [
    "while monitoring",
    "Monitor lithium levels while receiving daily lithium treatment.",
    "Monitor lithium levels every three months while receiving daily lithium treatment.",
  ],
  ["duration only", "Monitor lithium levels for three months.", "Monitor lithium levels monthly for three months."],
  [
    "numeric treatment interval",
    "Monitor lithium levels during lithium treatment every 3 months.",
    "Monitor lithium levels every 3 months during lithium treatment.",
  ],
  [
    "treatment before monitoring",
    "During daily lithium treatment, monitor lithium levels.",
    "During daily lithium treatment, monitor lithium levels every 3 months.",
  ],
  [
    "compound treatment after monitoring",
    "Monitor lithium levels and take lithium daily.",
    "Monitor lithium levels annually and take lithium daily.",
  ],
  [
    "treatment with monitoring",
    "Monitor lithium levels with daily lithium treatment.",
    "Monitor lithium levels yearly with daily lithium treatment.",
  ],
  ["treatment adjective", "Monitor daily lithium treatment.", "Monitor daily lithium treatment every three months."],
])("P12B R4 binds delivered monitoring cadence locally: %s", async (_name, unspecified, scheduled) => {
  const { buildRagQueryPlan } = await import("../src/lib/rag/rag-query-plan");
  const { analyzeClinicalQuery } = await import("../src/lib/clinical-search");
  const query = "What monitoring frequency and risks apply to lithium?";
  const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
  expect(plan.subquestions.map((part) => part.requestedFacets)).toEqual([
    ["monitoring", "risk"],
    ["monitoring"],
    ["risk"],
  ]);
  const risk = "Lithium carries a risk of tremor.";
  // The verifier splits source prose at "while". Use the equivalent "during"
  // source phrase; both delivered variants must still earn actual direct support.
  const row = { content: [unspecified, scheduled, risk].join(" ").replaceAll("while receiving", "during") };
  for (const [monitoring, complete] of [
    [unspecified, false],
    [scheduled, true],
  ] as const) {
    const result = await p12bR2DeliveredCase(plan, [monitoring, risk], row);
    expect(result.answer.supportedClaims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: monitoring, supportStatus: "direct", supportingChunkIds: ["chunk-1"] }),
        expect.objectContaining({ text: risk, supportStatus: "direct", supportingChunkIds: ["chunk-1"] }),
      ]),
    );
    expect(result.coverage.coverage.map((entry) => entry.status)).toEqual(
      complete ? ["direct", "direct", "direct"] : ["absent", "absent", "direct"],
    );
    expect(result.gapAdded).toBe(!complete);
    const gap = result.answer.answerSections?.find((section) => section.kind === "source_gap");
    if (complete) expect(gap).toBeUndefined();
    else {
      expect(gap?.body).toMatch(/^monitoring frequency:/);
      expect(gap?.body).not.toMatch(/risk|not covered by the active sources/);
    }
  }
});

it.each([
  "Check lithium levels every three months.",
  "Lithium levels should be checked every 3 months.",
  "Monitor lithium levels once a month.",
  "Monitor lithium levels on a monthly basis.",
  "Review lithium levels annually.",
  "Monitor lithium levels daily.",
  "Every three months, monitor lithium levels.",
  "Monitor lithium levels and renal function every three months.",
  "Monitor lithium levels at three-month intervals.",
  "Monitor lithium levels at 3-month intervals.",
])("P12B R4 preserves explicit monitoring schedule paraphrase: %s", async (monitoring) => {
  const { buildRagQueryPlan } = await import("../src/lib/rag/rag-query-plan");
  const { analyzeClinicalQuery } = await import("../src/lib/clinical-search");
  const query = "What monitoring frequency and risks apply to lithium?";
  const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
  const result = await p12bR2DeliveredCase(plan, [monitoring, "Lithium carries a risk of tremor."]);
  expect(result.coverage.coverage.every((entry) => entry.status === "direct")).toBe(true);
  expect(result.gapAdded).toBe(false);
});

it.each([
  "document medication adherence",
  "record weight",
  "assess hydration",
  "notify the care team",
  "also record weight",
  "should record weight",
])("P12B R5 keeps a coordinated clinical action's cadence separate: %s", async (otherAction) => {
  const { buildRagQueryPlan } = await import("../src/lib/rag/rag-query-plan");
  const { analyzeClinicalQuery } = await import("../src/lib/clinical-search");
  const { hasClinicalActionSignal } = await import("../src/lib/rag/rag-clinical-language-signals");
  expect(hasClinicalActionSignal(otherAction)).toBe(true);
  const query = "What monitoring frequency and risks apply to lithium?";
  const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
  expect(plan.subquestions.map((part) => part.requestedFacets)).toEqual([
    ["monitoring", "risk"],
    ["monitoring"],
    ["risk"],
  ]);
  const unspecified = `Monitor lithium levels and ${otherAction} daily.`;
  const scheduledBefore = `Monitor lithium levels every three months and ${otherAction} daily.`;
  const scheduledAfter = `${otherAction[0]!.toUpperCase()}${otherAction.slice(1)} daily and monitor lithium levels every three months.`;
  const risk = "Lithium carries a risk of tremor.";
  const row = { content: [unspecified, scheduledBefore, scheduledAfter, risk].join(" ") };
  for (const [monitoring, complete] of [
    [unspecified, false],
    [scheduledBefore, true],
    [scheduledAfter, true],
  ] as const) {
    const result = await p12bR2DeliveredCase(plan, [monitoring, risk], row);
    expect(result.answer.supportedClaims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: monitoring, supportStatus: "direct", supportingChunkIds: ["chunk-1"] }),
        expect.objectContaining({ text: risk, supportStatus: "direct", supportingChunkIds: ["chunk-1"] }),
      ]),
    );
    expect(result.coverage.coverage.map((entry) => entry.status)).toEqual(
      complete ? ["direct", "direct", "direct"] : ["absent", "absent", "direct"],
    );
    expect(result.gapAdded).toBe(!complete);
    const gap = result.answer.answerSections?.find((section) => section.kind === "source_gap");
    if (complete) expect(gap).toBeUndefined();
    else {
      expect(gap?.body).toBe("monitoring frequency: The active sources support only part of this question.");
    }
  }
});

it.each(["medication use", "family support"])(
  "P12B R5 preserves a coordinated monitored noun object containing an action word: %s",
  async (object) => {
    const { buildRagQueryPlan } = await import("../src/lib/rag/rag-query-plan");
    const { analyzeClinicalQuery } = await import("../src/lib/clinical-search");
    const { hasClinicalActionSignal } = await import("../src/lib/rag/rag-clinical-language-signals");
    expect(hasClinicalActionSignal(object)).toBe(true);
    const query = "What monitoring frequency and risks apply to lithium?";
    const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
    const monitoring = `Monitor lithium levels and ${object} every three months.`;
    const result = await p12bR2DeliveredCase(plan, [monitoring, "Lithium carries a risk of tremor."]);
    expect(result.answer.supportedClaims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: monitoring, supportStatus: "direct", supportingChunkIds: ["chunk-1"] }),
      ]),
    );
    expect(result.coverage.coverage.every((entry) => entry.status === "direct")).toBe(true);
    expect(result.gapAdded).toBe(false);
  },
);

it.each([
  ["support needs", true],
  ["support requirements", true],
  ["support the family", false],
] as const)("P12B C1 distinguishes a coordinated support noun from a support action: %s", async (object, complete) => {
  const { buildRagQueryPlan } = await import("../src/lib/rag/rag-query-plan");
  const { analyzeClinicalQuery } = await import("../src/lib/clinical-search");
  const query = "What monitoring frequency and risks apply to lithium?";
  const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
  expect(plan.subquestions.map((part) => part.requestedFacets)).toEqual([
    ["monitoring", "risk"],
    ["monitoring"],
    ["risk"],
  ]);
  const monitoring = `Monitor lithium levels and ${object} every three months.`;
  const risk = "Lithium carries a risk of tremor.";
  const result = await p12bR2DeliveredCase(plan, [monitoring, risk]);
  expect(result.answer.supportedClaims).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ text: monitoring, supportStatus: "direct", supportingChunkIds: ["chunk-1"] }),
      expect.objectContaining({ text: risk, supportStatus: "direct", supportingChunkIds: ["chunk-1"] }),
    ]),
  );
  expect(result.coverage.coverage.map((entry) => entry.status)).toEqual(
    complete ? ["direct", "direct", "direct"] : ["absent", "absent", "direct"],
  );
  expect(result.gapAdded).toBe(!complete);
  const gap = result.answer.answerSections?.find((section) => section.kind === "source_gap");
  if (complete) expect(gap).toBeUndefined();
  else expect(gap?.body).toBe("monitoring frequency: The active sources support only part of this question.");
});

it.each([false, true])("P12B R3 binds requested dosing maximum and route, delivered=%s", async (delivered) => {
  const { buildRagQueryPlan } = await import("../src/lib/rag/rag-query-plan");
  const { analyzeClinicalQuery } = await import("../src/lib/clinical-search");
  const query = "What are the maximum dose and route, monitoring frequency and risks of lithium?";
  const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
  expect(plan.subquestions[0]?.requestedFacets).toContain("dosing");
  const dose = delivered ? "The maximum oral lithium dose is 900 mg daily." : "Start lithium at 300 mg daily.";
  const monitoring = "Monitor lithium levels every three months.";
  const risk = "Lithium carries a risk of tremor.";
  const result = await p12bR2DeliveredCase(plan, [dose, monitoring, risk], {
    content: [dose, monitoring, risk, "The maximum oral lithium dose is 900 mg daily."].join(" "),
  });
  expect(result.coverage.coverage.at(-1)?.status).toBe("direct");
  expect(result.coverage.coverage[0]?.status).toBe(delivered ? "direct" : "absent");
  const gap = result.answer.answerSections?.find((section) => section.kind === "source_gap");
  if (delivered) expect(gap).toBeUndefined();
  else {
    expect(gap?.body).toContain("dosing maximum");
    expect(gap?.body).toContain("dosing route");
    expect(gap?.body).not.toMatch(/monitoring|risk|not covered by the active sources/);
  }
});

it("P12B R3 does not borrow daily dosing to answer monitoring frequency in a grouped tail", async () => {
  const { buildRagQueryPlan } = await import("../src/lib/rag/rag-query-plan");
  const { analyzeClinicalQuery } = await import("../src/lib/clinical-search");
  const query = "Describe lithium assessment, dose, monitoring frequency and risks.";
  const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
  expect(plan.subquestions.at(-1)?.requestedFacets).toEqual(["monitoring", "risk"]);
  const facts = [
    "Assess lithium treatment response.",
    "Start lithium at 300 mg daily.",
    "Monitor lithium levels.",
    "Lithium carries a risk of tremor.",
  ];
  const result = await p12bR2DeliveredCase(plan, facts, {
    content: [...facts, "Monitor lithium levels every three months."].join(" "),
  });
  expect(
    result.coverage.coverage.find(
      (entry) =>
        entry.subquestionId ===
        plan.subquestions.find((part) => part.requestedFacets?.length === 1 && part.requestedFacets.includes("dosing"))
          ?.id,
    )?.status,
  ).toBe("direct");
  expect(result.coverage.coverage.at(-1)?.status).toBe("absent");
  const gap = result.answer.answerSections?.find((section) => section.kind === "source_gap");
  expect(gap?.body).toMatch(/^monitoring frequency:/);
  expect(gap?.body).not.toMatch(/dosing|risk|not covered by the active sources/);
});

it.each([false, true])("P12B R3 emits no empty aggregate gap at full nonmergeable capacity=%s", async (full) => {
  const { buildRagQueryPlan } = await import("../src/lib/rag/rag-query-plan");
  const { analyzeClinicalQuery } = await import("../src/lib/clinical-search");
  const { answerWithinLimits, adaptiveAnswerLimits } = await import("../src/lib/rag/rag-answer-contract-limits");
  const query = "Agitation monitoring and risk in detail.";
  const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
  const facts = ["Monitor agitation symptoms every three months.", "Agitation carries a risk of injury."];
  if (full)
    facts.push(
      "Record the person's preferred language before discussing agitation care.",
      "Document the agreed care contact after discussing agitation care.",
      "Record communication preferences before discussing agitation care.",
      "Document the consent decision after discussing agitation care.",
      "Record the person's preferred name before discussing agitation care.",
      "Document the family contact after discussing agitation care.",
    );
  const result = await p12bR2DeliveredCase(
    plan,
    facts,
    {},
    {
      alternateKinds: true,
      customizeCoverage: (coverage) => {
        coverage.coverage[0]!.status = "absent";
        coverage.coverage[0]!.chunkIds = [];
        coverage.coverage[0]!.reasonCodes = ["retrieval_miss"];
        coverage.overall = "partial";
        coverage.insufficiencyReason = "retrieval_miss";
      },
    },
  );
  expect(result.coverage.coverage[0]?.status).toBe("absent");
  expect(result.coverage.overall).toBe("partial");
  expect(answerWithinLimits(result.answer, adaptiveAnswerLimits, 8)).toBe(true);
  expect(result.gapAdded).toBe(false);
  expect(result.answer.answerSections).toHaveLength(full ? 8 : 2);
  expect(
    result.answer.answerSections?.map((section) => ({
      heading: section.heading,
      kind: section.kind,
      supportLevel: section.supportLevel,
      citation_chunk_ids: section.citation_chunk_ids,
    })),
  ).toEqual(
    facts.map((_, index) => ({
      heading: `Fact ${index + 1}`,
      kind: index % 2 ? "monitoring_timing" : "required_actions",
      supportLevel: "direct",
      citation_chunk_ids: ["chunk-1"],
    })),
  );
  for (let index = 1; index < (result.answer.answerSections?.length ?? 0); index++) {
    expect(result.answer.answerSections![index]!.kind).not.toBe(result.answer.answerSections![index - 1]!.kind);
  }
});

it.each([
  ["How often should lithium monitoring occur and what are its risks?", ["monitoring"]],
  ["What lithium dosing frequency and monitoring are required?", ["dosing"]],
  ["What lithium monitoring and dosing frequency are required?", ["dosing"]],
  ["What lithium dose with monitoring frequency and risks are required?", ["monitoring"]],
  ["How often should lithium dosing and monitoring occur?", ["dosing", "monitoring"]],
])("P12B R3 binds frequency to its actual clause: %s", async (query, frequencyOwners) => {
  const { buildRagQueryPlan } = await import("../src/lib/rag/rag-query-plan");
  const { analyzeClinicalQuery } = await import("../src/lib/clinical-search");
  const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
  const details = plan.subquestions[0]?.requestedFacetDetails;
  expect(
    ["dosing", "monitoring"].filter((facet) => details?.[facet as "dosing" | "monitoring"]?.includes("frequency")),
  ).toEqual(frequencyOwners);
  const facts = [
    "Start lithium at 300 mg daily.",
    "Monitor lithium levels annually.",
    "Lithium carries a risk of tremor.",
  ];
  const positive = await p12bR2DeliveredCase(plan, facts);
  expect(positive.answer.answerSections?.find((section) => section.kind === "source_gap")).toBeUndefined();
  if (frequencyOwners.length === 1) {
    const removed =
      frequencyOwners[0] === "monitoring"
        ? [facts[0]!, "Monitor lithium levels.", facts[2]!]
        : ["Start lithium at 300 mg.", facts[1]!, facts[2]!];
    const negative = await p12bR2DeliveredCase(plan, removed, { content: [...facts, ...removed].join(" ") });
    expect(negative.answer.answerSections?.find((section) => section.kind === "source_gap")?.body).toMatch(
      new RegExp(`^${frequencyOwners[0]} frequency:`),
    );
  }
});

it.each([
  ["Start oral lithium at 300 mg daily.", "maximum"],
  ["The maximum lithium dose is 900 mg daily.", "route"],
])("P12B R3 identifies only the missing dose detail in %s", async (dose, missing) => {
  const { buildRagQueryPlan } = await import("../src/lib/rag/rag-query-plan");
  const { analyzeClinicalQuery } = await import("../src/lib/clinical-search");
  const query = "What are the maximum dose and route, monitoring and risks of lithium?";
  const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
  const facts = [dose, "Monitor lithium levels annually.", "Lithium carries a risk of tremor."];
  const result = await p12bR2DeliveredCase(plan, facts, {
    content: [...facts, "The maximum oral lithium dose is 900 mg daily."].join(" "),
  });
  const gap = result.answer.answerSections?.find((section) => section.kind === "source_gap")?.body;
  expect(gap).toMatch(new RegExp(`^dosing ${missing}:`));
  expect(gap).not.toContain(missing === "maximum" ? "dosing route" : "dosing maximum");
});

it("P12B R3 honors original request details and explicit latest-context omission", async () => {
  const { buildRagQueryPlan } = await import("../src/lib/rag/rag-query-plan");
  const { analyzeClinicalQuery } = await import("../src/lib/clinical-search");
  const { renderAnswerRequestContext, resolveAnswerRequestContext } = await import("../src/lib/answer-request-context");
  const original = "What lithium monitoring frequency and risks apply?";
  const context = renderAnswerRequestContext(
    resolveAnswerRequestContext(original, "For this, omit frequency and describe monitoring and risks."),
  );
  const augmented = "Maximum oral dose and monitoring frequency mode: " + context;
  const plan = buildRagQueryPlan(augmented, analyzeClinicalQuery(augmented), context);
  expect(plan.originalQuery).toBe(augmented);
  expect(plan.subquestions[0]?.requestedFacets).toEqual(["monitoring", "risk"]);
  expect(plan.subquestions[0]?.requestedFacetDetails).toBeUndefined();
});

describe("dead stem regex fixes (#HD1C6W)", () => {
  it.each([
    "Escalate to the consultant when the value is below 2.0.",
    "Care was escalated to the consultant when the value fell below 2.0.",
    "Escalation to the consultant is required when the value is below 2.0.",
  ])("treats %s as an actionable numeric answer and fails closed on unverified figures", (answerText) => {
    const cited = source({ id: "chunk-esc", content: "Notify the team when the value is below 3.0." });
    const input: RagAnswer = {
      answer: answerText,
      grounded: true,
      confidence: "high",
      citations: [citationFromResult(cited, "model_selected")],
      sources: [cited],
    };

    const verified = applyNumericVerification(input);
    expect(verified.grounded).toBe(false);
    expect(verified.confidence).toBe("unsupported");
    expect(verified.responseMode).toBe("evidence_gap");
  });

  it("maps 'no more than' and 'at most' to the same at_most comparator across numeric verification, claim support, and alcohol summary delivery", async () => {
    const { sourceDirectlySupportsAnswerText } = await import("../src/lib/rag/rag-claim-support");
    const { renderSourceBoundAlcoholSummary } = await import("../src/lib/rag/rag-source-bound-alcohol-summary");
    const { hasCompleteOpeningSentence } = await import("../src/lib/rag/rag-answer-shape-checks");

    const singleSentenceAdultSource = source({
      id: "nhmrc-adult-single",
      content:
        "To reduce the risk of harm from alcohol-related disease or injury, healthy men and women aged 18 years and over should drink no more than 10 standard drinks a week and no more than 4 standard drinks on any one day.",
    });
    const candidateClause =
      "For healthy adults aged 18 years and over, the NHMRC advises limiting alcohol intake to at most 10 standard drinks per week and at most 4 standard drinks on any single day.";
    expect(sourceDirectlySupportsAnswerText(candidateClause, singleSentenceAdultSource)).toBe(true);
    const verified = verifyAnswerNumbers(
      candidateClause,
      [{ chunk_id: "nhmrc-adult-single" }],
      [singleSentenceAdultSource],
    );
    expect(verified.hasUnverifiedNumbers).toBe(false);
    expect(verified.unverifiedTokens).toEqual([]);
    expect(
      hasCompleteOpeningSentence(
        "For healthy adults aged 18 years and over, drink at most 10 standard drinks a week and at most 4 standard drinks on any one day.",
      ),
    ).toBe(true);

    const nhmrcMeta = {
      publisher_code: "NHMRC",
      publisher: "National Health and Medical Research Council",
    } as unknown as NonNullable<SearchResult["source_metadata"]>;
    const nhmrcResults = [
      source({
        id: "nhmrc-1",
        document_id: "doc-nhmrc",
        source_metadata: nhmrcMeta,
        content:
          "Guideline 1: Adults To reduce the risk of harm from alcohol-related disease or injury, healthy men and women should drink no more than 10 standard drinks a week and no more than 4 standard drinks on any one day. The less you drink, the lower your risk of harm from alcohol. This guideline applies to healthy men and women aged 18 years and over. The guideline does not represent a 'safe' or 'no-risk' drinking level, nor does it set an absolute upper limit of intake. This guideline provides recommendations to reduce the risk of harm from alcohol, but these recommendations do not completely eliminate all risk from drinking alcohol. Not drinking at all is the best way to reduce the risk of harm from alcohol.",
      }),
      source({
        id: "nhmrc-2",
        document_id: "doc-nhmrc",
        source_metadata: nhmrcMeta,
        content:
          "Guideline 2: Children and people under 18 years of age To reduce the risk of injury and other harms to health, children and people under 18 years of age should not drink alcohol. There is no clear 'safe' level of alcohol consumption for children and people under 18 years of age.",
      }),
      source({
        id: "nhmrc-3",
        document_id: "doc-nhmrc",
        source_metadata: nhmrcMeta,
        content:
          "Guideline 3: Women who are pregnant or breastfeeding A. To prevent harm from alcohol to their unborn child, women who are pregnant or planning a pregnancy should not drink alcohol. B. For women who are breastfeeding, not drinking alcohol is safest for their baby. The evidence does not indicate a safe amount of alcohol that pregnant women and breastfeeding mothers can drink.",
      }),
    ];
    const summaryText =
      "For healthy adults aged 18 years and over, drink at most 10 standard drinks a week and at most 4 standard drinks on any one day; less drinking further lowers risk. People under 18 years should not drink alcohol. Women who are pregnant or planning pregnancy should not drink alcohol, and for women who are breastfeeding, not drinking alcohol is safest for the baby. These recommendations do not imply a safe or no-risk level of alcohol use.";
    const rendered = renderSourceBoundAlcoholSummary(
      {
        answer: summaryText,
        grounded: true,
        confidence: "high",
        citations: nhmrcResults.map((r) => citationFromResult(r, "model_selected")),
        sources: nhmrcResults,
        answerSections: [
          {
            heading: "Important qualification",
            kind: "contraindications_cautions",
            supportLevel: "direct",
            body: "For healthy adults, the recommended limits reduce risk but do not eliminate it; not drinking is the best way to reduce alcohol-related harm. No safe level has been identified during pregnancy, and the evidence does not indicate a safe amount for pregnant or breastfeeding mothers.",
            citation_chunk_ids: ["nhmrc-1", "nhmrc-3"],
          },
        ],
      },
      nhmrcResults,
      "Summarise the NHMRC alcohol guidelines.",
      "broad_summary",
    );
    expect(rendered).not.toBeNull();
    expect(rendered?.answer.grounded).toBe(true);
  });
});

describe("upper-limit comparator with clinical units", () => {
  it.each(["5 mg", "1.5 × 10^9/L"])("keeps no more than and its unit together: %s", (quantity) => {
    for (const [answerComparator, sourceComparator] of [
      ["no more than", "at most"],
      ["at most", "no more than"],
    ]) {
      const evidence = source({ content: `Use ${sourceComparator} ${quantity}.` });
      const verified = verifyAnswerNumbers(
        `Use ${answerComparator} ${quantity}.`,
        [{ chunk_id: evidence.id }],
        [evidence],
      );
      expect(verified.unverifiedTokens).toEqual([]);
      expect(
        verifyAnswerNumbers(`Use at least ${quantity}.`, [{ chunk_id: evidence.id }], [evidence]).hasUnverifiedNumbers,
      ).toBe(true);
    }
  });
});

describe("thousands separators are not decimal commas (#177)", () => {
  const verify = (sourceText: string, answerText: string) => {
    const evidence = source({ content: sourceText });
    return verifyAnswerNumbers(answerText, [{ chunk_id: evidence.id }], [evidence]);
  };

  it.each([
    ["Give 1,000 mg daily.", "Give 1 mg daily."],
    ["Give 5,000 units.", "Give 5 units."],
    ["Give 1,500 mg daily.", "Give 1.5 mg daily."],
    ["Give 5,000,000 units.", "Give 1,000,000 units."],
  ])("flags a dose that drops the thousands: source %s, answer %s", (sourceText, answerText) => {
    expect(verify(sourceText, answerText).hasUnverifiedNumbers).toBe(true);
  });

  it.each([
    ["Give 1,000 mg daily.", "Give 1,000 mg daily."],
    ["Give 1,000 mg daily.", "Give 1000 mg daily."],
    ["Give 1,000,000 units.", "Give 1,000,000 units."],
    ["Give 0,5 mg daily.", "Give 0.5 mg daily."],
  ])("verifies the same figure however it is grouped: source %s, answer %s", (sourceText, answerText) => {
    expect(verify(sourceText, answerText).unverifiedTokens).toEqual([]);
  });
});

describe("unverified symbol-comparator thresholds lose their bold (#179)", () => {
  it("un-bolds **ANC < 1.5** when <1.5 could not be verified", () => {
    expect(unboldUnverifiedNumbers("Withhold if **ANC < 1.5**.", new Set(["<1.5"]))).toBe("Withhold if ANC < 1.5.");
  });

  it("keeps the bold on a verified threshold", () => {
    expect(unboldUnverifiedNumbers("Withhold if **ANC < 1.5**.", new Set(["<2.0"]))).toBe("Withhold if **ANC < 1.5**.");
  });
});
