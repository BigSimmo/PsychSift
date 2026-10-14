import { describe, expect, it } from "vitest";

import {
  buildExtractiveAnswer,
  completeExtractiveSentence,
  finalizeRagAnswerQuality,
  generatedAnswerQualityFailureReason,
  isLaunderedGuidanceWrapperAnswer,
} from "../src/lib/rag/rag-extractive-answer";
import type { Citation, RagAnswer, RagQueryClass, SearchResult } from "../src/lib/types";

// The two answers the Gate E capture of 2026-08-21 shipped grounded, with five citations, no
// fallback_reason and degraded_mode.active false — byte-identical across dump-v18 and dump-v19.
// Quoted verbatim from docs/rag-improvement/231-diagnosis-2026-08-22.md §3.1, which is the only
// record of them that leaves the owner's workstation (the dumps themselves are gitignored).
//
// FALSIFICATION, run against unmodified source before the predicate below existed
// (`npx vitest run tests/rag-guidance-wrapper-quality-gate.test.ts`, 2 passed):
// generatedAnswerQualityFailureReason returned null for BOTH, at their real eval query classes.
// The gap was predicate strictness, not gate reachability — see the reachability block at the
// foot of this file. The durable form of that finding is the laundering pair below: the bare
// fragment is rejected, and the same fragment inside the wrapper used to be accepted.
const METABOLIC_QUERY = "What metabolic monitoring is required for antipsychotics?";
const METABOLIC_FRAGMENT = "compliance, monitoring and evaluation";
const METABOLIC_ANSWER = `The guidance for metabolic is that ${METABOLIC_FRAGMENT}.`;
const DISCHARGE_QUERY = "What discharge documentation is required?";
const DISCHARGE_FRAGMENT =
  "aim > To effectively identify admission and discharge processes to facilitate ease of access to > 2";
const DISCHARGE_ANSWER = `The guidance is that ${DISCHARGE_FRAGMENT}.`;

// The eval cases these two answers came from, so the gate is exercised at the class the pipeline
// actually assigns: src/lib/rag/rag-eval-cases.ts quality-antipsychotic-metabolic-monitoring
// and quality-discharge-documentation.
const METABOLIC_CLASS = "medication_dose_risk" satisfies RagQueryClass;
const DISCHARGE_CLASS = "document_lookup" satisfies RagQueryClass;

function citation(index: number): Citation {
  return {
    chunk_id: `chunk-${index}`,
    document_id: `doc-${index}`,
    title: `Clinical Source ${index}`,
    file_name: `Clinical Source ${index}.pdf`,
    page_number: index,
    chunk_index: index,
  };
}

/** The captured shape: grounded first-choice extractive, five citations, no gate reason. */
function capturedGroundedExtractiveAnswer(text: string, overrides: Partial<RagAnswer> = {}): RagAnswer {
  return {
    answer: text,
    grounded: true,
    confidence: "medium",
    citations: [1, 2, 3, 4, 5].map(citation),
    sources: [],
    routingMode: "extractive",
    routingReason: "high_confidence_extractive_retrieval",
    ...overrides,
  };
}

describe("#NPQJKP — the laundered guidance wrapper", () => {
  it("is what the completer emits for a fragment it cannot complete", () => {
    // The mechanism, pinned at source: an uncompletable fragment comes back wrapped, and the
    // wrapper is what makes the result look like a sentence.
    expect(completeExtractiveSentence(METABOLIC_FRAGMENT, METABOLIC_QUERY)).toBe(
      `The guidance is that ${METABOLIC_FRAGMENT}.`,
    );
  });

  it("rejects the bare fragment but USED TO accept the same fragment once wrapped", () => {
    // Both halves of the laundering, side by side. Before the guidance_wrapper_fragment
    // predicate the second expectation was `toBeNull()` — that is the defect.
    expect(
      generatedAnswerQualityFailureReason(
        capturedGroundedExtractiveAnswer(`${METABOLIC_FRAGMENT}.`),
        METABOLIC_QUERY,
        METABOLIC_CLASS,
      ),
    ).toBe("incomplete_opening_sentence");
    expect(
      generatedAnswerQualityFailureReason(
        capturedGroundedExtractiveAnswer(METABOLIC_ANSWER),
        METABOLIC_QUERY,
        METABOLIC_CLASS,
      ),
    ).toBe("guidance_wrapper_fragment");
  });

  it("rejects the captured discharge-documentation answer at document_lookup", () => {
    expect(
      generatedAnswerQualityFailureReason(
        capturedGroundedExtractiveAnswer(`${DISCHARGE_FRAGMENT}.`),
        DISCHARGE_QUERY,
        DISCHARGE_CLASS,
      ),
    ).toBe("incomplete_opening_sentence");
    expect(
      generatedAnswerQualityFailureReason(
        capturedGroundedExtractiveAnswer(DISCHARGE_ANSWER),
        DISCHARGE_QUERY,
        DISCHARGE_CLASS,
      ),
    ).toBe("guidance_wrapper_fragment");
  });

  it("sees through markdown bolding on the wrapper", () => {
    expect(isLaunderedGuidanceWrapperAnswer(`**${METABOLIC_ANSWER}**`)).toBe(true);
  });
});

describe("#NPQJKP — every legitimate completer output survives", () => {
  // One case per branch of completeExtractiveSentence, so a future edit to the completer that
  // changes which wrapper it emits fails here rather than silently degrading good answers.
  it("keeps the conditional wrap when its continuation is a clause", () => {
    const wrapped = completeExtractiveSentence("when clozapine is withheld the FBC must be repeated", METABOLIC_QUERY);
    expect(wrapped).toBe("The guidance is that when clozapine is withheld the FBC must be repeated.");
    expect(isLaunderedGuidanceWrapperAnswer(wrapped)).toBe(false);
  });

  it("keeps a conditional that carries its own action, which never gets a wrapper", () => {
    expect(completeExtractiveSentence("when INR is high, monitor closely", METABOLIC_QUERY)).toBe(
      "When INR is high, monitor closely.",
    );
  });

  it("keeps a wrapped clause built on a verb the clinical list does not carry", () => {
    // The false positive this predicate must not have. "places" is a perfectly good finite verb
    // and is deliberately absent from openingSentenceActionPattern, which lists clinical
    // directives. Pinned by tests/rag-extractive-procedural-artifact.test.ts as a grounded answer.
    expect(
      isLaunderedGuidanceWrapperAnswer(
        "The guidance is that following receipt of referral, the ECT Coordinator places the patient onto the Booking Assistant Scheduling Engine (BASE).",
      ),
    ).toBe(false);
  });

  it("keeps numeric comparators, which are not layout debris", () => {
    expect(isLaunderedGuidanceWrapperAnswer("The guidance is that ANC > 2.0 and WBC > 3.5 before rechallenge.")).toBe(
      false,
    );
    expect(isLaunderedGuidanceWrapperAnswer("The guidance is that eGFR > 30 mL/min permits standard dosing.")).toBe(
      false,
    );
  });

  it("keeps the infinitive and includes forms, which are not 'is that' wrappers at all", () => {
    expect(isLaunderedGuidanceWrapperAnswer("The guidance is to withhold clozapine and repeat the FBC.")).toBe(false);
    expect(isLaunderedGuidanceWrapperAnswer("The guidance includes baseline weight, lipids and glucose.")).toBe(false);
  });

  it("keeps ordinary clauses, with and without the entity prefix", () => {
    expect(isLaunderedGuidanceWrapperAnswer("The guidance is that lithium levels should be checked weekly.")).toBe(
      false,
    );
    expect(
      isLaunderedGuidanceWrapperAnswer("The guidance for clozapine is that FBC monitoring is required weekly."),
    ).toBe(false);
  });

  it("keeps an answer whose lead is a real sentence, wrapper or not", () => {
    expect(
      isLaunderedGuidanceWrapperAnswer(
        "Discharge documentation should include a mental state examination, risk assessment and follow-up plan.",
      ),
    ).toBe(false);
    expect(
      isLaunderedGuidanceWrapperAnswer("Withhold clozapine and repeat the full blood count within 24 hours."),
    ).toBe(false);
  });

  it("leaves the four continuations the older enumeration already rejects to that enumeration", () => {
    // clippedClinicalFragmentPattern (rag-answer-text.ts) lists these one by one and is untouched.
    // What matters is that they are still rejected — by whichever gate — so no coverage was lost.
    for (const continuation of ["adjust", "monitoring", "higher doses than", "lower doses than"]) {
      const answer = `The guidance is that ${continuation}.`;
      expect(
        generatedAnswerQualityFailureReason(capturedGroundedExtractiveAnswer(answer), METABOLIC_QUERY, METABOLIC_CLASS),
      ).not.toBeNull();
    }
  });
});

describe("#NPQJKP — reachability of the enforcing gate on the grounded extractive path", () => {
  // docs/rag-improvement/231-diagnosis-2026-08-22.md §3.2 records that the call inside the
  // first-choice extractive branch (rag.ts, guarded on !grounded) is bypassed for these answers.
  // That is true of THAT call site, which only labels an already-decided review fallback. The
  // ENFORCING call is the unconditional one inside finalizeRagAnswerQualityCore, which the
  // grounded path reaches through finalizeAnswer -> finalizeRagAnswerQuality. These two tests
  // pin that, so no reachability change is needed and the only remaining bypass is named.
  it("runs on a grounded extractive answer and degrades it to a source gap", () => {
    const finalized = finalizeRagAnswerQuality(
      capturedGroundedExtractiveAnswer(METABOLIC_ANSWER),
      METABOLIC_QUERY,
      METABOLIC_CLASS,
    );

    expect(finalized.grounded).toBe(false);
    expect(finalized.routingReason).toContain("final_quality_gate:guidance_wrapper_fragment");
    // Not rescued: shouldPreserveSourceBackedGeneratedAnswer admits only missing_query_intent
    // and missing_query_overlap, so a new reason cannot be preserved back to grounded.
    expect(finalized.routingReason).not.toContain("source_backed_recovery");
    expect(finalized.answer).not.toContain("compliance, monitoring and evaluation");
  });

  it("preserves the rejected candidate text in rejectedCandidateText, distinct from the delivered fallback", () => {
    // scripts/eval-quality.ts records this field so a failed canary shows what the gate actually
    // read (see its "answerText" field), rather than only the generic evidence-gap wrapper the
    // user was shown. Debug-only: it must not change what is returned to the user.
    const finalized = finalizeRagAnswerQuality(
      capturedGroundedExtractiveAnswer(METABOLIC_ANSWER),
      METABOLIC_QUERY,
      METABOLIC_CLASS,
    );

    expect(finalized.rejectedCandidateText).toBe(METABOLIC_ANSWER);
    expect(finalized.answer).not.toBe(METABOLIC_ANSWER);
    expect(finalized.answer).not.toContain("compliance, monitoring and evaluation");
  });

  it("is bypassed only by the preformatted-and-grounded early return", () => {
    // The one remaining way past the quality gate on this path. Whether the two captured answers
    // were preformatted cannot be read from here — the dumps are gitignored on the owner's
    // machine — so the bypass is named rather than assumed closed. A preformatted answer is still
    // caught downstream by claim support here, but NOT by the quality gate, which is the point.
    const finalized = finalizeRagAnswerQuality(
      capturedGroundedExtractiveAnswer(METABOLIC_ANSWER, { preformatted: true }),
      METABOLIC_QUERY,
      METABOLIC_CLASS,
    );

    expect(finalized.routingReason).not.toContain("guidance_wrapper_fragment");
  });
});

// Canary run 38383361787: the fast answer to "What should discharge documentation include?" failed
// its quality check, there was no budget left for the strong retry, and the generation fallback led
// with the heading trail above. Source-prose recovery found no complete sentence to swap in, so the
// wrapper stayed, the gate (rightly) rejected it and the reader got a review stub. With no prose to
// recover, the fallback must lead with the next fact that is not a wrapper.
describe("generation fallback drops a wrapper lead when prose recovery finds nothing", () => {
  function discharge(id: string, fileName: string, content: string): SearchResult {
    return {
      id,
      document_id: fileName,
      title: fileName.replace(/\.pdf$/, ""),
      file_name: fileName,
      page_number: 1,
      chunk_index: 0,
      section_heading: "Discharge documentation",
      content,
      image_ids: [],
      similarity: 0.9,
      hybrid_score: 0.9,
      text_rank: 0.11,
      source_metadata: {
        source_title: fileName,
        publisher: "Local service",
        jurisdiction: "Australia/WA",
        version: "1",
        publication_date: null,
        review_date: null,
        uploaded_at: null,
        indexed_at: null,
        uploaded_by: null,
        document_status: "current",
        clinical_validation_status: "approved",
        extraction_quality: "good",
      },
      images: [],
    };
  }

  it("answers from the real fact instead of wrapping the trail", () => {
    const query = "What should discharge documentation include?";
    // No closing full stop, so source-prose recovery (complete sentences only) cannot use it.
    const sentence =
      "Discharge documentation must include the discharge summary, medication list and follow-up appointments with the community team";
    const results = [
      discharge("trail", "Admission to Discharge (NMHS).pdf", `Discharge documentation ${DISCHARGE_FRAGMENT}`),
      discharge(
        "list",
        "Admission to Discharge (NMHS).pdf",
        "Discharge documentation: compliance, monitoring and evaluation",
      ),
      discharge("prose", "MHSP.Discharge.pdf", sentence),
    ];
    const finalized = finalizeRagAnswerQuality(
      buildExtractiveAnswer({
        query,
        queryClass: DISCHARGE_CLASS,
        results,
        quoteCards: [],
        documentBreakdown: [],
        evidenceSummary: undefined,
        sourceCoverage: undefined,
        conflictsOrGaps: [],
        visualEvidence: [],
        bestSource: null,
        smartPanel: undefined,
        relatedDocuments: [],
        routeReason: "strong_routine_retrieval",
        timings: undefined,
        allowSourceProseRecovery: true,
      }),
      query,
      DISCHARGE_CLASS,
    );

    expect(finalized.grounded).toBe(true);
    expect(finalized.answer).toBe(`${sentence}.`);
    expect(finalized.routingReason ?? "").not.toContain("final_quality_gate");
  });
});
