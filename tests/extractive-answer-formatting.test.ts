import { describe, expect, it } from "vitest";
import lithiumLiveExcerpts from "./fixtures/lithium-monitoring-live-excerpts.json";
import { citationFromResult } from "../src/lib/citations";
import {
  adjacentLabelledNumericBandConflicts,
  textReferencesAdjacentBandConflict,
} from "../src/lib/answer-verification";
import {
  buildExtractiveAnswer,
  classifyAnswerIntent,
  documentSupportListIntent,
  finalizeRagAnswerQuality,
  generatedAnswerQualityFailureReason,
  hasMaximumDoseEvidence,
  isBareDocumentSupportListAnswer,
  isExplicitEscalationQuery,
  isProviderSourceGapGeneratedAnswer,
  isSafeExtractiveFallbackCandidate,
  labelledNumericBandConflictChunkIds,
  retainCitedExtractiveFallbackEvidence,
  sentenceFromFact,
  splitClinicalEvidenceSentences,
} from "../src/lib/rag/rag-extractive-answer";
import { classifyRagQuery } from "../src/lib/clinical-search";
import { buildSelectedEvidenceArtifacts, retainRelatedDocumentsForResults } from "../src/lib/retrieval-selection";
import { buildSmartRagApiPlan } from "../src/lib/smart-rag-api";
import type { RagAnswer, RagQueryClass, SearchResult } from "../src/lib/types";

function extractiveAnswerFor(query: string, results: SearchResult[], queryClass?: RagQueryClass) {
  return buildExtractiveAnswer({
    query,
    queryClass: queryClass ?? classifyRagQuery(query).queryClass,
    results,
    quoteCards: [],
    documentBreakdown: [] as RagAnswer["documentBreakdown"],
    evidenceSummary: undefined as unknown as RagAnswer["evidenceSummary"],
    sourceCoverage: undefined as unknown as RagAnswer["sourceCoverage"],
    conflictsOrGaps: [],
    visualEvidence: [] as unknown as RagAnswer["visualEvidence"],
    bestSource: undefined as unknown as RagAnswer["bestSource"],
    smartPanel: undefined as unknown as RagAnswer["smartPanel"],
    relatedDocuments: [] as unknown as RagAnswer["relatedDocuments"],
    routeReason: "demo",
    timings: undefined as unknown as RagAnswer["latencyTimings"],
  });
}

function figureChunk(overrides: Partial<SearchResult>): SearchResult {
  return {
    id: "figure-chunk-1",
    document_id: "figure-doc",
    title: "Quetiapine Prescribing Guideline",
    file_name: "Quetiapine Prescribing Guideline.pdf",
    page_number: 2,
    chunk_index: 1,
    section_heading: "Dosing",
    content: "",
    image_ids: [],
    similarity: 0.91,
    hybrid_score: 0.95,
    images: [],
    ...overrides,
  } as unknown as SearchResult;
}

function capturedLithiumSource(caseId: "literal" | "timing" | "detailed", sourceIndex = 0) {
  const captured = lithiumLiveExcerpts.cases.find((entry) => entry.id === caseId);
  const entry = captured?.sources[sourceIndex];
  if (!captured || !entry) throw new Error(`Missing captured lithium source: ${caseId}/${sourceIndex}`);
  return {
    query: captured.query,
    source: figureChunk({
      ...entry,
      file_name: `${entry.title}.pdf`,
      section_heading: null,
      source_metadata: entry.source_metadata as SearchResult["source_metadata"],
    }),
  };
}

describe("source-bound clozapine red-range extraction", () => {
  it.each([
    ["absent", "Withhold clozapine at this ANC threshold."],
    [
      "foreign medicine",
      "An ANC below 1.0 x 10^9/L requires withholding lithium. Withhold clozapine at this ANC threshold.",
    ],
    [
      "inapplicable population",
      "In children, an ANC below 1.0 x 10^9/L requires withholding clozapine. Withhold clozapine at this ANC threshold.",
    ],
  ])("A2 E18 retains useful action without borrowing an %s threshold", (_label, content) => {
    const evidence = figureChunk({
      title: "Clozapine guideline",
      file_name: "Clozapine.pdf",
      section_heading: null,
      content,
    });
    const result = extractiveAnswerFor("What ANC threshold requires withholding clozapine in adults?", [evidence]);
    const visible = [result.answer, ...(result.answerSections ?? []).map((section) => section.body)].join(" ");
    expect(visible).not.toMatch(/1\.0/);
    expect(result.answer).toMatch(/withhold/i);
    expect(result.citations.map((citation) => citation.chunk_id)).toContain(evidence.id);
    expect(result.conflictsOrGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "gap", message: expect.stringMatching(/requested blood-count threshold/) }),
      ]),
    );
  });
  it("A2 E18 keeps a pure action answer without requiring a threshold figure", () => {
    const result = extractiveAnswerFor("Should I withhold clozapine after a red ANC result?", [
      figureChunk({
        title: "Clozapine guideline",
        file_name: "Clozapine.pdf",
        section_heading: null,
        content: "Withhold clozapine after a red ANC result.",
      }),
    ]);
    expect(result.answer).toMatch(/withhold/i);
    expect(result.grounded).toBe(true);
    expect(result.conflictsOrGaps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/requested blood-count threshold/) }),
      ]),
    );
  });
  const query = "What FBC threshold should withhold clozapine?";
  const redRangeSource = figureChunk({
    id: "nmhs-clozapine-red-range",
    document_id: "nmhs-clozapine",
    title: "Clozapine Prescribing(NMHS)",
    file_name: "Clozapine Prescribing (NMHS).pdf",
    page_number: 7,
    section_heading: "8.2 Monitoring for agranulocytosis and neutropenia",
    content: `Clozapine Blood Results Monitoring Recommended Action
System
WBC ≥ 3.5 x 109/L AND Continue clozapine therapy
Green Range Neutrophils ≥ 2.0 x 109 /L

WBC 3.0 - <3.5 x 109/L AND/OR Continue clozapine therapy with twice-weekly blood
Amber Range Neutrophils 1.5 - < 2.0 x 109 /L tests until return to “green” range

WBC < 3.0 x 109/L AND/OR Stop clozapine therapy immediately.
Red Range Neutrophils < 1.5 x 109 /L Contact haematologist and Clozapine Monitoring
Centre`,
    source_metadata: {
      source_title: "Clozapine Prescribing(NMHS)",
      publisher: "North Metropolitan Health Service",
      jurisdiction: "Australia/WA",
      version: "1",
      publication_date: null,
      review_date: "2027-03-24",
      uploaded_at: null,
      indexed_at: null,
      uploaded_by: null,
      document_status: "current",
      clinical_validation_status: "locally_reviewed",
      extraction_quality: "good",
    },
  });

  it("keeps both blood-count thresholds bound to the immediate stop action in one cited chunk", () => {
    const distractor = figureChunk({
      id: "generic-monitoring",
      document_id: "other-document",
      title: "Clozapine Monitoring Appendix",
      content: "Routine monitoring forms should be filed after each blood test.",
    });
    const answer = finalizeRagAnswerQuality(
      extractiveAnswerFor(query, [redRangeSource, distractor], "table_threshold"),
      query,
      "table_threshold",
    );
    const plainAnswer = answer.answer.replace(/\*\*/g, "");

    expect(answer.grounded).toBe(true);
    expect(answer.confidence).not.toBe("unsupported");
    expect(plainAnswer).toContain("WBC <3.0 × 10⁹/L");
    expect(plainAnswer).toContain("neutrophils <1.5 × 10⁹/L");
    expect(plainAnswer).toMatch(/stop clozapine therapy immediately/i);
    expect(answer.citations.map((citation) => citation.chunk_id)).toEqual(["nmhs-clozapine-red-range"]);
    expect(answer.answerSections).toEqual([
      expect.objectContaining({
        heading: "Red-range threshold and action",
        citation_chunk_ids: ["nmhs-clozapine-red-range"],
      }),
    ]);
  });

  it("uses the same source-bound answer after deterministic medication typo correction", () => {
    const typoQuery = "What ANC or FBC cut off means clozapin should be withheld?";
    const answer = finalizeRagAnswerQuality(
      extractiveAnswerFor(typoQuery, [redRangeSource], "table_threshold"),
      typoQuery,
      "table_threshold",
    );

    expect(answer.grounded).toBe(true);
    expect(answer.answer.replace(/\*\*/g, " ")).toMatch(/stop clozapine therapy immediately/i);
    expect(answer.citations.map((citation) => citation.chunk_id)).toEqual(["nmhs-clozapine-red-range"]);
    expect(answer.routingReason).not.toContain("source_backed_review_fallback");
  });

  it("does not synthesize the atomic red-range answer from partial or split rows", () => {
    const partialWbc = {
      ...redRangeSource,
      id: "partial-wbc-row",
      content: "WBC < 3.0 x 109/L AND/OR Stop clozapine therapy immediately.",
    };
    const splitNeutrophils = {
      ...redRangeSource,
      id: "split-neutrophil-row",
      content: "Red Range Neutrophils < 1.5 x 109/L Contact haematologist.",
    };
    const splitAnswer = extractiveAnswerFor(query, [partialWbc, splitNeutrophils], "table_threshold");
    const monitoringAnswer = extractiveAnswerFor(
      "When should clozapine blood monitoring occur?",
      [redRangeSource],
      "medication_dose_risk",
    );

    expect(splitAnswer.answerSections?.some((section) => section.heading === "Red-range threshold and action")).toBe(
      false,
    );
    expect(
      monitoringAnswer.answerSections?.some((section) => section.heading === "Red-range threshold and action"),
    ).toBe(false);
  });
});

describe("source-bound community-home-visit requirements", () => {
  const query = "What is required for community home visits?";
  const departureSource = figureChunk({
    id: "community-home-visit-departure",
    document_id: "community-home-visit-akg",
    title: "Community Home Visit(AKG)",
    file_name: "Community Home Visit (AKG).pdf",
    page_number: 1,
    section_heading: "Procedure",
    content: `All clinical staff are to complete a Community Home Visit Log prior to leaving the workplace.
Designated OAC clerical staff will review the log.`,
  });
  const returnSource = figureChunk({
    id: "community-home-visit-return",
    document_id: "community-home-visit-akg",
    title: "Community Home Visit(AKG)",
    file_name: "Community Home Visit (AKG).pdf",
    page_number: 2,
    section_heading: "Safety monitoring",
    content: `Leschen clerical reception staff will take responsibility for safety monitoring.
The clinician will inform Leschen clerical reception staff on their return to the workplace and update the community home visit log.`,
  });

  it("keeps departure and return requirements bound to two chunks in the same AKG procedure", () => {
    const answer = finalizeRagAnswerQuality(
      extractiveAnswerFor(query, [departureSource, returnSource], "unsupported_or_general"),
      query,
      "unsupported_or_general",
    );
    const plainAnswer = answer.answer.replace(/\*\*/g, " ");

    expect(answer.grounded).toBe(true);
    expect(answer.confidence).not.toBe("unsupported");
    expect(plainAnswer).toMatch(/Community Home Visit Log.*prior to leaving the workplace/i);
    expect(plainAnswer).toMatch(/clerical staff will review the log/i);
    expect(plainAnswer).toMatch(/safety monitoring/i);
    expect(plainAnswer).toMatch(/on their return to the workplace.*update the Community Home Visit Log/i);
    expect(answer.citations.map((citation) => citation.chunk_id)).toEqual([
      "community-home-visit-departure",
      "community-home-visit-return",
    ]);
    expect(answer.answerSections?.map((section) => section.heading)).toEqual([
      "Before leaving",
      "Safety monitoring and return",
    ]);
  });

  it("does not synthesize the measured answer from partial, cross-document, or mislabelled evidence", () => {
    const cases: SearchResult[][] = [
      [departureSource],
      [departureSource, { ...returnSource, document_id: "other-document" }],
      [departureSource, { ...returnSource, title: "Community Visits", file_name: "visits.pdf" }],
      [
        departureSource,
        {
          ...returnSource,
          content: returnSource.content.replace("safety monitoring", "filing support"),
        },
      ],
    ];

    for (const results of cases) {
      const answer = extractiveAnswerFor(query, results, "unsupported_or_general");
      expect(answer.answerSections?.some((section) => section.heading === "Safety monitoring and return")).toBe(false);
    }
  });
});

describe("source-bound Best Practice Prescription requirements", () => {
  const query = "What does the best practice prescription document require?";
  const useSource = figureChunk({
    id: "best-practice-program-use",
    document_id: "best-practice-prescription-akg",
    title: "Best Practice Prescription(AKG)",
    file_name: "Best Practice Prescription (AKG).pdf",
    page_number: 1,
    section_heading: "MEN-PRO-0489-19",
    content: `Best Practice Prescription Program is an electronic program implemented in the AHS outpatient mental health clinics that is used for the following activities:
• Prescription generation (replacing handwritten prescriptions)
• Maintenance of electronic medication profiles (replacing paper-based profiles)
• Internal and external correspondence generation
• Recording other relevant clinical information (e.g.: allergies/ adverse drug reactions).`,
  });
  const profileSource = figureChunk({
    id: "best-practice-profile-maintenance",
    document_id: "best-practice-prescription-akg",
    title: "Best Practice Prescription(AKG)",
    file_name: "Best Practice Prescription (AKG).pdf",
    page_number: 2,
    section_heading: "Maintaining a medication profile",
    content: `At the first clinic appointment, medical officers are to inquire with the consumer (or carer) about their current medications and may need to verify this information with the consumer's own medications or a suitable alternative source (e.g.: General Practitioner).
The details (i.e.: medication name, formulation, route, dose and directions for use) of each psychiatric and non-psychiatric medication must be entered into the Best Practice Prescription Program medication profile.`,
  });

  it("binds program uses and profile duties to two chunks in the same AKG procedure", () => {
    const answer = finalizeRagAnswerQuality(
      extractiveAnswerFor(query, [useSource, profileSource], "document_lookup"),
      query,
      "document_lookup",
    );
    const plainAnswer = answer.answer.replace(/\*\*/g, " ");

    expect(answer.grounded).toBe(true);
    expect(answer.confidence).not.toBe("unsupported");
    expect(plainAnswer).toMatch(/prescription generation/i);
    expect(plainAnswer).toMatch(/electronic medication profiles/i);
    expect(plainAnswer).toMatch(/first clinic appointment/i);
    expect(plainAnswer).toMatch(/current medications/i);
    expect(plainAnswer).toMatch(/medication name, formulation, route, dose and directions for use/i);
    expect(answer.citations.map((citation) => citation.chunk_id)).toEqual([
      "best-practice-program-use",
      "best-practice-profile-maintenance",
    ]);
    expect(answer.answerSections?.map((section) => section.heading)).toEqual(["Program use", "Medication profile"]);
  });

  it("does not synthesize the measured answer from partial or cross-document evidence", () => {
    for (const results of [
      [useSource],
      [useSource, { ...profileSource, document_id: "other-document" }],
      [useSource, { ...profileSource, content: profileSource.content.replace("General Practitioner", "local file") }],
    ]) {
      const answer = extractiveAnswerFor(query, results, "document_lookup");
      expect(answer.answerSections?.some((section) => section.heading === "Medication profile")).toBe(false);
    }
  });
});

describe("provider source-gap lifecycle", () => {
  it("clears claim attribution when a cited terminal answer is only a source gap", () => {
    const result = figureChunk({
      id: "nearby-discharge-source",
      document_id: "discharge-document",
      title: "Discharge guidance",
      content: "Discharge planning begins during admission.",
    });
    const answer = finalizeRagAnswerQuality(
      {
        answer: "No current source with directly relevant clinical guidance was found.",
        grounded: false,
        confidence: "low",
        citations: [citationFromResult(result)],
        sources: [result],
        answerSections: [
          {
            heading: "Source gap",
            kind: "source_gap",
            supportLevel: "unsupported",
            body: "The available source does not provide enough detail.",
            citation_chunk_ids: [result.id],
          },
        ],
        quoteCards: [
          {
            chunk_id: result.id,
            quote: "Discharge planning begins during admission.",
            section_heading: null,
          },
        ],
        bestSource: null,
        routingReason: "strong_routine_retrieval",
        routingMode: "strong",
        modelUsed: "gpt-test",
        queryClass: "broad_summary",
      } as RagAnswer,
      "Summarize the discharge guidance",
      "broad_summary",
    );

    expect(answer.grounded).toBe(false);
    expect(answer.confidence).toBe("unsupported");
    expect(answer.citations).toEqual([]);
    expect(answer.answerSections).toEqual([]);
    expect(answer.quoteCards).toEqual([]);
    expect(answer.routingReason).toContain("final_quality_gate:provider_source_gap");
  });

  it("does not classify a substantive answer with a bounded limitation as a source-gap refusal", () => {
    expect(
      isProviderSourceGapGeneratedAnswer({
        answer:
          "Discharge planning begins during admission and records ongoing care arrangements. The available sources do not specify the local follow-up interval.",
        grounded: true,
        confidence: "medium",
        answerSections: [],
      }),
    ).toBe(false);
  });

  const dischargeChunks = [
    figureChunk({
      id: "discharge-planning-start",
      document_id: "discharge-guidance",
      title: "Admission to Discharge for Mental Health Inpatients (NMHS)",
      file_name: "Admission to Discharge for Mental Health Inpatients (NMHS).pdf",
      page_number: 4,
      section_heading: "Discharge planning",
      content:
        "Clinicians will actively plan effective and timely discharge from the beginning of admission and review the plan throughout the inpatient stay.",
      similarity: 0.97,
      hybrid_score: 0.97,
    }),
    figureChunk({
      id: "discharge-documentation",
      document_id: "discharge-guidance",
      title: "Admission to Discharge for Mental Health Inpatients (NMHS)",
      file_name: "Admission to Discharge for Mental Health Inpatients (NMHS).pdf",
      page_number: 5,
      section_heading: "Discharge documentation",
      content:
        "The discharge plan must document ongoing care arrangements, communicate the plan with the consumer, and identify follow-up responsibilities.",
      similarity: 0.97,
      hybrid_score: 0.97,
    }),
  ];

  // The S1d defect shape: a hedged, cited, grounded, low-confidence fast answer whose
  // lead misses providerSourceGapLeadPattern but whose body matches the finalizer's
  // broad gap-like regex ("do not provide specific") and survives sanitizeAnswerText.
  const hedgedGapLikeFastAnswer = (overrides: Partial<RagAnswer> = {}): RagAnswer =>
    ({
      answer:
        "Discharge planning begins at admission and the plan is reviewed during the inpatient stay. The discharge documents do not provide specific timing details.",
      grounded: true,
      confidence: "low",
      citations: dischargeChunks.map((chunk) => citationFromResult(chunk)),
      sources: dischargeChunks,
      answerSections: [],
      quoteCards: [],
      bestSource: null,
      routingReason: "strong_routine_retrieval",
      routingMode: "fast",
      modelUsed: "gpt-test",
      queryClass: "broad_summary",
      ...overrides,
    }) as RagAnswer;
  const dischargeQuery = "Summarize the discharge guidance";

  it("rebuilds a source-backed extractive answer when a cited low-confidence fast answer is only gap-like phrasing", () => {
    const answer = finalizeRagAnswerQuality(hedgedGapLikeFastAnswer(), dischargeQuery, "broad_summary");

    expect(answer.routingMode).toBe("extractive");
    expect(answer.grounded).toBe(true);
    expect(answer.confidence).not.toBe("unsupported");
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.responseMode).toBeDefined();
    expect(answer.responseMode).not.toBe("evidence_gap");
    expect(answer.answer).not.toMatch(/do not provide specific/i);
    expect(answer.routingReason).toContain("generation_fallback:provider_source_gap");
    expect(answer.routingReason).toContain("source_backed_extractive_fallback");
    expect(answer.routingReason).toContain("final_quality_gate_source_backed_recovery:provider_source_gap");
    expect(answer.routingReason).not.toMatch(/final_quality_gate:/);
    expect(answer.modelUsed).toBeNull();
    expect(answer.answerQualityTier).toBe("source_only");
  });

  it("keeps a zero-source fast gap-like answer terminal", () => {
    const answer = finalizeRagAnswerQuality(
      hedgedGapLikeFastAnswer({ sources: [], citations: [] }),
      dischargeQuery,
      "broad_summary",
    );

    expect(answer.grounded).toBe(false);
    expect(answer.confidence).toBe("unsupported");
    expect(answer.citations).toEqual([]);
    expect(answer.responseMode).toBe("evidence_gap");
    expect(answer.routingReason).toContain("final_quality_gate:provider_source_gap");
  });

  it("keeps a strong-route gap-like answer terminal", () => {
    const answer = finalizeRagAnswerQuality(
      hedgedGapLikeFastAnswer({ routingMode: "strong" }),
      dischargeQuery,
      "broad_summary",
    );

    expect(answer.grounded).toBe(false);
    expect(answer.confidence).toBe("unsupported");
    expect(answer.citations).toEqual([]);
    expect(answer.responseMode).toBe("evidence_gap");
    expect(answer.routingReason).toContain("final_quality_gate:provider_source_gap");
  });

  it("keeps a comparison-class gap-like answer terminal", () => {
    const answer = finalizeRagAnswerQuality(
      hedgedGapLikeFastAnswer({ queryClass: "comparison" }),
      dischargeQuery,
      "comparison",
    );

    expect(answer.grounded).toBe(false);
    expect(answer.confidence).toBe("unsupported");
    expect(answer.citations).toEqual([]);
    expect(answer.responseMode).toBe("evidence_gap");
    expect(answer.routingReason).toContain("final_quality_gate:provider_source_gap");
  });

  it("does not recover outside strong routine retrieval", () => {
    const answer = finalizeRagAnswerQuality(
      hedgedGapLikeFastAnswer({ routingReason: "retrieval_gap_or_conflict" }),
      dischargeQuery,
      "broad_summary",
    );

    expect(answer.grounded).toBe(false);
    expect(answer.confidence).toBe("unsupported");
    expect(answer.citations).toEqual([]);
    expect(answer.responseMode).toBe("evidence_gap");
    expect(answer.routingReason).toContain("final_quality_gate:provider_source_gap");
  });
});

describe("extractive malformed-fragment signatures", () => {
  it("reflows the observed EMHS olanzapine and consultant dose bullets without dropping their continuations", () => {
    const sentences = splitClinicalEvidenceSentences(
      [
        "• Olanzapine IM may be repeated after 2 hours and a third dose 6 hours after the",
        "first dose if required. Total of 3 doses or 30mg maximum in 24 hours (10mg",
        "maximum in 24 hours for older adults over 65 years) whichever occurs first.",
        "• Dosing frequencies outside the recommended guidelines require Consultant",
        "Psychiatrist approval.",
      ].join("\n"),
    );

    expect(sentences).toEqual([
      "Olanzapine IM may be repeated after 2 hours and a third dose 6 hours after the first dose if required — Total of 3 doses or 30mg maximum in 24 hours (10mg maximum in 24 hours for older adults over 65 years) whichever occurs first.",
      "Dosing frequencies outside the recommended guidelines require Consultant Psychiatrist approval.",
    ]);
  });

  it.each([
    "Dosing frequencies outside the recommended schedule require prescriber review before olanzapine is administered.",
    "The table summarising olanzapine dosing lists a maximum dose of 20 mg daily.",
  ])("keeps complete clinical prose that shares an artifact prefix: %s", (text) => {
    expect(splitClinicalEvidenceSentences(text)).toEqual([text]);
  });

  it.each([
    "Dosing frequencies outside of recommended time and/or dose maximum AND IM daily dose hourly until the patient is ambulatory.",
    "Table summarizing recommended medication doses, monitoring protocols, and maximum daily dose limits.",
  ])("rejects the complete observed malformed continuation: %s", (text) => {
    expect(splitClinicalEvidenceSentences(text)).toEqual([]);
  });
});

describe("escalation fallback intent", () => {
  const query = "When should neuroleptic side effects be escalated?";
  const queryClass = "medication_dose_risk" as const;
  const distressSource = figureChunk({
    id: "lunsers-distress",
    document_id: "lunsers-document",
    title: "Neuroleptic Side Effects (AKG)",
    file_name: "Neuroleptic Side Effects (AKG).pdf",
    section_heading: null,
    content:
      "Scores are medium (41-89), high (81-100), and very high (>101). Any neuroleptic side effect which is causing distress irrespective of score should be escalated to the treating doctor and reviewed.",
  });

  it("requires a direct escalation action and trigger rather than topical neuroleptic overlap", () => {
    const supported = extractiveAnswerFor(query, [distressSource], queryClass);
    const unrelated = {
      ...supported,
      answer:
        "Contraindications and precautions include agranulocytosis, blood dyscrasias, and a history of neuroleptic malignant syndrome.",
      grounded: true,
      confidence: "medium" as const,
    };

    expect(generatedAnswerQualityFailureReason(unrelated, query, queryClass)).toBe("missing_query_intent");
    expect(isSafeExtractiveFallbackCandidate(unrelated, query, queryClass)).toBe(false);
    expect(
      isSafeExtractiveFallbackCandidate(
        {
          ...unrelated,
          answer:
            "Armadale Kalamunda Group > Contraindications Precautions (consider the following when prescribing) > History of neuroleptic malignant syndrome.",
        },
        query,
        queryClass,
      ),
    ).toBe(false);
  });

  it("does not route de-escalation language through the escalation fallback contract", () => {
    expect(isExplicitEscalationQuery("How should agitation be de-escalated?")).toBe(false);
    expect(isExplicitEscalationQuery("Summarise de-escalation techniques")).toBe(false);
    expect(isExplicitEscalationQuery("When should de-escalation stop and escalation to medical review begin?")).toBe(
      true,
    );
    expect(isExplicitEscalationQuery(query)).toBe(true);
  });

  it.each([
    "Scores are recorded and the treating doctor should review them.",
    "The prescriber should review the neuroleptic side-effect score.",
    "Contact the treating doctor about documentation when prescribing neuroleptics.",
    "If neuroleptic side effects were discussed, the nurse reported to the treating doctor yesterday.",
    "If neuroleptic side effects caused distress yesterday, they were escalated during the audit.",
    "If neuroleptic side effects occur, urgent medical review is documented in the audit.",
    "If severe side effects occur, the patient should be assessed before escalation.",
    "If severe side effects occur, the plan requires assessment before escalation.",
    "If severe side effects occur, staff should assess whether to contact the treating doctor.",
    "If severe side effects occur, staff must document any decision to contact the prescriber.",
    "If severe side effects occur, contact details for the treating doctor are available.",
    "If severe side effects occur, a report from the prescriber is filed.",
    "If treatment is stable, document neuroleptic side effects and contact the treating doctor.",
    "The 2024 audit recorded that severe neuroleptic side effects should be escalated to the treating doctor.",
    "It was reported in the 2024 audit that severe neuroleptic side effects should be escalated to the treating doctor.",
    "According to the 2024 audit, severe neuroleptic side effects should be escalated to the treating doctor.",
    "This guideline states that the 2024 audit reported severe neuroleptic side effects should be escalated to the treating doctor.",
    "This guideline states that the patient record reports severe neuroleptic side effects should be escalated to the treating doctor.",
    "A previous guideline stated that severe neuroleptic side effects should be escalated to the treating doctor.",
    "The former protocol states that severe neuroleptic side effects should be escalated to the treating doctor.",
    "In 2024, the guideline stated that severe neuroleptic side effects should be escalated to the treating doctor.",
    "The superseded policy requires escalation when neuroleptic side effects are severe.",
    "The prior policy requires escalation when neuroleptic side effects are severe.",
    "The earlier guideline requires escalation when neuroleptic side effects are severe.",
    "The withdrawn policy requires escalation when neuroleptic side effects are severe.",
    "The legacy protocol requires escalation when neuroleptic side effects are severe.",
    "The retired guideline requires escalation when neuroleptic side effects are severe.",
    "The repealed policy requires escalation when neuroleptic side effects are severe.",
    "The discontinued protocol requires escalation when neuroleptic side effects are severe.",
    "The outdated guideline requires escalation when neuroleptic side effects are severe.",
    "When should severe neuroleptic side effects be escalated to the treating doctor?",
    "Should severe neuroleptic side effects be escalated to the treating doctor?",
  ])("does not treat an unbound score or incidental when-clause as an escalation trigger: %s", (answer) => {
    const candidate = { ...extractiveAnswerFor(query, [distressSource], queryClass), answer };
    expect(generatedAnswerQualityFailureReason(candidate, query, queryClass)).not.toBeNull();
    expect(isSafeExtractiveFallbackCandidate(candidate, query, queryClass)).toBe(false);
  });

  it.each([
    "Which neuroleptic side effects require escalation?",
    "What triggers escalation of neuroleptic side effects?",
    "Give the escalation criteria for neuroleptic side effects.",
    "Under what circumstances should neuroleptic side effects be escalated?",
  ])("requires a condition for escalation trigger and criteria questions: %s", (triggerQuery) => {
    const candidate = {
      ...extractiveAnswerFor(triggerQuery, [distressSource], queryClass),
      answer: "Escalation is required.",
    };
    expect(generatedAnswerQualityFailureReason(candidate, triggerQuery, queryClass)).toBe("missing_query_intent");
  });

  it.each([
    "Contact the treating doctor when neuroleptic side effects cause distress.",
    "Notify the responsible clinician if neuroleptic side effects cause distress.",
    "Neuroleptic side effects causing distress require prompt medical review.",
    "Neuroleptic side effects causing distress should be reviewed by the treating prescriber.",
    "For a patient with a history of NMS, severe neuroleptic side effects should be escalated to the treating doctor.",
    "This guideline states that severe neuroleptic side effects should be escalated to the treating doctor.",
  ])("accepts a bounded escalation-action paraphrase: %s", (answer) => {
    const candidate = { ...extractiveAnswerFor(query, [distressSource], queryClass), answer };
    expect(generatedAnswerQualityFailureReason(candidate, query, queryClass)).toBeNull();
  });

  it("withholds contradictory score bands but keeps the independent trigger and score-independent context", () => {
    const scoreContext = figureChunk({
      id: "lunsers-score-context",
      document_id: "lunsers-document",
      title: "Neuroleptic Side Effects (AKG)",
      file_name: "Neuroleptic Side Effects (AKG).pdf",
      section_heading: null,
      content:
        "The LUNSERS tool measures neuroleptic side effects. Scoring of the completed LUNSERS can ascertain severity, however scoring is not essential for actions to be taken. Scores are medium (41-89), high (81-100), and very high (>101).",
    });
    const answer = extractiveAnswerFor(query, [distressSource, scoreContext], queryClass);
    const plain = answer.answer.replace(/\*\*/g, "");

    expect(answer.grounded).toBe(true);
    expect(plain).toMatch(/causing distress/i);
    expect(plain).toMatch(/escalated to the treating doctor/i);
    expect(`${answer.answer} ${answer.answerSections.map((section) => section.body).join(" ")}`).not.toMatch(
      /\b(?:41|81|100|101)\b/,
    );
    expect(answer.citations.map((citation) => citation.chunk_id)).toEqual(
      expect.arrayContaining(["lunsers-distress", "lunsers-score-context"]),
    );
    expect(answer.conflictsOrGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "conflict", source_chunk_ids: expect.arrayContaining(["lunsers-distress"]) }),
      ]),
    );
    expect(isSafeExtractiveFallbackCandidate(answer, query, queryClass)).toBe(true);
  });

  it("keeps a soft-wrapped escalation recipient attached to the live source rule", () => {
    const wrappedDistressSource = figureChunk({
      id: "lunsers-wrapped-distress",
      document_id: "lunsers-document",
      title: "Neuroleptic Side Effects (AKG)",
      file_name: "Neuroleptic Side Effects (AKG).pdf",
      section_heading: null,
      content: [
        "increased, or side",
        "effects noted within the three-month period, LUNSERS is to be repeated within 28 days of",
        "the change. Scores which fall into the medium (41-89), High (81-100) Very High (>101)",
        "ranges are to be escalated to the treating doctor. The treating doctor will document a plan",
        "within the health care record for management",
        "• Side effects are noted as causing distress to the patient, the LUNSERS should be repeated",
        "3-monthly. Any side effect which is causing distress irrespective of score should be escalated",
        "to the treating doctor and reviewed.",
      ].join("\n"),
    });

    const answer = extractiveAnswerFor(query, [wrappedDistressSource], queryClass);
    const plain = answer.answer.replace(/\*\*/g, "");

    expect(answer.grounded).toBe(true);
    expect(plain).toMatch(
      /any side effect which is causing distress irrespective of score should be escalated to the treating doctor and reviewed/i,
    );
    expect(plain).not.toMatch(/\b(?:41|81|100|101)\b/);
    expect(isSafeExtractiveFallbackCandidate(answer, query, queryClass)).toBe(true);
  });

  it("scopes a split labelled-band conflict to the adjacent LUNSERS chunks", () => {
    const splitMedium = figureChunk({
      id: "lunsers-medium-split",
      document_id: "multi-scale-document",
      page_number: 1,
      chunk_index: 10,
      section_heading: null,
      content: "LUNSERS score bands: medium (41-89),",
    });
    const splitHigh = figureChunk({
      id: "lunsers-high-split",
      document_id: "multi-scale-document",
      page_number: 1,
      chunk_index: 11,
      section_heading: null,
      content:
        "high (81-100), and very high (>101). LUNSERS side effects causing distress should be escalated to the treating doctor.",
    });
    const independentScale = figureChunk({
      id: "metabolic-risk-bands",
      document_id: "multi-scale-document",
      page_number: 4,
      chunk_index: 30,
      anchor_id: "metabolic-risk",
      section_path: ["Appendix", "Metabolic risk"],
      section_heading: "Metabolic risk",
      content: "Metabolic risk bands are low (0-9), medium (10-19), and high (>19).",
    });

    const results = [splitMedium, splitHigh, independentScale];
    const conflicts = adjacentLabelledNumericBandConflicts(results);
    expect(labelledNumericBandConflictChunkIds(results)).toEqual(
      new Set(["lunsers-medium-split", "lunsers-high-split"]),
    );
    expect(textReferencesAdjacentBandConflict("A LUNSERS score of 81 is high.", splitHigh.id, conflicts)).toBe(true);
    expect(textReferencesAdjacentBandConflict("LUNSERS high starts at 85.", splitHigh.id, conflicts)).toBe(true);
    expect(textReferencesAdjacentBandConflict("High is 81.", splitHigh.id, conflicts)).toBe(true);
    expect(textReferencesAdjacentBandConflict("The LUNSERS score is 80-90.", splitHigh.id, conflicts)).toBe(true);
    expect(textReferencesAdjacentBandConflict("The LUNSERS score is below 90.", splitHigh.id, conflicts)).toBe(true);
    expect(textReferencesAdjacentBandConflict("The LUNSERS score is >80.", splitHigh.id, conflicts)).toBe(true);
    expect(textReferencesAdjacentBandConflict("The LUNSERS score is between 80 and 90.", splitHigh.id, conflicts)).toBe(
      true,
    );
    expect(
      textReferencesAdjacentBandConflict("A LUNSERS score of 50 requires escalation.", splitHigh.id, conflicts),
    ).toBe(true);
    expect(
      textReferencesAdjacentBandConflict("According to NMHS, the LUNSERS score 85 is high.", splitHigh.id, conflicts),
    ).toBe(true);
    // Once a labelled set is internally contradictory, every scalar within
    // its affected member bands is withheld rather than only the overlap.
    expect(textReferencesAdjacentBandConflict("The LUNSERS score is 90.", splitHigh.id, conflicts)).toBe(true);
    expect(textReferencesAdjacentBandConflict("There were 81 cases.", splitHigh.id, conflicts)).toBe(false);
    expect(textReferencesAdjacentBandConflict("The appendix contains 100 examples.", splitHigh.id, conflicts)).toBe(
      false,
    );
    expect(textReferencesAdjacentBandConflict("The interval 81-100 was reviewed.", splitHigh.id, conflicts)).toBe(
      false,
    );
    expect(textReferencesAdjacentBandConflict("See sections 81-100.", splitHigh.id, conflicts)).toBe(false);
    expect(textReferencesAdjacentBandConflict("81.", splitHigh.id, conflicts, "What is the LUNSERS score band?")).toBe(
      true,
    );
    for (const actionableScalar of [
      "Escalate at 90.",
      "Contact the treating doctor at 100.",
      "At 90, escalate to the treating doctor.",
      "100, escalate neuroleptic side effects to the treating doctor.",
      "At 100, escalate neuroleptic side effects to the treating doctor.",
      "100: neuroleptic side effects should be escalated to the treating doctor.",
      "Escalate neuroleptic side effects at 100.",
    ]) {
      expect(
        textReferencesAdjacentBandConflict(
          actionableScalar,
          splitHigh.id,
          conflicts,
          "Should neuroleptic side effects be escalated?",
        ),
      ).toBe(true);
    }
    for (const nonThresholdIdentifier of [
      "Contact the treating doctor on extension 100.",
      "Contact the treating doctor by calling 100.",
      "Notify switchboard on 90.",
      "Escalate using form 100.",
      "Contact the treating doctor using reference 100.",
    ]) {
      expect(
        textReferencesAdjacentBandConflict(
          nonThresholdIdentifier,
          splitHigh.id,
          conflicts,
          "Should neuroleptic side effects be escalated?",
        ),
      ).toBe(false);
    }
    for (const modifier of [
      "applicable",
      "specified",
      "defined",
      "documented",
      "indicated",
      "provided",
      "given",
      "reported",
      "required",
    ]) {
      expect(
        textReferencesAdjacentBandConflict(
          `The ${modifier} range is 81-100.`,
          splitHigh.id,
          conflicts,
          "What is the applicable LUNSERS range?",
        ),
      ).toBe(true);
    }
    expect(
      textReferencesAdjacentBandConflict("See page 81 for the LUNSERS score bands.", splitHigh.id, conflicts),
    ).toBe(false);
    expect(
      textReferencesAdjacentBandConflict("LUNSERS was validated in 80-90 patients.", splitHigh.id, conflicts),
    ).toBe(false);
    expect(
      textReferencesAdjacentBandConflict("Give 81-100 mg and record the LUNSERS score.", splitHigh.id, conflicts),
    ).toBe(false);
    expect(textReferencesAdjacentBandConflict("The score was recorded. Give 81-100 mg.", splitHigh.id, conflicts)).toBe(
      false,
    );
    expect(
      textReferencesAdjacentBandConflict("Hamilton Anxiety Rating Scale high starts at 81.", splitHigh.id, conflicts),
    ).toBe(false);
    expect(textReferencesAdjacentBandConflict("Metabolic risk is high above 19.", splitHigh.id, conflicts)).toBe(false);
    expect(textReferencesAdjacentBandConflict("Metabolic bands are low (70-81).", splitHigh.id, conflicts)).toBe(false);
    expect(
      textReferencesAdjacentBandConflict(
        "LUNSERS was recorded; metabolic risk bands are low (70-81).",
        splitHigh.id,
        conflicts,
      ),
    ).toBe(false);
    expect(
      textReferencesAdjacentBandConflict(
        "PANSS and LUNSERS were recorded, and 81 on the PANSS score is high.",
        splitHigh.id,
        conflicts,
      ),
    ).toBe(false);
    expect(
      textReferencesAdjacentBandConflict(
        "The PANSS range is 81-100.",
        splitHigh.id,
        conflicts,
        "What is the applicable LUNSERS range?",
      ),
    ).toBe(false);
    expect(
      textReferencesAdjacentBandConflict(
        "The LUNSERS reference range is 81-100.",
        splitHigh.id,
        conflicts,
        "What is the applicable LUNSERS range?",
      ),
    ).toBe(true);
    for (const panssRange of [
      "On PANSS, the range is 81-100.",
      "On PANSS: the range is 81-100.",
      "On PANSS; the range is 81-100.",
      "On PANSS — the range is 81-100.",
      "On PANSS - the range is 81-100.",
      "On PANSS (the range is 81-100).",
      "PANSS: the range is 81-100.",
      "PANSS; the range is 81-100.",
      "PANSS — the range is 81-100.",
      "PANSS – the range is 81-100.",
      "PANSS - the range is 81-100.",
      "(PANSS) the range is 81-100.",
      "The range is 81-100 (PANSS).",
    ]) {
      expect(
        textReferencesAdjacentBandConflict(
          panssRange,
          splitHigh.id,
          conflicts,
          "Compare the LUNSERS and PANSS ranges.",
        ),
      ).toBe(false);
    }
    expect(
      textReferencesAdjacentBandConflict(
        "PANSS guidance ends here. The range is 81-100.",
        splitHigh.id,
        conflicts,
        "What is the applicable LUNSERS range?",
      ),
    ).toBe(true);
  });

  it("keeps a coherent named scale from a chunk containing another scale's conflict", () => {
    const mixedScale = figureChunk({
      id: "mixed-scale-extractive",
      document_id: "mixed-scale-extractive-document",
      content:
        "LUNSERS score bands are medium (41-89) and high (81-100). Metabolic risk bands are low (0-9), medium (10-19), and high (>19).",
    });
    const answer = extractiveAnswerFor("What is the high metabolic risk band?", [mixedScale], "table_threshold");
    const delivered = `${answer.answer} ${answer.answerSections.map((section) => section.body).join(" ")}`;

    expect(answer.grounded).toBe(true);
    expect(delivered).toMatch(/metabolic/i);
    expect(delivered).toMatch(/(?:above|>)\s*19/i);
    expect(delivered).not.toMatch(/41|81|100/);
    expect(answer.conflictsOrGaps).toEqual([]);
  });

  it("does not bridge different sections, scales, or non-adjacent chunks", () => {
    const chunk = (overrides: Partial<SearchResult>) =>
      figureChunk({
        document_id: "bounded-band-document",
        page_number: 2,
        ...overrides,
      });
    const differentSections = [
      chunk({
        id: "depression-medium",
        chunk_index: 1,
        anchor_id: "depression",
        section_path: ["Depression"],
        content: "Mood score bands: medium (41-89),",
      }),
      chunk({
        id: "anxiety-high",
        chunk_index: 2,
        anchor_id: "anxiety",
        section_path: ["Anxiety"],
        content: "high (81-100). Mood score guidance for anxiety.",
      }),
    ];
    const differentScales = [
      chunk({
        id: "lunsers-medium",
        chunk_index: 4,
        section_heading: "Outcome measures",
        content: "LUNSERS score bands: medium (41-89),",
      }),
      chunk({
        id: "panss-high",
        chunk_index: 5,
        section_heading: "Outcome measures",
        content: "PANSS score bands: high (81-100).",
      }),
    ];
    const nonAdjacent = [
      chunk({
        id: "lunsers-gap-medium",
        chunk_index: 8,
        section_heading: null,
        content: "LUNSERS score bands: medium (41-89),",
      }),
      chunk({
        id: "lunsers-gap-high",
        chunk_index: 10,
        section_heading: null,
        content: "high (81-100). LUNSERS score guidance.",
      }),
    ];
    const differentNamedScales = [
      chunk({
        id: "hamilton-medium",
        chunk_index: 12,
        section_path: ["Outcome measures"],
        section_heading: null,
        content: "Hamilton Anxiety Rating Scale bands: medium (41-89),",
      }),
      chunk({
        id: "montgomery-high",
        chunk_index: 13,
        section_path: ["Outcome measures"],
        section_heading: null,
        content: "Montgomery Depression Rating Scale bands: high (81-100).",
      }),
    ];

    expect(labelledNumericBandConflictChunkIds(differentSections)).toEqual(new Set());
    expect(labelledNumericBandConflictChunkIds(differentScales)).toEqual(new Set());
    expect(labelledNumericBandConflictChunkIds(nonAdjacent)).toEqual(new Set());
    expect(labelledNumericBandConflictChunkIds(differentNamedScales)).toEqual(new Set());
  });

  it("uses an explicit shared scale identity for consecutive pageless chunks", () => {
    const chunk = (overrides: Partial<SearchResult>) =>
      figureChunk({
        document_id: "pageless-band-document",
        page_number: null,
        section_path: [],
        section_heading: null,
        parent_heading: null,
        ...overrides,
      });
    const sameScale = [
      chunk({
        id: "pageless-lunsers-medium",
        chunk_index: 10,
        content: "LUNSERS score bands: medium (41-89),",
      }),
      chunk({
        id: "pageless-lunsers-high",
        chunk_index: 11,
        content: "LUNSERS score bands continue: high (81-100), very high (>101).",
      }),
    ];
    const differentScales = [
      sameScale[0]!,
      chunk({
        id: "pageless-panss-high",
        chunk_index: 11,
        content: "PANSS score bands continue: high (81-100), very high (>101).",
      }),
    ];

    expect(labelledNumericBandConflictChunkIds(sameScale)).toEqual(
      new Set(["pageless-lunsers-medium", "pageless-lunsers-high"]),
    );
    expect(labelledNumericBandConflictChunkIds(differentScales)).toEqual(new Set());
  });

  it("uses strong section scope ahead of repaired or repeated anchors", () => {
    const chunk = (overrides: Partial<SearchResult>) =>
      figureChunk({
        document_id: "anchor-scope-document",
        page_number: 2,
        ...overrides,
      });
    const samePathWithRepairedAnchors = [
      chunk({
        id: "repaired-medium",
        chunk_index: 20,
        anchor_id: "p2-c20-outcome-measures",
        section_path: ["Outcome measures", "LUNSERS"],
        section_heading: "LUNSERS medium bands",
        parent_heading: "Outcome measures",
        content: "LUNSERS score bands: medium (41-89),",
      }),
      chunk({
        id: "repaired-high",
        chunk_index: 21,
        anchor_id: "p2-c21-outcome-measures",
        section_path: ["Outcome measures", "LUNSERS"],
        section_heading: "Continuation fragment",
        parent_heading: "Different detected heading",
        content: "high (81-100). LUNSERS score guidance.",
      }),
    ];
    const repeatedAnchorDifferentPaths = [
      chunk({
        id: "depression-repeated-anchor",
        chunk_index: 30,
        anchor_id: "risk-bands",
        section_path: ["Depression", "Risk bands"],
        content: "Mood score bands: medium (41-89),",
      }),
      chunk({
        id: "anxiety-repeated-anchor",
        chunk_index: 31,
        anchor_id: "risk-bands",
        section_path: ["Anxiety", "Risk bands"],
        content: "high (81-100). Mood score guidance.",
      }),
    ];
    const uppercaseLiveShape = [
      chunk({
        id: "uppercase-medium",
        chunk_index: 40,
        section_path: ["Outcome measures", "LUNSERS"],
        content: "LUNSERS SCORE BANDS: MEDIUM (41-89),",
      }),
      chunk({
        id: "uppercase-high",
        chunk_index: 41,
        section_path: ["Outcome measures", "LUNSERS"],
        content: "HIGH (81-100), VERY HIGH (>101).",
      }),
    ];
    const sharedBroadPathDifferentHeadings = [
      chunk({
        id: "heading-lunsers-medium",
        chunk_index: 50,
        section_path: ["Outcome measures"],
        section_heading: "LUNSERS",
        content: "LUNSERS score bands: medium (41-89),",
      }),
      chunk({
        id: "heading-panss-high",
        chunk_index: 51,
        section_path: ["Outcome measures"],
        section_heading: "PANSS",
        content: "high (81-100).",
      }),
    ];
    const authorityPathDifferentHeadings = sharedBroadPathDifferentHeadings.map((result, index) => ({
      ...result,
      id: index === 0 ? "authority-lunsers-medium" : "authority-panss-high",
      section_path: ["NMHS", "Outcome measures"],
      chunk_index: 60 + index,
    }));
    const sameScaleAliasHeadings = [
      chunk({
        id: "alias-lunsers-medium",
        chunk_index: 70,
        section_path: ["Outcome measures", "LUNSERS"],
        section_heading: "LUNSERS",
        content: "LUNSERS score bands: medium (41-89),",
      }),
      chunk({
        id: "alias-lunsers-high",
        chunk_index: 71,
        section_path: ["Outcome measures", "LUNSERS"],
        section_heading: "Liverpool University Neuroleptic Side Effect Rating Scale",
        content: "high (81-100).",
      }),
    ];
    const sameScaleConnectorAliasHeadings = [
      chunk({
        id: "alias-panss-medium",
        chunk_index: 75,
        section_path: ["Outcome measures"],
        section_heading: "PANSS",
        content: "PANSS score bands: medium (41-89),",
      }),
      chunk({
        id: "alias-panss-high",
        chunk_index: 76,
        section_path: ["Outcome measures"],
        section_heading: "Positive and Negative Syndrome Scale",
        content: "high (81-100).",
      }),
    ];
    const sameScaleRowHeadings = [
      chunk({
        id: "row-heading-medium",
        chunk_index: 80,
        section_heading: "LUNSERS medium bands",
        content: "LUNSERS score bands: medium (41-89),",
      }),
      chunk({
        id: "row-heading-high",
        chunk_index: 81,
        section_heading: "LUNSERS high bands",
        content: "high (81-100).",
      }),
    ];

    expect(labelledNumericBandConflictChunkIds(samePathWithRepairedAnchors)).toEqual(
      new Set(["repaired-medium", "repaired-high"]),
    );
    expect(labelledNumericBandConflictChunkIds(repeatedAnchorDifferentPaths)).toEqual(new Set());
    expect(labelledNumericBandConflictChunkIds(uppercaseLiveShape)).toEqual(
      new Set(["uppercase-medium", "uppercase-high"]),
    );
    expect(labelledNumericBandConflictChunkIds(sharedBroadPathDifferentHeadings)).toEqual(new Set());
    expect(labelledNumericBandConflictChunkIds(authorityPathDifferentHeadings)).toEqual(new Set());
    expect(labelledNumericBandConflictChunkIds(sameScaleAliasHeadings)).toEqual(
      new Set(["alias-lunsers-medium", "alias-lunsers-high"]),
    );
    expect(labelledNumericBandConflictChunkIds(sameScaleConnectorAliasHeadings)).toEqual(
      new Set(["alias-panss-medium", "alias-panss-high"]),
    );
    expect(labelledNumericBandConflictChunkIds(sameScaleRowHeadings)).toEqual(
      new Set(["row-heading-medium", "row-heading-high"]),
    );
  });

  it("runs claim-support trigger binding through the fallback-candidate safety gate", () => {
    const supported = extractiveAnswerFor(query, [distressSource], queryClass);
    const mismatchedTrigger = {
      ...supported,
      answer: "Escalate a neuroleptic side effect to the treating doctor if it causes a rash.",
    };

    expect(generatedAnswerQualityFailureReason(mismatchedTrigger, query, queryClass)).toBeNull();
    expect(isSafeExtractiveFallbackCandidate(mismatchedTrigger, query, queryClass)).toBe(false);
  });

  it("removes ranked and removed-section artifacts after extractive fallback finalization", () => {
    const results = Array.from({ length: 7 }, (_, index) =>
      figureChunk({
        id: `fallback-source-${index + 1}`,
        document_id: `fallback-document-${index + 1}`,
        title: `Fallback source ${index + 1}`,
        file_name: `fallback-source-${index + 1}.pdf`,
        chunk_index: index,
        content: `Routine source text ${index + 1}.`,
      }),
    );
    results[0]!.content = "Any neuroleptic side effect causing distress should be escalated to the treating doctor.";
    results[1]!.content = "If neuroleptic side effects persist, they should be escalated to the treating doctor.";
    results[3]!.content = "If neuroleptic symptoms worsen, contact the responsible clinician for prompt review.";
    results[4]!.content =
      "It was reported in the 2024 audit that severe neuroleptic side effects should be escalated to the treating doctor.";
    results[5]!.content = "If severe lithium side effects occur, contact the treating doctor for prompt review.";
    results[6]!.content = "Should severe neuroleptic side effects be escalated to the treating doctor?";
    const bestSource = {
      ...citationFromResult(results[6]!, "deterministic_support"),
      source_strength: "moderate",
      score: 0.8,
      snippet: results[6]!.content,
      section_heading: null,
      image_count: 0,
      viewer_href: "/documents/fallback-document-7",
    } as RagAnswer["bestSource"];
    const candidate = {
      answer: "Any neuroleptic side effect causing distress should be escalated to the treating doctor.",
      grounded: true,
      confidence: "medium",
      citations: results.map((result) => citationFromResult(result, "deterministic_support")),
      sources: results,
      routingMode: "extractive",
      routingReason: "generation_fallback:generation_quality_failed; source_backed_extractive_fallback",
      queryClass,
      answerSections: [
        {
          heading: "Persistent effects",
          body: "If neuroleptic side effects persist, they should be escalated to the treating doctor.",
          citation_chunk_ids: [results[1]!.id],
        },
        {
          heading: "Duplicate answer",
          body: "Any neuroleptic side effect causing distress should be escalated to the treating doctor.",
          citation_chunk_ids: [results[2]!.id],
        },
      ],
      quoteCards: [
        {
          ...citationFromResult(results[3]!, "exact_quote"),
          quote: results[3]!.content,
          section_heading: null,
        },
        {
          ...citationFromResult(results[4]!, "exact_quote"),
          quote: results[4]!.content,
          section_heading: null,
        },
        {
          ...citationFromResult(results[5]!, "exact_quote"),
          quote: results[5]!.content,
          section_heading: null,
        },
        {
          ...citationFromResult(results[6]!, "exact_quote"),
          quote: results[6]!.content,
          section_heading: null,
        },
      ],
      visualEvidence: [
        {
          id: "removed-visual",
          image_id: "removed-image",
          signed_url_endpoint: "/api/images/removed-image/signed-url",
          caption: "This visual is not cited by delivered content.",
          document_id: results[4]!.document_id,
          title: "Removed visual",
          file_name: results[4]!.file_name,
          page_number: 1,
          source_chunk_id: results[4]!.id,
          chunk_index: results[4]!.chunk_index,
          viewer_href: "/documents/fallback-document-5",
        },
      ],
      bestSource,
      conflictsOrGaps: [
        {
          type: "gap",
          message: "Removed source gap.",
          source_chunk_ids: [results[5]!.id],
        },
      ],
      memoryCardsUsed: [
        {
          id: "removed-memory",
          document_id: results[5]!.document_id,
          card_type: "risk",
          title: "Removed memory",
          content: "Not delivered.",
          normalized_terms: [],
          page_number: 1,
          source_chunk_ids: [results[5]!.id],
          source_image_ids: [],
          confidence: 0.8,
        },
      ],
      scoreExplanations: results.map((result) => ({
        chunk_id: result.id,
        document_id: result.document_id,
        finalScore: result.hybrid_score ?? result.similarity,
      })),
      supportedClaims: [
        {
          claimId: "retained-claim",
          text: "Any neuroleptic side effect causing distress should be escalated to the treating doctor.",
          riskClass: "high_risk",
          supportingChunkIds: [results[0]!.id],
          supportStatus: "direct",
        },
        {
          claimId: "removed-claim",
          text: "Removed routine text 7.",
          riskClass: "routine",
          supportingChunkIds: [results[6]!.id],
          supportStatus: "direct",
        },
      ],
      evidenceAssessments: Object.fromEntries(
        results.map((result) => [
          result.id,
          {
            relevance: "direct",
            claimSupport: "direct",
            authority: "unverified",
            currency: "unknown",
            extractionQuality: "unknown",
          },
        ]),
      ),
      smartPanel: {
        query,
        total_sources: results.length,
        documents: [],
        quotes: [],
        visualEvidence: [],
        bestSource,
        image_count: 1,
        evidenceSummary: {
          document_count: results.length,
          total_sources: results.length,
          quote_count: 1,
          image_count: 1,
          source_strength: "moderate",
          summary: "Unpruned evidence.",
        },
        sourceCoverage: {
          documents_used: results.length,
          pages: [1],
          strongest_similarity: 0.95,
          has_images: true,
        },
        conflictsOrGaps: [],
      },
    } as RagAnswer;

    const answer = finalizeRagAnswerQuality(candidate, query, queryClass, results);
    const retainedIds = [results[0]!.id, results[1]!.id, results[3]!.id];

    expect(answer.citations.map((citation) => citation.chunk_id)).toEqual(retainedIds);
    expect(answer.sources.map((result) => result.id)).toEqual(retainedIds);
    expect(answer.answerSections).toEqual([
      expect.objectContaining({ heading: "Persistent effects", citation_chunk_ids: [results[1]!.id] }),
    ]);
    expect(answer.quoteCards?.map((quote) => quote.chunk_id)).toEqual([results[3]!.id]);
    expect(answer.visualEvidence).toEqual([]);
    expect(answer.bestSource).toBeNull();
    expect(answer.conflictsOrGaps).toEqual([]);
    expect(answer.memoryCardsUsed).toEqual([]);
    expect(answer.scoreExplanations?.map((item) => item.chunk_id)).toEqual(retainedIds);
    expect(answer.smartPanel).toMatchObject({ total_sources: 3, image_count: 0, bestSource: null });
    expect(answer.supportedClaims?.some((claim) => /removed routine text/i.test(claim.text))).toBe(false);
    expect(Object.keys(answer.evidenceAssessments ?? {}).sort()).toEqual([...retainedIds].sort());
  });

  it("removes medication-unbound numeric repeat schedules from fallback quote cards", () => {
    const query = "What agitation and arousal dosing guidance applies?";
    const queryClass = "medication_dose_risk" as const;
    const source = figureChunk({
      id: "agitation-repeat-dose-source",
      document_id: "agitation-repeat-dose-document",
      title: "Agitation and Arousal Pharmacological Management",
      file_name: "agitation-and-arousal-pharmacological-management.pdf",
      content:
        "For agitation and arousal, oral doses may be repeated hourly. For agitation and arousal, olanzapine IM maximum is 30 mg in 24 hours.",
    });
    const unsafeQuote = "For agitation and arousal, oral doses may be repeated hourly.";
    const safeQuote = "For agitation and arousal, olanzapine IM maximum is 30 mg in 24 hours.";
    const answer = finalizeRagAnswerQuality(
      {
        answer: safeQuote,
        grounded: true,
        confidence: "medium",
        citations: [citationFromResult(source, "deterministic_support")],
        sources: [source],
        routingMode: "extractive",
        routingReason: "generation_fallback:provider_timeout; source_backed_extractive_fallback",
        queryClass,
        answerSections: [],
        quoteCards: [unsafeQuote, safeQuote].map((quote) => ({
          ...citationFromResult(source, "exact_quote"),
          quote,
          section_heading: null,
        })),
      },
      query,
      queryClass,
      [source],
    );

    expect(answer.grounded).toBe(true);
    expect(answer.citations.map((citation) => citation.chunk_id)).toEqual([source.id]);
    expect(answer.quoteCards?.map((quote) => quote.quote)).toEqual([safeQuote]);
  });

  it("removes uncited smart-plan source links from extractive fallback artifacts", () => {
    const query = "What ANC monitoring is required for clozapine?";
    const queryClass = classifyRagQuery(query).queryClass;
    const routeReason = "generation_fallback:provider_timeout; source_backed_extractive_fallback";
    const kept = figureChunk({
      id: "kept-plan-source",
      document_id: "kept-plan-document",
      title: "Clozapine monitoring guidance",
      content: "Clozapine monitoring requires regular clinical review.",
      similarity: 0.3,
      hybrid_score: 0.3,
    });
    const removed = figureChunk({
      id: "removed-plan-source",
      document_id: "removed-plan-document",
      title: "Clozapine ANC monitoring schedule",
      content: "Clozapine ANC monitoring requires weekly FBC.",
      similarity: 0.95,
      hybrid_score: 0.95,
    });
    const smartApiPlan = buildSmartRagApiPlan({
      query,
      queryClass,
      results: [kept, removed],
      routeMode: "extractive",
      routeReason,
      retrievalStrategy: "hybrid",
    });
    const expectedPlan = buildSmartRagApiPlan({
      query,
      queryClass,
      results: [kept],
      routeMode: "extractive",
      routeReason,
      retrievalStrategy: "hybrid",
    });
    const broadArtifacts = buildSelectedEvidenceArtifacts(query, [kept, removed]);
    const expectedArtifacts = buildSelectedEvidenceArtifacts(query, [kept]);
    const answer = retainCitedExtractiveFallbackEvidence({
      answer: "Keep the cited source.",
      grounded: true,
      confidence: "medium",
      citations: [citationFromResult(kept, "deterministic_support")],
      sources: [kept, removed],
      routingMode: "extractive",
      routingReason: routeReason,
      queryClass,
      smartApiPlan,
      quoteCards: broadArtifacts.quoteCards,
      documentBreakdown: broadArtifacts.documentBreakdown,
      evidenceSummary: broadArtifacts.evidenceSummary,
      sourceCoverage: broadArtifacts.sourceCoverage,
      conflictsOrGaps: broadArtifacts.conflictsOrGaps,
      visualEvidence: broadArtifacts.visualEvidence,
      bestSource: broadArtifacts.bestSource,
      smartPanel: broadArtifacts.smartPanel,
      relevance: broadArtifacts.relevance,
      memoryCardsUsed: broadArtifacts.memoryCardsUsed,
      indexingQuality: broadArtifacts.indexingQuality,
      scoreExplanations: broadArtifacts.scoreExplanations,
    } as RagAnswer);

    expect(answer.sources.map((source) => source.id)).toEqual([kept.id]);
    expect(answer.relevance).toEqual(expectedArtifacts.relevance);
    expect(answer.scoreExplanations).toEqual(expectedArtifacts.scoreExplanations);
    expect(answer.documentBreakdown).toEqual(expectedArtifacts.documentBreakdown);
    expect(answer.evidenceSummary).toEqual(expectedArtifacts.evidenceSummary);
    expect(answer.sourceCoverage).toEqual(expectedArtifacts.sourceCoverage);
    expect(answer.bestSource).toBeNull();
    expect(answer.memoryCardsUsed).toEqual(expectedArtifacts.memoryCardsUsed);
    expect(answer.indexingQuality).toEqual(expectedArtifacts.indexingQuality);
    expect(answer.smartPanel).toMatchObject({
      total_sources: 1,
      relevance: expectedArtifacts.relevance,
      bestSource: null,
    });
    expect(answer.smartApiPlan).toEqual(expectedPlan);
    const retainedPlan = answer.smartApiPlan!;
    expect(retainedPlan.answerPlan.sourceSelection.selectedCount).toBe(1);
    expect(retainedPlan.answerPlan.retrievalQuality).toBe(expectedPlan.answerPlan.retrievalQuality);
    expect(retainedPlan.answerPlan.sourceSelection.matchedSignals).toEqual(
      expectedPlan.answerPlan.sourceSelection.matchedSignals,
    );
    expect(retainedPlan.answerPlan.sourceSelection.missingRequiredSignals).toEqual(
      expectedPlan.answerPlan.sourceSelection.missingRequiredSignals,
    );
  });

  it("keeps top-level and smart-panel related documents aligned to cited fallback sources", () => {
    const kept = figureChunk({ id: "kept-related-source", document_id: "kept-related-document" });
    const removed = figureChunk({ id: "removed-related-source", document_id: "removed-related-document" });
    const relatedDocuments = [kept, removed].map((source) => ({
      document_id: source.document_id,
      title: source.title,
      file_name: source.file_name,
      labels: [],
      summary: null,
      best_pages: [source.page_number ?? 1],
      best_chunk_ids: [source.id],
      image_count: 0,
      match_reason: "Direct source match",
      score: source.hybrid_score,
    }));
    const answer = retainCitedExtractiveFallbackEvidence({
      answer: "Keep the cited source.",
      grounded: true,
      confidence: "medium",
      citations: [citationFromResult(kept, "deterministic_support")],
      sources: [kept, removed],
      relatedDocuments,
      smartPanel: { relatedDocuments },
    } as unknown as RagAnswer);

    expect(answer.relatedDocuments?.map((document) => document.document_id)).toEqual([kept.document_id]);
    expect(answer.relatedDocuments?.[0]?.best_chunk_ids).toEqual([kept.id]);
    expect(answer.smartPanel?.relatedDocuments).toEqual(answer.relatedDocuments);
  });

  it("rebuilds late related-document metadata from only the cited same-document source", () => {
    const kept = figureChunk({
      id: "kept-same-document-source",
      document_id: "shared-related-document",
      page_number: 3,
      similarity: 0.61,
      hybrid_score: 0.63,
      images: [],
    });
    const removed = figureChunk({
      id: "removed-same-document-source",
      document_id: "shared-related-document",
      page_number: 9,
      similarity: 0.98,
      hybrid_score: 0.99,
      images: [
        {
          id: "removed-related-image",
          page_number: 9,
          storage_path: "removed-related-image.png",
          caption: "Removed clinical table",
          image_type: "clinical_table",
          searchable: true,
          clinical_relevance_score: 1,
        },
      ],
    });
    const relatedDocuments = [
      {
        document_id: kept.document_id,
        title: kept.title,
        file_name: kept.file_name,
        labels: [],
        summary: null,
        best_pages: [removed.page_number ?? 1, kept.page_number ?? 1],
        best_chunk_ids: [removed.id],
        image_count: 1,
        match_reason: "Matched 2 indexed passages",
        score: removed.hybrid_score ?? removed.similarity,
      },
    ];
    const expectedRelatedDocuments = retainRelatedDocumentsForResults(relatedDocuments, [kept]);
    const answer = retainCitedExtractiveFallbackEvidence({
      answer: "Keep the cited passage only.",
      grounded: true,
      confidence: "medium",
      citations: [citationFromResult(kept, "deterministic_support")],
      sources: [kept, removed],
      relatedDocuments,
      smartPanel: { relatedDocuments },
    } as unknown as RagAnswer);

    expect(answer.relatedDocuments).toEqual(expectedRelatedDocuments);
    expect(answer.smartPanel?.relatedDocuments).toEqual(expectedRelatedDocuments);
    expect(answer.relatedDocuments).toEqual([
      expect.objectContaining({
        best_pages: [3],
        best_chunk_ids: [kept.id],
        image_count: 0,
        match_reason: "Matched 1 indexed passage",
        score: kept.hybrid_score ?? kept.similarity,
      }),
    ]);
    expect(JSON.stringify(answer.relatedDocuments)).not.toMatch(
      /removed-same-document-source|removed-related-image|0\.99/,
    );
  });

  it("retains the correctly bound escalation clause from a mixed-medication chunk", () => {
    const mixedSource = figureChunk({
      id: "mixed-medication-escalation",
      document_id: "mixed-medication-document",
      title: "Medication escalation guidance",
      file_name: "medication-escalation-guidance.pdf",
      content:
        "If clozapine side effects cause distress, contact the treating doctor for prompt review. If lithium toxicity is suspected, arrange urgent lithium assessment.",
    });
    const answer = finalizeRagAnswerQuality(
      {
        answer: "If clozapine side effects cause distress, contact the treating doctor for prompt review.",
        grounded: true,
        confidence: "medium",
        citations: [citationFromResult(mixedSource, "deterministic_support")],
        sources: [mixedSource],
        routingMode: "extractive",
        routingReason: "generation_fallback:generation_quality_failed; source_backed_extractive_fallback",
        queryClass,
        answerSections: [],
        quoteCards: [
          {
            ...citationFromResult(mixedSource, "exact_quote"),
            quote: "If clozapine side effects cause distress, contact the treating doctor for prompt review.",
            section_heading: null,
          },
        ],
      },
      "When should clozapine side effects be escalated?",
      queryClass,
      [mixedSource],
    );

    expect(answer.grounded).toBe(true);
    expect(answer.citations.map((citation) => citation.chunk_id)).toEqual([mixedSource.id]);
    expect(answer.quoteCards?.map((quote) => quote.chunk_id)).toEqual([mixedSource.id]);
  });

  it("uses trusted title context to bind a generic escalation clause to a named medication", () => {
    const clozapineSource = figureChunk({
      id: "clozapine-title-context",
      document_id: "clozapine-title-document",
      title: "Clozapine Side Effects",
      file_name: "clozapine-side-effects.pdf",
      content: "Any side effect causing distress should be escalated to the treating doctor.",
    });
    const answer = finalizeRagAnswerQuality(
      {
        answer: "Any clozapine side effect causing distress should be escalated to the treating doctor.",
        grounded: true,
        confidence: "medium",
        citations: [citationFromResult(clozapineSource, "deterministic_support")],
        sources: [clozapineSource],
        routingMode: "extractive",
        routingReason: "generation_fallback:generation_quality_failed; source_backed_extractive_fallback",
        queryClass,
        answerSections: [],
        quoteCards: [
          {
            ...citationFromResult(clozapineSource, "exact_quote"),
            quote: clozapineSource.content,
            section_heading: null,
          },
        ],
      },
      "When should clozapine side effects be escalated?",
      queryClass,
      [clozapineSource],
    );

    expect(answer.grounded).toBe(true);
    expect(answer.citations.map((citation) => citation.chunk_id)).toEqual([clozapineSource.id]);
    expect(answer.quoteCards?.map((quote) => quote.chunk_id)).toEqual([clozapineSource.id]);
  });

  it("drops a named-medication quote that would overgeneralize to all neuroleptics", () => {
    const neurolepticSource = figureChunk({
      id: "neuroleptic-direct-rule",
      document_id: "neuroleptic-direct-document",
      title: "Neuroleptic Side Effects",
      file_name: "neuroleptic-side-effects.pdf",
      content: "Any neuroleptic side effect causing distress should be escalated to the treating doctor.",
    });
    const lithiumSource = figureChunk({
      id: "lithium-specific-rule",
      document_id: "lithium-specific-document",
      title: "Lithium Side Effects",
      file_name: "lithium-side-effects.pdf",
      content: "If severe lithium side effects occur, contact the treating doctor for prompt review.",
    });
    const answer = finalizeRagAnswerQuality(
      {
        answer: neurolepticSource.content,
        grounded: true,
        confidence: "medium",
        citations: [
          citationFromResult(neurolepticSource, "deterministic_support"),
          citationFromResult(lithiumSource, "deterministic_support"),
        ],
        sources: [neurolepticSource, lithiumSource],
        routingMode: "extractive",
        routingReason: "generation_fallback:generation_quality_failed; source_backed_extractive_fallback",
        queryClass,
        answerSections: [],
        quoteCards: [
          {
            ...citationFromResult(lithiumSource, "exact_quote"),
            quote: lithiumSource.content,
            section_heading: null,
          },
        ],
      },
      query,
      queryClass,
      [neurolepticSource, lithiumSource],
    );

    expect(answer.grounded).toBe(true);
    expect(answer.citations.map((citation) => citation.chunk_id)).toEqual([neurolepticSource.id]);
    expect(answer.quoteCards).toEqual([]);
  });

  it("rejects escalation prose hidden behind historical title or preceding audit context", () => {
    const content = "Severe neuroleptic side effects should be escalated to the treating doctor.";
    const candidateFor = (source: SearchResult, answerText = content, candidateClass: RagQueryClass = queryClass) =>
      ({
        answer: answerText,
        grounded: true,
        confidence: "medium",
        citations: [citationFromResult(source, "deterministic_support")],
        sources: [source],
        routingMode: "extractive",
        routingReason: "generation_fallback:generation_quality_failed; source_backed_extractive_fallback",
        queryClass: candidateClass,
        answerSections: [],
        quoteCards: [
          {
            ...citationFromResult(source, "exact_quote"),
            quote: answerText,
            section_heading: source.section_heading,
          },
        ],
      }) as RagAnswer;
    const auditSource = figureChunk({
      id: "historical-audit-title",
      title: "2024 Audit of Neuroleptic Side-effect Escalation",
      content,
    });
    const currentSource = figureChunk({
      id: "current-guideline-title",
      title: "Current Neuroleptic Side-effect Guideline",
      content,
    });
    const currentComplianceAuditSource = figureChunk({
      id: "current-compliance-audit-context",
      title: "Current Neuroleptic Side-effect Guideline",
      content: `${content} Compliance with this requirement is reviewed in the annual clinical audit.`,
    });
    const followingHistoricalAnaphoraSources = [
      figureChunk({
        id: "following-this-historical-anaphora",
        title: "Neuroleptic Side Effects",
        content: `${content} This was recorded in the 2024 audit.`,
      }),
      figureChunk({
        id: "following-it-historical-anaphora",
        title: "Neuroleptic Side Effects",
        content: `${content} It was reported in the 2024 audit.`,
      }),
      figureChunk({
        id: "following-it-recommendation-historical-anaphora",
        title: "Neuroleptic Side Effects",
        content: `${content} It was the recommendation recorded in a historical audit.`,
      }),
      figureChunk({
        id: "following-this-based-on-historical-anaphora",
        title: "Neuroleptic Side Effects",
        content: `${content} This was based on a historical audit.`,
      }),
      figureChunk({
        id: "following-it-came-from-historical-anaphora",
        title: "Neuroleptic Side Effects",
        content: `${content} It came from a retrospective study.`,
      }),
      figureChunk({
        id: "following-recommendation-came-from-historical-anaphora",
        title: "Neuroleptic Side Effects",
        content: `${content} The recommendation came from an earlier audit.`,
      }),
      figureChunk({
        id: "following-those-observed-historical-anaphora",
        title: "Neuroleptic Side Effects",
        content: `${content} Those were observed in the historical review.`,
      }),
      figureChunk({
        id: "following-its-origin-historical-anaphora",
        title: "Neuroleptic Side Effects",
        content: `${content} Its origin was a historical audit.`,
      }),
      figureChunk({
        id: "following-source-for-recommendation-historical-anaphora",
        title: "Neuroleptic Side Effects",
        content: `${content} The source for this recommendation was a retrospective study.`,
      }),
      figureChunk({
        id: "following-rule-originated-historical-anaphora",
        title: "Neuroleptic Side Effects",
        content: `${content} The rule originated in an earlier audit.`,
      }),
      figureChunk({
        id: "following-its-provenance-historical-anaphora",
        title: "Neuroleptic Side Effects",
        content: `${content} Its provenance was an archived protocol.`,
      }),
      figureChunk({
        id: "following-source-label-historical-anaphora",
        title: "Neuroleptic Side Effects",
        content: `${content} Source: historical audit.`,
      }),
    ];
    const precedingAuditSource = figureChunk({
      id: "preceding-audit-context",
      title: "Neuroleptic Side Effects",
      content: `The 2024 audit reviewed staff responses to neuroleptic side effects. ${content}`,
      retrieval_synopsis: content,
    });
    const auditFilenameSource = figureChunk({
      id: "audit-filename-context",
      title: "Neuroleptic Side Effects",
      file_name: "2024_Audit-of-Neuroleptic-Escalation.docx",
      content,
    });
    const auditSectionPathSource = figureChunk({
      id: "audit-section-path-context",
      title: "Neuroleptic Side Effects",
      section_heading: null,
      section_path: ["Appendices", "Historical audit"],
      content,
    });
    const staleProvenanceSources = [
      figureChunk({
        id: "archived-guidance-section-path",
        title: "Neuroleptic Side Effects",
        section_path: ["Archived guidance"],
        content,
      }),
      figureChunk({
        id: "previous-recommendations-section-path",
        title: "Neuroleptic Side Effects",
        section_path: ["Previous recommendations"],
        content,
      }),
      figureChunk({
        id: "superseded-procedure-index-path",
        title: "Neuroleptic Side Effects",
        content,
        index_unit: {
          id: "superseded-procedure-index-unit",
          unit_type: "section",
          title: "Escalation",
          content,
          source_chunk_id: "superseded-procedure-index-path",
          source_image_id: null,
          page_start: 2,
          page_end: 2,
          heading_path: ["Superseded procedure"],
          normalized_terms: [],
          quality_score: 1,
          extraction_mode: "deterministic",
        },
      }),
      figureChunk({
        id: "former-standard-section-path",
        title: "Neuroleptic Side Effects",
        section_path: ["Former standard"],
        content,
      }),
      figureChunk({
        id: "legacy-escalation-criteria-section-path",
        title: "Neuroleptic Side Effects",
        section_path: ["Legacy escalation criteria"],
        content,
      }),
      figureChunk({
        id: "archived-appendix-section-heading",
        title: "Neuroleptic Side Effects",
        section_heading: "Archived appendix",
        content,
      }),
      figureChunk({
        id: "withdrawn-escalation-criteria-parent-heading",
        title: "Neuroleptic Side Effects",
        parent_heading: "Withdrawn escalation criteria",
        content,
      }),
      figureChunk({
        id: "superseded-escalation-rules-index-path",
        title: "Neuroleptic Side Effects",
        content,
        index_unit: {
          id: "superseded-escalation-rules-index-unit",
          unit_type: "section",
          title: "Escalation",
          content,
          source_chunk_id: "superseded-escalation-rules-index-path",
          source_image_id: null,
          page_start: 2,
          page_end: 2,
          heading_path: ["Superseded escalation rules"],
          normalized_terms: [],
          quality_score: 1,
          extraction_mode: "deterministic",
        },
      }),
    ];
    const distantAuditContextSource = figureChunk({
      id: "distant-audit-context",
      title: "Neuroleptic Side Effects",
      content: `Historical audit findings. Staff education was reviewed. ${content}`,
    });
    const blankLineAuditSources = [
      figureChunk({
        id: "blank-line-audit-heading",
        title: "Neuroleptic Side Effects",
        content: `Historical audit findings.\n\n${content}`,
      }),
      figureChunk({
        id: "blank-line-dated-audit",
        title: "Neuroleptic Side Effects",
        content: `The 2024 audit reviewed practice.\n\n${content}`,
      }),
    ];
    const equivalentHistoricalSources = [
      {
        query: "When should neuroleptic side effects be reported to the treating doctor?",
        answerText: "Severe neuroleptic side effects should be reported to the treating doctor.",
        source: figureChunk({
          id: "historical-reported-equivalent",
          title: "Neuroleptic Side Effects",
          content:
            "The 2024 audit recorded how staff responded to side effects. Severe neuroleptic side effects should be reported to the treating doctor.",
        }),
      },
      {
        query: "When should I contact the treating doctor about neuroleptic side effects?",
        answerText: "Staff should contact the treating doctor about severe neuroleptic side effects.",
        source: figureChunk({
          id: "historical-contact-equivalent",
          title: "Neuroleptic Side Effects",
          content:
            "The 2024 audit recorded how staff responded to side effects. Staff should contact the treating doctor about severe neuroleptic side effects.",
        }),
      },
    ];
    const documentContactSource = figureChunk({
      id: "document-contact-control",
      title: "Document access contacts",
      content: "The 2024 audit recorded document access contacts. Contact the records office about document access.",
    });

    const auditAnswer = finalizeRagAnswerQuality(candidateFor(auditSource), query, queryClass, [auditSource]);
    const precedingAuditAnswer = finalizeRagAnswerQuality(candidateFor(precedingAuditSource), query, queryClass, [
      precedingAuditSource,
    ]);
    const auditFilenameAnswer = finalizeRagAnswerQuality(candidateFor(auditFilenameSource), query, queryClass, [
      auditFilenameSource,
    ]);
    const auditSectionPathAnswer = finalizeRagAnswerQuality(candidateFor(auditSectionPathSource), query, queryClass, [
      auditSectionPathSource,
    ]);
    const distantAuditContextAnswer = finalizeRagAnswerQuality(
      candidateFor(distantAuditContextSource),
      query,
      queryClass,
      [distantAuditContextSource],
    );
    const currentAnswer = finalizeRagAnswerQuality(candidateFor(currentSource), query, queryClass, [currentSource]);
    const currentComplianceAuditAnswer = finalizeRagAnswerQuality(
      candidateFor(currentComplianceAuditSource),
      query,
      queryClass,
      [currentComplianceAuditSource],
    );

    expect(auditAnswer).toMatchObject({ grounded: false, confidence: "unsupported", responseMode: "evidence_gap" });
    expect(auditAnswer.citations).toEqual([]);
    expect(auditAnswer.quoteCards).toEqual([]);
    expect(precedingAuditAnswer).toMatchObject({
      grounded: false,
      confidence: "unsupported",
      responseMode: "evidence_gap",
    });
    expect(precedingAuditAnswer.citations).toEqual([]);
    expect(precedingAuditAnswer.quoteCards).toEqual([]);
    expect(auditFilenameAnswer).toMatchObject({
      grounded: false,
      confidence: "unsupported",
      responseMode: "evidence_gap",
    });
    expect(auditFilenameAnswer.citations).toEqual([]);
    expect(auditFilenameAnswer.quoteCards).toEqual([]);
    const blankLineAuditAnswers = blankLineAuditSources.map((source) =>
      finalizeRagAnswerQuality(candidateFor(source), query, queryClass, [source]),
    );
    const followingHistoricalAnaphoraAnswers = followingHistoricalAnaphoraSources.map((source) =>
      finalizeRagAnswerQuality(candidateFor(source), query, queryClass, [source]),
    );
    const staleProvenanceAnswers = staleProvenanceSources.map((source) =>
      finalizeRagAnswerQuality(candidateFor(source), query, queryClass, [source]),
    );
    for (const historicalAnswer of [
      auditSectionPathAnswer,
      distantAuditContextAnswer,
      ...blankLineAuditAnswers,
      ...followingHistoricalAnaphoraAnswers,
      ...staleProvenanceAnswers,
    ]) {
      expect(historicalAnswer, historicalAnswer.sources[0]?.id ?? "unknown historical source").toMatchObject({
        grounded: false,
        confidence: "unsupported",
        responseMode: "evidence_gap",
      });
      expect(historicalAnswer.citations).toEqual([]);
      expect(historicalAnswer.quoteCards).toEqual([]);
    }
    for (const equivalent of equivalentHistoricalSources) {
      const equivalentAnswer = finalizeRagAnswerQuality(
        candidateFor(equivalent.source, equivalent.answerText),
        equivalent.query,
        queryClass,
        [equivalent.source],
      );
      expect(equivalentAnswer).toMatchObject({
        grounded: false,
        confidence: "unsupported",
        responseMode: "evidence_gap",
      });
      expect(equivalentAnswer.citations).toEqual([]);
      expect(equivalentAnswer.quoteCards).toEqual([]);
    }
    const documentContactAnswer = finalizeRagAnswerQuality(
      candidateFor(documentContactSource, "Contact the records office about document access.", "document_lookup"),
      "Who should I contact about document access?",
      "document_lookup",
      [documentContactSource],
    );
    expect(documentContactAnswer.grounded).toBe(true);
    expect(documentContactAnswer.citations.map((citation) => citation.chunk_id)).toEqual([documentContactSource.id]);
    expect(currentAnswer.grounded).toBe(true);
    expect(currentAnswer.citations.map((citation) => citation.chunk_id)).toEqual([currentSource.id]);
    expect(currentAnswer.quoteCards?.map((quote) => quote.chunk_id)).toEqual([currentSource.id]);
    expect(currentComplianceAuditAnswer.grounded).toBe(true);
    expect(currentComplianceAuditAnswer.citations.map((citation) => citation.chunk_id)).toEqual([
      currentComplianceAuditSource.id,
    ]);
  });
});

describe("maximum-dose evidence", () => {
  it("accepts equivalent numeric limit wording without accepting an unrelated dose", () => {
    expect(hasMaximumDoseEvidence("Olanzapine may be increased up to 20 mg daily.")).toBe(true);
    expect(hasMaximumDoseEvidence("The total daily dose must not exceed 20 mg.")).toBe(true);
    expect(hasMaximumDoseEvidence("The dose is not to exceed 200 mg/day.")).toBe(true);
    expect(hasMaximumDoseEvidence("Use not more than 200 mg daily.")).toBe(true);
    expect(hasMaximumDoseEvidence("Use no more than 2 tablets daily.")).toBe(true);
    expect(hasMaximumDoseEvidence("The total daily dose must not exceed 20 milligrams.")).toBe(true);
    expect(hasMaximumDoseEvidence("Use at most 500 micrograms daily.")).toBe(true);
    expect(hasMaximumDoseEvidence("Limit the dose to 5 millilitres daily.")).toBe(true);
    expect(hasMaximumDoseEvidence("Use no more than 10 international units daily.")).toBe(true);
    expect(hasMaximumDoseEvidence("The maximum recommended daily dose is 20 mg.")).toBe(true);
    expect(hasMaximumDoseEvidence("The maximum is 20 mg daily.")).toBe(true);
    expect(hasMaximumDoseEvidence("The starting dose is 5 mg daily.")).toBe(false);
    expect(hasMaximumDoseEvidence("Lithium has a maximum treatment duration of two years.")).toBe(false);
  });
});

// Regression for the live source-only answer that rendered as:
// "For lithium, twice daily dosing should be spaced by 12 hours. The guidance
// is that for lithium, acute Mania: o IR product: 750 to 1000mg daily in 2 or
// 3 divided doses or as a single dose at night."
// — a literal Word/PDF sub-bullet "o" glyph in the answer body, the section
// heading glued mid-sentence, and the query entity stitched in twice.
describe("extractive evidence splitting", () => {
  const lithiumPassage =
    "Twice daily dosing should be spaced by 12 hours. Acute Mania: o IR product: 750 to 1000mg daily in 2 or 3 divided doses or as a single dose at night.";

  it("treats the sub-bullet 'o' glyph as a fact boundary instead of leaving it mid-sentence", () => {
    const sentences = splitClinicalEvidenceSentences(lithiumPassage);
    expect(sentences.length).toBeGreaterThan(0);
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/\bo\s+[A-Z]/);
      expect(sentence).not.toContain("Mania: o");
    }
  });

  it("keeps the indication heading as context on the dose fact instead of dropping it", () => {
    const sentences = splitClinicalEvidenceSentences(lithiumPassage);
    const doseFact = sentences.find((sentence) => sentence.includes("750 to 1000mg"));
    expect(doseFact).toBeDefined();
    expect(doseFact).toMatch(/acute mania/i);
  });

  it("rewrites a leading heading colon into readable context", () => {
    const sentences = splitClinicalEvidenceSentences(
      "Renal Impairment: o Reduce the maintenance dose and monitor levels closely.",
    );
    expect(sentences.some((sentence) => /^For renal impairment,/i.test(sentence))).toBe(true);
  });

  it("keeps a directive heading attached to its bullet item", () => {
    const sentences = splitClinicalEvidenceSentences(
      "Do not use: o Pregnancy or breastfeeding without specialist advice.",
    );
    const contraindication = sentences.find((sentence) => /pregnancy/i.test(sentence));
    expect(contraindication).toBeDefined();
    expect(contraindication).toMatch(/^Do not use:/i);
  });

  it("keeps digit-bearing schedule headings attached to their dose items", () => {
    const daySentences = splitClinicalEvidenceSentences("Day 1: o 25 mg nightly before considering an increase.");
    const dayDose = daySentences.find((sentence) => sentence.includes("25 mg"));
    expect(dayDose).toBeDefined();
    expect(dayDose).toMatch(/^Day 1\b/);
    expect(dayDose).not.toMatch(/\bo\s+\d/);

    const stepSentences = splitClinicalEvidenceSentences("Step 2: o Increase to 50 mg nightly if tolerated.");
    const stepDose = stepSentences.find((sentence) => sentence.includes("50 mg"));
    expect(stepDose).toBeDefined();
    expect(stepDose).toMatch(/^Step 2\b/);
    expect(stepDose).not.toMatch(/\bo\s+[A-Z0-9]/);
  });

  it("preserves a newline boundary before bare sub-bullets after numeric headings", () => {
    const sentences = splitClinicalEvidenceSentences("Step 1\no Start at 12.5 mg nightly and review tomorrow.");
    expect(sentences.some((sentence) => sentence.includes("Start at 12.5 mg"))).toBe(true);
    expect(sentences.join(" ")).not.toMatch(/\bo\s+Start\b/);
  });

  it("keeps comparator threshold headings attached to their action items", () => {
    const renal = splitClinicalEvidenceSentences("eGFR <30: o Reduce the maintenance dose to 500 mg daily.").find(
      (sentence) => sentence.includes("500 mg"),
    );
    expect(renal).toBeDefined();
    expect(renal).toMatch(/^eGFR <30:/);

    const anc = splitClinicalEvidenceSentences("ANC <0.5: o Withhold clozapine and repeat FBC tomorrow.").find(
      (sentence) => /withhold clozapine/i.test(sentence),
    );
    expect(anc).toBeDefined();
    expect(anc).toMatch(/^ANC <0\.5:/);
  });

  it("keeps clinical section headings while excluding structural section labels", () => {
    const caesarean = splitClinicalEvidenceSentences(
      "Caesarean section: o Give antibiotic prophylaxis before skin incision.",
    ).find((sentence) => /antibiotic prophylaxis/i.test(sentence));
    expect(caesarean).toBeDefined();
    expect(caesarean).toMatch(/caesarean section/i);
  });

  it("keeps reference-range headings attached to their numeric items", () => {
    const range = splitClinicalEvidenceSentences(
      "Reference range: o 0.6-1.0 mmol/L for maintenance lithium therapy.",
    ).find((sentence) => sentence.includes("0.6-1.0 mmol/L"));
    expect(range).toBeDefined();
    expect(range).toMatch(/reference range/i);
  });

  it("keeps the clinical source-control heading attached to its action item", () => {
    const sourceControl = splitClinicalEvidenceSentences(
      "Source control: o Review antibiotics and arrange drainage within six hours.",
    ).find((sentence) => /review antibiotics/i.test(sentence));
    expect(sourceControl).toBeDefined();
    expect(sourceControl).toMatch(/source control/i);
  });

  it("keeps plus-bearing electrolyte thresholds attached to their action items", () => {
    const potassium = splitClinicalEvidenceSentences(
      "K+ >5.5 mmol/L: o Withhold the next dose and recheck electrolytes.",
    ).find((sentence) => /withhold/i.test(sentence));
    expect(potassium).toBeDefined();
    expect(potassium).toMatch(/^K\+ >5\.5 mmol\/L:/);
  });

  it("keeps degree and micro threshold headings attached to their action items", () => {
    const temperature = splitClinicalEvidenceSentences(
      "Temp ≥38°C: o Contact the treating team and repeat observations.",
    ).find((sentence) => /contact the treating team/i.test(sentence));
    expect(temperature).toBeDefined();
    expect(temperature).toMatch(/^Temp ≥38°C:/);
  });

  it("keeps numeric time-window headings attached to their restart items", () => {
    const restart = splitClinicalEvidenceSentences("48-72 hours: o Restart clozapine at 12.5 mg and review.").find(
      (sentence) => sentence.includes("12.5 mg"),
    );
    expect(restart).toBeDefined();
    expect(restart).toMatch(/^48-72 hours:/i);
    expect(restart).not.toMatch(/\bo\s+[A-Z0-9]/);
  });

  it("merges lowercase headings with their bullet items", () => {
    const contraindication = splitClinicalEvidenceSentences(
      "do not use: o Pregnancy or breastfeeding without specialist advice.",
    ).find((sentence) => /pregnancy/i.test(sentence));
    expect(contraindication).toBeDefined();
    expect(contraindication).toMatch(/^do not use:/i);

    const schedule = splitClinicalEvidenceSentences("day 1: o 25 mg nightly before considering an increase.").find(
      (sentence) => sentence.includes("25 mg"),
    );
    expect(schedule).toBeDefined();
    expect(schedule).toMatch(/^day 1\b/i);
    expect(schedule).not.toMatch(/\bo\s+\d/);
  });

  it("keeps an advisory heading attached to its bullet item in colon form", () => {
    const sentences = splitClinicalEvidenceSentences(
      "Caution: o Pregnancy or breastfeeding requires specialist advice before dosing.",
    );
    const caveat = sentences.find((sentence) => /pregnancy/i.test(sentence));
    expect(caveat).toBeDefined();
    expect(caveat).toMatch(/^Caution:/i);
  });

  it("keeps a directive dose heading in colon form instead of a copula rewrite", () => {
    const avoidance = splitClinicalEvidenceSentences(
      "Avoid: o 12.5 mg after a treatment interruption of two days.",
    ).find((sentence) => sentence.includes("12.5 mg"));
    expect(avoidance).toBeDefined();
    expect(avoidance).toMatch(/^Avoid: 12\.5 mg/);
    expect(avoidance).not.toMatch(/Avoid is/);
  });

  it("keeps a directive heading's colon form instead of rewriting it as noun context", () => {
    const sentences = splitClinicalEvidenceSentences("Avoid: o Pregnancy in the first trimester of treatment.");
    const avoidance = sentences.find((sentence) => /pregnancy/i.test(sentence));
    expect(avoidance).toBeDefined();
    expect(avoidance).not.toMatch(/^For avoid,/i);
    expect(avoidance).toMatch(/^Avoid:/i);
  });

  it("does not rewrite a preposition-ended colon phrase as a dose label", () => {
    const sentences = splitClinicalEvidenceSentences(
      "If tolerated poorly, reduce the total daily dose to: 500mg at night and review within one week.",
    );
    const doseSentence = sentences.find((sentence) => sentence.includes("500mg"));
    expect(doseSentence).toBeDefined();
    expect(doseSentence).not.toMatch(/to is 500mg/);
  });
});

describe("extractive sentence stitching", () => {
  it("never duplicates the query entity across the prefix and the guidance wrapper", () => {
    const sentence = sentenceFromFact(
      {
        kind: "dose",
        text: "twice daily dosing should be spaced by 12 hours",
        citationChunkIds: ["chunk-1"],
        priority: 1,
      },
      "lithium dosing",
    );
    expect(sentence).toBeTruthy();
    expect(sentence).not.toMatch(/that for lithium/i);
    expect((sentence.match(/lithium/gi) ?? []).length).toBeLessThanOrEqual(1);
  });

  it("does not prefix the entity when the fact already names it", () => {
    const sentence = sentenceFromFact(
      {
        kind: "monitoring",
        text: "lithium levels should be checked 5 to 7 days after any dose change",
        citationChunkIds: ["chunk-1"],
        priority: 1,
      },
      "lithium monitoring",
    );
    expect(sentence).toBeTruthy();
    expect((sentence.match(/lithium/gi) ?? []).length).toBe(1);
  });

  it("suppresses the entity prefix when asked so lead answers do not repeat it", () => {
    const sentence = sentenceFromFact(
      {
        kind: "dose",
        text: "twice daily dosing should be spaced by 12 hours",
        citationChunkIds: ["chunk-1"],
        priority: 1,
      },
      "lithium dosing",
      { suppressEntityPrefix: true },
    );
    expect(sentence).toBeTruthy();
    expect(sentence).not.toMatch(/lithium/i);
  });
});

describe("extractive answer end to end", () => {
  it("uses equivalent maximum-dose wording even when the source omits maximum and dose tokens", () => {
    const result = {
      id: "olanzapine-chunk-1",
      document_id: "olanzapine-doc",
      title: "Olanzapine Prescribing Guideline",
      file_name: "Olanzapine Prescribing Guideline.pdf",
      page_number: 4,
      chunk_index: 3,
      section_heading: "Maintenance",
      content: "Olanzapine may be increased up to 20 milligrams daily.",
      image_ids: [],
      similarity: 0.91,
      hybrid_score: 0.95,
      images: [],
    } as unknown as SearchResult;

    const answer = buildExtractiveAnswer({
      query: "What is the maximum olanzapine dose?",
      queryClass: "medication_dose_risk",
      results: [result],
      quoteCards: [],
      documentBreakdown: [] as RagAnswer["documentBreakdown"],
      evidenceSummary: undefined as unknown as RagAnswer["evidenceSummary"],
      sourceCoverage: undefined as unknown as RagAnswer["sourceCoverage"],
      conflictsOrGaps: [],
      visualEvidence: [] as unknown as RagAnswer["visualEvidence"],
      bestSource: undefined as unknown as RagAnswer["bestSource"],
      smartPanel: undefined as unknown as RagAnswer["smartPanel"],
      relatedDocuments: [] as unknown as RagAnswer["relatedDocuments"],
      routeReason: "demo",
      timings: undefined as unknown as RagAnswer["latencyTimings"],
    });

    expect((answer.answer ?? "").replace(/\*\*/g, "")).toMatch(/up to 20 milligrams daily/i);
  });

  it("renders the lithium source-only case cleanly through buildExtractiveAnswer", () => {
    const result = {
      id: "lithium-chunk-1",
      document_id: "lithium-doc",
      title: "Lithium Therapy Guideline",
      file_name: "Lithium Therapy Guideline.pdf",
      page_number: 3,
      chunk_index: 2,
      section_heading: "Dosing",
      content:
        "Twice daily dosing should be spaced by 12 hours. Acute Mania: o IR product: 750 to 1000mg daily in 2 or 3 divided doses or as a single dose at night.",
      image_ids: [],
      similarity: 0.88,
      hybrid_score: 0.93,
      images: [],
    } as unknown as SearchResult;

    const answer = buildExtractiveAnswer({
      query: "lithium dosing",
      queryClass: "medication_dose_risk",
      results: [result],
      quoteCards: [],
      documentBreakdown: [] as RagAnswer["documentBreakdown"],
      evidenceSummary: undefined as unknown as RagAnswer["evidenceSummary"],
      sourceCoverage: undefined as unknown as RagAnswer["sourceCoverage"],
      conflictsOrGaps: [],
      visualEvidence: [] as unknown as RagAnswer["visualEvidence"],
      bestSource: undefined as unknown as RagAnswer["bestSource"],
      smartPanel: undefined as unknown as RagAnswer["smartPanel"],
      relatedDocuments: [] as unknown as RagAnswer["relatedDocuments"],
      routeReason: "demo",
      timings: undefined as unknown as RagAnswer["latencyTimings"],
    });

    const plain = (answer.answer ?? "").replace(/\*\*/g, "");
    expect(plain).not.toMatch(/\bo\s+[A-Z]/);
    expect(plain).not.toMatch(/that for lithium/i);
    expect(plain).toMatch(/^For lithium, twice daily dosing should be spaced by 12 hours\./);
    expect(plain).toMatch(/For acute mania, IR product is 750 to 1000mg daily/);
  });
});

// E-3c PR-C: dose and monitoring answers must carry the asked-for figure or
// schedule in the lead whenever a cited chunk verbatim supports it. The fact
// sorter orders same-priority facts shortest-first, so a terse figure-less
// sentence used to displace the sentence holding the actual dose or interval.
describe("figure-aware extractive lead selection", () => {
  it("promotes the schedule-bearing monitoring fact into the lead over a shorter figure-less fact", () => {
    const answer = extractiveAnswerFor("What metabolic monitoring is required for antipsychotics?", [
      figureChunk({
        id: "metabolic-chunk-1",
        section_heading: "Metabolic monitoring",
        content:
          "Metabolic monitoring is required for all patients prescribed antipsychotics. Weight, blood pressure, fasting glucose and lipids are monitored at baseline, at 3 months, then annually.",
      }),
    ]);

    const plain = (answer.answer ?? "").replace(/\*\*/g, "");
    expect(answer.grounded).toBe(true);
    expect(plain).toMatch(/baseline|annually/);
    expect(plain).toMatch(/3 months/);
  });

  it("swaps the dose figure fact into the last dose lead slot when both lead slots are figure-less", () => {
    const answer = extractiveAnswerFor("What is the quetiapine dose?", [
      figureChunk({
        id: "quetiapine-dose-chunk-1",
        content:
          "Quetiapine doses must be taken daily. Quetiapine doses should be reviewed daily. The maximum recommended quetiapine dose is 200 mg daily.",
      }),
    ]);

    const plain = (answer.answer ?? "").replace(/\*\*/g, "");
    expect(answer.grounded).toBe(true);
    expect(plain).toContain("200 mg");
    // The first lead slot keeps the top-ranked fact; only the last slot swaps.
    expect(plain).toMatch(/^Quetiapine doses must be taken daily\./);
  });

  it("refuses promotion when the figure only exists in adjacent context outside the claim-support corpus", () => {
    const answer = extractiveAnswerFor("What is the quetiapine dose?", [
      figureChunk({
        id: "quetiapine-adjacent-chunk-1",
        content: "Quetiapine doses must be taken daily. Quetiapine doses should be reviewed daily.",
        adjacent_context: "The maximum recommended quetiapine dose is 200 mg daily.",
      }),
    ]);

    const plain = (answer.answer ?? "").replace(/\*\*/g, "");
    expect(answer.grounded).toBe(true);
    // The 200 mg figure passes numeric verification (adjacent context is part of
    // that corpus) but not claim support, so promoting it would nuke the whole
    // answer at the claim gate. The figure-less lead must stay.
    expect(plain).not.toContain("200 mg");
    expect(plain).toMatch(/^Quetiapine doses must be taken daily\./);
  });

  it("keeps non-dose, non-monitoring fact ordering byte-identical", () => {
    const answer = extractiveAnswerFor("When is quetiapine contraindicated?", [
      figureChunk({
        id: "quetiapine-contraindication-chunk-1",
        section_heading: "",
        content:
          "Quetiapine is contraindicated in known hypersensitivity. Quetiapine is contraindicated in patients already taking more than 200 mg daily of interacting sedatives.",
      }),
    ]);

    const plain = (answer.answer ?? "").replace(/\*\*/g, "");
    expect(answer.grounded).toBe(true);
    // Contraindication intent has no figure requirement: the shorter lead fact
    // must keep the single lead slot exactly as before.
    expect(plain).toBe("Quetiapine is contraindicated in known hypersensitivity.");
    expect(plain).not.toContain("200 mg");
  });

  it("leaves a dose lead that already carries its figure untouched", () => {
    const answer = extractiveAnswerFor("What is the quetiapine dose?", [
      figureChunk({
        id: "quetiapine-figured-chunk-1",
        content: "Quetiapine is started at 25 mg at night. The maximum recommended quetiapine dose is 200 mg daily.",
      }),
    ]);

    const plain = (answer.answer ?? "").replace(/\*\*/g, "");
    expect(answer.grounded).toBe(true);
    expect(plain).toBe(
      "Quetiapine is started at 25 mg at night. The maximum recommended quetiapine dose is 200 mg daily.",
    );
  });
});

describe("zero-atom figure promotion guard (reviewer P2)", () => {
  const question = "What metabolic monitoring is required for antipsychotics?";
  const leadOnly = "Metabolic monitoring is required for all patients prescribed antipsychotics.";
  const intervalSentence = "Weight and fasting glucose are monitored for antipsychotic patients every 6 weeks.";

  it("refuses an adjacent-context interval whose number matches corpus text with a different unit", () => {
    const answer = extractiveAnswerFor(question, [
      figureChunk({
        id: "monitoring-guard-1",
        // The synopsis shares the bare number but not the unit. The
        // "every 6 weeks" figure yields a 6/week quantity atom, so atom
        // identity must refuse the 6/month corpus — and the interval pattern's
        // full-match ordering keeps the verbatim fallback equally honest.
        // (The synopsis's own "every 6 months" is corpus-verbatim and may be
        // legitimately admitted via the figure coverage escape; the pin here is
        // only that the mismatched adjacent-context figure never ships.)
        section_heading: "Metabolic monitoring",
        retrieval_synopsis: "Reviewed every 6 months",
        content: leadOnly,
        adjacent_context: intervalSentence,
      }),
    ]);
    const plain = (answer.answer ?? "").replace(/\*\*/g, "");
    expect(plain).not.toMatch(/every 6 weeks/i);
  });

  // Longer than leadOnly so it stays a promotion candidate instead of taking
  // the shortest-first lead slot, and digit-free so it yields no value atom —
  // exercising the guard's verbatim-corpus fallback rather than atom identity.
  const annualSentence = "Weight and fasting glucose monitoring is repeated annually for all antipsychotic patients.";

  it("promotes a truly zero-atom schedule token verbatim-supported by chunk content", () => {
    const answer = extractiveAnswerFor(question, [
      figureChunk({
        id: "monitoring-guard-4",
        section_heading: "Metabolic monitoring",
        content: `${leadOnly} ${annualSentence}`,
      }),
    ]);
    const plain = (answer.answer ?? "").replace(/\*\*/g, "");
    expect(plain).toMatch(/annually/i);
  });

  it("refuses a truly zero-atom schedule token that exists only in adjacent context", () => {
    const answer = extractiveAnswerFor(question, [
      figureChunk({
        id: "monitoring-guard-5",
        section_heading: "Metabolic monitoring",
        content: leadOnly,
        adjacent_context: annualSentence,
      }),
    ]);
    const plain = (answer.answer ?? "").replace(/\*\*/g, "");
    expect(plain).not.toMatch(/annually/i);
  });

  it("promotes an atom-backed interval verbatim-supported by chunk content", () => {
    const answer = extractiveAnswerFor(question, [
      figureChunk({
        id: "monitoring-guard-2",
        section_heading: "Metabolic monitoring",
        content: `${leadOnly} ${intervalSentence}`,
      }),
    ]);
    const plain = (answer.answer ?? "").replace(/\*\*/g, "");
    expect(plain).toMatch(/every 6 weeks/i);
  });

  it("refuses the interval when it exists only in adjacent context", () => {
    const answer = extractiveAnswerFor(question, [
      figureChunk({
        id: "monitoring-guard-3",
        section_heading: "Metabolic monitoring",
        content: leadOnly,
        adjacent_context: intervalSentence,
      }),
    ]);
    const plain = (answer.answer ?? "").replace(/\*\*/g, "");
    expect(plain).not.toMatch(/every 6 weeks/i);
  });
});

// Run-#60 miss class: the monitoring-schedule evidence GATE was narrower than
// the fact filter and the eval judge, so schedule/range/panel sentences passed
// fact filtering but died at the gate (or at kind classification) — "reviewed",
// "annually", "monitored", bare durations, and the level-range/metabolic-panel
// vocabulary were all rejected. These pin the widened shared vocabulary.
describe("monitoring evidence gate parity (run-#60 miss class)", () => {
  it("binds source-scoped steady-state timing to its immediate qualifier", () => {
    const { query, source } = capturedLithiumSource("timing");
    const queryClass = classifyRagQuery(query).queryClass;
    const raw = extractiveAnswerFor(query, [source]);
    const answer = finalizeRagAnswerQuality(
      { ...raw, routingReason: `${raw.routingReason}; source_backed_extractive_fallback` },
      query,
      queryClass,
      [source],
    );
    const delivered = [answer.answer, ...(answer.answerSections ?? []).map((section) => section.body)]
      .join(" ")
      .replace(/\*\*/g, "");

    expect(answer.grounded).toBe(true);
    expect(delivered).toMatch(/12 hours after the last dose/i);
    expect(delivered).toMatch(/steady state concentration is achieved after 5-7 days/i);
    expect(delivered).toMatch(/5-7 days\. This may be longer \(between 7-10 days\)/i);
    expect(delivered).toMatch(/elderly|renal impairment/i);
    expect(delivered).not.toMatch(/For lithium, this may be longer/i);
  });

  it("does not borrow a foreign analyte interval from a lithium-titled source", () => {
    const answer = extractiveAnswerFor("What monitoring is required for lithium?", [
      figureChunk({
        id: "lithium-title-foreign-analyte-timing",
        title: "Lithium monitoring guideline",
        content: "For lithium, TSH levels should be sampled 12 hours after the last dose.",
      }),
    ]);
    const delivered = [answer.answer, ...(answer.answerSections ?? []).map((section) => section.body)]
      .join(" ")
      .replace(/\*\*/g, "");

    expect(delivered).not.toMatch(/TSH levels should be sampled 12 hours/i);
  });

  it("retains distinct supported cadences within the same monitoring facet", () => {
    const answer = extractiveAnswerFor("What monitoring and risks apply to lithium?", [
      figureChunk({
        id: "lithium-multiple-ongoing-cadences",
        title: "Australian lithium monitoring guideline",
        content:
          "Lithium monitoring includes renal function every six months. Check lithium levels every three months.",
      }),
    ]);
    const delivered = [answer.answer, ...(answer.answerSections ?? []).map((section) => section.body)]
      .join(" ")
      .replace(/\*\*/g, "");

    expect(answer.grounded).toBe(true);
    expect(delivered).toContain("renal function every six months");
    expect(delivered).toContain("lithium levels every three months");
  });

  it("retains source-supported facets from an OCR baseline monitoring block", () => {
    const { query, source } = capturedLithiumSource("literal");
    const raw = extractiveAnswerFor(query, [source]);
    const rawVisible = [raw.answer, ...(raw.answerSections ?? []).map((section) => section.body)]
      .join(" ")
      .replace(/\*\*/g, "");
    expect(rawVisible, JSON.stringify(raw.answerSections)).toMatch(/every 3–6 months/i);
    const answer = finalizeRagAnswerQuality(raw, query, classifyRagQuery(query).queryClass, [source]);
    expect(splitClinicalEvidenceSentences(source.content).join(" ")).toMatch(
      /Serum lithium concentrations tend to fluctuate for 6–10 hours after dosing, so the 12-hour post-dose serum concentration is used for monitoring purposes/i,
    );
    const delivered = [answer.answer, ...(answer.answerSections ?? []).map((section) => section.body)]
      .join(" ")
      .replace(/\*\*/g, "");

    expect(answer.grounded).toBe(true);
    expect(delivered).toMatch(/In Lithium\s*\(CAMHS\), baseline tests include Full Blood Picture/i);
    expect(delivered).toMatch(/Renal function/i);
    expect(delivered).toMatch(/Calcium levels/i);
    expect(delivered).toMatch(/Thyroid Function Test/i);
    expect(delivered).toMatch(/TSH and T4/i);
    expect(delivered).toMatch(/12-hour post-dose/i);
    expect(delivered).toMatch(/5–7 days after starting treatment/i);
    expect(delivered).toMatch(/dose change until stabilised/i);
    expect(delivered).toMatch(/once every three months/i);
    expect(delivered).toMatch(/every 3–6 months/i);
    expect(answer.answerSections?.every((section) => section.citation_chunk_ids.every((id) => id === source.id))).toBe(
      true,
    );
    expect(answer.answerSections?.every((section) => !section.body.includes(answer.answer))).toBe(true);
  });

  it("does not present an appendix form heading as clinical monitoring guidance", () => {
    const captured = lithiumLiveExcerpts.cases.find((entry) => entry.id === "literal");
    const appendix = captured?.sources.find((entry) => /^Appendix I: Lithium Monitoring Form/m.test(entry.content));
    if (!captured || !appendix) throw new Error("Missing captured lithium appendix source");
    const source = figureChunk({
      ...appendix,
      file_name: `${appendix.title}.pdf`,
      section_heading: null,
      source_metadata: appendix.source_metadata as SearchResult["source_metadata"],
    });
    const answer = extractiveAnswerFor(captured.query, [source]);
    const delivered = [answer.answer, ...(answer.answerSections ?? []).map((section) => section.body)].join(" ");

    expect(delivered).not.toMatch(/Appendix I:\s*Lithium Monitoring Form/i);
  });

  it("keeps a multi-facet monitoring schedule primary while retaining an atomic toxicity action", () => {
    const captured = lithiumLiveExcerpts.cases.find((entry) => entry.id === "detailed");
    if (!captured) throw new Error("Missing captured detailed lithium case");
    const sources = captured.sources.map((entry) =>
      figureChunk({
        ...entry,
        file_name: `${entry.title}.pdf`,
        section_heading: null,
        source_metadata: entry.source_metadata as SearchResult["source_metadata"],
      }),
    );
    const queryClass = classifyRagQuery(captured.query).queryClass;
    expect(classifyAnswerIntent(captured.query, queryClass)).toBe("monitoring_schedule");

    const raw = extractiveAnswerFor(captured.query, sources, queryClass);
    const rawToxicity = raw.answerSections?.find((section) => section.heading === "Suspected toxicity");
    expect(rawToxicity?.body, JSON.stringify(raw.answerSections)).toMatch(
      /check the serum lithium level.*renal function/i,
    );
    expect([raw.answer, ...(raw.answerSections ?? []).map((section) => section.body)].join(" ")).toMatch(
      /For (?:acute mania|BPAD prophylaxis|older adult), the target serum level is/i,
    );
    const answer = finalizeRagAnswerQuality(
      { ...raw, routingReason: `${raw.routingReason}; source_backed_extractive_fallback` },
      captured.query,
      queryClass,
      sources,
    );
    const visible = [answer.answer, ...(answer.answerSections ?? []).map((section) => section.body)]
      .join(" ")
      .replace(/\*\*/g, "");
    const toxicitySource = captured.sources.find((entry) => /withhold lithium/i.test(entry.content));
    const toxicitySection = answer.answerSections?.find((section) => section.heading === "Suspected toxicity");

    expect(answer.grounded).toBe(true);
    expect(visible).toMatch(/12 hours after the last dose/i);
    expect(visible).toMatch(/For (?:acute mania|BPAD prophylaxis|older adult), the target serum level is/i);
    expect(visible).toMatch(/withhold lithium/i);
    expect(visible).toMatch(/check the serum lithium level.*renal function/i);
    expect(toxicitySection?.kind).toBe("required_actions");
    expect(toxicitySection?.citation_chunk_ids).toEqual([toxicitySource?.id]);
    expect(visible).toMatch(/This answer does not establish: baseline tests/i);
    expect(visible).toMatch(/stable-treatment monitoring/i);
  });

  it.each([
    { section_heading: "Valproate" },
    { parent_heading: "Valproate", section_heading: "Monitoring" },
    { section_path: ["Valproate", "Monitoring"], section_heading: "Monitoring" },
  ])("rejects a baseline list scoped to a different medication: %j", (scope) => {
    const answer = extractiveAnswerFor("What monitoring is required for lithium?", [
      figureChunk({
        title: "Lithium guideline",
        file_name: "Lithium guideline.pdf",
        parent_heading: null,
        section_path: [],
        ...scope,
        content: "Baseline Tests\n• Pregnancy test\n• Full blood count",
      }),
    ]);
    const delivered = [answer.answer, ...(answer.answerSections ?? []).map((section) => section.body)].join(" ");
    expect(delivered).not.toMatch(/baseline tests include/i);
  });

  it("keeps a standalone toxicity-action request on the result-action path", () => {
    const query = "What action is required if lithium toxicity is suspected?";
    const queryClass = classifyRagQuery(query).queryClass;
    expect(classifyAnswerIntent(query, queryClass)).toBe("red_result_action");
  });

  it.each([
    "After changing the dose, check serum lithium levels after 5 days.",
    "Check serum lithium levels every 7 days after a dose change.",
  ])("keeps baseline population scope and uses evidence-specific change headings: %s", (changeInstruction) => {
    const answer = extractiveAnswerFor("What monitoring is required for lithium?", [
      figureChunk({
        id: "population-scoped-lithium-monitoring",
        title: "Lithium guideline",
        file_name: "Lithium guideline.pdf",
        section_heading: "Monitoring",
        parent_heading: "Children and adolescents",
        section_path: ["Children and adolescents", "Monitoring"],
        content: ["Baseline Tests1", "• Full Blood Picture", "• Renal function", changeInstruction].join("\n"),
      }),
    ]);
    const delivered = [answer.answer, ...(answer.answerSections ?? []).map((section) => section.body)]
      .join(" ")
      .replace(/\*\*/g, "");

    expect(delivered).toMatch(/In Lithium guideline, Children and adolescents, baseline tests include/i);
    expect(answer.answerSections?.some((section) => section.heading === "Dose changes")).toBe(true);
    expect(answer.answerSections?.some((section) => section.heading === "Starting and dose changes")).toBe(false);
    expect(answer.answerSections?.every((section) => section.body.length <= 600)).toBe(true);
  });

  it("carries a lithium range heading across flattened cohort bullets and selects maintenance", () => {
    const content =
      "• Baseline weight (desirable) All patients commenced on lithium must be provided with written information. 4.4 Dosing and Therapeutic Drug Monitoring Lithium dose is titrated according to patient response and plasma levels. Consider all interacting medication when prescribing lithium and if necessary adjust dose and/or monitoring. The recommended therapeutic serum lithium range for:\n• ACUTE mania is between 0.5 -1.2 mmol/L.\n• MAINTENANCE treatment is between 0.5 -1.0 mmol/L.\n• In the elderly (>65 years) is between 0.4 -0.7 mmol/L.";
    const sentences = splitClinicalEvidenceSentences(content);
    const maintenance = sentences.find((sentence) => /maintenance treatment/i.test(sentence));
    expect(maintenance).toMatch(/therapeutic serum lithium range/i);

    const answer = extractiveAnswerFor("What lithium level range is used for maintenance monitoring?", [
      figureChunk({
        id: "lithium-hosted-range-shape",
        title: "Lithium Prescribing And Management(NMHS)",
        file_name: "Lithium Prescribing and Management (NMHS).pdf",
        section_heading: null,
        content,
      }),
    ]);
    const plain = (answer.answer ?? "").replace(/\*\*/g, "");
    expect(plain).toMatch(/0\.5\s*-\s*1\.0 mmol\/L/i);
    expect(plain).not.toMatch(/0\.5\s*-\s*1\.2 mmol\/L/i);
    expect(answer.grounded).toBe(true);
    expect(
      isSafeExtractiveFallbackCandidate(
        answer,
        "What lithium level range is used for maintenance monitoring?",
        "table_threshold",
      ),
    ).toBe(true);
  });

  it("does not inherit a foreign medication heading across a flattened maintenance bullet", () => {
    const answer = extractiveAnswerFor("What lithium level range is used for maintenance monitoring?", [
      figureChunk({
        id: "lamotrigine-hosted-range-shape",
        title: "Lithium Therapy",
        file_name: "Lithium Therapy.pdf",
        section_heading: null,
        content: "The lamotrigine maintenance range for:\n• MAINTENANCE treatment is between 3 and 15 mg/L.",
      }),
    ]);
    const plain = (answer.answer ?? "").replace(/\*\*/g, "");
    expect(plain).not.toMatch(/3\s+and\s+15 mg\/L/i);
  });

  it("does not return a digoxin range as a grounded lithium answer", () => {
    const answer = extractiveAnswerFor("What lithium level range is used for maintenance monitoring?", [
      figureChunk({
        id: "digoxin-range-in-lithium-document",
        title: "Lithium Therapy",
        file_name: "Lithium Therapy.pdf",
        section_heading: "Maintenance monitoring",
        content: "Unlike lithium, monitor digoxin at 0.8 to 2.0 ng/mL.",
        similarity: 0.55,
        hybrid_score: 0.58,
        text_rank: 0.01,
      }),
    ]);
    const plain = (answer.answer ?? "").replace(/\*\*/g, "");

    expect(answer.grounded).toBe(false);
    expect(plain).not.toMatch(/0\.8\s+to\s+2\.0 ng\/mL/i);
  });

  it.each([
    ["Lithicarb", "TSH is 0.4 to 4.0 mmol/L."],
    ["Quilonum SR", "Serum sodium is 130 to 145 mmol/L."],
    ["Lithicarb", "Blood glucose is 3.0 to 15.0 mmol/L."],
  ])("does not return a foreign analyte as a grounded %s answer", (brand, content) => {
    const answer = extractiveAnswerFor(`What ${brand} level range is used for maintenance monitoring?`, [
      figureChunk({
        id: `${brand.toLowerCase().replace(/\s+/g, "-")}-foreign-analyte`,
        title: `${brand} Therapy`,
        file_name: `${brand} Therapy.pdf`,
        section_heading: "Maintenance monitoring",
        content,
        similarity: 0.8,
        hybrid_score: 0.82,
        text_rank: 0.12,
      }),
    ]);
    const plain = (answer.answer ?? "").replace(/\*\*/g, "");

    expect(answer.grounded).toBe(false);
    expect(plain).not.toContain(content);
  });

  it.each([
    "Maintain lithium at 0.6 to 0.8 mmol/L and keep sodium chloride intake stable.",
    "For lithium co-prescribed with aspirin, maintain 0.6 to 0.8 mmol/L.",
    "For lithium, keep sodium chloride intake stable and maintain the level at 0.6 to 0.8 mmol/L.",
  ])("keeps an explicit lithium value when a contextual co-medication has no value", (content) => {
    const answer = extractiveAnswerFor("What lithium level range is used for maintenance monitoring?", [
      figureChunk({
        id: "lithium-range-with-contextual-sodium",
        title: "Lithium Therapy",
        file_name: "Lithium Therapy.pdf",
        section_heading: "Maintenance monitoring",
        content,
      }),
    ]);
    const plain = (answer.answer ?? "").replace(/\*\*/g, "");

    expect(answer.grounded).toBe(true);
    expect(plain).toMatch(/0\.6\s+to\s+0\.8 mmol\/L/i);
  });

  it.each(["Blood glucose target levels", "TSH reference ranges"])(
    "does not emit a plural foreign threshold heading as a lithium answer: %s",
    (heading) => {
      const answer = extractiveAnswerFor("What lithium level range is used for maintenance monitoring?", [
        figureChunk({
          id: "plural-foreign-range",
          title: "Lithium Therapy",
          file_name: "Lithium Therapy.pdf",
          section_heading: null,
          content: `${heading}:\n• Maintenance range is 3.0-15.0 mmol/L.`,
        }),
      ]);
      const plain = (answer.answer ?? "").replace(/\*\*/g, "");

      expect(answer.grounded).toBe(false);
      expect(plain).not.toMatch(/3\.0\s*-\s*15\.0 mmol\/L/i);
    },
  );

  it("uses maintenance section scope for a locally bound target concentration", () => {
    const answer = extractiveAnswerFor("What lithium level range is used for maintenance monitoring?", [
      figureChunk({
        id: "maintenance-scope-range",
        title: "Lithium Therapy",
        file_name: "Lithium Therapy.pdf",
        section_heading: "Maintenance monitoring",
        content: "Target serum lithium concentration is 0.6 to 0.8 mmol/L.",
      }),
    ]);
    const plain = (answer.answer ?? "").replace(/\*\*/g, "");

    expect(answer.grounded).toBe(true);
    expect(plain).toMatch(/0\.6\s+to\s+0\.8 mmol\/L/i);
  });

  it("prefers a lithium concentration range over cadence for a natural level-value query", () => {
    const answer = extractiveAnswerFor("What lithium level is used for maintenance monitoring?", [
      figureChunk({
        id: "lithium-level-and-cadence",
        title: "Lithium Therapy",
        file_name: "Lithium Therapy.pdf",
        section_heading: "Maintenance monitoring",
        content: "Check lithium levels every 3 months. The maintenance serum lithium concentration is 0.6-0.8 mmol/L.",
      }),
    ]);
    const plain = (answer.answer ?? "").replace(/\*\*/g, "");

    expect(answer.grounded).toBe(true);
    expect(plain).toMatch(/0\.6-0\.8 mmol\/L/i);
    expect(plain.indexOf("0.6-0.8 mmol/L")).toBeLessThan(plain.indexOf("every 3 months"));
  });

  it("answers a natural target-concentration query from exact medication evidence", () => {
    const answer = extractiveAnswerFor("What target concentration is used for lithium maintenance?", [
      figureChunk({
        id: "lithium-target-concentration",
        title: "Lithium Therapy",
        file_name: "Lithium Therapy.pdf",
        section_heading: "Maintenance monitoring",
        content: "The target lithium concentration for maintenance is 0.6-0.8 mmol/L.",
      }),
    ]);
    const plain = (answer.answer ?? "").replace(/\*\*/g, "");

    expect(answer.grounded).toBe(true);
    expect(plain).toMatch(/0\.6-0\.8 mmol\/L/i);
  });

  it.each(["FBC", "full blood count"])("keeps passive categorical %s withholding evidence", (parameter) => {
    const answer = extractiveAnswerFor(`What ${parameter} threshold should withhold clozapine?`, [
      figureChunk({
        id: "categorical-fbc-withheld",
        title: "Clozapine Monitoring",
        file_name: "Clozapine Monitoring.pdf",
        section_heading: "Blood result action",
        content: `${parameter} results in the Amber or Red range require clozapine to be withheld and urgent review arranged.`,
      }),
    ]);
    const plain = (answer.answer ?? "").replace(/\*\*/g, "");

    expect(answer.grounded).toBe(true);
    expect(plain).toMatch(/amber|red|withheld/i);
  });

  it("admits a level-range fact phrased without monitor/level tokens", () => {
    const answer = extractiveAnswerFor("What lithium level range is used for maintenance monitoring?", [
      figureChunk({
        id: "lithium-range-chunk-1",
        title: "Lithium (AKG)",
        file_name: "Lithium (AKG).pdf",
        section_heading: "Lithium",
        content: "Lithium is prescribed for bipolar maintenance. Maintenance range is 0.6-0.8 mmol/L.",
      }),
    ]);
    const plain = (answer.answer ?? "").replace(/\*\*/g, "");
    expect(plain).toMatch(/0\.6-0\.8 mmol\/L/i);
  });

  it("keeps a sole dose figure whose sentence uses inflected monitoring tokens (reviewer P2)", () => {
    // The inflected monitoring kind tokens must not steal a dose-value sentence
    // from the dose arm: with these as the only dose-bearing facts, dose-intent
    // answers previously flipped to a source-gap after the inflection widen.
    for (const sentence of [
      "Quetiapine is monitored at a dose of 200 mg daily.",
      "Quetiapine 200 mg daily is reviewed annually.",
    ]) {
      const answer = extractiveAnswerFor("What is the quetiapine dose?", [
        figureChunk({ id: "dose-steal-guard-1", content: sentence }),
      ]);
      const plain = (answer.answer ?? "").replace(/\*\*/g, "");
      expect(answer.grounded).toBe(true);
      expect(plain).toContain("200 mg");
    }
  });

  it("denies monitoring intent coverage to a dose-amount range in a token-free chunk (CodeRabbit major #2)", () => {
    const answer = extractiveAnswerFor("What monitoring is required for quetiapine?", [
      figureChunk({
        id: "dose-range-coverage-guard-1",
        section_heading: "Quetiapine",
        // Genuinely token-free: no monitoring vocabulary at all, so the ONLY
        // candidate coverage grantor is the mg dose range, which must not
        // count as a monitoring figure at either the result level or the
        // sentence level. (End-to-end this is defense-in-depth layered with
        // the gate miss and the dose-kind cadence/level guard — the
        // generic-vocabulary path is pinned by the neighbouring test.)
        content: "Quetiapine prescribing information follows. 300-450 mg is listed for adults.",
      }),
    ]);
    const plain = (answer.answer ?? "").replace(/\*\*/g, "");
    expect(plain).not.toContain("300-450 mg");
  });

  it("refuses generic dose-range prose as monitoring evidence (CodeRabbit major)", () => {
    const answer = extractiveAnswerFor("What monitoring is required for quetiapine?", [
      figureChunk({
        id: "dose-range-not-schedule-1",
        section_heading: "Quetiapine",
        // The dose range carries range/therapeutic/maintenance vocabulary and a
        // mg unit-range figure, but no cadence or level signal — it must not be
        // admitted as monitoring-schedule evidence.
        content:
          "Quetiapine monitoring requirements are described in the prescribing guideline. The therapeutic dose range is 300-450 mg daily.",
      }),
    ]);
    const plain = (answer.answer ?? "").replace(/\*\*/g, "");
    expect(plain).not.toContain("300-450 mg");
  });

  it("refuses a bare schedule row from a multi-drug chunk (reviewer P3)", () => {
    const answer = extractiveAnswerFor("What monitoring is required for clozapine?", [
      figureChunk({
        id: "multi-drug-monitoring-guard-1",
        title: "Antipsychotic Monitoring Summary",
        file_name: "Antipsychotic Monitoring Summary.pdf",
        section_heading: "Monitoring",
        // The bare interval row names no drug; the chunk names two. The figure
        // coverage escape must not let the row inherit the queried drug.
        content:
          "Clozapine and olanzapine monitoring requirements are listed below. Reviewed every 6 months with fasting bloods.",
      }),
    ]);
    const plain = (answer.answer ?? "").replace(/\*\*/g, "");
    expect(plain).not.toMatch(/every 6 months/i);
  });

  it("still refuses a schedule-free monitoring sentence with no query-token coverage", () => {
    const answer = extractiveAnswerFor("What metabolic monitoring is required for antipsychotics?", [
      figureChunk({
        id: "metabolic-uncovered-chunk-1",
        section_heading: "Metabolic monitoring",
        content:
          "Metabolic monitoring is required for all patients prescribed antipsychotics. Community staff arrange the reviews with the general practitioner.",
      }),
    ]);
    const plain = (answer.answer ?? "").replace(/\*\*/g, "");
    // "reviews" passes the widened evidence gate but carries no schedule figure
    // and names no query token, so the coverage escape must NOT admit it.
    expect(plain).toBe("Metabolic monitoring is required for all patients prescribed antipsychotics.");
  });

  it("admits a metabolic-panel fact whose schedule uses inflected tokens", () => {
    const answer = extractiveAnswerFor("What metabolic monitoring is required for antipsychotics?", [
      figureChunk({
        id: "metabolic-annual-chunk-1",
        section_heading: "Metabolic monitoring",
        content:
          "Metabolic monitoring is required for all patients prescribed antipsychotics. Weight, BMI, fasting glucose and lipids are reviewed annually.",
      }),
    ]);
    const plain = (answer.answer ?? "").replace(/\*\*/g, "");
    expect(plain).toMatch(/annually/i);
  });

  it("admits a duration-figure fact phrased with 'monitored for N hours'", () => {
    const answer = extractiveAnswerFor("What monitoring is required after olanzapine LAI?", [
      figureChunk({
        id: "olanzapine-lai-chunk-1",
        title: "Olanzapine LAI (AKG)",
        file_name: "Olanzapine LAI (AKG).pdf",
        section_heading: "Post-injection observation",
        content:
          "Olanzapine LAI requires post-injection observation. The patient is monitored for 3 hours after each injection.",
      }),
    ]);
    const plain = (answer.answer ?? "").replace(/\*\*/g, "");
    expect(plain).toMatch(/3 hours/i);
  });

  describe("bare document title list guard (#S4R2W3)", () => {
    const bareTitleList =
      "I found 3 indexed documents that support this query: Aggression and Agitation Management Procedure; High Risk Assessment and Clinical Escalation; Clinical De-escalation Protocol.";

    it("identifies bare document support list answers", () => {
      expect(isBareDocumentSupportListAnswer(bareTitleList)).toBe(true);
      expect(isBareDocumentSupportListAnswer("I found one indexed document that supports this query: Policy A.")).toBe(
        true,
      );
      expect(
        isBareDocumentSupportListAnswer("Aggression management begins with verbal de-escalation in a calm area."),
      ).toBe(false);
    });

    it("rejects bare document support list answers for substantive clinical queries", () => {
      const candidate: RagAnswer = {
        answer: bareTitleList,
        grounded: true,
        confidence: "medium",
        citations: [
          {
            chunk_id: "doc-1",
            title: "Aggression Procedure",
            document_id: "doc-1",
            file_name: "Aggression Procedure.pdf",
            page_number: 1,
            chunk_index: 0,
          },
        ],
        sources: [{ id: "doc-1", title: "Aggression Procedure", document_id: "doc-1", content: "..." } as SearchResult],
        unverifiedNumericTokens: [],
      };

      const clinicalQuery = "What is the duress procedure pathway?";
      const clinicalQueryClass: RagQueryClass = "unsupported_or_general";
      expect(documentSupportListIntent(clinicalQuery, clinicalQueryClass)).toBe(false);
      expect(generatedAnswerQualityFailureReason(candidate, clinicalQuery, clinicalQueryClass)).toBe(
        "bare_document_title_list",
      );
      expect(isSafeExtractiveFallbackCandidate(candidate, clinicalQuery, clinicalQueryClass)).toBe(false);
    });

    it("accepts bare document support list answers when the query explicitly asks for supporting documents", () => {
      const candidate: RagAnswer = {
        answer: bareTitleList,
        grounded: true,
        confidence: "medium",
        citations: [
          {
            chunk_id: "doc-1",
            title: "Aggression Procedure",
            document_id: "doc-1",
            file_name: "Aggression Procedure.pdf",
            page_number: 1,
            chunk_index: 0,
          },
        ],
        sources: [{ id: "doc-1", title: "Aggression Procedure", document_id: "doc-1", content: "..." } as SearchResult],
        unverifiedNumericTokens: [],
      };

      const docQuery = "Which documents support lithium monitoring?";
      const docQueryClass: RagQueryClass = "document_lookup";
      expect(documentSupportListIntent(docQuery, docQueryClass)).toBe(true);
      expect(generatedAnswerQualityFailureReason(candidate, docQuery, docQueryClass)).toBeNull();
    });
  });
});

describe("two-medicine interaction intent (#ZZ4RAP)", () => {
  it("routes a co-prescribing question to contraindication", () => {
    expect(classifyAnswerIntent("Can I prescribe ibuprofen for someone on lithium?", "medication_dose_risk")).toBe(
      "contraindication",
    );
  });

  it("routes a passive co-administration question to contraindication", () => {
    expect(classifyAnswerIntent("Can ibuprofen be administered with lithium?", "medication_dose_risk")).toBe(
      "contraindication",
    );
  });

  it("routes two-medicine dosing, switching and mechanism questions to interaction guidance", () => {
    for (const query of [
      "What dose of ibuprofen is safe with lithium?",
      "How do I switch from sertraline to clozapine?",
      "What is the mechanism of the ibuprofen and lithium effect?",
    ]) {
      expect(classifyAnswerIntent(query, "medication_dose_risk")).toBe("contraindication");
    }
  });

  it("does not treat 'with' + a condition as an interaction", () => {
    expect(
      classifyAnswerIntent(
        "Can I use lithium after stopping ibuprofen in someone with bipolar disorder?",
        "medication_dose_risk",
      ),
    ).not.toBe("contraindication");
  });
});
