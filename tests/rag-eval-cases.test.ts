import { describe, expect, it } from "vitest";
import {
  answerQualityEvalCases,
  answerQualityMetricLabels,
  loadCapturedRagEvalCases,
  mapCapturedEvalCase,
  mergeRagEvalCases,
  ragEvalCases,
  selectRagEvalCases,
  scoreAnswerQualityEvalCase,
  scoreAnswerTargeting,
  evaluateRagCase,
  type AnswerQualityEvalCase,
} from "../src/lib/rag/rag-eval-cases";
import { ragProgrammeFixture } from "../src/lib/rag/rag-programme-eval";
import type { RagAnswer } from "../src/lib/types";

describe("P12C fixed delivery expectations in the canonical registry", () => {
  const byId = (id: string) => ragEvalCases.find((testCase) => testCase.id === id)!;
  const answer = (text: string): RagAnswer => ({
    answer: text,
    grounded: true,
    confidence: "high",
    citations: [],
    sources: [],
    answerSections: [],
  });
  it("rejects generic broad prose even when it asserts that it is grounded", () => {
    expect(
      evaluateRagCase(byId("broad-supported-sections"), answer("Management should follow the relevant guideline."))
        .failures,
    ).toContain("missing_required_subquestion_coverage");
  });
  it("rejects blanket insufficiency when monitoring is supported", () => {
    expect(
      evaluateRagCase(byId("broad-multi-intent-partial"), {
        ...answer("No current source with specific guidance was found."),
        grounded: false,
        confidence: "unsupported",
      }).failures,
    ).toContain("false_insufficiency");
  });
  it.each([
    ["site-medication-direct", "medication-differential-specifier"],
    ["site-product-primary", "concise-catalogue"],
    ["site-changed-deleted-stale", "supported-guideline-site-gap"],
  ])("evaluates attached consumer-only repository-content variant %s / %s", (id, variantId) => {
    const testCase = byId(id);
    const variant = testCase.deliveryVariants![variantId]!;
    expect(variant.scope).toBe("consumer_only");
    const passages = variant.supportingPassages;
    const complete: RagAnswer = {
      ...answer(passages[0]!),
      answerSections: passages.slice(1).map((body, index) => ({
        heading: ["Medication", "Differential", "Specifier"][index]!,
        body,
        citation_chunk_ids: [`fixture-${index}`],
      })),
    };
    if (variantId === "medication-differential-specifier") {
      complete.answer = "The current records contain the requested catalogue descriptions.";
      complete.answerSections = passages.map((body, index) => ({
        heading: ["Medication", "Differential", "Specifier"][index]!,
        body,
        citation_chunk_ids: [`fixture-${index}`],
      }));
    }
    if (variant.expectation.exactGap)
      complete.answerSections!.push({
        heading: "Source gap",
        kind: "source_gap",
        body: variant.expectation.exactGap,
        citation_chunk_ids: [],
      });
    expect(evaluateRagCase(testCase, complete, variantId).pass).toBe(true);
    if (variantId === "medication-differential-specifier")
      expect(
        evaluateRagCase(
          testCase,
          {
            ...complete,
            answerSections: complete.answerSections!.slice(0, 2),
          },
          variantId,
        ).failures,
      ).toContain("missing_required_subquestion_coverage");
    if (variantId === "supported-guideline-site-gap") {
      expect(evaluateRagCase(testCase, { ...complete, answerSections: [] }, variantId).failures).toContain(
        "missing_exact_gap",
      );
      expect(
        evaluateRagCase(testCase, { ...complete, answer: "No current source was found.", grounded: false }, variantId)
          .failures,
      ).toContain("false_insufficiency");
      expect(
        evaluateRagCase(
          testCase,
          {
            ...complete,
            answerSections: [
              ...complete.answerSections!,
              {
                heading: "Source gap",
                kind: "source_gap",
                body: "monitoring: unsupported",
                citation_chunk_ids: [],
              },
            ],
          },
          variantId,
        ).failures,
      ).toContain("missing_exact_gap");
      expect(testCase.supported).toBe(false); // The original stale-site-only fixture remains unchanged.
    }
    if (variantId === "concise-catalogue") expect(complete.answerSections).toHaveLength(0);
  });
  it("keeps the narrow fact concise rather than requiring broad sections", () => {
    const narrow = answer("Lithium levels are checked every three months.");
    expect(evaluateRagCase(byId("narrow-fact-concise"), narrow).pass).toBe(true);
    expect(
      evaluateRagCase(byId("narrow-fact-concise"), {
        ...narrow,
        answerSections: [
          { heading: "Unrequested management", body: "Review management.", citation_chunk_ids: [] },
          { heading: "Unrequested risk", body: "Review risks.", citation_chunk_ids: [] },
        ],
      }).failures,
    ).toContain("answer_section_range");
  });
});

const legacyRagEvalCaseIds = [
  "clozapine-monitoring",
  "patient-safety-plan",
  "ect-procedure",
  "agitation-arousal-pharmacological-management",
  "discharge-documentation",
  "metabolic-screening",
  "long-acting-injectables",
  "nocc-requirements",
  "duress-procedure",
  "assessment-documentation",
  "best-practice-prescribing",
  "community-home-visits",
  "community-admission",
  "active-community-patient-ed",
  "active-community-pt-ed-short-terms",
  "illegal-substances",
  "treatment-team-process",
  "direct-document-lookup-nocc",
  "summary-discharge-guidance",
  "agitation-arousal-table-lookup",
  "clozapine-fbc-acronym-threshold",
  "agitation-im-po-route-short-terms",
  "admission-discharge-comparison",
  "neuroleptic-side-effect-escalation",
  "clozapine-anc-withhold-threshold",
  "clozapine-monitoring-paraphrase",
  "clozapine-typo-acronym-threshold",
  "clozapine-missed-dose-table",
  "agitation-arousal-typo-dosing",
  "admission-discharge-coverage-paraphrase",
  "unsupported-coffee-machine",
  "unsupported-air-fryer",
  "unsupported-recipe",
  "unsupported-dka-insulin",
  "unsupported-pneumonia-antibiotic",
  "unsupported-ssri-adolescent-dose",
  "unsupported-hyperkalaemia-insulin",
  "unsupported-future-upload-title",
  "unsupported-nonexistent-clozapine-policy",
  "unsupported-close-title-noise",
  "unsupported-prompt-injection-secrets",
  "unsupported-prompt-injection-citation-forge",
  "unsupported-invented-florbizone",
  "unsupported-invented-quxbyria",
] as const;

const row = {
  id: "capture-1",
  query: "What FBC threshold should withhold clozapine?",
  query_class: "table_threshold",
  top_files: ["CG.MHSP.ClozapinePresAdminMonitor.pdf"],
  expected_file: null,
  miss_reason: "answer_good_eval",
  metadata: { rating: "good" },
  created_at: "2026-06-13T00:00:00.000Z",
};

function clientWithRows(rows: (typeof row)[]) {
  const filters: Array<{ column: string; value: unknown }> = [];
  const query = {
    eq(column: string, value: unknown) {
      filters.push({ column, value });
      return query;
    },
    order() {
      return {
        limit: async () => ({ data: rows, error: null }),
      };
    },
  };
  return {
    filters,
    from: () => ({
      select: () => query,
    }),
  };
}

describe("captured RAG eval cases", () => {
  it("keeps default selection on the exact legacy population and semantics", () => {
    const selected = selectRagEvalCases({});

    expect(selected.map((testCase) => testCase.id)).toEqual(legacyRagEvalCaseIds);
    expect(selected.every((testCase) => testCase.programmeExpectation === undefined)).toBe(true);
    expect(selectRagEvalCases({ limit: 3 }).map((testCase) => testCase.id)).toEqual(legacyRagEvalCaseIds.slice(0, 3));

    const knownLegacy = selected[0]!;
    expect(selectRagEvalCases({ question: `  ${knownLegacy.question.toUpperCase()}  ` })).toEqual([knownLegacy]);

    const programmeQuestion = ragEvalCases.find((testCase) => testCase.programmeExpectation)?.question;
    const [customCase] = selectRagEvalCases({ question: programmeQuestion });
    expect(customCase).toMatchObject({ id: "custom-question", expectedFiles: [] });
    expect(customCase?.programmeExpectation).toBeUndefined();
  });

  it("selects every programme case exactly once only through the explicit population option", () => {
    const selected = selectRagEvalCases({ population: "programme" });
    const expectedIds = ragProgrammeFixture.cases.map((testCase) => testCase.id);

    expect(selected.map((testCase) => testCase.id)).toEqual(expectedIds);
    expect(new Set(selected.map((testCase) => testCase.id)).size).toBe(expectedIds.length);
    expect(selected.every((testCase) => testCase.programmeExpectation !== undefined)).toBe(true);
    expect(selectRagEvalCases({ population: "programme", limit: 4 })).toEqual(selected.slice(0, 4));

    const knownProgramme = selected[0]!;
    expect(
      selectRagEvalCases({ population: "programme", question: `  ${knownProgramme.question.toUpperCase()}  ` }),
    ).toEqual([knownProgramme]);
    expect(selectRagEvalCases({ population: "programme", question: "not a canonical programme case" })).toEqual([]);
  });

  it("extends the canonical registry with every privacy-reviewed programme case", () => {
    const programmeCases = ragEvalCases.filter((testCase) => testCase.programmeExpectation !== undefined);

    expect(programmeCases.map((testCase) => testCase.id).sort()).toEqual(
      ragProgrammeFixture.cases.map((testCase) => testCase.id).sort(),
    );
    for (const fixtureCase of ragProgrammeFixture.cases) {
      const registered = programmeCases.find((testCase) => testCase.id === fixtureCase.id);
      expect(registered?.expectedFiles).toEqual(fixtureCase.expectedDocuments);
      expect(registered?.latencyTargetMs).toBe(fixtureCase.latencyTargetMs);
      expect(registered?.programmeExpectation).toEqual(fixtureCase.expectation);
    }
  });

  it("maps good captures to source-backed reusable eval cases", () => {
    const testCase = mapCapturedEvalCase(row);

    expect(testCase).toMatchObject({
      id: "captured-capture-1",
      question: row.query,
      expectedQueryClass: "table_threshold",
      expectedFiles: ["CG.MHSP.ClozapinePresAdminMonitor.pdf"],
      supported: true,
      minCitations: 1,
    });
  });

  it("does not treat needs-fixing top files as expected hits without explicit review", () => {
    const testCase = mapCapturedEvalCase({
      ...row,
      id: "capture-2",
      miss_reason: "answer_needs_fixing",
      metadata: { rating: "needs_fixing" },
    });

    expect(testCase.expectedFiles).toEqual([]);
    expect(testCase.minCitations).toBe(0);
  });

  it("maps unsupported-answer feedback to unsupported eval expectations", () => {
    const testCase = mapCapturedEvalCase({
      ...row,
      id: "capture-unsupported",
      miss_reason: "unsupported_answer",
      metadata: { rating: "needs_fixing", feedback_type: "unsupported_answer" },
    });

    expect(testCase).toMatchObject({
      category: "unsupported",
      relevanceGrade: "unsupported",
      supported: false,
      expectedFiles: [],
      allowedRoutes: ["unsupported"],
      minCitations: 0,
    });
  });

  it("preserves expected danger-warning metadata on unsupported captures", () => {
    const testCase = mapCapturedEvalCase({
      ...row,
      id: "capture-source-danger",
      miss_reason: "source_insufficient",
      metadata: {
        rating: "needs_fixing",
        feedback_type: "source_insufficient",
        sourceGovernanceWarnings: [{ severity: "danger", code: "outdated_source" }],
      },
    });

    expect(testCase).toMatchObject({
      supported: false,
      expectsSourceDangerWarning: true,
    });
  });

  it("detects persisted danger-message string governance warnings on unsupported captures", () => {
    // /api/eval-cases persists governance warnings as plain message strings
    // (ClinicalDashboard submits warning.message), so the predicate matches the
    // canonical danger message text, not only object-shaped { severity: "danger" }.
    const testCase = mapCapturedEvalCase({
      ...row,
      id: "capture-source-danger-string",
      miss_reason: "unsupported_answer",
      metadata: {
        rating: "needs_fixing",
        feedback_type: "unsupported_answer",
        source_governance_warnings: [
          "One or more supporting sources have not been locally validated.",
          "One or more supporting sources are marked outdated.",
        ],
      },
    });

    expect(testCase).toMatchObject({
      supported: false,
      expectsSourceDangerWarning: true,
    });
  });

  it("does not expect a danger warning for non-danger string warnings on unsupported captures", () => {
    // A review_due-only refusal carries no danger warning; flagging it as
    // expecting one would trip the missing-warning gate on a false positive.
    const testCase = mapCapturedEvalCase({
      ...row,
      id: "capture-string-warning-only",
      miss_reason: "unsupported_answer",
      metadata: {
        rating: "needs_fixing",
        feedback_type: "unsupported_answer",
        source_governance_warnings: ["One or more supporting sources are due for review."],
      },
    });

    expect(testCase.expectsSourceDangerWarning).toBeUndefined();
  });

  it("expects danger warnings for source-insufficient captured refusals", () => {
    const testCase = mapCapturedEvalCase({
      ...row,
      id: "capture-source-insufficient",
      miss_reason: "source_insufficient",
      metadata: { rating: "needs_fixing", feedback_type: "source_insufficient" },
    });

    expect(testCase).toMatchObject({
      supported: false,
      expectsSourceDangerWarning: true,
    });
  });

  it("maps numeric-error feedback to a source-backed regression case", () => {
    const testCase = mapCapturedEvalCase({
      ...row,
      id: "capture-numeric",
      miss_reason: "numeric_error",
      metadata: { rating: "needs_fixing", feedback_type: "numeric_error" },
    });

    expect(testCase).toMatchObject({
      category: "complex",
      supported: true,
      minCitations: 1,
    });
  });

  it("loads only promoted captures and scopes to the owner when provided", async () => {
    const client = clientWithRows([row]);
    const cases = await loadCapturedRagEvalCases({
      supabase: client,
      ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      limit: 3,
    });

    expect(cases).toHaveLength(1);
    expect(client.filters).toEqual([
      { column: "promoted_eval_case", value: true },
      { column: "owner_id", value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    ]);
  });

  it("prefers captured regressions while deduping matching static questions", () => {
    const captured = mapCapturedEvalCase(row);
    const merged = mergeRagEvalCases(
      [
        {
          ...captured,
          id: "static-duplicate",
          expectedFiles: [],
        },
      ],
      [captured],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("captured-capture-1");
  });

  it("keeps a 48-query answer-quality fixture (30 core + 18 high-risk) with the expected scoring dimensions", () => {
    expect(answerQualityEvalCases).toHaveLength(48);
    expect(new Set(answerQualityEvalCases.map((testCase) => testCase.id)).size).toBe(48);
    expect(answerQualityEvalCases.filter((testCase) => testCase.id.startsWith("high-risk-"))).toHaveLength(18);
    expect(Object.keys(answerQualityMetricLabels).sort()).toEqual([
      "artifact_leaks",
      "fail_closed",
      "intent_coverage",
      "readability",
      "relevance",
    ]);
    expect(answerQualityEvalCases.some((testCase) => testCase.expectedIntent === "document_lookup")).toBe(true);
    expect(answerQualityEvalCases.some((testCase) => testCase.supported === false)).toBe(true);
  });

  it("marks the diffuse discharge cases as source-only-acceptable, still supported", () => {
    const core = ragEvalCases.find((item) => item.id === "discharge-documentation");
    expect(core?.supported).toBe(true);
    expect(core?.acceptSourceOnly).toBe(true);
    // The retrieval guard must remain: expected discharge docs still asserted.
    expect(core?.expectedFiles).toEqual(["MHSP.Discharge.pdf"]);

    const quality = answerQualityEvalCases.find((item) => item.id === "quality-discharge-documentation");
    expect(quality?.supported).toBe(true);
    expect(quality?.acceptSourceOnly).toBe(true);
    expect(quality?.expectedFiles).toEqual(["MHSP.Discharge.pdf"]);
  });

  it("marks the diffuse duress cases as source-only-acceptable, still supported", () => {
    // The duress-procedure query surfaces the same tangential RKPG cross-reference boilerplate as
    // discharge, so its correct behaviour is a source-only answer citing the duress docs.
    const core = ragEvalCases.find((item) => item.id === "duress-procedure");
    expect(core?.supported).toBe(true);
    expect(core?.acceptSourceOnly).toBe(true);
    expect(core?.expectedFiles).toEqual(["MHSP.Duress.pdf"]);

    const quality = answerQualityEvalCases.find((item) => item.id === "quality-duress-pathway");
    expect(quality?.supported).toBe(true);
    expect(quality?.acceptSourceOnly).toBe(true);
    expect(quality?.expectedFiles).toEqual(["MHSP.Duress.pdf"]);
  });

  it("requires the authoritative clozapine source rather than an unrelated second citation", () => {
    const testCase = ragEvalCases.find((item) => item.id === "clozapine-anc-withhold-threshold");
    expect(testCase).toMatchObject({
      minCitations: 1,
      requireExpectedFileCitation: true,
      expectedFiles: ["CG.MHSP.ClozapinePresAdminMonitor.pdf"],
    });
  });

  it("scores an acceptSourceOnly source-only answer as relevant only when it still cites the expected doc", () => {
    const testCase = answerQualityEvalCases.find((item) => item.id === "quality-discharge-documentation")!;

    const citingExpected = {
      answer: "The uploaded discharge documents are cited below — review them directly.",
      grounded: false,
      confidence: "unsupported",
      citations: [
        {
          chunk_id: "discharge-1",
          document_id: "discharge-doc",
          title: "Discharge",
          file_name: "MHSP.Discharge.pdf",
          page_number: 1,
          chunk_index: 0,
        },
      ],
      sources: [],
      routingMode: "extractive",
      queryClass: "document_lookup",
      answerSections: [],
    } satisfies RagAnswer;
    const withCite = scoreAnswerQualityEvalCase(testCase, citingExpected).find((s) => s.metric === "relevance");
    expect(withCite?.score).toBe(1);

    // A source-only answer that no longer surfaces the expected document must NOT score relevant —
    // otherwise a retrieval regression that stops returning MHSP.Discharge.pdf would hide here.
    // A prose mention of the topic ("discharge") must NOT rescue an uncited answer — coverage is
    // citation-based, not answer-text based (the doc-name alternatives include bare topic tokens).
    const withoutCite = {
      answer: "No current source with discharge documentation guidance was found.",
      grounded: false,
      confidence: "unsupported",
      citations: [],
      sources: [],
      routingMode: "extractive",
      queryClass: "document_lookup",
      answerSections: [],
    } satisfies RagAnswer;
    const noCite = scoreAnswerQualityEvalCase(testCase, withoutCite).find((s) => s.metric === "relevance");
    expect(noCite?.score).toBe(0);
  });

  it("scores answer quality for relevance, readability, artifacts, intent coverage, and fail-closed behavior", () => {
    const testCase = answerQualityEvalCases.find((item) => item.id === "quality-naltrexone-source-gap-specific")!;
    const answer = {
      answer: "No current source with contraindication or avoid-use guidance was found.",
      grounded: false,
      confidence: "unsupported",
      citations: [],
      sources: [],
      routingMode: "unsupported",
      queryClass: "medication_dose_risk",
      answerSections: [],
    } satisfies RagAnswer;

    const scores = scoreAnswerQualityEvalCase(testCase, answer);

    expect(scores.map((score) => score.metric).sort()).toEqual([
      "artifact_leaks",
      "fail_closed",
      "intent_coverage",
      "readability",
      "relevance",
    ]);
    expect(scores.every((score) => score.score === 1)).toBe(true);
  });

  describe("high-risk required facts", () => {
    const testCase = answerQualityEvalCases.find((item) => item.id === "high-risk-interaction-lithium-nsaid")!;
    function intentOf(text: string) {
      const answer = {
        answer: text,
        grounded: true,
        confidence: "high",
        citations: [],
        sources: [],
        routingMode: "fast",
        queryClass: "medication_dose_risk",
        answerSections: [],
      } satisfies RagAnswer;
      return scoreAnswerQualityEvalCase(testCase, answer).find((score) => score.metric === "intent_coverage")!;
    }

    it("passes only when every required fact group is present", () => {
      expect(intentOf("Avoid NSAIDs: they reduce lithium clearance and risk toxicity.").score).toBe(1);
      const missing = intentOf("Avoid NSAIDs because of toxicity.");
      expect(missing.score).toBe(0);
      expect(missing.reason).toContain("required fact missing: clearance / increase lithium levels");
    });

    it("fails a forbidden claim even when every fact is present", () => {
      const forbidden = intentOf("Ibuprofen is safe. Avoid others: reduced clearance and toxicity.");
      expect(forbidden.score).toBe(0);
      expect(forbidden.reason).toBe("forbidden claim: ibuprofen is safe");
      expect(intentOf("**Ibuprofen is safe**. Avoid others: reduced clearance and toxicity.").score).toBe(0);
    });

    it("does not count a required fact the answer negates", () => {
      const red = answerQualityEvalCases.find((item) => item.id === "high-risk-false-premise-clozapine-red-range")!;
      const intent = (text: string) =>
        scoreAnswerQualityEvalCase(red, {
          answer: text,
          grounded: true,
          confidence: "high",
          citations: [],
          sources: [],
          routingMode: "fast",
          queryClass: "medication_dose_risk",
          answerSections: [],
        } satisfies RagAnswer).find((score) => score.metric === "intent_coverage")!;
      expect(intent("Stop clozapine immediately and contact the haematologist.").score).toBe(1);
      const negated = intent("Do not stop clozapine; repeat the count immediately and tell the haematologist.");
      expect(negated.score).toBe(0);
      expect(negated.reason).toContain("stop / discontinue / withhold / cease");
    });

    it("does not count a forbidden claim the answer is correcting", () => {
      expect(
        intentOf(
          "It is not true that ibuprofen is safe. Avoid NSAIDs: they reduce lithium clearance and risk toxicity.",
        ).score,
      ).toBe(1);
      expect(intentOf("NSAIDs are not ideal, but ibuprofen is safe. Avoid others: clearance and toxicity.").score).toBe(
        0,
      );
    });

    it("requires a citation to an expected guideline for relevance", () => {
      const relevanceWith = (citation: Partial<RagAnswer["citations"][number]>) =>
        scoreAnswerQualityEvalCase(testCase, {
          answer: "Avoid NSAIDs: they reduce lithium clearance and risk toxicity.",
          grounded: true,
          confidence: "high",
          citations: [{ chunk_id: "c1", ...citation } as RagAnswer["citations"][number]],
          sources: [],
          routingMode: "fast",
          queryClass: "medication_dose_risk",
          answerSections: [],
        } satisfies RagAnswer).find((score) => score.metric === "relevance")!;
      const unrelated = relevanceWith({ document_id: "d1", title: "Pressure Injury Prevention and Management (FSH)" });
      expect(unrelated.score).toBe(0);
      expect(unrelated.reason).toBe("expected source not cited");
      expect(
        relevanceWith({ document_id: "d2", title: "Lithium Therapy - Initiation And Continuation Guideline(FSH)" })
          .score,
      ).toBe(1);
    });

    it("matches a concept only at a word start, not inside another word", () => {
      const amber = answerQualityEvalCases.find((item) => item.id === "high-risk-monitoring-clozapine-amber-range")!;
      const groups = amber.requiredConceptGroups ?? [];
      const continueGroup = groups.findIndex((group) => group.includes("continue"));
      expect(continueGroup).toBeGreaterThanOrEqual(0);
      const answerWith = (text: string) =>
        ({
          answer: text,
          grounded: true,
          confidence: "high",
          citations: [],
          sources: [],
          routingMode: "fast",
          queryClass: "medication_dose_risk",
          answerSections: [],
        }) satisfies RagAnswer;
      const intent = (text: string) =>
        scoreAnswerQualityEvalCase(amber, answerWith(text)).find((score) => score.metric === "intent_coverage")!;
      expect(intent("Discontinue clozapine now.").reason).toContain(groups[continueGroup].join(" / "));
      expect(intent("Discontinue clozapine now.").score).toBe(0);
    });

    it("matches a quoted range written with an en dash", () => {
      const steadyState = answerQualityEvalCases.find((item) => item.id === "high-risk-renal-lithium-steady-state")!;
      const answer = {
        answer: "In renal impairment lithium may take 7–10 days to reach steady state.",
        grounded: true,
        confidence: "high",
        citations: [],
        sources: [],
        routingMode: "fast",
        queryClass: "medication_dose_risk",
        answerSections: [],
      } satisfies RagAnswer;
      expect(
        scoreAnswerQualityEvalCase(steadyState, answer).find((score) => score.metric === "intent_coverage")!.score,
      ).toBe(1);
    });
  });

  describe("readability: fragmentation and length are scored independently", () => {
    // Packet S2 (#2097, dda4956ff, prompt clinical-rag-answer-v19) moved the answer field to
    // 60-110 words and sections to three-to-six. The old scorer conflated fragmentation and a flat
    // 220-word ceiling into one boolean with one reason ("fragmented or too long"), so a correctly
    // shaped v19 answer could fail for length and be indistinguishable from the fragmentation
    // regression the metric exists to catch. These tests pin the split.
    const qualityCase = answerQualityEvalCases.find((item) => item.id === "quality-discharge-documentation")!;

    function readabilityOf(text: string, sections: RagAnswer["answerSections"] = []) {
      const answer = {
        answer: text,
        grounded: true,
        confidence: "high",
        citations: [],
        sources: [],
        routingMode: "fast",
        queryClass: "document_lookup",
        answerSections: sections,
      } satisfies RagAnswer;
      return scoreAnswerQualityEvalCase(qualityCase, answer).find((score) => score.metric === "readability")!;
    }

    // Clean clinical prose with no fragmentation artefacts: no run-together digit lists, no
    // "? monitoring" break, no glued-together heading token.
    const cleanSentence =
      "Review the admission record and confirm the responsible consultant has documented the current plan. ";

    it("scores a long but clean v19-shaped answer as readable", () => {
      // ~110-word answer plus six sections, the maximum shape prompt v19 asks for. Comfortably over
      // the retired 220-word ceiling, comfortably under the derived 900-word contract ceiling.
      const answerField = Array.from(
        { length: 8 },
        (_, i) => `For lead pathway ${String.fromCharCode(65 + i)}, ${cleanSentence.toLowerCase()}`,
      ).join(" ");
      const sections = Array.from({ length: 6 }, (_, index) => ({
        heading: `Section ${String.fromCharCode(65 + index)}`,
        kind: "required_actions" as const,
        supportLevel: "direct" as const,
        body: Array.from(
          { length: 4 },
          (_, i) =>
            `For pathway ${String.fromCharCode(65 + index)}${String.fromCharCode(65 + i)}, ${cleanSentence.toLowerCase()}`,
        ).join(" "),
        citation_chunk_ids: [],
      })) satisfies RagAnswer["answerSections"];

      const score = readabilityOf(answerField, sections);
      const wordCount = [answerField, ...sections.map((section) => `${section.heading}: ${section.body}`)]
        .join(" ")
        .split(/\s+/)
        .filter(Boolean).length;

      // Guard the guard: this fixture must actually exercise the regression it claims to.
      expect(wordCount).toBeGreaterThan(220);
      expect(wordCount).toBeLessThan(900);
      expect(score.score).toBe(1);
      expect(score.reason).toBe("readable");
    });

    it("still fails a genuinely fragmented answer, and names fragmentation as the reason", () => {
      const score = readabilityOf(
        "Clozapine monitoring anyMANAGEMENT of the neutrophil result follows the escalation pathway.",
      );

      expect(score.score).toBe(0);
      expect(score.reason).toContain("fragmented");
      // Distinguishable from the length failure by the reason alone.
      expect(score.reason).not.toContain("too long");
      expect(score.reason).not.toContain("too short");
    });

    it("still fails a runaway-length answer, and names length as the reason", () => {
      const score = readabilityOf(cleanSentence.repeat(80));

      expect(score.score).toBe(0);
      expect(score.reason).toContain("too long");
      // Distinguishable from the fragmentation failure by the reason alone.
      expect(score.reason).not.toContain("fragmented");
    });

    it("still fails an empty-stub answer as too short", () => {
      const score = readabilityOf("No source.");

      expect(score.score).toBe(0);
      expect(score.reason).toContain("too short");
      expect(score.reason).not.toContain("fragmented");
    });

    it("reports both reasons when an answer is fragmented AND over length", () => {
      const score = readabilityOf(`anyMANAGEMENT ${cleanSentence.repeat(80)}`);

      expect(score.score).toBe(0);
      expect(score.reason).toContain("fragmented");
      expect(score.reason).toContain("too long");
    });
  });

  describe("scoreAnswerTargeting (structural per-intent targeting)", () => {
    const doseCase = {
      id: "t-dose",
      question: "What is the maximum sertraline dose?",
      expectedIntent: "dose",
      supported: true,
      category: "routine",
      expectedFiles: [],
      allowedRoutes: ["fast"],
      minCitations: 1,
      latencyTargetMs: 20000,
    } as unknown as AnswerQualityEvalCase;

    function grounded(text: string, citation: Partial<RagAnswer["citations"][number]> = {}): RagAnswer {
      return {
        answer: text,
        grounded: true,
        confidence: "high",
        citations: [{ chunk_id: "c1", ...citation } as RagAnswer["citations"][number]],
        sources: [],
        answerSections: [],
      } as unknown as RagAnswer;
    }

    it("scores source-backed review stubs as targeting and intent-coverage misses despite echoed clinical terms", () => {
      const redCase = {
        ...doseCase,
        question: "What ANC threshold should trigger clozapine withholding?",
        expectedIntent: "red_result_action",
        mustContainAny: ["ANC", "withhold"],
      } as AnswerQualityEvalCase;
      const substantive = grounded("Monitor clozapine ANC weekly and withhold treatment below 1.5.");
      const reviewStub = {
        ...substantive,
        routingReason:
          "strong_routine_retrieval; generation_fallback:generation_quality_failed; source_backed_review_fallback",
      } as RagAnswer;

      expect(scoreAnswerTargeting(redCase, reviewStub)).toEqual({
        applicable: true,
        score: 0,
        reason: "source-backed review stub",
      });
      expect(
        scoreAnswerQualityEvalCase(redCase, reviewStub).find((score) => score.metric === "intent_coverage"),
      ).toMatchObject({ score: 0, reason: "source-backed review stub" });

      expect(scoreAnswerTargeting(redCase, substantive)).toMatchObject({ applicable: true, score: 1 });
      expect(
        scoreAnswerQualityEvalCase(redCase, substantive).find((score) => score.metric === "intent_coverage"),
      ).toMatchObject({ score: 1, reason: "covered" });
    });

    it("keeps unsupported cases outside the targeting denominator even with a review-fallback marker", () => {
      const unsupportedCase = {
        ...doseCase,
        supported: false,
        category: "unsupported",
      } as AnswerQualityEvalCase;
      const reviewStub = {
        ...grounded("The maximum sertraline dose is available for source-backed review."),
        routingReason: "strong_routine_retrieval; source_backed_review_fallback",
      } as RagAnswer;

      expect(scoreAnswerTargeting(unsupportedCase, reviewStub)).toEqual({
        score: 1,
        applicable: false,
        reason: "n/a: unsupported / fail-closed case",
      });
    });

    it("passes a dose answer that carries a figure+unit", () => {
      const result = scoreAnswerTargeting(doseCase, grounded("The maximum dose is 200 mg daily."));
      expect(result).toMatchObject({ applicable: true, score: 1 });
    });

    it("fails a supported dose answer that carries no dose figure or regimen", () => {
      const bare = scoreAnswerTargeting(doseCase, grounded("Sertraline is an SSRI used for depression."));
      expect(bare).toMatchObject({ applicable: true, score: 0 });
    });

    it("does not count maximum alone as dose targeting", () => {
      const result = scoreAnswerTargeting(doseCase, grounded("The maximum sertraline dose is in the source."));
      expect(result).toMatchObject({ applicable: true, score: 0 });
    });

    it("treats a fail-closed/unsupported case as n/a (not counted)", () => {
      const unsupported = {
        answer: "No current source with dose guidance for this query was found.",
        grounded: false,
        confidence: "unsupported",
        citations: [],
        sources: [],
        answerSections: [],
      } as unknown as RagAnswer;
      expect(scoreAnswerTargeting(doseCase, unsupported)).toMatchObject({ applicable: false, score: 1 });
    });

    it("requires a withhold/stop action with a threshold for red_result_action", () => {
      const redCase = {
        ...doseCase,
        question: "What ANC threshold should trigger clozapine withholding?",
        expectedIntent: "red_result_action",
      } as AnswerQualityEvalCase;
      expect(scoreAnswerTargeting(redCase, grounded("Withhold clozapine if the ANC falls below 1.5."))).toMatchObject({
        score: 1,
      });
      expect(scoreAnswerTargeting(redCase, grounded("Neutropenia is a recognised clozapine risk."))).toMatchObject({
        score: 0,
      });
    });

    it("allows red-result action answers without a numeric threshold when the question asks for action", () => {
      const redCase = {
        ...doseCase,
        question: "What action is required for suspected lithium toxicity?",
        expectedIntent: "red_result_action",
      } as AnswerQualityEvalCase;
      expect(scoreAnswerTargeting(redCase, grounded("Stop lithium and seek urgent medical review."))).toMatchObject({
        applicable: true,
        score: 1,
      });
    });

    it("accepts monitoring level ranges for monitoring cases that ask for a range", () => {
      const monitoringCase = {
        ...doseCase,
        question: "What lithium level range is used for maintenance monitoring?",
        expectedIntent: "monitoring_schedule",
      } as AnswerQualityEvalCase;
      expect(scoreAnswerTargeting(monitoringCase, grounded("The maintenance range is 0.4-0.8 mmol/L."))).toMatchObject({
        applicable: true,
        score: 1,
      });
    });

    it("requires document-lookup targeting to name or cite the expected document", () => {
      const documentCase = {
        ...doseCase,
        question: "What documents support lithium monitoring?",
        expectedIntent: "document_lookup",
        expectedFiles: ["CG.MHSP.Lithium.pdf"],
      } as AnswerQualityEvalCase;

      expect(
        scoreAnswerTargeting(
          documentCase,
          grounded("The monitoring document supports regular review.", {
            file_name: "Unrelated.Policy.pdf",
            title: "Unrelated Policy",
          }),
        ),
      ).toMatchObject({ applicable: true, score: 0 });
      expect(
        scoreAnswerTargeting(
          documentCase,
          grounded("The lithium guideline supports regular review.", {
            file_name: "CG.MHSP.Lithium.pdf",
            title: "CG.MHSP.Lithium",
          }),
        ),
      ).toMatchObject({ applicable: true, score: 1 });
    });

    it("reuses eval document aliases for document-lookup targeting", () => {
      const documentCase = {
        ...doseCase,
        question: "What discharge documentation is required?",
        expectedIntent: "document_lookup",
        expectedFiles: ["MHSP.Discharge.pdf"],
      } as AnswerQualityEvalCase;

      expect(
        scoreAnswerTargeting(
          documentCase,
          grounded("The discharge planning document sets out documentation responsibilities.", {
            file_name: "Admission to Discharge for Mental Health Inpatients (NMHS).pdf",
            title: "Admission to Discharge for Mental Health Inpatients",
          }),
        ),
      ).toMatchObject({ applicable: true, score: 1 });
    });
  });
});

describe("generation degradation offline expectations", () => {
  it("keeps all five fault mechanisms distinct and refuses unsupported completed output", async () => {
    const { generationDegradationOfflineCases, scoreGenerationDegradationObservation } =
      await import("../src/lib/rag/rag-eval-cases");
    const { createGenerationDegradationRecorder } = await import("../src/lib/rag/rag-generation-degradation");
    expect(new Set(generationDegradationOfflineCases.map((c) => c.expectedReason)).size).toBe(5);
    const recorder = createGenerationDegradationRecorder({ enabled: true, routeBudgetMs: 35000 });
    recorder.start({
      route: "strong",
      timeoutMs: 30000,
      outputBudget: "standard",
      retrievalHealthy: true,
      coverage: "complete",
      contextCount: 1,
    });
    recorder.fail("timeout", 30000);
    const record = recorder.finish(
      {
        answer: "Withhold the medicine.",
        grounded: true,
        citations: [{ chunk_id: "s", document_id: "d" }],
        sources: [{ id: "s", document_id: "d" }],
      },
      true,
    )!;
    expect(scoreGenerationDegradationObservation(record, generationDegradationOfflineCases[0])).toBe(true);
    expect(
      scoreGenerationDegradationObservation(
        { ...record, completedOutput: { ...record.completedOutput, useful: false } },
        generationDegradationOfflineCases[0],
      ),
    ).toBe(false);
    expect(scoreGenerationDegradationObservation(record, generationDegradationOfflineCases[1])).toBe(false);
  });
});

it("scores a legal maximum adaptive allocation beyond the retired 900-word estimate", async () => {
  const { adaptiveAnswerLimits: limits } = await import("@/lib/rag/rag-answer-contract-limits");
  // Synthetic short tokens test the character contract, not clinical quality.
  const words = Array.from({ length: 1250 }, (_, i) =>
    String.fromCharCode(97 + Math.floor(i / 676), 97 + (Math.floor(i / 26) % 26), 97 + (i % 26)),
  );
  const answer: RagAnswer = {
    answerContractVersion: "clinical-rag-answer-v20",
    renderAdaptiveAnswer: false,
    answer: words.slice(0, 550).join(" "),
    grounded: true,
    confidence: "high",
    citations: [],
    sources: [],
    answerSections: [
      { heading: "A", body: words.slice(550, 1100).join(" "), citation_chunk_ids: [] },
      { heading: "B", body: words.slice(1100).join(" "), citation_chunk_ids: [] },
    ],
  };
  const testCase = answerQualityEvalCases[0];
  expect(words.length).toBeGreaterThan(900);
  const read = (value: RagAnswer) =>
    scoreAnswerQualityEvalCase(testCase, value).find((score) => score.metric === "readability")!;
  expect(read(answer).score).toBe(1);
  const total = answer.answer.length + answer.answerSections!.reduce((n, s) => n + s.heading.length + s.body.length, 0);
  answer.answerSections![1].body += "x".repeat(limits.total - total + 1);
  expect(read(answer)).toMatchObject({ score: 0 });
  expect(read(answer).reason).toContain("too long");
});

it("keeps runaway duplication independent of legal adaptive size", () => {
  const answer: RagAnswer = {
    answerContractVersion: "clinical-rag-answer-v20",
    renderAdaptiveAnswer: false,
    answer: "Review the supported action and document the agreed plan. ".repeat(10),
    grounded: true,
    confidence: "high",
    citations: [],
    sources: [],
  };
  expect(
    scoreAnswerQualityEvalCase(answerQualityEvalCases[0], answer).find((score) => score.metric === "readability"),
  ).toMatchObject({ score: 0, reason: "runaway duplication" });
});
