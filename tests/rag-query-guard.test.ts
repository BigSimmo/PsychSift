import { describe, expect, it } from "vitest";

import { analyzeClinicalQuery } from "@/lib/clinical-search";
import {
  clearlyOutsideCorpusMedicalPattern,
  isUnsupportedSoftTailAnalysis,
  shouldShortCircuitUnsupportedSearch,
} from "@/lib/rag/rag-query-guard";

/**
 * #000GN4 and #3944SV are two different false-positive routes into a refusal, and only the
 * second one was still open when this file was written.
 *
 * #000GN4 — bare clinical TOKENS in the out-of-corpus pattern — was closed on main by PR #2546,
 * which replaced `ssri`, `antibiotic`, `pneumonia`, `dka` and `ketamine sedation` with
 * disease-specific phrases. The first block below pins that, and `tests/corpus-grounding.test.ts`
 * pins it from both directions against the golden fixture.
 *
 * #3944SV — the CONSUMER heuristic ("phone", "car", "insurance") firing on a clinical question
 * that happens to contain one of those words — is what this file's later blocks fix.
 *
 * The phrases that remain are NOT a residue of #000GN4 and must not be removed to widen recall.
 * `src/lib/rag/rag-eval-cases.ts` declares four controls `expectedQueryClass:
 * "unsupported_or_general"` and `scripts/eval-utils.ts` pins them at `unsupported_correct_rate`
 * 1.0; removing the guard was MEASURED at 0.79 on 2026-07-03 (`docs/process-hardening.md`).
 * Two of those controls are carried by the phrases asserted here, so a test that asks for them
 * to reach retrieval is asking the corpus to guess at insulin dosing it does not contain.
 */
describe("rag-query-guard — in-corpus clinical and psychiatric queries", () => {
  it("does not classify SSRI queries as clearly outside corpus", () => {
    expect(clearlyOutsideCorpusMedicalPattern.test("Which SSRI is first line for generalised anxiety disorder?")).toBe(
      false,
    );
    expect(clearlyOutsideCorpusMedicalPattern.test("ssri discontinuation syndrome")).toBe(false);
  });

  it("retains genuine outside-corpus acute medical conditions", () => {
    expect(clearlyOutsideCorpusMedicalPattern.test("diabetic ketoacidosis management protocol")).toBe(true);
    expect(clearlyOutsideCorpusMedicalPattern.test("community-acquired pneumonia treatment")).toBe(true);
    // Bare tokens dka and antibiotic are deliberately dropped in favor of specific phrases
    expect(clearlyOutsideCorpusMedicalPattern.test("dka fluids")).toBe(false);
    expect(clearlyOutsideCorpusMedicalPattern.test("antibiotic stewardship")).toBe(false);
  });

  /**
   * The two phrases that carry eval controls 3 and 4. They are disease-specific, which is the
   * bar the pattern's own contract sets, so they stay — and this block exists so a future
   * widening pass cannot quietly take them the way one already tried to.
   */
  it("keeps the two phrases that carry the SSRI-dose and hyperkalaemia eval controls", () => {
    expect(clearlyOutsideCorpusMedicalPattern.test("What SSRI dose is recommended for adolescent depression?")).toBe(
      true,
    );
    expect(clearlyOutsideCorpusMedicalPattern.test("What insulin dose should be used for hyperkalaemia?")).toBe(true);
    // Both spellings, because the controls and the corpus do not agree on one.
    expect(clearlyOutsideCorpusMedicalPattern.test("hyperkalemia insulin dose")).toBe(true);
  });

  /**
   * The #3944SV fix, stated as the narrow thing it is: a consumer token no longer refuses a
   * question that also carries clinical signal. Every query here is one the corpus can actually
   * be asked, which is what separates this from widening the out-of-corpus phrase list.
   */
  it("does not short-circuit clinical queries that mention consumer tokens like phone", () => {
    const query = "phone triage for a patient on lithium";
    const analysis = analyzeClinicalQuery(query);
    expect(shouldShortCircuitUnsupportedSearch(query, analysis)).toBe(false);
  });

  it("does not short-circuit SSRI queries", () => {
    const query = "Which SSRI is first line for generalised anxiety disorder?";
    const analysis = analyzeClinicalQuery(query);
    expect(shouldShortCircuitUnsupportedSearch(query, analysis)).toBe(false);
  });

  it("still short-circuits purely non-clinical consumer queries", () => {
    const query = "best espresso coffee machine";
    const analysis = analyzeClinicalQuery(query);
    expect(shouldShortCircuitUnsupportedSearch(query, analysis)).toBe(true);
    expect(isUnsupportedSoftTailAnalysis(query, analysis)).toBe(false);
  });

  /**
   * #3944SV, second pass: psychiatric questions that carry a consumer word only by accident.
   * None may be refused by the consumer heuristic. Each either searches outright or meets the
   * soft tail, where `classifyCorpusGrounding` lets the corpus decide in production.
   */
  it.each([
    "flight of ideas",
    "flight of ideas in mania",
    "gaming disorder",
    "internet gaming disorder treatment",
    "car accident trauma assessment",
    "PTSD after a car accident",
    "phone contact after discharge",
    "tv watching and negative symptoms",
    "holiday leave from the ward",
    "psychosis after a long haul flight",
    "self-harm after a car accident",
  ])("lets the corpus decide on %j instead of refusing it on a consumer word", (query) => {
    const analysis = analyzeClinicalQuery(query);
    const refusedByConsumerWord =
      shouldShortCircuitUnsupportedSearch(query, analysis) && !isUnsupportedSoftTailAnalysis(query, analysis);
    expect(refusedByConsumerWord).toBe(false);
  });

  it.each([
    "What is the best coffee machine for my kitchen?",
    "Which air fryer should I buy for a small kitchen?",
    "Give me a recipe for high protein overnight oats.",
    "best gaming laptop",
    "car insurance quote",
    "car finance deals",
    "phone sale discount",
    "popular tv show",
    "flight booking online",
    "hotel near perth airport",
    "best tv to buy",
  ])("still refuses the purely consumer question %j", (query) => {
    const analysis = analyzeClinicalQuery(query);
    expect(shouldShortCircuitUnsupportedSearch(query, analysis)).toBe(true);
  });

  /**
   * The consumer escape hatch must not become a way past the out-of-corpus phrases. A query
   * carrying both a consumer token and an out-of-corpus phrase still refuses, because the
   * phrase branch runs first and does not consult the clinical-context pattern.
   */
  it("does not let a consumer token escape an out-of-corpus phrase", () => {
    const query = "phone advice for adolescent depression";
    const analysis = analyzeClinicalQuery(query);
    expect(shouldShortCircuitUnsupportedSearch(query, analysis)).toBe(true);
  });
});
