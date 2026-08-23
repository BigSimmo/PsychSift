import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { citationFromResult } from "../src/lib/citations";
import {
  answerRouteBudgetMs,
  answerRouteResultCanBeCached,
  generationRecoveryReserveMs,
} from "../src/lib/rag/rag-route-budget";
import type { RagAnswer, SearchResult } from "../src/lib/types";

function retrievalRpcBaseName(name: string) {
  return name.replace(/_v[23]$/, "");
}

function source(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "agitation-chunk-1",
    document_id: "agitation-doc",
    title: "Agitation and Arousal Pharmacological Management",
    file_name: "MHSP.AgitationArousalPharmaMgt.pdf",
    page_number: 8,
    chunk_index: 0,
    section_heading: "Appendix 1",
    content:
      "Agitation and arousal pharmacological management for adult mental health inpatients. Step 1 uses oral medication when the patient is willing. Step 2 considers increased agitation and arousal ratings with oral benzodiazepines or antipsychotics. Step 3 uses intramuscular medication when oral medication is refused.",
    image_ids: [],
    similarity: 0.97,
    hybrid_score: 0.97,
    text_rank: 1.1,
    source_metadata: {
      source_title: "Agitation source",
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
    ...overrides,
  };
}

class EmptyQuery implements PromiseLike<{ data: unknown[]; error: null }> {
  select() {
    return this;
  }

  in() {
    return this;
  }

  eq() {
    return this;
  }

  neq() {
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return Promise.resolve({ data: [], error: null });
  }

  then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected);
  }
}

type GeneratedAnswerPayload = {
  answer: string;
  grounded: boolean;
  confidence: "high" | "medium" | "low" | "unsupported";
  answerSections?: unknown[];
  citations?: Array<{ chunk_id: string }>;
  quoteCards?: unknown[];
  conflictsOrGaps?: unknown[];
};

type GeneratedAnswerAttempt = GeneratedAnswerPayload | Error | "truncated";

async function answerFromTextSources(
  query: string,
  sources: SearchResult[],
  generatedAnswer?: GeneratedAnswerAttempt | GeneratedAnswerAttempt[],
  options: { sourceOnly?: boolean } = {},
) {
  // `src/lib/env.ts` freezes process.env at module load. The offline vitest wrapper
  // starts every worker as RAG_PROVIDER_MODE=offline with a blank OpenAI key, so we
  // must re-parse env after stubbing — otherwise the first test in this file keeps
  // the runner's offline snapshot and never exercises the mocked provider path.
  vi.resetModules();
  vi.stubEnv("OPENAI_API_KEY", options.sourceOnly ? "" : "test-key");
  vi.stubEnv("RAG_PROVIDER_MODE", options.sourceOnly ? "offline" : "auto");
  vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
  vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

  const rpc = vi.fn(async (name: string) => {
    if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: sources, error: null };
    if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
    return { data: [], error: null };
  });

  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: () => ({
      rpc,
      from: vi.fn(() => new EmptyQuery()),
    }),
  }));
  let generatedAnswerAttemptIndex = 0;
  const generateStructuredTextResult = vi.fn(async () => {
    const attempt = Array.isArray(generatedAnswer) ? generatedAnswer[generatedAnswerAttemptIndex++] : generatedAnswer;
    if (attempt === "truncated") {
      return {
        text: "",
        model: "gpt-4.1-mini",
        operation: "answer",
        latencyMs: 12,
        requestId: "req_answer_from_text_sources_truncated",
        usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
        status: "incomplete" as const,
        truncated: true,
        incompleteReason: "max_output_tokens",
      };
    }
    if (attempt instanceof Error) throw attempt;
    return {
      text: JSON.stringify(
        attempt ?? {
          answer: "No current source with specific guidance for this query was found.",
          grounded: false,
          confidence: "unsupported",
          answerSections: [],
          citations: [],
          quoteCards: [],
          conflictsOrGaps: [],
        },
      ),
      model: "gpt-4.1-mini",
      operation: "answer",
      latencyMs: 12,
      requestId: "req_answer_from_text_sources",
      usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
    };
  });

  vi.doMock("@/lib/openai", () => ({
    embedTextWithTelemetry: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false })),
    generateStructuredTextResult,
  }));

  const { answerQuestionWithScope } = await import("../src/lib/rag/rag");
  return answerQuestionWithScope({
    query,
    ownerId: undefined,
    logQuery: false,
    skipCache: true,
  });
}

beforeEach(() => {
  // The default runner removes real provider credentials and selects offline mode.
  // This suite supplies a fully mocked provider and must exercise those fake paths.
  vi.stubEnv("RAG_PROVIDER_MODE", "auto");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("@/lib/rag/rag-routing");
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("RAG structured-output fallback", () => {
  it("records the specific quality-gate verdict when an unverified figure forces the source-only fallback (#231)", async () => {
    // A realistic rejected payload, not an injected Error: the generated answer cites the
    // right chunk but states 500 mg where the source says 250 mg. Deterministic numeric
    // verification cannot match the figure, the post-finalize gate throws, and the answer
    // degrades to a cited source-backed fallback. The degraded token stays unchanged; the
    // specific verdict must now survive in answer_retry_reasons.
    const answer = await answerFromTextSources(
      "Lithium dosing?",
      [
        source({
          id: "lithium-dose-source",
          document_id: "lithium-guideline",
          title: "Medication guideline",
          file_name: "medication-guideline.pdf",
          section_heading: "Lithium initiation",
          content: "Start lithium carbonate at 250 mg once daily and review tolerability before titration.",
          similarity: 0.94,
          hybrid_score: 0.94,
          text_rank: 0.09,
        }),
      ],
      {
        answer: "Start lithium carbonate at 500 mg once daily.",
        grounded: true,
        confidence: "high",
        answerSections: [],
        citations: [{ chunk_id: "lithium-dose-source" }],
        quoteCards: [],
        conflictsOrGaps: [],
      },
    );

    // Conservative failure behaviour is preserved: no generated prose is returned as-is.
    expect(answer.routingReason).toContain("generation_fallback:generation_quality_failed");
    // The structured verdict that used to be discarded is now recorded.
    expect(answer.latencyTimings?.answer_retry_reasons).toContain("generation_quality_gate:numeric_faithfulness_gap");
    // The unverified figure never reaches the delivered answer unmarked as verified text.
    expect(answer.grounded).toBe(true);
    expect(answer.citations.length).toBeGreaterThan(0);
  });

  it("preserves the initial strong quality verdict when its repair attempt truncates", async () => {
    const sources = [
      source({
        id: "quality-retry-source-a",
        document_id: "quality-retry-guide-a",
        content: "Guide A outlines routine monitoring steps and referral thresholds.",
      }),
      source({
        id: "quality-retry-source-b",
        document_id: "quality-retry-guide-b",
        content: "Guide B outlines a second monitoring pathway and escalation thresholds.",
      }),
    ];
    const templateLikeAnswer: GeneratedAnswerPayload = {
      answer: "Compare the document monitoring pathways using the source-backed guidance.",
      grounded: true,
      confidence: "high",
      answerSections: [],
      citations: [{ chunk_id: "quality-retry-source-a" }],
      quoteCards: [],
      conflictsOrGaps: [],
    };

    const answer = await answerFromTextSources("Compare document monitoring pathways across two guides", sources, [
      templateLikeAnswer,
      templateLikeAnswer,
      "truncated",
    ]);

    expect(answer.latencyTimings?.answer_retry_reasons).toContain("fast_template_retry_strong");
    expect(answer.latencyTimings?.answer_retry_reasons).toContain("strong_quality_retry");
    // The preserved verdict is whatever generatedAnswerQualityFailureReason returned for the
    // strong answer at gate time. Current sanitizeAnswerText strips this fixture's template
    // answer to nothing, so the first check in the ladder (empty_after_sanitize) wins over
    // template_like_answer; the assertion pins preservation, not the ladder's tie-break.
    expect(answer.latencyTimings?.answer_retry_reasons).toContain("generation_quality_gate:empty_after_sanitize");
  });

  it("records the cited-refusal verdict when generation returns a provider source gap (#231)", async () => {
    const answer = await answerFromTextSources(
      "Lithium dosing?",
      [
        source({
          id: "lithium-dose-source",
          document_id: "lithium-guideline",
          title: "Medication guideline",
          file_name: "medication-guideline.pdf",
          section_heading: "Lithium initiation",
          content: "Start lithium carbonate at 250 mg once daily and review tolerability before titration.",
          similarity: 0.94,
          hybrid_score: 0.94,
          text_rank: 0.09,
        }),
      ],
      {
        answer: "No current source with specific guidance for this query was found.",
        grounded: false,
        confidence: "unsupported",
        answerSections: [],
        citations: [{ chunk_id: "lithium-dose-source" }],
        quoteCards: [],
        conflictsOrGaps: [],
      },
    );

    expect(answer.routingReason).toContain("generation_fallback");
    expect(answer.latencyTimings?.answer_retry_reasons).toContain("generation_quality_gate:provider_source_gap");
  });

  it("recovers a cited provider source gap instead of treating nearby citations as a grounded answer", async () => {
    const dischargeSources = [
      source({
        id: "discharge-planning-start",
        document_id: "discharge-guidance",
        title: "Admission to Discharge for Mental Health Inpatients (NMHS)",
        file_name: "Admission to Discharge for Mental Health Inpatients (NMHS).pdf",
        section_heading: "Discharge planning",
        content:
          "Clinicians will actively plan effective and timely discharge from the beginning of admission and review the plan throughout the inpatient stay.",
      }),
      source({
        id: "discharge-documentation",
        document_id: "discharge-guidance",
        title: "Admission to Discharge for Mental Health Inpatients (NMHS)",
        file_name: "Admission to Discharge for Mental Health Inpatients (NMHS).pdf",
        section_heading: "Discharge documentation",
        content:
          "The discharge plan must document ongoing care arrangements, communicate the plan with the consumer, and identify follow-up responsibilities.",
      }),
    ];
    const answer = await answerFromTextSources("Summarize the discharge guidance", dischargeSources, {
      answer: "No current source with directly relevant clinical guidance was found.",
      grounded: false,
      confidence: "low",
      answerSections: [
        {
          heading: "Source gap",
          kind: "source_gap",
          supportLevel: "unsupported",
          body: "The retrieved excerpts do not provide sufficient discharge guidance.",
          citation_chunk_ids: ["discharge-planning-start"],
        },
      ],
      citations: [{ chunk_id: "discharge-planning-start" }, { chunk_id: "discharge-documentation" }],
      quoteCards: [],
      conflictsOrGaps: [],
    });

    expect(answer.routingMode).toBe("extractive");
    expect(answer.routingReason).toContain("generation_fallback:provider_source_gap");
    expect(answer.routingReason).toContain("source_backed_extractive_fallback");
    expect(answer.routingReason).not.toContain("source_backed_review_fallback");
    expect(answer.grounded).toBe(true);
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.answer).not.toMatch(/^No current source/i);
  });

  it("recovers a grounded low-confidence cited source-gap phrasing at the final quality gate without a strong retry", async () => {
    // The S1d shape: grounded, cited, confidence "low", substantive lead misses
    // providerSourceGapLeadPattern, hedged body matches the finalizer's broad
    // gap-like regex ("do not provide specific") and survives sanitizeAnswerText.
    // It passes every in-loop fast-failure screen and used to collapse to a
    // citation-free evidence_gap in finalizeRagAnswerQualityCore.
    const dischargeSources = [
      source({
        id: "discharge-planning-start",
        document_id: "discharge-guidance",
        title: "Admission to Discharge for Mental Health Inpatients (NMHS)",
        file_name: "Admission to Discharge for Mental Health Inpatients (NMHS).pdf",
        section_heading: "Discharge planning",
        content:
          "Clinicians will actively plan effective and timely discharge from the beginning of admission and review the plan throughout the inpatient stay.",
      }),
      source({
        id: "discharge-documentation",
        document_id: "discharge-guidance",
        title: "Admission to Discharge for Mental Health Inpatients (NMHS)",
        file_name: "Admission to Discharge for Mental Health Inpatients (NMHS).pdf",
        section_heading: "Discharge documentation",
        content:
          "The discharge plan must document ongoing care arrangements, communicate the plan with the consumer, and identify follow-up responsibilities.",
      }),
    ];
    const answer = await answerFromTextSources("Summarize the discharge guidance", dischargeSources, {
      answer:
        "Discharge planning begins at admission and the plan is reviewed during the inpatient stay. The discharge documents do not provide specific timing details.",
      grounded: true,
      confidence: "low",
      answerSections: [],
      citations: [{ chunk_id: "discharge-planning-start" }, { chunk_id: "discharge-documentation" }],
      quoteCards: [],
      conflictsOrGaps: [],
    });

    expect(answer.routingMode).toBe("extractive");
    expect(answer.routingReason).toContain("generation_fallback:provider_source_gap");
    expect(answer.routingReason).toContain("source_backed_extractive_fallback");
    expect(answer.routingReason).toContain("final_quality_gate_source_backed_recovery:provider_source_gap");
    expect(answer.routingReason).not.toMatch(/final_quality_gate:/);
    expect(answer.grounded).toBe(true);
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.answer).not.toMatch(/do not provide specific/i);
    expect(answer.latencyTimings?.answer_retry_reasons ?? []).not.toContain("fast_source_gap_retry_strong");
    expect(answer.latencyTimings?.answer_retry_reasons ?? []).not.toContain("fast_unsupported_retry_strong");
    expect(answer.latencyTimings?.answer_retry_reasons ?? []).not.toContain("fast_quality_retry_strong");
  });

  it("keeps provider-failed complex comparisons on the source-attributed comparison fallback", async () => {
    const comparisonFact = (documentId: string, chunkId: string, value: string) => ({
      id: `${documentId}-threshold`,
      document_id: documentId,
      source_chunk_id: chunkId,
      source_image_id: null,
      page_number: 2,
      table_title: "ANC thresholds",
      row_label: "Red range",
      clinical_parameter: "ANC",
      threshold_value: value,
      action: "Withhold and repeat FBC",
    });
    const answer = await answerFromTextSources(
      "Compare and reconcile the clinical implications of these ANC thresholds",
      [
        source({
          id: "chunk-a",
          document_id: "doc-a",
          title: "Protocol A",
          table_facts: [comparisonFact("doc-a", "chunk-a", "below 1.5 x 10^9/L")],
        }),
        source({
          id: "chunk-b",
          document_id: "doc-b",
          title: "Protocol B",
          table_facts: [comparisonFact("doc-b", "chunk-b", "below 1.0 x 10^9/L")],
        }),
      ],
      new Error("mock provider unavailable"),
    );

    expect(answer.comparisonEvaluationState).toBe("evaluated");
    expect(answer.comparisonMatrix?.rows[0]?.status).toBe("conflict");
    expect(answer.answer).toContain("Protocol A: below 1.5 x 10^9/L");
    expect(answer.answer).toContain("Protocol B: below 1.0 x 10^9/L");
    expect(answer.routingReason).toContain("generation_fallback");
    expect(answer.routingReason).toContain("comparison_source_safe_fallback");
    expect(answer.routingReason).not.toContain("source_backed_extractive_fallback");
  });

  it("recovers a generated comparison with an uncited high-risk value through the source-safe fallback", async () => {
    const comparisonFact = (documentId: string, chunkId: string, value: string) => ({
      id: `${documentId}-threshold`,
      document_id: documentId,
      source_chunk_id: chunkId,
      source_image_id: null,
      page_number: 2,
      table_title: "ANC thresholds",
      row_label: "Red range",
      clinical_parameter: "ANC",
      threshold_value: value,
      action: "Withhold and repeat FBC",
    });
    const answer = await answerFromTextSources(
      "Compare and reconcile the clinical implications of these ANC thresholds",
      [
        source({
          id: "chunk-a",
          document_id: "doc-a",
          title: "Protocol A",
          table_facts: [comparisonFact("doc-a", "chunk-a", "below 1.5 x 10^9/L")],
        }),
        source({
          id: "chunk-b",
          document_id: "doc-b",
          title: "Protocol B",
          table_facts: [comparisonFact("doc-b", "chunk-b", "below 1.0 x 10^9/L")],
        }),
      ],
      {
        answer: "Protocol A uses below 1.5 x 10^9/L, while Protocol B uses below 1.0 x 10^9/L; both require action.",
        grounded: true,
        confidence: "high",
        answerSections: [],
        citations: [{ chunk_id: "chunk-a" }],
        quoteCards: [],
        conflictsOrGaps: [],
      },
    );

    expect(answer.grounded).toBe(true);
    expect(answer.routingMode).toBe("extractive");
    expect(answer.routingReason).toContain("generation_fallback:generation_quality_failed");
    expect(answer.routingReason).toContain("comparison_source_safe_fallback");
    expect(answer.answer).toContain("Protocol A: below 1.5 x 10^9/L");
    expect(answer.answer).toContain("Protocol B: below 1.0 x 10^9/L");
    expect(answer.unverifiedNumericTokens).toBeUndefined();
  });

  async function answerWithLiveAdmissionDischargeComparisonShape() {
    // #019 reproducer: retrieval and deterministic comparison packing retain the admission
    // and discharge documents, and the extractive fallback must keep the citations that
    // support its delivered answer sections.
    return answerFromTextSources(
      "Compare admission and discharge requirements",
      [
        source({
          id: "combined-policy",
          document_id: "combined-policy-doc",
          title: "Referral, Admission And Discharge - Mental Health Hospital In The Home",
          file_name: "Referral, Admission and Discharge - MHHITH.pdf",
          content: "Referral procedure, consultant acceptance and patient-flow allocation.",
          hybrid_score: 0.2898,
          lexical_score: 0.99,
          score_explanation: { rankScore: 1.5365 } as NonNullable<SearchResult["score_explanation"]>,
        }),
        source({
          id: "discharge-community",
          document_id: "discharge-community-doc",
          title: "Discharge Planning For Community Patients",
          file_name: "MHSP.Discharge.pdf",
          content: [
            "5. Discharge Planning",
            "Discharge planning must be integral in the following stages of a consumer’s transition through a",
            "community service:",
          ].join("\n"),
          hybrid_score: 0.3892,
          lexical_score: 0.99,
          score_explanation: { rankScore: 1.1365 } as NonNullable<SearchResult["score_explanation"]>,
        }),
        source({
          id: "discharge-community-sibling",
          document_id: "discharge-community-doc",
          title: "Discharge Planning For Community Patients",
          file_name: "MHSP.Discharge.pdf",
          content: "Community staff document the discharge plan and ongoing care arrangements.",
          hybrid_score: 0.3882,
          lexical_score: 0.95,
          score_explanation: { rankScore: 1.0204 } as NonNullable<SearchResult["score_explanation"]>,
        }),
        source({
          id: "admission-community",
          document_id: "admission-community-doc",
          title: "Admission Of Community Patients",
          file_name: "MHSP.AdmissionCommunityPts.pdf",
          content: [
            "admitted and managed on an open ward is",
            "the responsibility of the accepting treating Consultant in discussion with the ANUM",
            "responsible for that area or if afterhours the On-Call Consultant in discussion with the",
            "Afterhours Mental Health CNS.",
            "",
            "Where there are indications of intoxication or physical health issues, the referring clinician will",
            "provide a medical clearance or if the consumer is a being referred from AKG Community Mental",
            "health team member then they are to be referred to the Armadale Health Service Emergency",
            "Department (AHS-ED) to obtain medical clearance.",
            "The Bed flow coordinator, in consultation with the Consultant Psychiatrist/On Call Consultant,",
            "will arrange the prioritisation of beds.",
            "When a bed is not available, the referring mental health clinician is to liaise with the EMHS",
            "Patient Flow Coordinator Mental Health to locate a bed at an alternative health service, as per:",
            "EMHS Mental Health Patient Flow and Bed Capacity Framework (Summary Sheet)",
            "2.2 Admissions Accompanied by Police",
          ].join("\n"),
          hybrid_score: 0.376,
          lexical_score: 0.95,
          score_explanation: { rankScore: 1.3325 } as NonNullable<SearchResult["score_explanation"]>,
        }),
        source({
          id: "admission-community-sibling",
          document_id: "admission-community-doc",
          title: "Admission Of Community Patients",
          file_name: "MHSP.AdmissionCommunityPts.pdf",
          content: "Admissions policy document control metadata without a clinical requirement.",
          hybrid_score: 0.3757,
          lexical_score: 0.95,
          score_explanation: { rankScore: 1.3082 } as NonNullable<SearchResult["score_explanation"]>,
        }),
        source({
          id: "patient-discharge",
          document_id: "patient-discharge-doc",
          title: "Patient Discharge Policy And Procedure",
          file_name: "Patient Discharge Policy.pdf",
          content: "Discharge requirements include clinical handover, referral and documented follow-up.",
          hybrid_score: 0.2847,
          lexical_score: 0.9,
          score_explanation: { rankScore: 0.9318 } as NonNullable<SearchResult["score_explanation"]>,
        }),
        source({
          id: "falls-distractor",
          document_id: "falls-doc",
          title: "Falls Prevention And Management",
          file_name: "Falls Prevention.pdf",
          content: "Rehabilitation discharge planning and progress notes are documented after medical review.",
          hybrid_score: 0.2361,
          lexical_score: 0.82,
          score_explanation: { rankScore: 0.6534 } as NonNullable<SearchResult["score_explanation"]>,
        }),
      ],
      new Error("OpenAI generation quality gate failed: comparison coverage"),
    );
  }

  function currentLiveAdmissionDischargeRankShape() {
    return [
      source({
        id: "live-discharge-planning",
        document_id: "live-discharge-planning-doc",
        title: "Discharge Planning For Community Patients(NMHS)",
        file_name: "Discharge Planning for Community Patients (NMHS).pdf",
        content: [
          "The consumer must be consulted about information sharing before transition planning.",
          "5. Discharge Planning",
          "Discharge planning must be integral in the following stages of a consumer’s transition through a",
          "community service:",
        ].join("\n"),
      }),
      source({
        id: "live-discharge-cover",
        document_id: "live-discharge-planning-doc",
        title: "Discharge Planning For Community Patients(NMHS)",
        file_name: "Discharge Planning for Community Patients (NMHS).pdf",
        content: "Procedure cover page and document-control metadata.",
      }),
      source({
        id: "live-combined-policy",
        document_id: "live-combined-policy-doc",
        title:
          "Referral, Admission And Discharge - Mental Health Hospital In The Home(MHHITH) Policy And Procedure(RKPG)",
        file_name:
          "Referral, Admission and Discharge - Mental Health Hospital in the Home (MHHITH) Policy and Procedure (RKPG).pdf",
        content: "Referral procedure, consultant acceptance and patient-flow allocation.",
      }),
      source({
        id: "live-patient-discharge",
        document_id: "live-patient-discharge-doc",
        title: "Patient Discharge Policy And Procedure(RKPG)",
        file_name: "Patient Discharge Policy and Procedure (RKPG).pdf",
        content: "Discharge requires a transfer-of-care summary and documented seven-day follow-up planning.",
      }),
      source({
        id: "live-falls-distractor",
        document_id: "live-falls-distractor-doc",
        title: "Falls Prevention And Management(AKG)",
        file_name: "Falls Prevention and Management (AKG).pdf",
        content: "Community rehabilitation can facilitate early supported discharge after falls care.",
      }),
      source({
        id: "live-follow-up-distractor",
        document_id: "live-follow-up-distractor-doc",
        title: "Discharge Follow - Up For Inpatients(FSH)",
        file_name: "Discharge Follow-Up for Inpatients (FSH).pdf",
        content: "Staff document post-discharge follow-up contacts in the clinical record.",
      }),
      source({
        id: "live-admission-bed-flow",
        document_id: "live-admission-community-doc",
        title: "Admission Of Community Patients(AKG)",
        file_name: "Admission of Community Patients (AKG).pdf",
        content: "2.2 Admissions Accompanied by Police. Property and personal effects may be damaged during transfer.",
      }),
      source({
        id: "live-admission-clearance",
        document_id: "live-admission-community-doc",
        title: "Admission Of Community Patients(AKG)",
        file_name: "Admission of Community Patients (AKG).pdf",
        content: [
          "Where there are indications of",
          "intoxication or physical health",
          "issues, the referring clinician will",
          "provide a medical clearance or if the",
          "consumer is referred from the community team, they are to attend the emergency department to obtain medical clearance.",
          "The bed flow coordinator will arrange the prioritisation of beds.",
        ].join("\n"),
      }),
    ];
  }

  it("retains the live-shape route and both documents before comparison citation compaction", async () => {
    const answer = await answerWithLiveAdmissionDischargeComparisonShape();

    expect(answer.routingReason).toContain("comparison_source_extractive_fallback");
    expect(answer.routingMode).toBe("extractive");
    expect(answer.sources.some((item) => item.file_name === "MHSP.AdmissionCommunityPts.pdf")).toBe(true);
    expect(answer.sources.some((item) => item.file_name === "MHSP.Discharge.pdf")).toBe(true);
  });

  it("retains the admission and discharge citations when the live comparison shape falls through generation", async () => {
    const answer = await answerWithLiveAdmissionDischargeComparisonShape();

    expect(answer.answer).toContain("medical clearance");
    expect(answer.answer).toContain("Discharge planning must be integral");
    expect(answer.answer).not.toContain("2.2 Admissions Accompanied by Police");
    expect(answer.answer).not.toContain(":.");
    expect(answer.answerSections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          heading: "Admission evidence",
          citation_chunk_ids: ["admission-community"],
        }),
        expect.objectContaining({
          heading: "Discharge evidence",
          citation_chunk_ids: ["discharge-community"],
        }),
      ]),
    );
    expect(answer.citations.map((item) => item.file_name)).toEqual(
      expect.arrayContaining(["MHSP.AdmissionCommunityPts.pdf", "MHSP.Discharge.pdf"]),
    );
  });

  it("recovers the late-ranked admission source after a generated comparison fails final claim support", async () => {
    const answer = await answerFromTextSources(
      "Compare admission and discharge requirements",
      currentLiveAdmissionDischargeRankShape(),
      {
        answer:
          "Admission requires a signed consultant order before transfer, while discharge requires a seven-day medicine supply before release.",
        grounded: true,
        confidence: "high",
        answerSections: [],
        citations: [{ chunk_id: "live-admission-clearance" }, { chunk_id: "live-discharge-planning" }],
        quoteCards: [],
        conflictsOrGaps: [],
      },
    );

    expect(answer.routingReason).toContain("validated_admission_discharge_extractive_first");
    expect(answer.routingReason).toContain("comparison_source_extractive_fallback");
    expect(answer.routingReason).not.toContain("source_backed_review_fallback");
    expect(answer.openAIRequestIds ?? []).toEqual([]);
    expect(answer.latencyTimings?.generation_latency_ms).toBe(0);
    expect(answer.responseMode).toBe("checklist");
    expect(answer.smartApiPlan).toMatchObject({
      intent: "compare_sources",
      responseMode: "multi_document_synthesis",
      displayMode: "checklist",
      answerPlan: {
        intent: "clinical_synthesis",
        routeMode: "extractive",
        modelStrategy: "extractive_lookup",
        fallbackBehavior: "extractive_lookup_only",
        sourcePolicy: "required_citations",
      },
    });
    expect(answer.smartApiPlan?.answerPlan.qualityCriteria).not.toContain("do_not_generate_clinical_advice");
    expect(answer.grounded).toBe(true);
    expect(answer.citations.map((citation) => citation.chunk_id)).toEqual([
      "live-admission-clearance",
      "live-discharge-planning",
    ]);
    expect(answer.sources.slice(0, 2).map((result) => result.id)).toEqual([
      "live-admission-clearance",
      "live-discharge-planning",
    ]);
    expect(answer.sources.slice(2).map((result) => result.id)).toEqual(
      expect.arrayContaining([
        "live-combined-policy",
        "live-follow-up-distractor",
        "live-discharge-cover",
        "live-patient-discharge",
        "live-admission-bed-flow",
        "live-falls-distractor",
      ]),
    );
  });

  it("keeps non-requirement admission and discharge comparisons on the generic extractive path", async () => {
    const answer = await answerFromTextSources(
      "Compare admission and discharge medication reconciliation",
      [
        source({
          id: "medication-reconciliation",
          document_id: "medication-reconciliation-doc",
          title: "Medication Reconciliation At Care Transitions",
          content:
            "Staff document admission and discharge medication reconciliation, including medicine histories and transfer changes.",
        }),
      ],
      new Error("mock provider unavailable"),
    );

    expect(answer.grounded).toBe(true);
    expect(answer.responseMode).not.toBe("evidence_gap");
    expect(answer.answer).toContain("admission and discharge medication reconciliation");
    expect(answer.answerSections).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ heading: "Admission evidence" }),
        expect.objectContaining({ heading: "Discharge evidence" }),
      ]),
    );
  });

  const sourceBoundAdmissionDischargeScopeTrap = () => [
    source({
      id: "scope-trap-admission",
      document_id: "scope-trap-admission-doc",
      title: "Admission Of Community Patients",
      content: "The referring clinician must provide medical clearance before transfer.",
      table_facts: [
        {
          id: "scope-trap-admission-fact",
          document_id: "scope-trap-admission-doc",
          source_chunk_id: "scope-trap-admission",
          source_image_id: null,
          page_number: 1,
          table_title: "Admission requirements",
          row_label: "Medical clearance",
          clinical_parameter: "Medical clearance",
          threshold_value: "Required before transfer",
          action: "Provide medical clearance.",
        },
      ],
    }),
    source({
      id: "scope-trap-discharge",
      document_id: "scope-trap-discharge-doc",
      title: "Discharge Planning For Community Patients",
      content: "Discharge planning must include documented ongoing care arrangements.",
      table_facts: [
        {
          id: "scope-trap-discharge-fact",
          document_id: "scope-trap-discharge-doc",
          source_chunk_id: "scope-trap-discharge",
          source_image_id: null,
          page_number: 1,
          table_title: "Discharge requirements",
          row_label: "Medical clearance",
          clinical_parameter: "Medical clearance",
          threshold_value: "Required before discharge",
          action: "Complete medical clearance and care planning.",
        },
      ],
    }),
  ];

  it.each([
    "Compare admission and discharge requirements for medication reconciliation",
    "Compare admission and discharge requirements that do not involve medical clearance or care planning",
  ])("does not promote the source-bound comparison after provider failure for: %s", async (query) => {
    const answer = await answerFromTextSources(
      query,
      sourceBoundAdmissionDischargeScopeTrap(),
      new Error("mock provider unavailable"),
    );

    const delivered =
      `${answer.answer} ${(answer.answerSections ?? []).map((section) => section.body).join(" ")}`.replace(/\*\*/g, "");
    expect(answer.grounded).toBe(false);
    expect(answer.confidence).toBe("unsupported");
    expect(answer.responseMode).toBe("evidence_gap");
    expect(answer.citations).toEqual([]);
    expect(answer.answerSections).toEqual([]);
    expect(answer.routingReason).toContain("structured_comparison_matrix");
    expect(answer.routingReason).toContain("comparison_evidence_gap");
    expect(answer.routingReason).not.toContain("validated_admission_discharge_extractive_first");
    expect(answer.routingReason).not.toContain("comparison_source_extractive_fallback");
    expect(delivered).not.toMatch(/medical clearance|ongoing care arrangements/i);
  });

  it.each([
    "Compare admission and discharge requirements for medication reconciliation",
    "Compare admission and discharge requirements that do not involve medical clearance or care planning",
  ])("does not promote the source-bound comparison in source-only mode for: %s", async (query) => {
    const answer = await answerFromTextSources(query, sourceBoundAdmissionDischargeScopeTrap(), undefined, {
      sourceOnly: true,
    });

    const delivered =
      `${answer.answer} ${(answer.answerSections ?? []).map((section) => section.body).join(" ")}`.replace(/\*\*/g, "");
    expect(answer.routingReason).toContain("source_only_offline_mode");
    expect(answer.routingReason).not.toContain("comparison_source_extractive_fallback");
    expect(answer.grounded).toBe(false);
    expect(answer.confidence).toBe("unsupported");
    expect(answer.responseMode).toBe("evidence_gap");
    expect(answer.citations).toEqual([]);
    expect(answer.answerSections).toEqual([]);
    expect(answer.routingReason).toContain("comparison_evidence_gap");
    expect(answer.routingReason).not.toContain("validated_admission_discharge_extractive_first");
    expect(answer.latencyTimings?.generation_latency_ms).toBe(0);
    expect(answer.openAIRequestIds ?? []).toEqual([]);
    expect(delivered).not.toMatch(/medical clearance|ongoing care arrangements/i);
  });

  it("does not force unrelated admission or discharge mentions into a comparison", async () => {
    const answer = await answerFromTextSources(
      "Compare admission and discharge requirements",
      [
        source({
          id: "bed-capacity",
          document_id: "bed-capacity-doc",
          title: "High Observation Bed Capacity",
          content: "Escorted admissions may require a high-observation bed.",
        }),
        source({
          id: "falls-discharge",
          document_id: "falls-doc",
          title: "Falls Prevention And Management",
          content: "Rehabilitation discharge planning follows medical review.",
        }),
      ],
      new Error("mock provider unavailable"),
    );

    expect(answer.grounded).toBe(false);
    expect(answer.responseMode).toBe("evidence_gap");
    expect(answer.routingReason).toContain("comparison_evidence_gap");
    expect(answer.citations).toEqual([]);
    expect(answer.answerSections).toEqual([]);
  });

  it("returns an evidence gap when one requested comparison side lacks a source-bound claim", async () => {
    const answer = await answerFromTextSources(
      "Compare admission and discharge requirements",
      [
        source({
          id: "admission-title-only",
          document_id: "admission-doc",
          title: "Admission Of Community Patients",
          content: "General service overview and contact information.",
        }),
        source({
          id: "discharge-supported",
          document_id: "discharge-doc",
          title: "Discharge Planning For Community Patients",
          content: "Staff document the discharge plan and ongoing care arrangements.",
        }),
      ],
      new Error("mock provider unavailable"),
    );

    expect(answer.grounded).toBe(false);
    expect(answer.responseMode).toBe("evidence_gap");
    expect(answer.routingReason).toContain("comparison_evidence_gap");
    expect(answer.citations).toEqual([]);
    expect(answer.answerSections).toEqual([]);
  });

  it("does not let one dual-title policy fill the missing admission side of the live paraphrase", async () => {
    const answer = await answerFromTextSources(
      "Combine community admission steps with discharge documentation requirements.",
      [
        source({
          id: "dual-title-community-policy",
          document_id: "dual-title-community-policy-doc",
          title: "Admission To Discharge For Community Mental Health(NMHS)",
          file_name: "Admission to Discharge for Community Mental Health (NMHS).pdf",
          content:
            "The policy describes admission and discharge requirements for community mental health services, including standardised clinical documentation.",
        }),
        source({
          id: "paraphrase-discharge-supported",
          document_id: "paraphrase-discharge-doc",
          title: "Discharge Planning For Community Patients(NMHS)",
          file_name: "Discharge Planning for Community Patients (NMHS).pdf",
          content: "Staff must document the discharge plan and ongoing care arrangements.",
        }),
      ],
      new Error("OpenAI generation quality gate failed: comparison coverage"),
    );

    expect(answer.grounded).toBe(false);
    expect(answer.responseMode).toBe("evidence_gap");
    expect(answer.routingReason).toContain("comparison_evidence_gap");
    expect(answer.citations).toEqual([]);
    expect(answer.answerSections).toEqual([]);
  });

  it("binds the live paraphrase to an admission-only fact and a distinct discharge source", async () => {
    const answer = await answerFromTextSources(
      "Combine community admission steps with discharge documentation requirements.",
      [
        source({
          id: "live-mhhith-admission-criteria",
          document_id: "live-mhhith-policy-doc",
          title: "Referral, Admission And Discharge - Mental Health Hospital In The Home(MHHITH)",
          file_name:
            "Referral, Admission and Discharge - Mental Health Hospital in the Home (MHHITH) Policy and Procedure (RKPG).pdf",
          content: [
            "Inclusion and exclusion criteria",
            "A patient will only be able to come to the service if they meet the identified inclusion criteria",
            "for admission to MHHiTH. See Appendix B.",
          ].join("\n"),
        }),
        source({
          id: "live-community-discharge-aim",
          document_id: "live-community-discharge-doc",
          title: "Discharge Planning For Community Patients(NMHS)",
          file_name: "Discharge Planning for Community Patients (NMHS).pdf",
          content: [
            "1. Aim",
            "All North Metropolitan Health Service Mental Health (NMHS MH) clinicians will actively plan the",
            "effective and timely discharge of consumers as per the Department of Health (DoH) Triage to",
            "Discharge Mental Health Framework for State-wide Standardised Clinical Documentation, and",
            "legislative requirements of the Mental Health Act (MHA) 2014.",
          ].join("\n"),
        }),
      ],
      new Error("OpenAI generation quality gate failed: comparison coverage"),
    );

    expect(answer.grounded).toBe(true);
    expect(answer.routingReason).toContain("comparison_source_extractive_fallback");
    expect(answer.routingReason).not.toContain("final_quality_gate");
    expect(answer.routingReason).not.toContain("source_backed_review_fallback");
    expect(answer.answer).toContain("inclusion criteria for admission to MHHiTH");
    expect(answer.answer).toContain("actively plan the effective and timely discharge");
    expect(answer.citations.map((citation) => citation.chunk_id)).toEqual([
      "live-mhhith-admission-criteria",
      "live-community-discharge-aim",
    ]);
    expect(answer.answerSections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          heading: "Admission evidence",
          citation_chunk_ids: ["live-mhhith-admission-criteria"],
        }),
        expect.objectContaining({
          heading: "Discharge evidence",
          citation_chunk_ids: ["live-community-discharge-aim"],
        }),
      ]),
    );
    expect(answer.supportedClaims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          supportStatus: "direct",
          supportingChunkIds: ["live-community-discharge-aim"],
        }),
      ]),
    );
  });

  it("never uses one dual-title document for both admission and discharge facts", async () => {
    const answer = await answerFromTextSources(
      "Combine community admission steps with discharge documentation requirements.",
      [
        source({
          id: "dual-title-both-facts",
          document_id: "dual-title-both-facts-doc",
          title: "Admission To Discharge For Community Mental Health(NMHS)",
          file_name: "Admission to Discharge for Community Mental Health (NMHS).pdf",
          content: [
            "A patient will only be able to come to the service if they meet the identified inclusion criteria for admission.",
            "Clinicians will actively plan the effective and timely discharge of consumers.",
          ].join("\n"),
        }),
      ],
      new Error("OpenAI generation quality gate failed: comparison coverage"),
    );

    expect(answer.grounded).toBe(false);
    expect(answer.responseMode).toBe("evidence_gap");
    expect(answer.routingReason).toContain("comparison_evidence_gap");
    expect(answer.citations).toEqual([]);
  });

  it("does not erase a clinical condition after an as-per clause", async () => {
    const answer = await answerFromTextSources(
      "Compare admission and discharge requirements",
      [
        source({
          id: "conditional-admission",
          document_id: "conditional-admission-doc",
          title: "Admission Of Community Patients",
          content: "The referring clinician must provide medical clearance before transfer.",
        }),
        source({
          id: "conditional-discharge",
          document_id: "conditional-discharge-doc",
          title: "Discharge Planning For Community Patients",
          content:
            "Clinicians will actively plan the effective and timely discharge as per the policy only after receiving consultant approval under the Mental Health Act (MHA) 2014.",
        }),
      ],
      new Error("mock provider unavailable"),
    );

    expect(answer.grounded).toBe(false);
    expect(answer.responseMode).toBe("evidence_gap");
    expect(answer.citations).toEqual([]);
    expect(answer.answer).not.toContain("Clinicians will actively plan the effective and timely discharge.");
  });

  it("does not treat patient-address records as admission or discharge requirements", async () => {
    const answer = await answerFromTextSources(
      "Compare admission and discharge requirements",
      [
        source({
          id: "admission-addresses",
          document_id: "admission-addresses-doc",
          title: "Admission records",
          content: "Admission records include patient addresses.",
        }),
        source({
          id: "discharge-addresses",
          document_id: "discharge-addresses-doc",
          title: "Discharge records",
          content: "Discharge records include patient addresses.",
        }),
      ],
      new Error("mock provider unavailable"),
    );

    expect(answer.grounded).toBe(false);
    expect(answer.responseMode).toBe("evidence_gap");
    expect(answer.routingReason).toContain("comparison_evidence_gap");
    expect(answer.citations).toEqual([]);
    expect(answer.answerSections).toEqual([]);
  });

  it("does not join operational medical-clearance metrics to a following admission heading", async () => {
    const answer = await answerFromTextSources(
      "Compare admission and discharge requirements",
      [
        source({
          id: "admission-separated-markers",
          document_id: "admission-separated-markers-doc",
          title: "Admission Of Community Patients",
          content: "Staff provide a medical clearance report monthly.\n2.2 Admissions Escorted by Police",
        }),
        source({
          id: "admission-clearance-training",
          document_id: "admission-clearance-training-doc",
          title: "Admission Training Records",
          content: "The education unit will provide medical clearance training annually.",
        }),
        source({
          id: "admission-clearance-information",
          document_id: "admission-clearance-information-doc",
          title: "Admission Information Records",
          content: "Staff provide medical clearance information and forms to referrers.",
        }),
        source({
          id: "admission-bed-reporting",
          document_id: "admission-bed-reporting-doc",
          title: "Admission Bed Reporting",
          content: "Staff arrange the prioritisation of beds reports monthly.",
        }),
        source({
          id: "admission-bed-fragment",
          document_id: "admission-bed-fragment-doc",
          title: "Admission Bed Fragment",
          content: "Patient Flow Coordinator Mental Health to locate a bed at an alternative health service.",
        }),
        source({
          id: "admission-clearance-audit",
          document_id: "admission-clearance-audit-doc",
          title: "Admission Governance Audit",
          content: "The governance team will provide medical clearance for annual audit of patient records.",
        }),
        source({
          id: "admission-clearance-training-records",
          document_id: "admission-clearance-training-records-doc",
          title: "Admission Training Records",
          content: "Staff provide medical clearance for clinician training records.",
        }),
        source({
          id: "discharge-requirement",
          document_id: "discharge-requirement-doc",
          title: "Discharge Planning For Community Patients",
          content: "Discharge planning must include documented ongoing care arrangements.",
        }),
      ],
      new Error("mock provider unavailable"),
    );

    expect(answer.grounded).toBe(false);
    expect(answer.responseMode).toBe("evidence_gap");
    expect(answer.routingReason).toContain("comparison_evidence_gap");
    expect(answer.citations).toEqual([]);
    expect(answer.answerSections).toEqual([]);
  });

  it("keeps a following numbered admission heading out of a preceding bed directive", async () => {
    const answer = await answerFromTextSources(
      "Compare admission and discharge requirements",
      [
        source({
          id: "admission-bed-directive",
          document_id: "admission-bed-directive-doc",
          title: "Admission Of Community Patients",
          content: [
            "When a bed is not available, the referring mental health clinician is to liaise with the EMHS",
            "Patient Flow Coordinator Mental Health to locate a bed at an alternative health service, as per:",
            "EMHS Mental Health Patient Flow and Bed Capacity Framework (Summary Sheet)",
            "2.2 Admissions Accompanied by Police",
          ].join("\n"),
        }),
        source({
          id: "discharge-bed-directive",
          document_id: "discharge-bed-directive-doc",
          title: "Discharge Planning For Community Patients",
          content: "Discharge planning must include documented ongoing care arrangements.",
        }),
      ],
      new Error("mock provider unavailable"),
    );

    expect(answer.grounded).toBe(true);
    expect(answer.answer).toContain("locate a bed at an alternative health service");
    expect(answer.answer).not.toContain("2.2 Admissions Accompanied by Police");
    expect(answer.answer).not.toContain("as per:.");
    expect(answer.citations.map((item) => item.chunk_id)).toEqual(
      expect.arrayContaining(["admission-bed-directive", "discharge-bed-directive"]),
    );
  });

  it("accepts ordinary clinical continuations after a medical-clearance requirement", async () => {
    const admissionRequirements = [
      "Clinicians provide medical clearance for admission.",
      "Clinicians obtain medical clearance via the emergency department.",
      "Clinicians provide medical clearance and arrange transfer.",
      "Clinicians obtain medical clearance after physical assessment.",
      "Clinicians provide medical clearance by the treating doctor.",
    ];

    for (const [index, content] of admissionRequirements.entries()) {
      const admissionChunkId = `admission-clinical-continuation-${index}`;
      vi.resetModules();
      const answer = await answerFromTextSources(
        "Compare admission and discharge requirements",
        [
          source({
            id: admissionChunkId,
            document_id: `admission-clinical-continuation-doc-${index}`,
            title: "Admission Of Community Patients",
            content,
          }),
          source({
            id: `discharge-clinical-continuation-${index}`,
            document_id: `discharge-clinical-continuation-doc-${index}`,
            title: "Discharge Planning For Community Patients",
            content: "Discharge planning must include documented ongoing care arrangements.",
          }),
        ],
        new Error("mock provider unavailable"),
      );

      expect(answer.grounded).toBe(true);
      expect(answer.answerSections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ heading: "Admission evidence", citation_chunk_ids: [admissionChunkId] }),
        ]),
      );
    }
  });

  it("accepts qualified clinical actors before an explicit locate-bed directive", async () => {
    const admissionRequirements = [
      "Patient Flow Coordinator Mental Health must locate a bed at an alternative health service.",
      "The patient flow coordinator for mental health is required to locate a bed at an alternative health service.",
      "The duty clinician on call must locate a bed within the service.",
      "When a bed is not available, the referring clinician is to liaise with the patient flow coordinator to locate a bed at an alternative health service.",
    ];

    for (const [index, content] of admissionRequirements.entries()) {
      const admissionChunkId = `admission-qualified-actor-${index}`;
      vi.resetModules();
      const answer = await answerFromTextSources(
        "Compare admission and discharge requirements",
        [
          source({
            id: admissionChunkId,
            document_id: `admission-qualified-actor-doc-${index}`,
            title: "Admission Of Community Patients",
            content,
          }),
          source({
            id: `discharge-qualified-actor-${index}`,
            document_id: `discharge-qualified-actor-doc-${index}`,
            title: "Discharge Planning For Community Patients",
            content: "Discharge planning must include documented ongoing care arrangements.",
          }),
        ],
        new Error("mock provider unavailable"),
      );

      expect(answer.grounded).toBe(true);
      expect(answer.answerSections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ heading: "Admission evidence", citation_chunk_ids: [admissionChunkId] }),
        ]),
      );
    }
  });

  it("does not promote uncertainty or reporting about bed location to a direct admission requirement", async () => {
    const answer = await answerFromTextSources(
      "Compare admission and discharge requirements",
      [
        source({
          id: "admission-uncertain-bed-location",
          document_id: "admission-uncertain-bed-location-doc",
          title: "Admission Review Notes",
          content:
            "The clinician is uncertain whether the coordinator will locate a bed at an alternative health service.",
        }),
        source({
          id: "admission-reviewing-bed-location",
          document_id: "admission-reviewing-bed-location-doc",
          title: "Admission Review Notes",
          content: "The clinician is reviewing whether staff should locate a bed within the service.",
        }),
        source({
          id: "admission-reporting-bed-location",
          document_id: "admission-reporting-bed-location-doc",
          title: "Admission Reporting Notes",
          content: "The coordinator is responsible for reporting whether the team will locate a bed for admission.",
        }),
        source({
          id: "discharge-requirement-after-uncertainty",
          document_id: "discharge-requirement-after-uncertainty-doc",
          title: "Discharge Planning For Community Patients",
          content: "Discharge planning must include documented ongoing care arrangements.",
        }),
      ],
      new Error("mock provider unavailable"),
    );

    expect(answer.grounded).toBe(false);
    expect(answer.responseMode).toBe("evidence_gap");
    expect(answer.routingReason).toContain("comparison_evidence_gap");
    expect(answer.citations).toEqual([]);
    expect(answer.answerSections).toEqual([]);
  });

  it("does not treat discharge-planning reporting metrics as a discharge requirement", async () => {
    const answer = await answerFromTextSources(
      "Compare admission and discharge requirements",
      [
        source({
          id: "admission-clearance-directive",
          document_id: "admission-clearance-directive-doc",
          title: "Admission Of Community Patients",
          content: "The referring clinician must provide medical clearance before transfer.",
        }),
        source({
          id: "discharge-reporting-metric",
          document_id: "discharge-reporting-metric-doc",
          title: "Discharge Planning For Community Patients",
          content: "Discharge planning reports must include monthly performance metrics.",
        }),
        source({
          id: "discharge-documentation-archive",
          document_id: "discharge-documentation-archive-doc",
          title: "Discharge Planning Records",
          content: "Discharge planning documentation must include the current version number.",
        }),
      ],
      new Error("mock provider unavailable"),
    );

    expect(answer.grounded).toBe(false);
    expect(answer.responseMode).toBe("evidence_gap");
    expect(answer.citations).toEqual([]);
    expect(answer.answerSections).toEqual([]);
  });

  it("rejects audit, report, archive, training, and historical wrappers around comparison obligations", async () => {
    const admissionWrapped = [
      "Audit observations: clinicians provide medical clearance.",
      "The annual report states that clinicians provide medical clearance.",
      "Archive records require staff to provide medical clearance.",
      "Training requirements: clinicians provide medical clearance.",
      "Historical audit findings: clinicians provide medical clearance.",
    ];
    for (const [index, content] of admissionWrapped.entries()) {
      vi.resetModules();
      const answer = await answerFromTextSources(
        "Compare admission and discharge requirements",
        [
          source({
            id: `wrapped-admission-${index}`,
            document_id: `wrapped-admission-document-${index}`,
            title: "Admission of Community Patients",
            content,
          }),
          source({
            id: `valid-discharge-${index}`,
            document_id: `valid-discharge-document-${index}`,
            title: "Discharge Planning for Community Patients",
            content: "Community staff document the discharge plan and ongoing care arrangements.",
          }),
        ],
        new Error("mock provider unavailable"),
      );

      expect(answer.grounded, `${content}: ${answer.routingReason} :: ${answer.answer}`).toBe(false);
      expect(answer.routingReason).toContain("comparison_evidence_gap");
    }

    const dischargeWrapped = [
      "The annual audit must include the discharge plan and ongoing care arrangements.",
      "The monthly report must include the discharge plan and ongoing care arrangements.",
      "Archive records must include the discharge plan and ongoing care arrangements.",
      "Training materials must include the discharge plan and ongoing care arrangements.",
      "Historical reports must include the discharge plan and ongoing care arrangements.",
    ];
    for (const [index, content] of dischargeWrapped.entries()) {
      vi.resetModules();
      const answer = await answerFromTextSources(
        "Compare admission and discharge requirements",
        [
          source({
            id: `valid-admission-${index}`,
            document_id: `valid-admission-document-${index}`,
            title: "Admission of Community Patients",
            content: "The referring clinician must provide medical clearance before transfer.",
          }),
          source({
            id: `wrapped-discharge-${index}`,
            document_id: `wrapped-discharge-document-${index}`,
            title: "Discharge Planning for Community Patients",
            content,
          }),
        ],
        new Error("mock provider unavailable"),
      );

      expect(answer.grounded, `${content}: ${answer.routingReason} :: ${answer.answer}`).toBe(false);
      expect(answer.routingReason).toContain("comparison_evidence_gap");
    }
  });

  it("keeps a direct source-only comparison evidence gap ungrounded", async () => {
    const answer = await answerFromTextSources(
      "Compare admission and discharge requirements",
      [
        source({
          id: "source-only-admission-audit",
          document_id: "source-only-admission-audit-document",
          title: "Admission of Community Patients",
          content: "Audit observations: clinicians provide medical clearance.",
        }),
        source({
          id: "source-only-discharge-report",
          document_id: "source-only-discharge-report-document",
          title: "Discharge Planning for Community Patients",
          content: "The annual report must include the discharge plan and ongoing care arrangements.",
        }),
      ],
      undefined,
      { sourceOnly: true },
    );

    expect(answer.routingReason).toContain("source_only_offline_mode");
    expect(answer.routingReason).toContain("comparison_evidence_gap");
    expect(answer.routingReason).not.toContain("source_backed_review_fallback");
    expect(answer.grounded).toBe(false);
    expect(answer.responseMode).toBe("evidence_gap");
    expect(answer.citations).toEqual([]);
    expect(answer.answerSections).toEqual([]);
  });

  it("keeps prescriber review bound to an olanzapine dosing-guidance answer", async () => {
    const answer = await answerFromTextSources(
      "What olanzapine dosing guidance applies?",
      [
        source({
          id: "olanzapine-dose-review",
          document_id: "olanzapine-dose-review-document",
          title: "Olanzapine prescribing guidance",
          file_name: "Olanzapine prescribing guidance.pdf",
          section_heading: "Dosing",
          content:
            "Dosing frequencies outside the recommended schedule require prescriber review before olanzapine is administered.",
        }),
      ],
      new Error("mock provider unavailable"),
    );

    expect(answer.grounded).toBe(true);
    expect(answer.routingReason).toContain("source_backed_extractive_fallback");
    expect(answer.answer.replace(/\*\*/g, "")).toContain(
      "Dosing frequencies outside the recommended schedule require prescriber review before olanzapine is administered.",
    );
    expect(answer.citations.map((citation) => citation.chunk_id)).toEqual(["olanzapine-dose-review"]);
  });

  it("keeps a genuine scheduled review classified as monitoring", async () => {
    const answer = await answerFromTextSources(
      "How often should olanzapine levels be monitored?",
      [
        source({
          id: "olanzapine-monitoring-review",
          document_id: "olanzapine-monitoring-review-document",
          title: "Olanzapine monitoring guidance",
          file_name: "Olanzapine monitoring guidance.pdf",
          section_heading: "Monitoring",
          content: "Olanzapine plasma levels should be reviewed weekly during dose adjustment.",
        }),
      ],
      new Error("mock provider unavailable"),
    );

    expect(answer.grounded).toBe(true);
    expect(answer.answer.replace(/\*\*/g, "")).toContain(
      "Olanzapine plasma levels should be reviewed weekly during dose adjustment.",
    );
    expect(answer.citations.map((citation) => citation.chunk_id)).toEqual(["olanzapine-monitoring-review"]);
  });

  it("does not turn scheduled monitoring review into dose guidance when dose prose is also present", async () => {
    const answer = await answerFromTextSources(
      "What olanzapine dosing guidance applies?",
      [
        source({
          id: "olanzapine-dose-with-monitoring-review",
          document_id: "olanzapine-dose-with-monitoring-review-document",
          title: "Olanzapine prescribing guidance",
          file_name: "Olanzapine prescribing guidance.pdf",
          section_heading: "Dosing and monitoring",
          content:
            "Olanzapine plasma levels should be reviewed weekly during dose adjustment. Olanzapine dosing should follow the prescribed schedule.",
        }),
      ],
      new Error("mock provider unavailable"),
    );

    const delivered =
      `${answer.answer} ${(answer.answerSections ?? []).map((section) => section.body).join(" ")}`.replace(/\*\*/g, "");
    expect(answer.grounded).toBe(true);
    expect(delivered).toContain("Olanzapine dosing should follow the prescribed schedule.");
    expect(delivered).not.toContain("plasma levels should be reviewed weekly");
  });

  it("does not turn retrospective committee-review prose into dose guidance", async () => {
    const answer = await answerFromTextSources(
      "What olanzapine dosing guidance applies?",
      [
        source({
          id: "olanzapine-retrospective-review",
          document_id: "olanzapine-retrospective-review-document",
          title: "Olanzapine documentation audit",
          file_name: "Olanzapine documentation audit.pdf",
          section_heading: "Audit findings",
          content: "A committee review found that olanzapine dosing documentation was incomplete.",
        }),
      ],
      new Error("mock provider unavailable"),
    );

    const delivered = `${answer.answer} ${(answer.answerSections ?? []).map((section) => section.body).join(" ")}`;
    expect(answer.routingReason).toContain("source_backed_review_fallback");
    expect(answer.answerSections).toEqual([]);
    expect(delivered).not.toContain("committee review");
    expect(delivered).not.toContain("dosing documentation was incomplete");
  });

  it("short-circuits the validated typo-query agitation dosing case without table fragments or unrelated medication", async () => {
    const answer = await answerFromTextSources(
      "What agitaton and arousl dosing guidance applies to psychiatric inpatients?",
      [
        source({
          id: "fsh-pregnancy-table-fragment",
          document_id: "fsh-agitation-guideline",
          title: "Medication For Agitation And Arousal In Inpatients(FSH)",
          file_name: "Medication for Agitation and Arousal in Inpatients (FSH).pdf",
          page_number: 14,
          section_heading: "OFFICIAL",
          content:
            "OFFICIAL Agitation, arousal Mental Health inpatients: medication management Appendix 6: Acute agitation and arousal pharmacological management for PREGNANT mental health inpatients aged 16 YEARS and above ORAL INTRAMUSCULAR USE ORAL MEDICATION FIRST WHENEVER POSSIBLE STEP 1 STEP 2 STEP 3 STEP 4 MILD TO MODERATE AROUSAL MODERATE TO SEVERE AROUSAL Medication Recommended Total maximum oral respiratory function.",
          similarity: 0.99,
          hybrid_score: 0.99,
          text_rank: 1.2,
        }),
        source({
          id: "emhs-repeat-dose-guidance",
          document_id: "emhs-agitation-guideline",
          title: "Mental Health Pharmacological Management Of Agitation And Arousal Guideline(EMHS)",
          file_name: "Mental Health Pharmacological Management of Agitation and Arousal Guideline (EMHS).pdf",
          page_number: 5,
          section_heading:
            "Agitation and arousal scores must be documented on the WA Agitation and Arousal PRN Medication Chart",
          content: [
            "Agitation and arousal scores must be documented before each PRN dose and reviewed after administration.",
            "Repeating doses.",
            "Where additional doses are required, administer at the frequency indicated until a score of 1 or maximum daily dosage is achieved.",
            "Oral doses may be repeated hourly.",
            "IM doses may be repeated after 30 minutes except olanzapine IM and clonazepam IM.",
            "• Olanzapine IM may be repeated after 2 hours and a third dose 6 hours after the",
            "first dose if required. Total of 3 doses or 30mg maximum in 24 hours (10mg",
            "maximum in 24 hours for older adults over 65 years) whichever occurs first.",
            "• Dosing frequencies outside the recommended guidelines require Consultant",
            "Psychiatrist approval.",
          ].join("\n"),
          similarity: 0.98,
          hybrid_score: 0.98,
          text_rank: 1.1,
        }),
        source({
          id: "fsh-interleaved-dose-table",
          document_id: "fsh-agitation-guideline",
          title: "Medication For Agitation And Arousal In Inpatients(FSH)",
          file_name: "Medication for Agitation and Arousal in Inpatients (FSH).pdf",
          page_number: 11,
          section_heading: "DOSES",
          content:
            "DOSES: MONITOR: Review IM doses after 30 and 60 min and record arousal rating. Medication Recommended Total maximum oral respiratory function every 10 minutes. Dosing frequencies outside of recommended time and/or dose maximum AND IM daily dose hourly until the patient is ambulatory. Quetiapine is the only licensed medication for older adolescents.",
          similarity: 0.97,
          hybrid_score: 0.97,
          text_rank: 1,
        }),
        source({
          id: "akg-repeat-dose-guidance",
          document_id: "akg-agitation-guideline",
          title: "Agitation And Arousal Pharmacological Management(AKG)",
          file_name: "Agitation and Arousal Pharmacological Management (AKG).pdf",
          page_number: 3,
          content:
            "Agitation and arousal scores must be documented before each PRN dose. Olanzapine IM may be repeated after 2 hours and a third dose 6 hours after the first dose if required.",
          similarity: 0.96,
          hybrid_score: 0.96,
          text_rank: 0.9,
        }),
        source({
          id: "zuclopenthixol-adjacent-guidance",
          document_id: "zuclopenthixol-guideline",
          title: "Zuclopenthixol(AKG)",
          file_name: "Zuclopenthixol (AKG).pdf",
          page_number: 3,
          content:
            "After short acting medication has been given to manage agitation and arousal, allow 60 minutes after IM administration before considering zuclopenthixol acetate. Withhold other PRN sedatives for 24 hours when zuclopenthixol acetate is administered.",
          similarity: 0.95,
          hybrid_score: 0.95,
          text_rank: 0.8,
        }),
      ],
      new Error("OpenAI request timed out after 20000ms"),
    );
    const deliveredText = `${answer.answer} ${(answer.answerSections ?? [])
      .map((section) => section.body)
      .join(" ")}`.replace(/\*\*/g, "");

    expect(answer.grounded).toBe(true);
    expect(answer.routingReason).toContain("validated_agitation_arousal_typo_dosing_extractive_first");
    expect(answer.routingReason).not.toContain("generation_fallback");
    expect(answer.openAIRequestIds ?? []).toEqual([]);
    expect(answer.latencyTimings?.generation_latency_ms).toBe(0);
    expect(answer.routingReason).not.toContain("source_backed_review_fallback");
    expect(deliveredText).toMatch(/agitation/i);
    expect(deliveredText).toMatch(/arousal/i);
    expect(deliveredText).toMatch(
      /olanzapine im may be repeated after 2 hours and a third dose 6 hours after the first dose if required — total of 3 doses or 30mg maximum in 24 hours \(10mg maximum in 24 hours for older adults over 65 years\) whichever occurs first/i,
    );
    expect(deliveredText).not.toMatch(/consultant psychiatrist|psychiatrist approval/i);
    expect(deliveredText).not.toMatch(/\(10mg\.|require consultant\./i);
    expect(deliveredText).not.toMatch(/agitaton|arousl/i);
    expect(deliveredText).not.toMatch(/total maximum oral respiratory function/i);
    expect(deliveredText).not.toMatch(/oral doses may be repeated hourly|im doses may be repeated after 30 minutes/i);
    expect(deliveredText).not.toMatch(/zuclopenthixol|clopixol/i);
    expect(answer.citations.map((citation) => citation.chunk_id)).toEqual(["emhs-repeat-dose-guidance"]);
    expect(answer.sources.map((result) => result.id)).toEqual(["emhs-repeat-dose-guidance"]);
    const quoteText = (answer.quoteCards ?? []).map((quote) => quote.quote).join(" ");
    expect(quoteText).not.toMatch(/oral doses may be repeated hourly|im doses may be repeated after 30 minutes/i);
    expect(quoteText).not.toMatch(/zuclopenthixol|clopixol/i);
  });

  it("recovers a provider-failed escalation query from the nonnumeric rule in the conflicted source", async () => {
    const answer = await answerFromTextSources(
      "When should neuroleptic side effects be escalated?",
      [
        source({
          id: "zuclopenthixol-contraindications",
          document_id: "zuclopenthixol-document",
          title: "Zuclopenthixol (AKG)",
          file_name: "Zuclopenthixol (AKG).pdf",
          section_heading: "Armadale Kalamunda Group",
          content:
            "Contraindications and precautions include agranulocytosis, blood dyscrasias, VTE risk, and a history of neuroleptic malignant syndrome. VTE risk should be assessed by the prescriber and documented.",
          similarity: 0.99,
          hybrid_score: 0.99,
          text_rank: 1.2,
        }),
        source({
          id: "lunsers-distress-rule",
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
          similarity: 0.97,
          hybrid_score: 0.97,
          text_rank: 1.1,
        }),
        source({
          id: "lunsers-score-independent-action",
          document_id: "lunsers-document",
          title: "Neuroleptic Side Effects (AKG)",
          file_name: "Neuroleptic Side Effects (AKG).pdf",
          section_heading: null,
          content:
            "The LUNSERS tool measures the side effects of neuroleptic medication. Scoring of the completed LUNSERS can ascertain severity of symptoms, however scoring is not essential for actions to be taken. Scores which fall into the medium (41-89), high (81-100), and very high (>101) ranges are to be escalated.",
          similarity: 0.96,
          hybrid_score: 0.96,
          text_rank: 1,
        }),
      ],
      new Error("OpenAI generation quality gate failed: labelled numeric band conflict"),
    );
    const deliveredText =
      `${answer.answer} ${(answer.answerSections ?? []).map((section) => section.body).join(" ")}`.replace(/\*\*/g, "");

    expect(answer.grounded).toBe(true);
    expect(answer.routingReason).toContain("generation_fallback:generation_quality_failed");
    expect(answer.routingReason).toContain("source_backed_extractive_fallback");
    expect(deliveredText).toMatch(
      /any side effect which is causing distress irrespective of score should be escalated to the treating doctor and reviewed/i,
    );
    expect(deliveredText).not.toMatch(/\b(?:41|81|100|101)\b/);
    expect(deliveredText).not.toMatch(/zuclopenthixol|malignant syndrome|agranulocytosis|vte/i);
    expect(answer.citations.map((citation) => citation.chunk_id)).toEqual(["lunsers-distress-rule"]);
    expect(answer.sources.map((result) => result.id)).toEqual(["lunsers-distress-rule"]);
    expect(
      new Set([
        ...(answer.supportedClaims ?? []).flatMap((claim) => claim.supportingChunkIds),
        ...(answer.quoteCards ?? []).map((quote) => quote.chunk_id),
      ]),
    ).toEqual(new Set(answer.citations.map((citation) => citation.chunk_id)));
    expect(answer.conflictsOrGaps).toEqual(expect.arrayContaining([expect.objectContaining({ type: "conflict" })]));
  });

  it("fails closed when provider failure leaves a LUNSERS score band split across adjacent chunks", async () => {
    const answer = await answerFromTextSources(
      "What is the high LUNSERS score range for neuroleptic side-effect monitoring?",
      [
        source({
          id: "lunsers-medium-band",
          document_id: "lunsers-document",
          title: "Neuroleptic Side Effects (AKG)",
          file_name: "Neuroleptic Side Effects (AKG).pdf",
          page_number: 7,
          chunk_index: 10,
          section_heading: "LUNSERS",
          section_path: ["Outcome measures", "LUNSERS"],
          content: "LUNSERS score bands are medium (41-89),",
          similarity: 0.98,
          hybrid_score: 0.98,
          text_rank: 1.2,
        }),
        source({
          id: "lunsers-high-and-very-high-bands",
          document_id: "lunsers-document",
          title: "Neuroleptic Side Effects (AKG)",
          file_name: "Neuroleptic Side Effects (AKG).pdf",
          page_number: 7,
          chunk_index: 11,
          section_heading: "LUNSERS",
          section_path: ["Outcome measures", "LUNSERS"],
          content: "high (81-100), and very high (>101).",
          similarity: 0.97,
          hybrid_score: 0.97,
          text_rank: 1.1,
        }),
      ],
      new Error("mock provider unavailable"),
    );
    const deliveredText = `${answer.answer} ${(answer.answerSections ?? [])
      .map((section) => section.body)
      .join(" ")}`.replace(/\*\*/g, "");

    expect(answer.grounded).toBe(false);
    expect(answer.responseMode).toBe("evidence_gap");
    expect(answer.routingReason).not.toContain("source_backed_extractive_fallback");
    expect(deliveredText).not.toMatch(/\b(?:41|89|81|100|101)\b/);
    expect(answer.answerSections).toEqual([]);
  });

  it("fails closed when a provider-failed escalation query has only topical contraindication prose", async () => {
    const answer = await answerFromTextSources(
      "When should neuroleptic side effects be escalated?",
      [
        source({
          id: "zuclopenthixol-only",
          document_id: "zuclopenthixol-only-document",
          title: "Zuclopenthixol (AKG)",
          file_name: "Zuclopenthixol (AKG).pdf",
          section_heading: "Armadale Kalamunda Group",
          content:
            "Contraindications and precautions include agranulocytosis, blood dyscrasias, VTE risk, and a history of neuroleptic malignant syndrome. VTE risk should be assessed by the prescriber and documented.",
        }),
      ],
      new Error("OpenAI generation quality gate failed: escalation coverage"),
    );

    expect(answer.grounded).toBe(false);
    expect(answer.responseMode).toBe("evidence_gap");
    expect(answer.routingReason).not.toContain("source_backed_extractive_fallback");
    expect(answer.answer).not.toMatch(/agranulocytosis|malignant syndrome|vte/i);
  });

  it("prioritizes late answer and section citations over ranked overflow without admitting unknown sources", async () => {
    const { compactExtractiveCitations } = await import("../src/lib/rag/rag-extractive-answer");
    const results = Array.from({ length: 7 }, (_, index) =>
      source({
        id: `candidate-${index + 1}`,
        document_id: `document-${index + 1}`,
        title: `Candidate ${index + 1}`,
        file_name: `Candidate ${index + 1}.pdf`,
      }),
    );
    const lateAnswerSupport = results.at(-1)!;
    const sectionSupport = results.at(-2)!;
    const answerSections = [
      {
        heading: "Late answer support",
        body: "The delivered answer is supported by the late source.",
        citation_chunk_ids: [sectionSupport.id],
      },
    ];
    const rankedCitations = results.slice(0, 6).map((result) => citationFromResult(result, "deterministic_support"));
    const citations = [
      ...rankedCitations,
      citationFromResult(lateAnswerSupport, "deterministic_support"),
      citationFromResult(source({ id: "not-a-result" }), "deterministic_support"),
    ];

    const compacted = compactExtractiveCitations({
      results,
      citations,
      rankedCitations,
      citationChunkIds: ["not-a-result", lateAnswerSupport.id, lateAnswerSupport.id],
      answerSections,
    });
    const finalCitationIds = new Set(compacted.map((citation) => citation.chunk_id));

    expect(compacted.map((citation) => citation.chunk_id)).toEqual([
      "candidate-6",
      "candidate-7",
      "candidate-1",
      "candidate-2",
      "candidate-3",
    ]);
    expect(
      answerSections.flatMap((section) => section.citation_chunk_ids).every((id) => finalCitationIds.has(id)),
    ).toBe(true);
    expect(compacted.every((citation) => results.some((result) => result.id === citation.chunk_id))).toBe(true);
  });

  it("preserves consecutive comparison support chunks before ranked overflow", async () => {
    const { compactExtractiveCitations } = await import("../src/lib/rag/rag-extractive-answer");
    const results = [
      source({ id: "doc-a-1", document_id: "doc-a" }),
      source({ id: "doc-a-2", document_id: "doc-a" }),
      source({ id: "doc-b-1", document_id: "doc-b" }),
      source({ id: "ranked-c", document_id: "doc-c" }),
      source({ id: "ranked-d", document_id: "doc-d" }),
      source({ id: "ranked-e", document_id: "doc-e" }),
    ];
    const citations = results.map((result) => citationFromResult(result, "deterministic_support"));
    const rankedCitations = results.slice(3).map((result) => citationFromResult(result, "deterministic_support"));

    const compacted = compactExtractiveCitations({
      results,
      citations,
      rankedCitations,
      citationChunkIds: [],
      answerSections: [
        {
          heading: "Comparison",
          body: "Two consecutive claims from document A are followed by one claim from document B.",
          citation_chunk_ids: ["doc-a-1", "doc-a-2", "doc-b-1"],
        },
      ],
    });

    expect(compacted.map((citation) => citation.chunk_id)).toEqual([
      "doc-a-1",
      "doc-a-2",
      "doc-b-1",
      "ranked-c",
      "ranked-d",
    ]);
  });

  it("keeps table-threshold questions on fact synthesis instead of source lookup", async () => {
    const answer = await answerFromTextSources("What ANC threshold does the clozapine table show?", [
      source({
        id: "clozapine-threshold-chunk",
        document_id: "clozapine-doc",
        title: "Clozapine Monitoring",
        file_name: "Clozapine Monitoring.pdf",
        page_number: 4,
        section_heading: "ANC thresholds",
        content: "Clozapine ANC threshold table: below 1.5 x 10^9/L, withhold clozapine and repeat FBC.",
        table_facts: [
          {
            id: "fact-anc-threshold",
            document_id: "clozapine-doc",
            source_chunk_id: "clozapine-threshold-chunk",
            source_image_id: null,
            page_number: 4,
            table_title: "Clozapine ANC thresholds",
            row_label: "ANC below 1.5",
            clinical_parameter: "ANC",
            threshold_value: "below 1.5 x 10^9/L",
            action: "Withhold clozapine and repeat FBC.",
          },
        ],
      }),
    ]);

    expect(answer.answer).toContain("1.5 x 10^9/L");
    // Strip bold markers first: values-only bolding emphasises escalation verbs ("**withhold**").
    expect(answer.answer.replace(/\*\*/g, "")).toMatch(/withhold clozapine/i);
    expect(answer.answer).not.toContain("The relevant source is");
  });

  it("preserves the final governance marker when direct extraction becomes a review fallback", async () => {
    const answer = await answerFromTextSources("What ANC threshold does the clozapine table show?", [
      source({
        id: "outdated-clozapine-threshold-chunk",
        document_id: "outdated-clozapine-doc",
        title: "Clozapine Monitoring",
        file_name: "Clozapine Monitoring.pdf",
        page_number: 4,
        section_heading: "ANC thresholds",
        content: "Clozapine ANC threshold table: below 1.5 x 10^9/L, withhold clozapine and repeat FBC.",
        source_metadata: {
          source_title: "Clozapine Monitoring",
          publisher: "Local service",
          jurisdiction: "Australia/WA",
          version: "1",
          publication_date: null,
          review_date: null,
          uploaded_at: null,
          indexed_at: null,
          uploaded_by: null,
          document_status: "outdated",
          clinical_validation_status: "approved",
          extraction_quality: "good",
        },
        table_facts: [
          {
            id: "outdated-fact-anc-threshold",
            document_id: "outdated-clozapine-doc",
            source_chunk_id: "outdated-clozapine-threshold-chunk",
            source_image_id: null,
            page_number: 4,
            table_title: "Clozapine ANC thresholds",
            row_label: "ANC below 1.5",
            clinical_parameter: "ANC",
            threshold_value: "below 1.5 x 10^9/L",
            action: "Withhold clozapine and repeat FBC.",
          },
        ],
      }),
    ]);

    expect(answer.routingReason).toContain("material_source_governance_gap");
    expect(answer.routingReason).toContain("source_backed_review_fallback");
    expect(answer.routingReason).toContain("extractive_quality_gate:");
  });

  it("does not answer FBC withhold-threshold lookups from generic monitoring timing facts", async () => {
    const answer = await answerFromTextSources("What FBC threshold should withhold clozapine?", [
      source({
        id: "clozapine-fbc-timing",
        document_id: "clozapine-doc",
        title: "Clozapine Monitoring",
        file_name: "Clozapine Monitoring.pdf",
        page_number: 15,
        section_heading: "FBC monitoring",
        content:
          "FBC monitoring frequency is weekly for the first 18 weeks. Blood results should be entered before dispensing. Repeat checks may occur within 48 hours when monitoring is incomplete.",
      }),
      source({
        id: "clozapine-fbc-action",
        document_id: "clozapine-doc",
        title: "Clozapine Monitoring",
        file_name: "Clozapine Monitoring.pdf",
        page_number: 16,
        section_heading: "FBC result action",
        content:
          "FBC blood results in the Amber or Red range require clozapine to be withheld and urgent review arranged.",
      }),
    ]);

    const plainAnswer = answer.answer.replace(/\*\*/g, "");
    expect(answer.grounded).toBe(true);
    expect(answer.citations.map((citation) => citation.chunk_id)).toContain("clozapine-fbc-action");
    expect(plainAnswer).toMatch(/amber|red|withheld|withhold/i);
    expect(plainAnswer).not.toContain("48 hours");
    expect(answer.unverifiedNumericTokens ?? []).toEqual([]);
  });

  it("uses model synthesis for strong non-direct source answers instead of packed source-card labels", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_ANSWER_TIMEOUT_MS", "4321");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

    const clozapineSource = source({
      id: "clozapine-monitoring-1",
      document_id: "clozapine-doc",
      title: "Medication guideline",
      file_name: "medication-guideline.pdf",
      page_number: 11,
      section_heading: "Monitoring",
      content:
        "Medication point: • Copy of the Consent to Clozapine Treatment Form EMR0270. Medication point: • Prescribe initiation of Clozapine on the WA Adult Clozapine Initiation and Titration form. Medication point: • Ensure consumers complete the Clozapine Monitoring Form on initiation.",
      similarity: 0.94,
      hybrid_score: 0.94,
      text_rank: 0,
      memory_cards: [
        {
          id: "memory-1",
          document_id: "clozapine-doc",
          owner_id: null,
          card_type: "medication",
          title: "Clozapine monitoring",
          content:
            "Medication point: • Copy of the Consent to Clozapine Treatment Form EMR0270 - Medication point: • Prescribe Initiation of Clozapine on the WA Adult Clozapine Initiation and Titration form - Medication point: • Ensure all consumers complete the Clozapine Monitoring Form on initiation.",
          normalized_terms: ["clozapine", "monitoring"],
          page_number: 11,
          source_chunk_ids: ["clozapine-monitoring-1"],
          source_image_ids: [],
          confidence: 0.92,
        },
      ],
    });
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: [clozapineSource], error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    const generateStructuredTextResult = vi.fn(async () => ({
      text: JSON.stringify({
        answer:
          "Clozapine monitoring requires supported initiation documentation and completion of the Clozapine Monitoring Form.",
        grounded: true,
        confidence: "high",
        answerSections: [
          {
            heading: "Monitoring documents",
            kind: "documentation",
            supportLevel: "direct",
            body: "Use consent documentation, initiation/titration prescribing, and the Clozapine Monitoring Form during clozapine initiation.",
            citation_chunk_ids: ["clozapine-monitoring-1"],
          },
        ],
        citations: [{ chunk_id: "clozapine-monitoring-1" }],
        quoteCards: [
          {
            chunk_id: "clozapine-monitoring-1",
            quote: "Ensure consumers complete the Clozapine Monitoring Form on initiation.",
            section_heading: "Monitoring",
          },
        ],
        conflictsOrGaps: [],
      }),
      model: "gpt-4.1-mini",
      operation: "answer",
      latencyMs: 12,
      requestId: "req_model_synthesis",
      usage: { input_tokens: 120, output_tokens: 90, total_tokens: 210 },
    }));

    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false })),
      generateStructuredTextResult,
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");

    const answer = await answerQuestionWithScope({
      query: "what monitoring is required for clozapine",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
    });

    expect(generateStructuredTextResult).toHaveBeenCalledTimes(1);
    const answerCalls = generateStructuredTextResult.mock.calls as unknown as Array<
      [string, unknown, { timeoutMs?: number; instructions?: string }]
    >;
    const answerInput = answerCalls[0]?.[0] ?? "";
    expect(answerCalls[0]?.[2]).toMatchObject({ timeoutMs: 4321 });
    expect(answerCalls[0]?.[2].instructions).toContain("Within one named scale and source");
    expect(answerCalls[0]?.[2].instructions).toContain("cite the smallest sufficient directly supporting chunk set");
    expect(answerInput).toContain("answer_plan.intent: clinical_synthesis");
    // Packet S2: the composition menu rides in the interpreted-task block. A monitoring
    // question classifies medication_dose_risk with a `general` heuristic intent → dosing menu.
    expect(answerInput).toContain("related_information_menu: monitoring_timing — monitoring schedule and levels;");
    expect(answerInput).toContain("answer_plan.route_mode: strong");
    expect(answerInput).toContain("answer_plan.model_strategy: strong_model_then_quality_gate");
    expect(answerInput).toContain("answer_plan.source_policy: required_citations");
    expect(answer.routingMode).toBe("strong");
    expect(answer.routingReason).toContain("medication_dose_risk_strong_route");
    expect(answer.smartApiPlan?.answerPlan).toMatchObject({
      intent: "clinical_synthesis",
      routeMode: "strong",
      modelStrategy: "strong_model_then_quality_gate",
      sourcePolicy: "required_citations",
    });
    expect(answer.answer.replace(/\*\*/g, "")).toMatch(/clozapine Monitoring Form/i);
    expect(answer.answer).not.toContain("- Medication point");
    expect(answer.answer).not.toMatch(/Medication point:.*Medication point:/);
    expect(answer.answerSections).toEqual([]);
    expect(answer.routingReason).toContain("claim_support_unsupported_sections_withheld");
  });

  it("preserves grounded source-backed answers when only the overlap heuristic is recoverable", async () => {
    const answer = await answerFromTextSources(
      "What is the long acting injectable pathway?",
      [
        source({
          id: "lai-pathway-1",
          document_id: "lai-doc",
          title: "Long Acting Injectable Antipsychotic Pathway",
          file_name: "MHSP.LongActingInjectableAntipsychoticPathway.pdf",
          section_heading: "Depot pathway",
          content: "Long acting injectable antipsychotic pathway guidance for depot reviews.",
          match_explanation: { titleHit: true, contentHit: true, reasons: ["title"] },
        }),
      ],
      {
        answer: "Depot antipsychotic follow-up is covered by the cited local pathway.",
        grounded: true,
        confidence: "low",
        answerSections: [],
        citations: [{ chunk_id: "lai-pathway-1" }],
        quoteCards: [],
        conflictsOrGaps: [],
      },
    );

    expect(answer.grounded).toBe(true);
    expect(answer.confidence).toBe("medium");
    expect(answer.routingReason).toContain("final_quality_gate_source_backed_recovery:missing_query_overlap");
    expect(answer.answer).not.toMatch(/not enough source evidence|No current source/i);
  });

  it("skips the model tail for a generic LAI-management question only after extractive validation", async () => {
    const answer = await answerFromTextSources(
      "How are long acting injectables managed?",
      [
        source({
          id: "lai-management-1",
          document_id: "lai-doc",
          title: "Long Acting Injectable Medication",
          file_name: "MHSP.LongActingInjectable.pdf",
          section_heading: "Management process",
          content:
            "Long acting injectables are managed through a documented medication pathway covering prescribing, administration, observation, follow-up, and clinical review.",
          match_explanation: { titleHit: true, contentHit: true, reasons: ["title", "content"] },
        }),
        source({
          id: "lai-management-2",
          document_id: "lai-doc",
          title: "Long Acting Injectable Medication",
          file_name: "MHSP.LongActingInjectable.pdf",
          section_heading: "Follow-up",
          content:
            "The long acting injectable medication record documents the prescription and administration, with follow-up and review arranged through the treating team.",
          match_explanation: { titleHit: true, contentHit: true, reasons: ["title", "content"] },
        }),
      ],
      new Error("model generation must not run for a validated generic LAI answer"),
    );

    expect(answer.routingMode).toBe("extractive");
    expect(answer.routingReason).toContain("validated_generic_lai_management_extractive_answer");
    expect(answer.routingReason).not.toContain("generation_fallback");
    expect(answer.grounded).toBe(true);
    expect(answer.confidence).not.toBe("unsupported");
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.latencyTimings?.generation_latency_ms).toBe(0);
  });

  it("keeps special-population LAI management questions on model synthesis", async () => {
    const answer = await answerFromTextSources(
      "How are long acting injectables managed in adolescents?",
      [
        source({
          id: "lai-management-adolescent",
          document_id: "lai-doc",
          title: "Long Acting Injectable Medication",
          content: "Long acting injectables require prescribing, administration, follow-up, and clinical review.",
          match_explanation: { titleHit: true, contentHit: true, reasons: ["title", "content"] },
        }),
      ],
      new Error("model generation attempted"),
    );

    expect(answer.routingReason).not.toContain("validated_generic_lai_management_extractive_answer");
    expect(answer.routingReason).toContain("generation_fallback");
  });

  it("keeps lactation-scoped LAI management questions on model synthesis", async () => {
    const answer = await answerFromTextSources(
      "How are long acting injectables managed during breastfeeding?",
      [
        source({
          id: "lai-management-lactation",
          document_id: "lai-doc",
          title: "Long Acting Injectable Medication",
          content: "Long acting injectables require prescribing, administration, follow-up, and clinical review.",
          match_explanation: { titleHit: true, contentHit: true, reasons: ["title", "content"] },
        }),
      ],
      new Error("model generation attempted"),
    );

    expect(answer.routingReason).not.toContain("validated_generic_lai_management_extractive_answer");
    expect(answer.routingReason).toContain("generation_fallback");
  });

  it("recovers generation timeouts with an extractive source-backed answer when sources are strong", async () => {
    const answer = await answerFromTextSources(
      "How should agitation be managed when oral medication is refused?",
      [
        source({
          id: "agitation-table-1",
          title: "Agitation And Arousal Pharmacological Management(AKG)",
          file_name: "Agitation and Arousal Pharmacological Management (AKG).pdf",
          section_heading: "Appendix V: Agitation and Arousal PRN Medication",
          content:
            "Agitation is managed by using IM medication when oral medication is refused, with review and monitoring.",
          match_explanation: { titleHit: true, contentHit: true, tableHit: true, reasons: ["title", "table"] },
          table_facts: [
            {
              id: "fact-agitation-table",
              document_id: "agitation-doc",
              source_chunk_id: "agitation-table-1",
              source_image_id: "image-agitation-table",
              page_number: 11,
              table_title: "Agitation and arousal pharmacological management",
              row_label: "PRN medication",
              clinical_parameter: "Medication table",
              threshold_value: null,
              action: "Use IM medication when oral medication is refused, with review and monitoring.",
            },
          ],
        }),
      ],
      new Error("OpenAI timed out. Trying source-only fallback response."),
    );

    expect(answer.routingMode).toBe("extractive");
    expect(answer.routingReason).toContain("source_backed_extractive_fallback");
    expect(answer.grounded).toBe(true);
    expect(answer.answer).toMatch(/IM medication|oral medication|agitation/i);
  });

  it("keeps source-backed agitation step numbers grounded across multiple citations", async () => {
    const answer = await answerFromTextSources(
      "What steps are listed for agitation and arousal pharmacological management?",
      [
        source({
          id: "agitation-step-table",
          document_id: "agitation-doc",
          title: "Agitation and Arousal Pharmacological Management",
          file_name: "MHSP.AgitationArousalPharmaMgt.pdf",
          section_heading: "Stepwise management",
          content:
            "Step 1: agitation and arousal pharmacological management should assess severity and use oral medication when the patient is willing. Step 2: monitor the agitation response and consider intramuscular medication when oral medication is refused.",
        }),
        source({
          id: "agitation-clinical-review",
          document_id: "agitation-doc",
          title: "Agitation and Arousal Pharmacological Management",
          file_name: "MHSP.AgitationArousalPharmaMgt.pdf",
          section_heading: "Clinical review",
          content:
            "Review physical causes, medicine-related risks, observations, and the least restrictive management option.",
          similarity: 0.94,
          hybrid_score: 0.94,
          text_rank: 1,
        }),
      ],
    );

    expect(answer.routingMode).toBe("extractive");
    expect(answer.grounded).toBe(true);
    expect(answer.citations.length).toBeGreaterThanOrEqual(2);
    expect(answer.answer).toMatch(/step [12]/i);
    expect(answer.unverifiedNumericTokens ?? []).toEqual([]);
    expect(answer.faithfulnessWarning).toBeUndefined();
  });

  it("recovers incomplete max-output generation with an extractive answer when evidence is strong", async () => {
    const answer = await answerFromTextSources(
      "How should agitation be managed when oral medication is refused?",
      [
        source({
          id: "agitation-max-output-1",
          title: "Agitation And Arousal Pharmacological Management(AKG)",
          file_name: "Agitation and Arousal Pharmacological Management (AKG).pdf",
          section_heading: "Appendix V: Agitation and Arousal PRN Medication",
          content:
            "Agitation is managed by using IM medication when oral medication is refused, with review and monitoring.",
          match_explanation: { titleHit: true, contentHit: true, tableHit: true, reasons: ["title", "table"] },
        }),
      ],
      new Error("OpenAI generation incomplete: max_output_tokens"),
    );

    expect(answer.routingMode).toBe("extractive");
    expect(answer.routingReason).toContain("generation_fallback:provider_incomplete_max_output_tokens");
    expect(answer.routingReason).toContain("source_backed_extractive_fallback");
    expect(answer.grounded).toBe(true);
    expect(answer.answer).toMatch(/IM medication|oral medication|agitation/i);
  });

  it("returns a grounded document-support fallback for procedure queries when no clean fact can be synthesized", async () => {
    const answer = await answerFromTextSources(
      "What is the process for ECT procedure?",
      [
        source({
          id: "ect-procedure-1",
          document_id: "ect-doc",
          title: "ECT Procedure",
          file_name: "ECT Procedure (AKG).pdf",
          section_heading: "Procedure flowchart",
          content: "Procedure flowchart records and rostered ECT team coordination.",
          similarity: 0.9,
          hybrid_score: 0.9,
          match_explanation: { titleHit: true, contentHit: true, reasons: ["document_title"] },
        }),
      ],
      new Error("OpenAI timed out. Trying source-only fallback response."),
    );

    expect(answer.routingMode).toBe("extractive");
    expect(answer.routingReason).toMatch(
      /high_confidence_extractive_retrieval|source_backed_(?:extractive|review)_fallback/,
    );
    expect(answer.grounded).toBe(true);
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.answer).toMatch(/source support|indexed document|supports this query|ECT Procedure/i);
  });

  it("retries template-like dosing-class strong answers with a quality retry before returning", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

    const clozapineSource = source({
      id: "clozapine-monitoring-template-1",
      document_id: "clozapine-doc",
      title: "Medication guideline",
      file_name: "medication-guideline.pdf",
      page_number: 11,
      section_heading: "Monitoring",
      content:
        "Copy the Consent to Clozapine Treatment Form EMR0270, prescribe initiation on the WA Adult Clozapine Initiation and Titration form, and ensure consumers complete the Clozapine Monitoring Form on initiation.",
      similarity: 0.94,
      hybrid_score: 0.94,
      text_rank: 0,
    });
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: [clozapineSource], error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    const generateStructuredTextResult = vi
      .fn()
      .mockResolvedValueOnce({
        text: JSON.stringify({
          answer: "The retrieved source supports clozapine monitoring documentation during initiation.",
          grounded: true,
          confidence: "high",
          answerSections: [
            {
              heading: "Monitoring documents",
              kind: "documentation",
              supportLevel: "direct",
              body: "The retrieved source supports consent documentation and completion of the Clozapine Monitoring Form.",
              citation_chunk_ids: ["clozapine-monitoring-template-1"],
            },
          ],
          citations: [{ chunk_id: "clozapine-monitoring-template-1" }],
          quoteCards: [
            {
              chunk_id: "clozapine-monitoring-template-1",
              quote: "ensure consumers complete the Clozapine Monitoring Form on initiation.",
              section_heading: "Monitoring",
            },
          ],
          conflictsOrGaps: [],
        }),
        model: "gpt-4.1-mini",
        operation: "answer",
        latencyMs: 12,
        requestId: "req_fast_template",
        usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          answer:
            "Clozapine initiation requires consent documentation, initiation/titration prescribing, and completion of the **Clozapine Monitoring Form**.",
          grounded: true,
          confidence: "high",
          answerSections: [
            {
              heading: "Documentation",
              kind: "documentation",
              supportLevel: "direct",
              body: "Complete the consent form, prescribe initiation on the WA Adult Clozapine Initiation and Titration form, and complete the monitoring form at initiation.",
              citation_chunk_ids: ["clozapine-monitoring-template-1"],
            },
          ],
          citations: [{ chunk_id: "clozapine-monitoring-template-1" }],
          quoteCards: [
            {
              chunk_id: "clozapine-monitoring-template-1",
              quote: "ensure consumers complete the Clozapine Monitoring Form on initiation.",
              section_heading: "Monitoring",
            },
          ],
          conflictsOrGaps: [],
        }),
        model: "gpt-4.1",
        operation: "answer",
        latencyMs: 24,
        requestId: "req_strong_natural",
        usage: { input_tokens: 160, output_tokens: 100, total_tokens: 260 },
      });

    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(),
      generateStructuredTextResult,
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");

    const answer = await answerQuestionWithScope({
      query: "what monitoring is required for clozapine",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
    });

    expect(generateStructuredTextResult).toHaveBeenCalledTimes(2);
    expect(answer.routingMode).toBe("strong");
    expect(answer.routingReason).toContain("strong_quality_retry");
    expect(answer.openAIRequestIds ?? []).toEqual(["req_fast_template", "req_strong_natural"]);
    expect(answer.grounded).toBe(true);
    expect(answer.confidence).toBe("medium");
    expect(answer.responseMode).toBe("clinical_pathway");
    expect(answer.answer.replace(/\*\*/g, "")).toMatch(/Clozapine initiation requires/i);
    expect(answer.answer).not.toMatch(/retrieved source|source-backed|based on the provided excerpts/i);
    expect(answer.answerSections?.[0]?.heading).toBe("Documentation");
  });

  it("retries over-expanded fast answers for simple direct questions", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

    const bulimiaSource = source({
      id: "bulimia-definition-1",
      document_id: "bulimia-doc",
      title: "Bulimia Nervosa",
      file_name: "bulimia-nervosa.pdf",
      page_number: 1,
      section_heading: "Overview",
      content:
        "Bulimia nervosa is an eating disorder with recurrent binge eating and compensatory behaviours. The guideline also discusses CBT, nutritional support, monitoring, and referral.",
      similarity: 0.94,
      hybrid_score: 0.94,
      text_rank: 1.2,
    });
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: [bulimiaSource], error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    const generateParsedTextResult = vi.fn(async () => ({
      parsed: {
        queryClass: "unsupported_or_general",
        confidence: 0.4,
        reasons: ["direct definition question"],
        expandedTerms: ["bulimia nervosa"],
      },
    }));
    const generateStructuredTextResult = vi
      .fn()
      .mockResolvedValueOnce({
        text: JSON.stringify({
          answer:
            "Bulimia nervosa is an eating disorder involving recurrent binge eating and compensatory behaviours. Management includes CBT, nutritional support, medication options, monitoring, and referral when risks are present.",
          grounded: true,
          confidence: "high",
          answerSections: [
            {
              heading: "Management",
              kind: "required_actions",
              supportLevel: "direct",
              body: "CBT and nutritional support are central treatments.",
              citation_chunk_ids: ["bulimia-definition-1"],
            },
            {
              heading: "Monitoring",
              kind: "required_actions",
              supportLevel: "direct",
              body: "Monitoring and referral are required when clinical risks are present.",
              citation_chunk_ids: ["bulimia-definition-1"],
            },
          ],
          citations: [{ chunk_id: "bulimia-definition-1" }],
          quoteCards: [
            {
              chunk_id: "bulimia-definition-1",
              quote: "Bulimia nervosa is an eating disorder with recurrent binge eating and compensatory behaviours.",
              section_heading: "Overview",
            },
          ],
          conflictsOrGaps: [],
        }),
        model: "gpt-4.1-mini",
        operation: "answer",
        latencyMs: 12,
        requestId: "req_fast_overexpanded",
        usage: { input_tokens: 120, output_tokens: 120, total_tokens: 240 },
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          answer:
            "Bulimia nervosa is an eating disorder involving recurrent binge eating followed by compensatory behaviours.",
          grounded: true,
          confidence: "high",
          answerSections: [],
          citations: [{ chunk_id: "bulimia-definition-1" }],
          quoteCards: [
            {
              chunk_id: "bulimia-definition-1",
              quote: "Bulimia nervosa is an eating disorder with recurrent binge eating and compensatory behaviours.",
              section_heading: "Overview",
            },
          ],
          conflictsOrGaps: [],
        }),
        model: "gpt-4.1",
        operation: "answer",
        latencyMs: 24,
        requestId: "req_strong_concise",
        usage: { input_tokens: 150, output_tokens: 60, total_tokens: 210 },
      });

    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(),
      generateParsedTextResult,
      generateStructuredTextResult,
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");

    const answer = await answerQuestionWithScope({
      query: "what is bulimia nervosa in adults",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
    });

    expect(generateParsedTextResult).toHaveBeenCalledTimes(1);
    expect(generateStructuredTextResult).toHaveBeenCalledTimes(2);
    expect(answer.routingMode).toBe("strong");
    expect(answer.routingReason).toContain("fast_overexpanded_simple_retry_strong");
    expect(answer.openAIRequestIds ?? []).toEqual(["req_fast_overexpanded", "req_strong_concise"]);
    expect(answer.answer.replace(/\*\*/g, "")).toContain("Bulimia nervosa is an eating disorder");
    expect(answer.smartApiPlan?.answerPlan.intent).toBe("clinical_synthesis");
  });

  it("records fast-template and strong-quality retry telemetry", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_AWAIT_QUERY_LOGS", "true");

    const firstSource = source({
      id: "template-retry-1",
      document_id: "document-a",
      title: "Document Monitoring Pathway Guide A",
      file_name: "document-monitoring-pathway-guide-a.pdf",
      page_number: 3,
      section_heading: "Monitoring pathway",
      content:
        "Guide A defines document monitoring pathways, routine review intervals, safety checks, and referral thresholds for comparison across guides.",
      similarity: 0.96,
      hybrid_score: 0.96,
      text_rank: 1.1,
    });

    const secondSource = source({
      id: "template-retry-2",
      document_id: "document-b",
      title: "Document Monitoring Pathway Guide B",
      file_name: "document-monitoring-pathway-guide-b.pdf",
      page_number: 4,
      section_heading: "Monitoring pathway",
      content:
        "Guide B describes a second document monitoring pathway with review frequency, escalation triggers, and referral thresholds for comparison.",
      similarity: 0.92,
      hybrid_score: 0.92,
      text_rank: 1.0,
    });

    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text")
        return { data: [firstSource, secondSource], error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });

    const generateStructuredTextResult = vi
      .fn()
      .mockResolvedValueOnce({
        text: JSON.stringify({
          answer:
            "This is a Direct source-backed answer derived from the retrieved sources and structured for the same citations.",
          grounded: false,
          confidence: "low",
          answerSections: [
            {
              heading: "Direct source-backed answer",
              kind: "documentation",
              supportLevel: "direct",
              body: "Use the retrieved evidence to guide a routine review.",
              citation_chunk_ids: ["template-retry-1"],
            },
          ],
          citations: [{ chunk_id: "template-retry-1" }],
          quoteCards: [
            {
              chunk_id: "template-retry-1",
              quote:
                "Retrieved source supports that this document defines the first-line management of a condition and associated safety checks.",
              section_heading: "Summary",
            },
          ],
          conflictsOrGaps: [],
        }),
        model: "gpt-5.4-mini",
        operation: "answer",
        latencyMs: 12,
        requestId: "req_fast_template",
        usage: { input_tokens: 80, output_tokens: 90, total_tokens: 170 },
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          answer: "Source-backed summaries mention management steps and review intervals.",
          grounded: true,
          confidence: "high",
          answerSections: [],
          citations: [{ chunk_id: "template-retry-1" }],
          quoteCards: [
            {
              chunk_id: "template-retry-1",
              quote: "Retrieved source supports that this document defines the first-line management.",
              section_heading: "Summary",
            },
          ],
          conflictsOrGaps: [],
        }),
        model: "gpt-5.5",
        operation: "answer",
        latencyMs: 18,
        requestId: "req_strong_template",
        usage: { input_tokens: 140, output_tokens: 120, total_tokens: 260 },
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          answer:
            "Compare the guide pathways by using routine review intervals, escalation triggers, and urgent referral thresholds.",
          grounded: true,
          confidence: "high",
          answerSections: [
            {
              heading: "Monitoring",
              kind: "required_actions",
              supportLevel: "direct",
              body: "Review the pathway criteria regularly and escalate when safety checks or referral thresholds are met.",
              citation_chunk_ids: ["template-retry-2"],
            },
          ],
          citations: [{ chunk_id: "template-retry-2" }],
          quoteCards: [
            {
              chunk_id: "template-retry-2",
              quote:
                "Guide B describes a second document monitoring pathway with review frequency, escalation triggers, and referral thresholds for comparison.",
              section_heading: "Monitoring",
            },
          ],
          conflictsOrGaps: [],
        }),
        model: "gpt-5.5",
        operation: "answer",
        latencyMs: 14,
        requestId: "req_strong_quality",
        usage: { input_tokens: 170, output_tokens: 120, total_tokens: 290 },
      });

    const insert = vi.fn(async () => ({ data: null, error: null }));
    const from = vi.fn((table: string) => (table === "rag_queries" ? { insert } : new EmptyQuery()));

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from,
      }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false })),
      generateStructuredTextResult,
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");

    const answer = await answerQuestionWithScope({
      query: "Compare document monitoring pathways across two guides",
      ownerId: undefined,
      skipCache: true,
    });

    expect(generateStructuredTextResult).toHaveBeenCalledTimes(3);
    expect(answer.routingMode).toBe("strong");
    expect(answer.latencyTimings?.answer_retry_count).toBe(2);
    expect(answer.latencyTimings?.answer_retry_reasons).toEqual(["fast_template_retry_strong", "strong_quality_retry"]);
    expect(answer.routingReason).toContain("fast_template_retry_strong");
    expect(answer.routingReason).toContain("strong_quality_retry");
    expect(answer.openAIRequestIds).toEqual(["req_fast_template", "req_strong_template", "req_strong_quality"]);
    const structuredCalls = generateStructuredTextResult.mock.calls as unknown as Array<[string]>;
    expect(structuredCalls[2]?.[0]).toContain("Within one named scale and source");
    expect(structuredCalls[2]?.[0]).toContain("cite the smallest sufficient directly supporting chunk set");
    expect(insert).toHaveBeenCalledTimes(1);
    const insertCalls = insert.mock.calls as unknown as Array<
      [{ answer?: unknown; metadata?: Record<string, unknown> }]
    >;
    const loggedRow = insertCalls[0]?.[0] ?? {};
    const loggedMetadata = loggedRow.metadata ?? {};
    expect(loggedMetadata.answer_retry_count).toBe(2);
    expect(loggedMetadata.answer_retry_reasons).toEqual(["fast_template_retry_strong", "strong_quality_retry"]);
    expect(loggedMetadata.degraded).toBe(false);
    expect(loggedMetadata.provider_generation_degraded).toBe(false);
    // PIA-3: the generated answer text must not be persisted to rag_queries.answer
    // unless RAG_PERSIST_ANSWER_TEXT is enabled (default off), and the row records
    // that the answer was not retained.
    expect(loggedRow.answer).toBeNull();
    expect(loggedMetadata.answer_retained).toBe(false);
    expect(JSON.stringify(loggedRow)).not.toContain("review intervals");
  });

  it("bounds every reason in an ordinary uncached programme query row", async () => {
    vi.resetModules();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_PROVIDER_MODE", "auto");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_AWAIT_QUERY_LOGS", "true");
    vi.stubEnv("RAG_TELEMETRY_EXTENDED", "true");

    const topLevelReasonCanary = "provider-error-canary: fallback raw upstream body";
    const nestedReasonCanary = "protected-reference-canary: restricted source text";
    const monitoringSource = source({
      id: "ordinary-programme-writer-source",
      document_id: "ordinary-programme-writer-document",
      title: "Synthetic monitoring guideline",
      file_name: "synthetic-monitoring-guideline.pdf",
      section_heading: "Monitoring",
      content: "Review mental state and adverse effects at each scheduled clinical review.",
      similarity: 0.96,
      hybrid_score: 0.96,
      text_rank: 1.1,
    });
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") {
        return { data: [monitoringSource], error: null };
      }
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
    const from = vi.fn((table: string) => {
      if (table === "rag_queries" || table === "rag_retrieval_logs") {
        return {
          insert: vi.fn(async (row: Record<string, unknown>) => {
            inserts.push({ table, row });
            return { data: null, error: null };
          }),
        };
      }
      return new EmptyQuery();
    });
    const generateStructuredTextResult = vi.fn(async () => ({
      text: JSON.stringify({
        answer: "Review mental state and adverse effects at each scheduled clinical review.",
        grounded: true,
        confidence: "high",
        answerSections: [],
        citations: [{ chunk_id: monitoringSource.id }],
        quoteCards: [
          {
            chunk_id: monitoringSource.id,
            quote: monitoringSource.content,
            section_heading: monitoringSource.section_heading,
          },
        ],
        conflictsOrGaps: [],
      }),
      model: "gpt-5.4-mini",
      operation: "answer",
      latencyMs: 12,
      requestId: "req_ordinary_programme_writer",
      usage: { input_tokens: 80, output_tokens: 50, total_tokens: 130 },
    }));

    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from }) }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false })),
      generateStructuredTextResult,
    }));
    vi.doMock("@/lib/rag/rag-routing", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/lib/rag/rag-routing")>();
      return {
        ...actual,
        chooseAnswerRoute: vi.fn((args: Parameters<typeof actual.chooseAnswerRoute>[0]) => ({
          ...actual.chooseAnswerRoute(args),
          reason: topLevelReasonCanary,
        })),
      };
    });

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");
    const interactionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await answerQuestionWithScope({
      query: "What monitoring action is supported by the synthetic guideline?",
      ownerId: undefined,
      skipCache: true,
      observationContext: { interactionId, rolloutMode: "shadow" },
      finalizeTelemetryAnswer: (telemetryAnswer) => {
        telemetryAnswer.routingReason = topLevelReasonCanary;
        telemetryAnswer.fallbackReason = topLevelReasonCanary;
        telemetryAnswer.degradedMode = { active: true, reason: topLevelReasonCanary };
        telemetryAnswer.programmeDiagnostics = {
          ...telemetryAnswer.programmeDiagnostics!,
          insufficiencyReason: nestedReasonCanary,
        } as unknown as NonNullable<RagAnswer["programmeDiagnostics"]>;
        return telemetryAnswer;
      },
    });

    const queryRow = inserts.find((inserted) => inserted.table === "rag_queries")?.row;
    expect(queryRow).toBeDefined();
    expect(JSON.stringify(queryRow)).not.toContain(topLevelReasonCanary);
    expect(JSON.stringify(queryRow)).not.toContain(nestedReasonCanary);
    expect(queryRow?.metadata).toMatchObject({
      interaction_id: interactionId,
      routing_reason: "strong",
      fallback_reason: "insufficient_claim_support",
      insufficiency_reason: "insufficient_claim_support",
    });
  });

  it("filters table-caption metadata from extractive answer points", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

    const clozapineTableSource = source({
      id: "clozapine-table-1",
      document_id: "clozapine-doc",
      title: "Clozapine Monitoring",
      file_name: "CG.MHSP.ClozapinePresAdminMonitor.pdf",
      page_number: 6,
      section_heading: "Roles and responsibilities",
      content:
        "Table detailing roles and responsibilities in Clozapine therapy monitoring including discontinuation criteria for red-range blood results. clinical_table table_crop Roles and responsibilities: If the consumer's blood results return in the red range, Clozapine therapy must be discontinued immediately and reported to the patient monitoring system.",
      similarity: 0.95,
      hybrid_score: 0.95,
      text_rank: 1.3,
      memory_cards: [
        {
          id: "memory-table-1",
          document_id: "clozapine-doc",
          owner_id: null,
          card_type: "table_row",
          title: "Clozapine red range action",
          content:
            "Table detailing roles and responsibilities in Clozapine therapy monitoring. clinical_table table_crop Roles and responsibilities: If the consumer's blood results return in the red range, Clozapine therapy must be discontinued immediately and reported to the patient monitoring system.",
          normalized_terms: ["clozapine", "monitoring", "red", "range"],
          page_number: 6,
          source_chunk_ids: ["clozapine-table-1"],
          source_image_ids: [],
          confidence: 0.93,
        },
      ],
    });
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text")
        return { data: [clozapineTableSource], error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    const generateStructuredTextResult = vi.fn(async () => ({
      text: JSON.stringify({
        answer:
          "For red-range blood results during clozapine therapy, clozapine therapy must be discontinued immediately and reported to the patient monitoring system.",
        grounded: true,
        confidence: "high",
        answerSections: [
          {
            heading: "Required action",
            kind: "required_actions",
            supportLevel: "direct",
            body: "Red-range blood results require immediate discontinuation of clozapine therapy and reporting to the monitoring system.",
            citation_chunk_ids: ["clozapine-table-1"],
          },
        ],
        citations: [{ chunk_id: "clozapine-table-1" }],
        quoteCards: [
          {
            chunk_id: "clozapine-table-1",
            quote:
              "If the consumer's blood results return in the red range, Clozapine therapy must be discontinued immediately and reported to the patient monitoring system.",
            section_heading: "Roles and responsibilities",
          },
        ],
        conflictsOrGaps: [],
      }),
      model: "gpt-4.1-mini",
      operation: "answer",
      latencyMs: 12,
      requestId: "req_table_synthesis",
      usage: { input_tokens: 130, output_tokens: 100, total_tokens: 230 },
    }));

    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(),
      generateStructuredTextResult,
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");

    const answer = await answerQuestionWithScope({
      query: "what clozapine monitoring action is needed for red range blood results",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
    });

    const plainAnswer = answer.answer.replace(/\*\*/g, "");
    expect(generateStructuredTextResult).not.toHaveBeenCalled();
    expect(answer.routingMode).toBe("extractive");
    expect(plainAnswer).toContain("must be discontinued immediately");
    expect(plainAnswer).not.toContain("Table detailing roles and responsibilities");
    expect(plainAnswer).not.toContain("clinical_table");
    expect(plainAnswer).not.toContain("table_crop");
  });

  it("retries malformed fast output and fails closed after strong generation also fails", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_MAX_OUTPUT_TOKENS", "650");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

    const sources = [
      source({
        content:
          "Inpatient approach details for agitation and arousal management include oral medication when the patient is willing, increased observation when ratings rise, and intramuscular medication when oral medication is refused.",
      }),
      source({
        id: "agitation-chunk-2",
        page_number: 10,
        chunk_index: 1,
        content:
          "Inpatient approach details include review of route, rating severity, escalation triggers, and monitoring after medication administration.",
      }),
    ];
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: sources, error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });
    const generateStructuredTextResult = vi.fn(async () => ({
      text: '{"answer":"Agitation and arousal management starts',
      model: "gpt-4.1-mini",
      operation: "answer",
      latencyMs: 12,
      requestId: "req_truncated",
      usage: { input_tokens: 100, output_tokens: 650, total_tokens: 750 },
    }));

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false })),
      generateStructuredTextResult,
    }));

    const { answerQuestionWithScope, machineReadableFallbackAnswer } = await import("../src/lib/rag/rag");

    const answer = await answerQuestionWithScope({
      query: "Summarize inpatient approach",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
    });

    expect(answer.answer).not.toBe(machineReadableFallbackAnswer);
    expect(answer.routingMode).toBe("strong");
    expect(answer.grounded).toBe(false);
    expect(answer.confidence).toBe("unsupported");
    expect(answer.responseMode).toBe("evidence_gap");
    expect(answer.citations).toEqual([]);
    expect(answer.quoteCards?.length).toBeGreaterThan(0);
    expect(answer.routingReason).toContain("final_quality_gate");
    expect(generateStructuredTextResult).toHaveBeenCalledTimes(3);
    expect(answer.openAIRequestIds).toEqual(["req_truncated", "req_truncated", "req_truncated"]);
    expect(answer.openAIUsage).toMatchObject({ output_tokens: 1950 });
    expect(answer.latencyTimings?.answer_retry_count).toBe(2);
    expect(answer.latencyTimings?.answer_retry_reasons).toEqual([
      "fast_unsupported_retry_strong",
      "strong_quality_retry",
    ]);
  });

  it("keeps valid structured model answers on the generated-answer path", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

    const sources = [
      source({
        content:
          "Inpatient approach details for agitation and arousal management include a stepwise approach based on rating severity, route, oral options, and intramuscular options.",
      }),
    ];
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: sources, error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });
    const generateStructuredTextResult = vi.fn(async () => ({
      text: JSON.stringify({
        answer: "The inpatient agitation and arousal approach is stepwise and based on rating and route.",
        grounded: true,
        confidence: "high",
        answerSections: [
          {
            heading: "Approach",
            body: "The inpatient agitation and arousal approach is stepwise and based on rating and route.",
            citation_chunk_ids: ["agitation-chunk-1"],
          },
        ],
        citations: [{ chunk_id: "agitation-chunk-1" }],
        quoteCards: [
          {
            chunk_id: "agitation-chunk-1",
            quote: "Agitation and arousal pharmacological management for adult mental health inpatients.",
            section_heading: "Appendix 1",
          },
        ],
        conflictsOrGaps: [],
      }),
      model: "gpt-4.1-mini",
      operation: "answer",
      latencyMs: 12,
      requestId: "req_valid",
      usage: { input_tokens: 100, output_tokens: 120, total_tokens: 220 },
    }));

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false })),
      generateStructuredTextResult,
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");

    const answer = await answerQuestionWithScope({
      query: "Summarize inpatient approach",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
    });

    expect(answer.answer).toBe(
      "The inpatient agitation and arousal approach is stepwise and based on rating and route.",
    );
    expect(answer.routingMode).toBe("fast");
    expect(answer.routingReason).not.toContain("structured_output_fallback");
    expect(answer.openAIRequestIds).toEqual(["req_valid"]);
    expect(answer.quoteCards?.length).toBe(1);
  });

  it("does not cache or coalesce anonymous answers despite legacy skipCache input", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "300000");
    vi.stubEnv("RAG_ANSWER_CACHE_SIZE", "100");

    const sources = [
      source({
        content:
          "Inpatient approach details for agitation and arousal management include a stepwise approach based on rating severity, route, oral options, and intramuscular options.",
      }),
    ];
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: sources, error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });

    let releaseGeneration!: () => void;
    let markGenerationStarted!: () => void;
    const generationStarted = new Promise<void>((resolve) => {
      markGenerationStarted = resolve;
    });
    const generationGate = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const generateStructuredTextResult = vi.fn(async () => {
      markGenerationStarted();
      await generationGate;
      return {
        text: JSON.stringify({
          answer: "Use a stepwise agitation and arousal approach based on rating and route.",
          grounded: true,
          confidence: "high",
          answerSections: [],
          citations: [{ chunk_id: "agitation-chunk-1" }],
          quoteCards: [
            {
              chunk_id: "agitation-chunk-1",
              quote: "Agitation and arousal pharmacological management for adult mental health inpatients.",
              section_heading: "Appendix 1",
            },
          ],
          conflictsOrGaps: [],
        }),
        model: "gpt-4.1-mini",
        operation: "answer",
        latencyMs: 12,
        requestId: "req_coalesced",
        usage: { input_tokens: 100, output_tokens: 120, total_tokens: 220 },
      };
    });

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn((table: string) =>
          table === "rag_retrieval_logs" ? { insert: vi.fn(async () => ({ error: null })) } : new EmptyQuery(),
        ),
      }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false })),
      generateStructuredTextResult,
    }));
    vi.doMock("@/lib/env", async () => {
      const actual = await vi.importActual<typeof import("../src/lib/env")>("@/lib/env");
      return {
        ...actual,
        env: {
          ...actual.env,
          RAG_SEARCH_CACHE_TTL_MS: 0,
          RAG_ANSWER_CACHE_TTL_MS: 300000,
          RAG_ANSWER_CACHE_SIZE: 100,
        },
        isDemoMode: () => false,
        isLocalNoAuthMode: () => false,
      };
    });
    vi.doMock("@/lib/public-api-access", () => ({
      publicAccessContext: vi.fn(async () => ({
        authenticated: false,
        ownerId: undefined,
        rateLimitSubject: { kind: "anonymous", subjectKey: "anon:test" },
      })),
    }));
    vi.doMock("@/lib/api-rate-limit", async () => {
      const actual = await vi.importActual<typeof import("../src/lib/api-rate-limit")>("@/lib/api-rate-limit");
      return {
        ...actual,
        consumeSubjectApiRateLimit: vi.fn(async () => ({
          limited: false,
          limit: 6,
          remaining: 5,
          retryAfterSeconds: 1,
          resetAt: new Date(Date.now() + 60_000).toISOString(),
        })),
      };
    });
    vi.doMock("@/lib/search-scope", async () => {
      const actual = await vi.importActual<typeof import("../src/lib/search-scope")>("@/lib/search-scope");
      return {
        ...actual,
        resolveSearchScope: vi.fn(async () => ({ documentIds: undefined, activeFilterCount: 0 })),
      };
    });

    const { POST } = await import("../src/app/api/answer/route");
    const publicRequest = () =>
      new Request("http://localhost/api/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "Summarize inpatient approach", skipCache: true }),
      });
    const first = POST(publicRequest());
    const second = POST(publicRequest());

    await generationStarted;
    releaseGeneration();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    const firstAnswer = (await firstResponse.json()) as RagAnswer;
    const secondAnswer = (await secondResponse.json()) as RagAnswer;

    expect([firstResponse.status, secondResponse.status]).toEqual([200, 200]);
    expect(generateStructuredTextResult).toHaveBeenCalledTimes(2);
    const generateCalls = generateStructuredTextResult.mock.calls as unknown as Array<
      [
        unknown,
        {
          properties: {
            citations: { items: { properties: { chunk_id: { enum: string[] } } } };
            quoteCards: { items: { properties: { chunk_id: { enum: string[] } } } };
            answerSections: { items: { properties: { citation_chunk_ids: { items: { enum: string[] } } } } };
            conflictsOrGaps: { items: { properties: { source_chunk_ids: { items: { enum: string[] } } } } };
          };
        },
      ]
    >;
    const schema = generateCalls[0]?.[1];
    if (!schema) throw new Error("Expected generated answer schema");
    expect(schema).toMatchObject({
      properties: {
        citations: { items: { properties: { chunk_id: { enum: ["agitation-chunk-1"] } } } },
        quoteCards: { items: { properties: { chunk_id: { enum: ["agitation-chunk-1"] } } } },
        answerSections: { items: { properties: { citation_chunk_ids: { items: { enum: ["agitation-chunk-1"] } } } } },
        conflictsOrGaps: { items: { properties: { source_chunk_ids: { items: { enum: ["agitation-chunk-1"] } } } } },
      },
    });
    expect(schema.properties.citations.items.properties.chunk_id.enum).toEqual(["agitation-chunk-1"]);
    expect(schema.properties.quoteCards.items.properties.chunk_id.enum).toEqual(["agitation-chunk-1"]);
    expect(schema.properties.answerSections.items.properties.citation_chunk_ids.items.enum).toEqual([
      "agitation-chunk-1",
    ]);
    expect(schema.properties.conflictsOrGaps.items.properties.source_chunk_ids.items.enum).toEqual([
      "agitation-chunk-1",
    ]);
    expect(rpc).toHaveBeenCalledWith("match_document_chunks_text_v2", expect.any(Object));
    expect(rpc.mock.calls.filter(([name]) => name === "match_document_chunks_text_v2")).toHaveLength(2);
    expect(firstAnswer.openAIRequestIds).toEqual(["req_coalesced"]);
    expect(secondAnswer.openAIRequestIds).toEqual(["req_coalesced"]);
    expect(secondAnswer.routingReason ?? "").not.toContain("answer_inflight_coalesced");
  });

  it("does not propagate an originating request's abort to a coalesced concurrent caller", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "300000");
    vi.stubEnv("RAG_ANSWER_CACHE_SIZE", "100");

    const sources = [source()];
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: sources, error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });
    const generateStructuredTextResult = vi.fn(async () => ({
      text: JSON.stringify({
        answer: "Use a stepwise agitation and arousal approach based on rating and route.",
        grounded: true,
        confidence: "high",
        answerSections: [],
        citations: [{ chunk_id: "agitation-chunk-1" }],
        quoteCards: [],
        conflictsOrGaps: [],
      }),
      model: "gpt-4.1-mini",
      operation: "answer",
      latencyMs: 12,
      requestId: "req_independent",
      usage: { input_tokens: 100, output_tokens: 120, total_tokens: 220 },
    }));

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ rpc, from: vi.fn(() => new EmptyQuery()) }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false })),
      generateStructuredTextResult,
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");

    // Originating request aborts before it can produce an answer; its shared in-flight promise rejects.
    const controller = new AbortController();
    controller.abort();
    const first = answerQuestionWithScope({
      query: "Summarize inpatient approach",
      ownerId: "owner-1",
      logQuery: false,
      signal: controller.signal,
    });
    // Two identical waiters coalesce onto the (now-doomed) in-flight promise.
    const second = answerQuestionWithScope({
      query: "Summarize inpatient approach",
      ownerId: "owner-1",
      logQuery: false,
    });
    const third = answerQuestionWithScope({
      query: "Summarize inpatient approach",
      ownerId: "owner-1",
      logQuery: false,
    });

    // The originator's failure stays with the originator...
    await expect(first).rejects.toBeTruthy();
    // ...and the coalesced caller still gets a real, independently generated answer rather than a 500.
    const [secondAnswer, thirdAnswer] = await Promise.all([second, third]);
    expect(secondAnswer.openAIRequestIds).toEqual(["req_independent"]);
    expect(thirdAnswer.openAIRequestIds).toEqual(["req_independent"]);
    expect(secondAnswer.routingReason ?? "").not.toContain("answer_inflight_coalesced");
    // It ran its OWN pipeline (search + generation once) instead of cloning the failed one.
    expect(generateStructuredTextResult).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.filter(([name]) => name === "match_document_chunks_text_v2")).toHaveLength(1);
  });

  it("lets a coalesced answer waiter cancel without waiting for or duplicating the originating request", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "300000");
    vi.stubEnv("RAG_ANSWER_CACHE_SIZE", "100");

    const sources = [source()];
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: sources, error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });
    let releaseGeneration!: () => void;
    let markGenerationStarted!: () => void;
    const generationStarted = new Promise<void>((resolve) => {
      markGenerationStarted = resolve;
    });
    const generationGate = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const generateStructuredTextResult = vi.fn(async () => {
      markGenerationStarted();
      await generationGate;
      return {
        text: JSON.stringify({
          answer: "Use a stepwise agitation and arousal approach based on rating and route.",
          grounded: true,
          confidence: "high",
          answerSections: [],
          citations: [{ chunk_id: "agitation-chunk-1" }],
          quoteCards: [],
          conflictsOrGaps: [],
        }),
        model: "gpt-4.1-mini",
        operation: "answer",
        latencyMs: 12,
        requestId: "req_origin",
        usage: { input_tokens: 100, output_tokens: 120, total_tokens: 220 },
      };
    });

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ rpc, from: vi.fn(() => new EmptyQuery()) }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false })),
      generateStructuredTextResult,
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");
    const first = answerQuestionWithScope({
      query: "Summarize inpatient approach",
      ownerId: "owner-waiter-cancel",
      logQuery: false,
    });
    await generationStarted;

    const controller = new AbortController();
    const second = answerQuestionWithScope({
      query: "Summarize inpatient approach",
      ownerId: "owner-waiter-cancel",
      logQuery: false,
      signal: controller.signal,
    });
    const reason = new DOMException("waiter left", "AbortError");
    controller.abort(reason);
    await expect(second).rejects.toBe(reason);

    releaseGeneration();
    await expect(first).resolves.toMatchObject({ openAIRequestIds: ["req_origin"] });
    expect(generateStructuredTextResult).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.filter(([name]) => name === "match_document_chunks_text_v2")).toHaveLength(1);
  });

  it("retries fast model output that cites evidence IDs outside retrieved chunks", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

    const bulimiaSource = source({
      id: "bulimia-definition-1",
      document_id: "bulimia-doc",
      title: "Bulimia Nervosa Guideline",
      file_name: "bulimia-guideline.pdf",
      section_heading: "Definition",
      content:
        "Bulimia nervosa is an eating disorder characterised by recurrent binge-eating episodes followed by compensatory behaviours.",
      similarity: 0.96,
      hybrid_score: 0.96,
      text_rank: 1.2,
    });
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: [bulimiaSource], error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });
    const generateParsedTextResult = vi.fn(async () => ({
      parsed: {
        queryClass: "unsupported_or_general",
        confidence: 0.4,
        reasons: ["direct definition question"],
        expandedTerms: ["bulimia nervosa"],
      },
    }));
    const generateStructuredTextResult = vi
      .fn()
      .mockResolvedValueOnce({
        text: JSON.stringify({
          answer:
            "Bulimia nervosa is an eating disorder characterised by binge eating followed by compensatory behaviours.",
          grounded: true,
          confidence: "high",
          answerSections: [],
          citations: [{ chunk_id: "missing-bulimia-chunk" }],
          quoteCards: [],
          conflictsOrGaps: [],
        }),
        model: "gpt-5.4-mini",
        operation: "answer",
        latencyMs: 12,
        requestId: "req_invalid_evidence",
        usage: { input_tokens: 90, output_tokens: 50, total_tokens: 140 },
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          answer:
            "Bulimia nervosa is an eating disorder characterised by recurrent binge-eating episodes followed by compensatory behaviours.",
          grounded: true,
          confidence: "high",
          answerSections: [],
          citations: [{ chunk_id: "bulimia-definition-1" }],
          quoteCards: [
            {
              chunk_id: "bulimia-definition-1",
              quote: "Bulimia nervosa is an eating disorder",
              section_heading: "Definition",
            },
          ],
          conflictsOrGaps: [],
        }),
        model: "gpt-5.5",
        operation: "answer",
        latencyMs: 18,
        requestId: "req_valid_evidence",
        usage: { input_tokens: 120, output_tokens: 60, total_tokens: 180 },
      });

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false })),
      generateParsedTextResult,
      generateStructuredTextResult,
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");
    const answer = await answerQuestionWithScope({
      query: "what is bulimia nervosa in adults",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
    });

    expect(generateParsedTextResult).toHaveBeenCalledTimes(1);
    expect(generateStructuredTextResult).toHaveBeenCalledTimes(2);
    expect(answer.routingMode).toBe("strong");
    expect(answer.routingReason).toContain("fast_invalid_evidence_retry_strong");
    expect(answer.grounded).toBe(true);
    expect(answer.openAIRequestIds).toEqual(["req_invalid_evidence", "req_valid_evidence"]);
    expect(answer.answer.replace(/\*\*/g, "")).toContain("Bulimia nervosa is an eating disorder");
  });

  it("fails closed when generated clinical prose starts as a source heading", async () => {
    const answer = await answerFromTextSources(
      "lithium dosing for patients",
      [
        source({
          id: "lithium-heading-1",
          document_id: "lithium-doc",
          title: "Lithium Therapy - Initiation And Continuation Guideline",
          file_name: "lithium-therapy.pdf",
          section_heading: "Dosage and monitoring",
          content:
            "Dosage and monitoring. Therapy with lithium should begin with conventional lithium carbonate tablets and serum lithium levels should guide titration.",
          similarity: 0.95,
          hybrid_score: 0.95,
          text_rank: 1.3,
        }),
      ],
      {
        answer: "Dosage and monitoring.",
        grounded: true,
        confidence: "high",
        answerSections: [],
        citations: [{ chunk_id: "lithium-heading-1" }],
        quoteCards: [
          {
            chunk_id: "lithium-heading-1",
            quote: "Therapy with lithium should begin with conventional lithium carbonate tablets",
            section_heading: "Dosage and monitoring",
          },
        ],
        conflictsOrGaps: [],
      },
    );

    expect(answer.answer).toBe("No current source with dose guidance for this query was found.");
    expect(answer.responseMode).toBe("evidence_gap");
    expect(answer.grounded).toBe(false);
    expect(answer.routingReason).toContain("final_quality_gate:incomplete_opening_sentence");
    expect(answer.answer).not.toMatch(/^Dosage and monitoring/i);
  });

  it("rejects an incomplete eight-section provider result and uses bounded source-backed recovery", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

    const waSource = (overrides: Partial<SearchResult>, publisherCode: "FSH" | "EMHS") =>
      source({
        ...overrides,
        source_metadata: {
          source_title: overrides.title ?? "Lithium guideline",
          publisher:
            publisherCode === "FSH" ? "Fiona Stanley Fremantle Hospitals Group" : "East Metropolitan Health Service",
          publisher_code: publisherCode,
          jurisdiction: "Australia/WA",
          version: "1",
          publication_date: null,
          review_date: null,
          uploaded_at: null,
          indexed_at: null,
          uploaded_by: null,
          document_status: "current",
          clinical_validation_status: "locally_reviewed",
          extraction_quality: "good",
        },
      });
    const sources = [
      waSource(
        {
          id: "fsh-lithium-1",
          document_id: "fsh-lithium",
          title: "Lithium Therapy - Initiation and Continuation Guideline",
          section_heading: "Initiation",
          content:
            "For lithium initiation in adults, start lithium carbonate at 250 mg at night and titrate according to the serum lithium concentration.",
        },
        "FSH",
      ),
      waSource(
        {
          id: "emhs-lithium-1",
          document_id: "emhs-lithium",
          title: "Lithium Clinical Guideline",
          section_heading: "Target range",
          content:
            "The usual target serum lithium concentration is 0.6 to 0.8 mmol/L for maintenance treatment in adults.",
        },
        "EMHS",
      ),
      waSource(
        {
          id: "fsh-lithium-2",
          document_id: "fsh-lithium",
          title: "Lithium Therapy - Initiation and Continuation Guideline",
          section_heading: "Monitoring after dose changes",
          content:
            "Measure the serum lithium concentration 12 hours after the previous dose and repeat it 5 to 7 days after a dose change.",
        },
        "FSH",
      ),
      waSource(
        {
          id: "emhs-lithium-2",
          document_id: "emhs-lithium",
          title: "Lithium Clinical Guideline",
          section_heading: "Dose adjustment",
          content:
            "Use a lower lithium starting dose in older adults and people with impaired renal function, with closer serum monitoring.",
        },
        "EMHS",
      ),
      source({
        id: "bmj-paediatric-depression",
        document_id: "bmj-paediatric-depression",
        title: "Depression in children",
        content: "Psychological therapy is considered for depression in children and young people.",
        source_metadata: {
          source_title: "Depression in children",
          publisher: "BMJ Best Practice",
          publisher_code: "BMJ",
          jurisdiction: "International",
          version: null,
          publication_date: null,
          review_date: null,
          uploaded_at: null,
          indexed_at: null,
          uploaded_by: null,
          document_status: "current",
          clinical_validation_status: "unverified",
          extraction_quality: "good",
        },
      }),
    ];
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: sources, error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });
    let requestIndex = 0;
    const incompleteStructuredText = JSON.stringify({
      answer: "Synthetic partial provider lead that must never be served.",
      answerSections: Array.from({ length: 8 }, (_, index) => ({
        heading: `Synthetic provider section ${index + 1}`,
        body: `Synthetic provider partial body ${index + 1}`,
        citation_chunk_ids: ["fsh-lithium-1"],
      })),
      citations: [{ chunk_id: "fsh-lithium-1" }],
    });
    const generateStructuredTextResult = vi.fn(async () => ({
      text: incompleteStructuredText,
      model: "gpt-5.4-mini",
      operation: "answer",
      latencyMs: 12,
      requestId: `req_truncated_${++requestIndex}`,
      usage: { input_tokens: 100, output_tokens: 650, total_tokens: 750 },
      status: "incomplete",
      truncated: true,
      incompleteReason: "max_output_tokens",
    }));

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false })),
      generateStructuredTextResult,
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");
    const progressEvents: Array<{
      stage: string;
      selectedContextCount?: number;
      australianSourceCount?: number;
      waSourceCount?: number;
      usedSupplementaryFallback?: boolean;
    }> = [];
    const answer = await answerQuestionWithScope({
      query: "Lithium dosing",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
      onProgress: (event) => {
        progressEvents.push(event);
      },
    });

    expect(generateStructuredTextResult).toHaveBeenCalledTimes(2);
    const generationCalls = generateStructuredTextResult.mock.calls as unknown as Array<[string]>;
    expect(generationCalls.every((call) => call[0].includes("start lithium carbonate at 250 mg"))).toBe(true);
    expect(generationCalls.every((call) => !call[0].includes("Psychological therapy is considered"))).toBe(true);
    expect(answer.routingMode).toBe("extractive");
    expect(answer.grounded).toBe(true);
    expect(answer.confidence).not.toBe("unsupported");
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.routingReason).toContain("generation_fallback:provider_incomplete_max_output_tokens");
    expect(answer.routingReason).toContain("source_backed_extractive_fallback");
    expect(answer.routingReason).not.toContain("OpenAI generation incomplete");
    expect(answer.answerQualityTier).toBe("source_only");
    expect(answer.answerSections).toEqual([]);
    expect(JSON.stringify(answer)).not.toContain("Synthetic provider partial");
    expect(answer.answer.replace(/\*\*/g, "")).toMatch(/lithium|250 mg/i);
    expect(answer.answer).not.toContain("could not generate a finalized answer");
    expect(answer.unverifiedNumericTokens ?? []).toEqual([]);
    // Numeric fallback intentionally narrows the returned support to one complete
    // claim/citation when a multi-source synthesis would mix figures across chunks.
    expect(new Set(answer.sources.map((result) => result.document_id))).toEqual(new Set(["fsh-lithium"]));
    expect(answer.latencyTimings?.answer_retry_count).toBe(2);
    expect(answer.latencyTimings?.answer_retry_reasons).toEqual([
      "strong_max_output_tokens_retry_strong",
      "partial_structure_not_served",
      "strong_max_output_tokens",
    ]);
    expect(answer.openAIRequestIds).toEqual(["req_truncated_1", "req_truncated_2"]);
    expect(answer.openAIUsage).toMatchObject({ output_tokens: 1300, total_tokens: 1500 });
    expect(answerRouteResultCanBeCached({ deadlineExceeded: false }, answer)).toBe(false);
    expect(progressEvents).toContainEqual(
      expect.objectContaining({
        stage: "ranking",
        selectedContextCount: 4,
        australianSourceCount: 4,
        waSourceCount: 4,
        usedSupplementaryFallback: false,
      }),
    );
    expect(progressEvents).toContainEqual(
      expect.objectContaining({
        stage: "fallback",
        selectedContextCount: 4,
        australianSourceCount: 4,
        waSourceCount: 4,
        usedSupplementaryFallback: false,
      }),
    );
    expect(progressEvents).toContainEqual(expect.objectContaining({ stage: "verifying" }));
  });

  it("fails closed instead of leaking another medication's numeric dose after generation failure", async () => {
    const answer = await answerFromTextSources(
      "What is the maximum sertraline dose?",
      [
        source({
          id: "sertraline-source-gap",
          document_id: "sertraline-source-gap-doc",
          title: "Antidepressant Dose Overview",
          file_name: "antidepressant-dose-overview.pdf",
          section_heading: "Maximum doses",
          content:
            "The table lists fluoxetine 60 mg and citalopram 40 mg, but it does not state a maximum sertraline dose.",
          similarity: 0.96,
          hybrid_score: 0.96,
          text_rank: 1.3,
        }),
      ],
      new Error("OpenAI generation incomplete: max_output_tokens"),
    );
    expect(answer.answer).not.toMatch(/fluoxetine|citalopram|60 mg|40 mg/i);
    expect(answer.answer).toMatch(/source|guidance|support|evidence/i);
    expect(answer.routingReason).toContain("generation_fallback:provider_incomplete_max_output_tokens");
    expect(answer.routingReason).toContain("source_backed_review_fallback");
    expect(answer.unverifiedNumericTokens ?? []).toEqual([]);
    expect(answerRouteResultCanBeCached({ deadlineExceeded: false }, answer)).toBe(false);
  });

  it("prefers the safe single-chunk fallback candidate that carries the asked-for dose figure", async () => {
    // E-3c PR-C: both chunks yield safe single-chunk extractive candidates, but
    // only the lower-ranked one states the dose figure the query asks for. The
    // first-safe-candidate rule used to ship the figure-less answer.
    const answer = await answerFromTextSources(
      "What is the usual quetiapine dose?",
      [
        source({
          id: "quetiapine-advice-1",
          document_id: "quetiapine-doc",
          title: "Quetiapine Prescribing Guideline",
          file_name: "quetiapine-prescribing-guideline.pdf",
          section_heading: "Dose and administration",
          content: "The usual quetiapine dose is taken once daily in the evening.",
          similarity: 0.97,
          hybrid_score: 0.97,
          text_rank: 1.4,
        }),
        source({
          id: "quetiapine-maximum-1",
          document_id: "quetiapine-doc",
          title: "Quetiapine Prescribing Guideline",
          file_name: "quetiapine-prescribing-guideline.pdf",
          section_heading: "Maximum dose",
          content: "The maximum recommended quetiapine dose is 200 mg daily.",
          similarity: 0.86,
          hybrid_score: 0.86,
          text_rank: 1.1,
        }),
      ],
      new Error("OpenAI generation incomplete: max_output_tokens"),
    );

    expect(answer.routingMode).toBe("extractive");
    expect(answer.routingReason).toContain("source_backed_extractive_fallback");
    expect(answer.grounded).toBe(true);
    expect(answer.confidence).not.toBe("unsupported");
    expect(answer.unverifiedNumericTokens ?? []).toEqual([]);
    expect(answer.answer.replace(/\*\*/g, "")).toContain("200 mg");
    expect(new Set(answer.citations.map((citation) => citation.chunk_id))).toEqual(new Set(["quetiapine-maximum-1"]));
  });

  it("never marks provider-generation fallbacks as cacheable", async () => {
    expect(
      answerRouteResultCanBeCached(
        { deadlineExceeded: false },
        {
          routingReason: "strong_generation; generation_fallback:provider_timeout",
          degradedMode: { active: true, reason: "generation_fallback:provider_timeout" },
        },
      ),
    ).toBe(false);
    expect(
      answerRouteResultCanBeCached(
        { deadlineExceeded: false },
        {
          routingReason:
            "strong_generation; generation_fallback:provider_timeout; source_backed_review_fallback; extractive_quality_gate:weak",
          degradedMode: { active: true, reason: "generation_fallback:provider_timeout" },
        },
      ),
    ).toBe(false);
  });

  it("keeps the confidence gate active for weak ambiguous retrieval", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

    const sources = [
      source({
        id: "weak-general-1",
        document_id: "doc-1",
        title: "Ward Process",
        file_name: "ward-process.pdf",
        content: "Discharge planning documentation is briefly mentioned alongside general administrative notes.",
        similarity: 0.6,
        hybrid_score: 0.6,
        text_rank: 0.06,
      }),
      source({
        id: "weak-general-2",
        document_id: "doc-2",
        title: "General Overview",
        file_name: "overview.pdf",
        content: "Planning tasks and review notes are listed without specific admission or discharge guidance.",
        similarity: 0.58,
        hybrid_score: 0.58,
        text_rank: 0.05,
      }),
    ];
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: sources, error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });
    const generateStructuredTextResult = vi.fn();
    const embedTextWithTelemetry = vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false }));

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry,
      generateStructuredTextResult,
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");

    const answer = await answerQuestionWithScope({
      query: "How is discharge planning handled?",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
    });

    expect(answer.routingMode).toBe("unsupported");
    expect(answer.routingReason).toContain("confidence_gate_blocked");
    expect(answer.retrievalDiagnostics).toMatchObject({
      gateStatus: "blocked",
      fallbackReason: "low_signal_document_lookup_strong",
      candidateCount: 2,
      retrievalDepth: 2,
      distinctDocumentCount: 2,
      topScore: 0.6,
      secondScore: 0.58,
      scoreSpread: 0.02,
      routeMode: "unsupported",
    });
    expect(answer.grounded).toBe(false);
    expect(answer.citations).toHaveLength(0);
    expect(generateStructuredTextResult).not.toHaveBeenCalled();
  });

  it("recovers a directly supported routine document-content answer without model generation", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

    const sources = [
      source({
        id: "safety-plan-reference",
        document_id: "safety-plan-doc",
        title: "Patient Safety Planning Guideline",
        file_name: "patient-safety-planning.pdf",
        section_heading: "Related procedures",
        content:
          "Related procedures and guidelines. Women's and Perinatal Mental Health Referral and Management Guideline.",
        similarity: 0.48,
        hybrid_score: 0.48,
        text_rank: 0.12,
      }),
      source({
        id: "safety-plan-requirements",
        document_id: "safety-plan-doc",
        title: "Patient Safety Planning Guideline",
        file_name: "patient-safety-planning.pdf",
        section_heading: "Safety planning for identified risks",
        content:
          "The Consumer Safety Plan must be developed in collaboration with the consumer, involve carers and family where appropriate, identify actions for a crisis and who is responsible, and be reviewed when clinical status changes.",
        similarity: 0.48,
        hybrid_score: 0.48,
        text_rank: 0.11,
      }),
    ];
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: sources, error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });
    const generateStructuredTextResult = vi.fn();

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false })),
      generateStructuredTextResult,
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");
    const answer = await answerQuestionWithScope({
      query: "What should a patient safety plan include?",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
    });

    expect(answer.routingMode).toBe("extractive");
    expect(answer.routingReason).toContain("validated_routine_extractive_recovery");
    expect(answer.retrievalDiagnostics).toMatchObject({
      gateStatus: "blocked",
      routeMode: "extractive",
      topScore: 0.48,
    });
    expect(answer.grounded).toBe(true);
    expect(answer.confidence).not.toBe("unsupported");
    expect(answer.answer).toContain("developed in collaboration with the consumer");
    expect(answer.answer).not.toContain("Perinatal Mental Health Referral");
    expect(answer.citations.some((citation) => citation.chunk_id === "safety-plan-requirements")).toBe(true);
    expect(generateStructuredTextResult).not.toHaveBeenCalled();
  });

  it("keeps gate-passed routine document-content queries on model synthesis", async () => {
    const answer = await answerFromTextSources(
      "How is patient safety planning handled?",
      [
        source({
          id: "safety-plan-requirements",
          document_id: "safety-plan-doc",
          title: "Patient Safety Planning Guideline",
          file_name: "patient-safety-planning.pdf",
          section_heading: "Safety planning for identified risks",
          content:
            "Patient safety planning must be developed collaboratively with the consumer and reviewed when clinical status changes.",
          similarity: 0.9,
          hybrid_score: 0.9,
          text_rank: 0.4,
        }),
      ],
      {
        answer:
          "Patient safety planning is handled collaboratively with the consumer and reviewed when clinical status changes.",
        grounded: true,
        confidence: "medium",
        answerSections: [],
        citations: [{ chunk_id: "safety-plan-requirements" }],
        quoteCards: [],
        conflictsOrGaps: [],
      },
    );

    expect(answer.retrievalDiagnostics).toMatchObject({
      gateStatus: "passed",
      routeMode: "fast",
      topScore: 0.9,
    });
    expect(answer.routingMode).toBe("fast");
    expect(answer.routingReason).toBe("strong_routine_retrieval");
    expect(answer.modelUsed).not.toBeNull();
    expect(answer.openAIRequestIds).toEqual(["req_answer_from_text_sources"]);
    expect(answer.grounded).toBe(true);
  });

  // Pre-generation validated-extractive short-circuit (rag-extractive-first). The titles below
  // deliberately share no topic token with the query so routing cannot take the existing
  // title-supported extractive branch: the route must be fast/"strong_routine_retrieval" with a
  // passed gate — the measured wasted-generation shape.
  const proceduralFirstSources = () => [
    source({
      id: "procedural-first-reference",
      document_id: "procedural-first-doc",
      title: "Consumer Crisis Response Guideline",
      file_name: "consumer-crisis-response.pdf",
      section_heading: "Related procedures",
      content:
        "Related procedures and guidelines. Women's and Perinatal Mental Health Referral and Management Guideline.",
      similarity: 0.9,
      hybrid_score: 0.9,
      text_rank: 0.12,
    }),
    source({
      id: "procedural-first-requirements",
      document_id: "procedural-first-doc",
      title: "Consumer Crisis Response Guideline",
      file_name: "consumer-crisis-response.pdf",
      section_heading: "Safety planning for identified risks",
      content:
        "The Consumer Safety Plan must be developed in collaboration with the consumer, involve carers and family where appropriate, identify actions for a crisis and who is responsible, and be reviewed when clinical status changes.",
      similarity: 0.9,
      hybrid_score: 0.9,
      text_rank: 0.11,
    }),
  ];

  it("short-circuits a validated gate-passed routine procedural answer before model generation", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

    const sources = proceduralFirstSources();
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: sources, error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });
    const generateStructuredTextResult = vi.fn();

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false })),
      generateStructuredTextResult,
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");
    const answer = await answerQuestionWithScope({
      query: "What should a patient safety plan include?",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
    });

    expect(generateStructuredTextResult).not.toHaveBeenCalled();
    expect(answer.routingMode).toBe("extractive");
    expect(answer.routingReason).toContain("validated_routine_extractive_first");
    expect(answer.retrievalDiagnostics).toMatchObject({ gateStatus: "passed", topScore: 0.9 });
    expect(answer.grounded).toBe(true);
    expect(answer.confidence).not.toBe("unsupported");
    expect(answer.citations.length).toBeGreaterThan(0);
  });

  it("keeps gate-passed 'How is…' document-content queries on model synthesis under the procedural short-circuit", async () => {
    const answer = await answerFromTextSources("How is patient safety planning handled?", proceduralFirstSources(), {
      answer:
        "Patient safety planning is handled collaboratively with the consumer and reviewed when clinical status changes.",
      grounded: true,
      confidence: "medium",
      answerSections: [],
      citations: [{ chunk_id: "procedural-first-requirements" }],
      quoteCards: [],
      conflictsOrGaps: [],
    });

    expect(answer.routingMode).toBe("fast");
    expect(answer.routingReason).toBe("strong_routine_retrieval");
    expect(answer.routingReason).not.toContain("validated_routine_extractive_first");
    expect(answer.modelUsed).not.toBeNull();
    expect(answer.openAIRequestIds).toEqual(["req_answer_from_text_sources"]);
  });

  it("keeps a procedural query on model synthesis when the only extractive candidate fails the final gates", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

    // Only a bare cross-reference chunk is available: it redirects to another named document
    // (see isBareCrossReferenceAnswer) and answers nothing itself, so the extractive candidate
    // fails the final gates and the short-circuit must refuse — generation still runs.
    const sources = [
      source({
        id: "procedural-first-cross-reference",
        document_id: "procedural-first-doc",
        title: "Consumer Crisis Response Guideline",
        file_name: "consumer-crisis-response.pdf",
        section_heading: "Related procedures",
        content:
          "Refer to the Women's and Perinatal Mental Health Referral and Management Guideline for further information about related procedures.",
        similarity: 0.9,
        hybrid_score: 0.9,
        text_rank: 0.12,
      }),
    ];
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: sources, error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });
    const generateStructuredTextResult = vi.fn(async () => ({
      text: JSON.stringify({
        answer: "A patient safety plan should include collaboratively developed actions for identified risks.",
        grounded: true,
        confidence: "medium",
        answerSections: [],
        citations: [{ chunk_id: "procedural-first-cross-reference" }],
        quoteCards: [],
        conflictsOrGaps: [],
      }),
      model: "gpt-4.1-mini",
      operation: "answer",
      latencyMs: 12,
      requestId: "req_procedural_first_negative",
      usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
    }));

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false })),
      generateStructuredTextResult,
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");
    const answer = await answerQuestionWithScope({
      query: "What should a patient safety plan include?",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
    });

    expect(generateStructuredTextResult).toHaveBeenCalled();
    expect(answer.routingReason).not.toContain("validated_routine_extractive_first");
  });

  it("keeps dose-class procedural queries on model synthesis under the procedural short-circuit", async () => {
    const query = "What is the maximum lithium dose process?";
    const { classifyRagQuery } = await import("../src/lib/clinical-search");
    // Pin the classification this negative depends on: dose-risk classes must never be
    // eligible for the routine procedural short-circuit.
    expect(classifyRagQuery(query).queryClass).toBe("medication_dose_risk");

    const answer = await answerFromTextSources(
      query,
      [
        source({
          id: "lithium-dose-1",
          document_id: "lithium-doc",
          title: "Lithium Therapy Guideline",
          file_name: "lithium-therapy.pdf",
          section_heading: "Dosing",
          content:
            "Lithium dosing follows the documented titration process with plasma level monitoring and clinical review before any dose change.",
          similarity: 0.9,
          hybrid_score: 0.9,
          text_rank: 0.12,
        }),
      ],
      {
        answer: "The maximum lithium dose process is described in the cited dosing guidance.",
        grounded: true,
        confidence: "medium",
        answerSections: [],
        citations: [{ chunk_id: "lithium-dose-1" }],
        quoteCards: [],
        conflictsOrGaps: [],
      },
    );

    expect(answer.routingReason).not.toContain("validated_routine_extractive_first");
    expect(answer.modelUsed).not.toBeNull();
    expect(answer.openAIRequestIds).toEqual(["req_answer_from_text_sources"]);
  });

  it("does not gate-block a moderate score clustered across several distinct documents", async () => {
    // Regression: a topic with rich coverage (e.g. clozapine) returns many relevant
    // documents whose scores cluster tightly at a moderate value. A tiny spread there
    // is strong coverage, not weak retrieval, so the confidence gate must not refuse.
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

    const sources = [1, 2, 3, 4, 5].map((n) =>
      source({
        id: `clustered-${n}`,
        document_id: `doc-${n}`,
        title: `Clozapine Guideline ${n}`,
        file_name: `clozapine-${n}.pdf`,
        content: "Clozapine missed-dose monitoring guidance describes retitration and observation steps.",
        similarity: 0.57,
        hybrid_score: 0.57,
        text_rank: 0.06,
      }),
    );
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: sources, error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });
    const generateStructuredTextResult = vi.fn();
    const embedTextWithTelemetry = vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false }));

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry,
      generateStructuredTextResult,
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");

    const answer = await answerQuestionWithScope({
      query: "Show the clozapine missed-dose monitoring guidance.",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
    });

    expect(answer.retrievalDiagnostics).toMatchObject({
      gateStatus: "passed",
      distinctDocumentCount: 5,
    });
    expect(answer.routingReason).not.toContain("confidence_gate_blocked");
    // The gate passed, so generation is attempted rather than short-circuited to a refusal.
    expect(generateStructuredTextResult).toHaveBeenCalled();
  });

  it("does not gate-block strong lexical-only evidence under the truthful score contract", async () => {
    // Regression (canary #459 family A): migration 20260713062107 made lexical-only
    // retrieval honest — similarity 0, hybrid_score hard-capped at 0.48, with the real
    // signal in lexical_score (0.4..0.99). Reading hybrid_score alone made
    // topScore < 0.5 unconditional for every text-fast-path answer, so well-supported
    // documentation lookups ("What does the metabolic screening document require?",
    // expected document at rank 1) were refused as confidence_gate_blocked. The gate
    // must read the lexical evidence.
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

    const sources = [1, 2, 3].map((n) =>
      source({
        id: `lexical-${n}`,
        document_id: n <= 2 ? "metabolic-doc" : `doc-${n}`,
        title: "Metabolic Screening",
        file_name: "metabolic-screening.pdf",
        content: "Metabolic screening requires baseline observations and scheduled physical health monitoring.",
        similarity: 0,
        hybrid_score: 0.48,
        text_rank: 1.2,
        lexical_score: 0.99,
      }),
    );
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: sources, error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });
    const generateStructuredTextResult = vi.fn();
    const embedTextWithTelemetry = vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false }));

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry,
      generateStructuredTextResult,
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");

    const answer = await answerQuestionWithScope({
      query: "What does the metabolic screening document require?",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
    });

    expect(answer.retrievalDiagnostics).toMatchObject({ gateStatus: "passed" });
    expect(answer.routingReason).not.toContain("confidence_gate_blocked");
  });

  it("still gate-blocks weak lexical-only evidence", async () => {
    // Control for the lexical-aware gate: a marginal keyword hit (lexical_score at its
    // 0.4 floor) must stay below the 0.5 evidence bar and refuse, preserving
    // unsupported_correct behaviour for junk/near-miss lexical rows.
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

    const sources = [
      source({
        id: "weak-lexical-1",
        document_id: "doc-1",
        title: "Unrelated Process",
        file_name: "unrelated.pdf",
        content: "A passing mention of screening in an unrelated administrative document.",
        similarity: 0,
        hybrid_score: 0.19,
        text_rank: 0.02,
        lexical_score: 0.41,
      }),
      source({
        id: "weak-lexical-2",
        document_id: "doc-2",
        title: "General Overview",
        file_name: "overview.pdf",
        content: "General notes without specific screening guidance.",
        similarity: 0,
        hybrid_score: 0.18,
        text_rank: 0.01,
        lexical_score: 0.4,
      }),
    ];
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: sources, error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });
    const generateStructuredTextResult = vi.fn();
    const embedTextWithTelemetry = vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false }));

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry,
      generateStructuredTextResult,
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");

    const answer = await answerQuestionWithScope({
      query: "How is discharge planning handled?",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
    });

    expect(answer.retrievalDiagnostics).toMatchObject({ gateStatus: "blocked" });
    expect(answer.routingMode).toBe("unsupported");
  });

  it("returns document names for source-support questions instead of clinical advice", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

    const lithiumDocument = {
      id: "lithium-doc",
      title: "Lithium Monitoring Guideline",
      file_name: "CG.MHSP.Lithium.pdf",
      metadata: {
        source_title: "Lithium Monitoring Guideline",
        publisher: "Local service",
        jurisdiction: "Australia/WA",
        document_status: "current",
        clinical_validation_status: "approved",
        extraction_quality: "good",
      },
      text_rank: 0.31,
    };
    const lithiumChunk = {
      id: "lithium-doc-chunk-1",
      document_id: "lithium-doc",
      page_number: 4,
      chunk_index: 0,
      section_heading: "Lithium monitoring",
      section_path: ["Lithium monitoring"],
      content: "Lithium monitoring guidance covers baseline tests, level checks, and renal review.",
      retrieval_synopsis: "Lithium monitoring source summary.",
      image_ids: [],
      text_rank: 0.42,
    };
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_documents_for_query") return { data: [lithiumDocument], error: null };
      if (retrievalRpcBaseName(name) === "match_document_lookup_chunks_text")
        return { data: [lithiumChunk], error: null };
      if (retrievalRpcBaseName(name) === "match_document_chunks_hybrid") {
        return {
          data: [
            source({
              id: "lithium-doc-chunk-1",
              document_id: "lithium-doc",
              title: "Lithium Monitoring Guideline",
              file_name: "CG.MHSP.Lithium.pdf",
              section_heading: "Lithium monitoring",
              content: "Lithium monitoring guidance covers baseline tests, level checks, and renal review.",
              similarity: 0.91,
              hybrid_score: 0.93,
              text_rank: 0.42,
            }),
          ],
          error: null,
        };
      }
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false })),
      generateStructuredTextResult: vi.fn(),
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");

    const answer = await answerQuestionWithScope({
      query: "What documents support lithium monitoring?",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
    });

    expect(answer.routingMode).toBe("extractive");
    expect(answer.answer.replace(/\*\*/g, "")).toContain("Lithium Monitoring Guideline");
    expect(answer.answer).toContain("indexed document");
    expect(answer.answer).not.toMatch(/level checks|renal review|baseline tests/i);
  });

  it("preserves parenthetical facility codes in the document-support list answer", async () => {
    // Regression: the document-list answer is deterministic and pre-formatted, but the
    // clinical-prose sanitizer used to strip facility-code suffixes like "(NOCC) (AKG)"
    // (read as non-prose), mangling a valid answer into garble the quality gate then
    // refused. The `preformatted` flag now exempts it from that sanitizer.
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

    const noccDocument = {
      id: "nocc-doc",
      title: "National Outcomes and Casemix Collection (NOCC) (AKG)",
      file_name: "NOCC.pdf",
      metadata: {
        source_title: "National Outcomes and Casemix Collection",
        publisher: "Local service",
        jurisdiction: "Australia/WA",
        document_status: "current",
        clinical_validation_status: "approved",
        extraction_quality: "good",
      },
      text_rank: 0.31,
    };
    const noccChunk = {
      id: "nocc-doc-chunk-1",
      document_id: "nocc-doc",
      page_number: 1,
      chunk_index: 0,
      section_heading: "Outcome measures",
      section_path: ["Outcome measures"],
      content: "National Outcomes and Casemix Collection guidance for outcome measures completion.",
      retrieval_synopsis: "NOCC source summary.",
      image_ids: [],
      text_rank: 0.42,
    };
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_documents_for_query") return { data: [noccDocument], error: null };
      if (retrievalRpcBaseName(name) === "match_document_lookup_chunks_text") return { data: [noccChunk], error: null };
      if (retrievalRpcBaseName(name) === "match_document_chunks_hybrid") {
        return {
          data: [
            source({
              id: "nocc-doc-chunk-1",
              document_id: "nocc-doc",
              title: "National Outcomes and Casemix Collection (NOCC) (AKG)",
              file_name: "NOCC.pdf",
              section_heading: "Outcome measures",
              content: "National Outcomes and Casemix Collection guidance for outcome measures completion.",
              similarity: 0.91,
              hybrid_score: 0.93,
              text_rank: 0.42,
            }),
          ],
          error: null,
        };
      }
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false })),
      generateStructuredTextResult: vi.fn(),
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");

    const answer = await answerQuestionWithScope({
      query: "What documents support outcome measures completion?",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
    });

    expect(answer.routingMode).toBe("extractive");
    expect(answer.grounded).toBe(true);
    expect(answer.preformatted).toBe(true);
    // The facility-code suffix survives intact (previously mangled to a dangling "(").
    expect(answer.answer).toContain("(NOCC) (AKG)");
    expect(answer.answer).not.toMatch(/\(\s*(?:;|$| Outcome)/);
  });

  it("does not promote lithium dosage headings or continuation fragments as the primary answer", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

    const lithiumSource = source({
      id: "lithium-dose-1",
      document_id: "lithium-doc",
      title: "Lithium Therapy - Initiation And Continuation Guideline",
      file_name: "lithium-therapy.pdf",
      page_number: 6,
      section_heading: "Dosage and monitoring",
      content:
        "Dosage (as lithium carbonate). alternative agent where possible and adjust the dose of lithium when necessary. Reduce doses in the elderly and in patients with renal impairment. Target serum lithium ranges are as follows: acute mania 0.8-1.2 mmol/L; prophylaxis uses a lower maintenance range. Therapy with lithium should always begin with conventional tablets (lithium carbonate 250 mg).",
      similarity: 0.95,
      hybrid_score: 0.95,
      text_rank: 1.3,
    });
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: [lithiumSource], error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    const generateStructuredTextResult = vi.fn(async () => ({
      text: JSON.stringify({
        answer:
          "Therapy with lithium should always begin with conventional tablets (**lithium carbonate 250 mg**). Doses should be reduced in elderly patients and patients with renal impairment. The guidance provides target serum lithium ranges for acute mania and prophylaxis.",
        grounded: true,
        confidence: "high",
        answerSections: [],
        citations: [{ chunk_id: "lithium-dose-1" }],
        quoteCards: [
          {
            chunk_id: "lithium-dose-1",
            quote: "Reduce doses in the elderly and in patients with renal impairment.",
            section_heading: "Dosage and monitoring",
          },
        ],
        conflictsOrGaps: [],
      }),
      model: "gpt-4.1-mini",
      operation: "answer",
      latencyMs: 12,
      requestId: "req_lithium_fast",
      usage: { input_tokens: 140, output_tokens: 90, total_tokens: 230 },
    }));

    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(),
      generateStructuredTextResult,
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");

    const answer = await answerQuestionWithScope({
      query: "lithium dosing for patients",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
    });

    const plainAnswer = answer.answer.replace(/\*\*/g, "");
    expect(generateStructuredTextResult).toHaveBeenCalledTimes(1);
    expect(answer.routingMode).toBe("strong");
    expect(answer.grounded).toBe(true);
    expect(plainAnswer).not.toMatch(/^Dosage\b/i);
    expect(plainAnswer).not.toContain("alternative agent where possible");
    expect(plainAnswer).toMatch(/target serum lithium|reduce doses|conventional tablets/i);
  });

  it("uses the same model-first guard for non-lithium dose searches", async () => {
    const answer = await answerFromTextSources(
      "olanzapine maximum dose",
      [
        source({
          id: "olanzapine-dose-1",
          document_id: "olanzapine-doc",
          title: "Olanzapine Dose Chart",
          file_name: "olanzapine-dose-chart.pdf",
          section_heading: "Dose table",
          content:
            "Dosage (adult). chart reference only. Maximum olanzapine dose is 20 mg in 24 hours. Repeat doses require sedation and blood pressure monitoring.",
          similarity: 0.95,
          hybrid_score: 0.95,
          text_rank: 1.3,
        }),
      ],
      {
        answer:
          "The maximum **olanzapine** dose is **20 mg in 24 hours**. For olanzapine, repeat doses require sedation and blood pressure monitoring.",
        grounded: true,
        confidence: "high",
        answerSections: [],
        citations: [{ chunk_id: "olanzapine-dose-1" }],
        quoteCards: [
          {
            chunk_id: "olanzapine-dose-1",
            quote: "Maximum olanzapine dose is 20 mg in 24 hours.",
            section_heading: "Dose table",
          },
        ],
        conflictsOrGaps: [],
      },
    );

    const plainAnswer = answer.answer.replace(/\*\*/g, "");
    expect(answer.routingMode).toBe("strong");
    expect(answer.grounded).toBe(true);
    expect(plainAnswer).not.toMatch(/^Dosage\b/i);
    expect(plainAnswer).not.toContain("chart reference only");
    expect(plainAnswer).toContain("20 mg");
  });

  it("uses the same model-first guard for threshold-action searches", async () => {
    const answer = await answerFromTextSources(
      "what clozapine monitoring action is needed for red range blood results",
      [
        source({
          id: "clozapine-red-action-1",
          document_id: "clozapine-doc",
          title: "Clozapine Monitoring Action Table",
          file_name: "clozapine-monitoring.pdf",
          section_heading: "Monitoring",
          content:
            "Monitoring. and reported to the patient monitoring system. If blood results return in the red range, clozapine therapy must be discontinued immediately and reported to the patient monitoring system.",
          similarity: 0.95,
          hybrid_score: 0.95,
          text_rank: 1.3,
        }),
      ],
      {
        answer:
          "For red-range blood results, the source-supported action is to **discontinue clozapine immediately** and report the result to the patient monitoring system.",
        grounded: true,
        confidence: "high",
        answerSections: [],
        citations: [{ chunk_id: "clozapine-red-action-1" }],
        quoteCards: [
          {
            chunk_id: "clozapine-red-action-1",
            quote: "clozapine therapy must be discontinued immediately",
            section_heading: "Monitoring",
          },
        ],
        conflictsOrGaps: [],
      },
    );

    const plainAnswer = answer.answer.replace(/\*\*/g, "");
    expect(answer.routingMode).toBe("extractive");
    expect(answer.grounded).toBe(true);
    expect(plainAnswer).not.toMatch(/^Monitoring\b/i);
    expect(plainAnswer).not.toMatch(/^and reported/i);
    expect(plainAnswer).toMatch(/discontinue.*immediately|discontinued immediately/i);
  });

  it("uses the same extractive guard for pathway and referral searches", async () => {
    const answer = await answerFromTextSources(
      "what are ECT referral criteria",
      [
        source({
          id: "ect-referral-1",
          document_id: "ect-doc",
          title: "ECT Referral Pathway",
          file_name: "ect-referral-pathway.pdf",
          section_heading: "Referral criteria",
          content:
            "Referral criteria. and document the referral form. ECT referral criteria include severe depression requiring specialist psychiatric review, consent assessment, and referral through the ECT pathway.",
          similarity: 0.95,
          hybrid_score: 0.95,
          text_rank: 1.3,
        }),
      ],
      {
        answer:
          "The ECT referral criteria include **severe depression requiring specialist psychiatric review**, consent assessment, and referral through the ECT pathway.",
        grounded: true,
        confidence: "high",
        answerSections: [],
        citations: [{ chunk_id: "ect-referral-1" }],
        quoteCards: [
          {
            chunk_id: "ect-referral-1",
            quote: "ECT referral criteria include severe depression requiring specialist psychiatric review",
            section_heading: "Referral criteria",
          },
        ],
        conflictsOrGaps: [],
      },
    );

    const plainAnswer = answer.answer.replace(/\*\*/g, "");
    expect(answer.routingMode).toBe("extractive");
    expect(answer.grounded).toBe(true);
    expect(plainAnswer).not.toMatch(/^Referral criteria\b/i);
    expect(plainAnswer).not.toMatch(/^and document/i);
    expect(plainAnswer).toMatch(/severe depression|specialist psychiatric review|ECT pathway/i);
  });

  it("blocks same-sentence cross-medication dose leakage", async () => {
    const answer = await answerFromTextSources(
      "What is the maximum sertraline dose?",
      [
        source({
          id: "sertraline-cross-medication-1",
          document_id: "sertraline-doc",
          title: "Sertraline Dose Appendix",
          file_name: "sertraline-dose-appendix.pdf",
          section_heading: "Maximum doses",
          content:
            "Sertraline dosing appendix lists fluoxetine maximum dose 60 mg and citalopram 40 mg for comparison, but does not state a maximum sertraline dose.",
          similarity: 0.95,
          hybrid_score: 0.95,
          text_rank: 1.3,
        }),
      ],
      {
        answer: "No current source with dose guidance for this query was found.",
        grounded: false,
        confidence: "unsupported",
        answerSections: [],
        citations: [],
        quoteCards: [],
        conflictsOrGaps: [],
      },
    );

    expect(answer.answer).toBe("No current source with dose guidance for this query was found.");
    expect(answer.grounded).toBe(false);
    expect(answer.confidence).toBe("unsupported");
    expect(answer.answer).not.toMatch(/fluoxetine|citalopram|60 mg|40 mg/i);
  });

  it("fails closed for classified dose intent when no accepted fact covers entity and intent together", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

    const broadDoseSource = source({
      id: "sertraline-broad-dose-1",
      document_id: "sertraline-doc",
      title: "Antidepressant Dose Overview",
      file_name: "antidepressant-overview.pdf",
      section_heading: "Maximum doses",
      content:
        "Antidepressant maximum oral doses include fluoxetine 60 mg, citalopram 40 mg, and escitalopram 20 mg. Sertraline patient information is provided in another section.",
      similarity: 0.94,
      hybrid_score: 0.94,
      text_rank: 1.2,
    });
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: [broadDoseSource], error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(),
      generateStructuredTextResult: vi.fn(async () => ({
        text: JSON.stringify({
          answer: "No current source with dose guidance for this query was found.",
          grounded: false,
          confidence: "unsupported",
          answerSections: [],
          citations: [],
          quoteCards: [],
          conflictsOrGaps: [],
        }),
        model: "gpt-4.1-mini",
        operation: "answer",
        latencyMs: 12,
        requestId: "req_sertraline_source_gap",
        usage: { input_tokens: 130, output_tokens: 40, total_tokens: 170 },
      })),
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");

    const answer = await answerQuestionWithScope({
      query: "What is the maximum sertraline dose?",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
    });

    expect(answer.answer).toBe("No current source with dose guidance for this query was found.");
    expect(answer.grounded).toBe(false);
    expect(answer.confidence).toBe("unsupported");
    expect(answer.answer).not.toMatch(/fluoxetine|citalopram|escitalopram/i);
    expect(answer.answerSections ?? []).toEqual([]);
  });

  it("reuses a rejected warm-up embedding instead of retrying the provider", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");

    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const embedTextWithTelemetry = vi.fn(async () => {
      throw new Error("embedding provider unavailable");
    });

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry,
      generateStructuredTextResult: vi.fn(),
    }));

    const { searchChunksWithTelemetry } = await import("../src/lib/rag/rag");
    const search = await searchChunksWithTelemetry({
      query: "monitoring requirements",
      topK: 4,
      allowGlobalSearch: true,
    });

    expect(search.telemetry.embedding_prefetched).toBe(true);
    expect(search.telemetry.embedding_skipped).toBe(true);
    expect(embedTextWithTelemetry).toHaveBeenCalledOnce();
  });

  it("does not convert caller cancellation during embedding into lexical fallback", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");

    const controller = new AbortController();
    const reason = new DOMException("caller left during embedding", "AbortError");
    const rpc = vi.fn(async (name: string) => {
      void name;
      return { data: [], error: null };
    });
    const embedTextWithTelemetry = vi.fn(async (_query: string, options?: { signal?: AbortSignal }) => {
      controller.abort(reason);
      options?.signal?.throwIfAborted();
      return { embedding: Array(1536).fill(0.01), cacheHit: false };
    });

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry,
      generateStructuredTextResult: vi.fn(),
    }));

    const { searchChunksWithTelemetry } = await import("../src/lib/rag/rag");

    await expect(
      searchChunksWithTelemetry({
        query: "monitoring requirements",
        topK: 4,
        allowGlobalSearch: true,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(embedTextWithTelemetry).toHaveBeenCalledOnce();
    expect(rpc.mock.calls.some(([name]) => String(name).includes("_hybrid"))).toBe(false);
  });

  it("continues hybrid chunk retrieval when index-unit hybrid retrieval times out", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");

    const hybridSource = source({
      id: "hybrid-fallback-chunk",
      title: "Monitoring Requirements",
      content: "Monitoring requirements are documented here.",
      similarity: 0.81,
      hybrid_score: 0.88,
      text_rank: 0.7,
    });
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: [], error: null };
      if (retrievalRpcBaseName(name) === "match_document_table_facts_text") return { data: [], error: null };
      if (retrievalRpcBaseName(name) === "match_document_embedding_fields_hybrid") return { data: [], error: null };
      if (retrievalRpcBaseName(name) === "match_document_index_units_hybrid") {
        return { data: null, error: { message: "canceling statement due to statement timeout" } };
      }
      if (retrievalRpcBaseName(name) === "match_document_chunks_hybrid") return { data: [hybridSource], error: null };
      if (retrievalRpcBaseName(name) === "match_document_memory_cards_hybrid") return { data: [], error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(async () => ({ embedding: Array(1536).fill(0.01), cacheHit: false })),
      generateStructuredTextResult: vi.fn(),
    }));

    const { searchChunksWithTelemetry } = await import("../src/lib/rag/rag");

    const search = await searchChunksWithTelemetry({
      query: "monitoring requirements",
      topK: 4,
      allowGlobalSearch: true,
    });

    expect(rpc).toHaveBeenCalledWith("match_document_index_units_hybrid_v2", expect.any(Object));
    expect(rpc).toHaveBeenCalledWith("match_document_chunks_hybrid_v2", expect.any(Object));
    expect(search.results.map((result) => result.id)).toContain("hybrid-fallback-chunk");
    expect(search.telemetry.index_unit_count).toBe(0);
    expect(search.telemetry.index_unit_top_score).toBe(0);
    expect(search.telemetry.retrieval_strategy).toBe("hybrid");
  });
});

describe("budget-aware generation deadlines", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Mirrors the "recovers lithium dosing" fixture above: a fast-routed dose query whose
   * every generation attempt resolves truncated (max_output_tokens). The first attempt
   * optionally burns fake wall-clock before resolving, so the remaining route budget can
   * be pushed below the recovery reserve + retry viability floor. */
  async function lithiumTruncatedGenerationAnswer(consumeFirstAttemptMs: number) {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

    const waSource = (overrides: Partial<SearchResult>, publisherCode: "FSH" | "EMHS") =>
      source({
        ...overrides,
        source_metadata: {
          source_title: overrides.title ?? "Lithium guideline",
          publisher:
            publisherCode === "FSH" ? "Fiona Stanley Fremantle Hospitals Group" : "East Metropolitan Health Service",
          publisher_code: publisherCode,
          jurisdiction: "Australia/WA",
          version: "1",
          publication_date: null,
          review_date: null,
          uploaded_at: null,
          indexed_at: null,
          uploaded_by: null,
          document_status: "current",
          clinical_validation_status: "locally_reviewed",
          extraction_quality: "good",
        },
      });
    const sources = [
      waSource(
        {
          id: "fsh-lithium-1",
          document_id: "fsh-lithium",
          title: "Lithium Therapy - Initiation and Continuation Guideline",
          section_heading: "Initiation",
          content:
            "For lithium initiation in adults, start lithium carbonate at 250 mg at night and titrate according to the serum lithium concentration.",
        },
        "FSH",
      ),
      waSource(
        {
          id: "emhs-lithium-1",
          document_id: "emhs-lithium",
          title: "Lithium Clinical Guideline",
          section_heading: "Target range",
          content:
            "The usual target serum lithium concentration is 0.6 to 0.8 mmol/L for maintenance treatment in adults.",
        },
        "EMHS",
      ),
      waSource(
        {
          id: "fsh-lithium-2",
          document_id: "fsh-lithium",
          title: "Lithium Therapy - Initiation and Continuation Guideline",
          section_heading: "Monitoring after dose changes",
          content:
            "Measure the serum lithium concentration 12 hours after the previous dose and repeat it 5 to 7 days after a dose change.",
        },
        "FSH",
      ),
      waSource(
        {
          id: "emhs-lithium-2",
          document_id: "emhs-lithium",
          title: "Lithium Clinical Guideline",
          section_heading: "Dose adjustment",
          content:
            "Use a lower lithium starting dose in older adults and people with impaired renal function, with closer serum monitoring.",
        },
        "EMHS",
      ),
      source({
        id: "bmj-paediatric-depression",
        document_id: "bmj-paediatric-depression",
        title: "Depression in children",
        content: "Psychological therapy is considered for depression in children and young people.",
        source_metadata: {
          source_title: "Depression in children",
          publisher: "BMJ Best Practice",
          publisher_code: "BMJ",
          jurisdiction: "International",
          version: null,
          publication_date: null,
          review_date: null,
          uploaded_at: null,
          indexed_at: null,
          uploaded_by: null,
          document_status: "current",
          clinical_validation_status: "unverified",
          extraction_quality: "good",
        },
      }),
    ];
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: sources, error: null };
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });
    let requestIndex = 0;
    const generateStructuredTextResult = vi.fn(async () => {
      requestIndex += 1;
      if (requestIndex === 1 && consumeFirstAttemptMs > 0) {
        vi.setSystemTime(new Date(Date.now() + consumeFirstAttemptMs));
      }
      return {
        text: "",
        model: "gpt-5.4-mini",
        operation: "answer",
        latencyMs: 12,
        requestId: `req_truncated_${requestIndex}`,
        usage: { input_tokens: 100, output_tokens: 650, total_tokens: 750 },
        status: "incomplete",
        truncated: true,
        incompleteReason: "max_output_tokens",
      };
    });

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false })),
      generateStructuredTextResult,
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");
    const answer = await answerQuestionWithScope({
      query: "Lithium dosing",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
    });
    return { answer, generateStructuredTextResult };
  }

  it("caps a generation attempt so source-backed recovery fits inside the route budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T00:00:00.000Z"));
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    // Stubbed far above the granted window below so the value can only come from the
    // deadline. The retrieval mock additionally burns 10_000ms of the 35_000ms strong
    // budget, keeping the deadline term (35_000 - 10_000 - 2_000 = 23_000ms) below every
    // plausible timeout cap — including the 30_000ms default that full-file runs pin when
    // an earlier import froze env — so this assertion discriminates in both run modes.
    // Reverting the call site to the reserve-free requestTimeoutMs would grant 25_000ms.
    vi.stubEnv("OPENAI_ANSWER_TIMEOUT_MS", "60000");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

    // Same retrieval fixture as the model-synthesis test above, which routes strong.
    const clozapineSource = source({
      id: "clozapine-monitoring-1",
      document_id: "clozapine-doc",
      title: "Medication guideline",
      file_name: "medication-guideline.pdf",
      page_number: 11,
      section_heading: "Monitoring",
      content:
        "Medication point: • Copy of the Consent to Clozapine Treatment Form EMR0270. Medication point: • Prescribe initiation of Clozapine on the WA Adult Clozapine Initiation and Titration form. Medication point: • Ensure consumers complete the Clozapine Monitoring Form on initiation.",
      similarity: 0.94,
      hybrid_score: 0.94,
      text_rank: 0,
    });
    let retrievalTimeBurned = false;
    const rpc = vi.fn(async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") {
        // Burn retrieval wall-clock exactly once so the deadline term is the binding
        // one at the generation call regardless of the effective timeout cap.
        if (!retrievalTimeBurned) {
          retrievalTimeBurned = true;
          vi.setSystemTime(new Date(Date.now() + 10_000));
        }
        return { data: [clozapineSource], error: null };
      }
      if (retrievalRpcBaseName(name) === "get_related_document_metadata") return { data: [], error: null };
      return { data: [], error: null };
    });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn(() => new EmptyQuery()),
      }),
    }));
    const grantedTimeoutsMs: number[] = [];
    const generateStructuredTextResult = vi.fn(
      async (_input: string, _schema: unknown, options?: { timeoutMs?: number }) => {
        grantedTimeoutsMs.push(options?.timeoutMs ?? Number.NaN);
        // Consume the entire granted window, then fail like a provider timeout. With the
        // reserve subtracted this leaves 2_000ms of route budget for the recovery path;
        // without it, recovery would start with the budget already fully spent.
        vi.setSystemTime(new Date(Date.now() + (options?.timeoutMs ?? 0)));
        throw new Error("OpenAI timed out. Trying source-only fallback response.");
      },
    );
    vi.doMock("@/lib/openai", () => ({
      embedTextWithTelemetry: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false })),
      generateStructuredTextResult,
    }));

    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");
    const answer = await answerQuestionWithScope({
      query: "what monitoring is required for clozapine",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
    });

    // Fake timers pin elapsed-at-call to exactly the burned 10_000ms, so the received
    // timeout must equal budget - burned - reserve. This is the assertion that fails if
    // generationRequestTimeoutMs is reverted to requestTimeoutMs at the generation call
    // site (that revert would grant 25_000ms).
    expect(generateStructuredTextResult).toHaveBeenCalledTimes(1);
    expect(grantedTimeoutsMs).toEqual([answerRouteBudgetMs.strong - 10_000 - generationRecoveryReserveMs]);
    expect(answer.latencyTimings?.route_budget_ms).toBe(answerRouteBudgetMs.strong);
    // The attempt used its whole window, yet the reserve kept the source-backed recovery
    // inside the route budget.
    expect(answer.latencyTimings?.route_deadline_exceeded).toBe(false);
    expect(answer.latencyTimings?.total_latency_ms).toBeLessThan(answerRouteBudgetMs.strong);
    expect(answer.routingReason).toContain("generation_fallback:provider_timeout");
    expect(answer.sources.length).toBeGreaterThan(0);
  });

  it("skips the truncation self-heal when the budget reserve would be breached", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T00:00:00.000Z"));
    // Burn 20_000ms of the 35_000ms strong budget inside the first attempt before it
    // resolves truncated: the 15_000ms left is below generationRecoveryReserveMs +
    // minimumGenerationRetryMs (22_000ms), so the strong self-heal must be skipped
    // instead of spending the recovery reserve on a guaranteed-discard retry.
    const { answer, generateStructuredTextResult } = await lithiumTruncatedGenerationAnswer(20_000);

    expect(generateStructuredTextResult).toHaveBeenCalledTimes(1);
    // The skip is recorded without counting as a retry; the terminal truncation throw
    // then lands on the existing source-backed recovery.
    expect(answer.latencyTimings?.answer_retry_reasons).toEqual([
      "truncation_retry_skipped_budget_reserve:strong_max_output_tokens",
      "generation_max_output_tokens",
    ]);
    expect(answer.latencyTimings?.answer_retry_count).toBe(1);
    expect(answer.routingReason).toContain("generation_fallback:provider_incomplete_max_output_tokens");
    expect(answer.routingReason).toContain("source_backed_extractive_fallback");
    expect(answer.routingMode).toBe("extractive");
    expect(answer.grounded).toBe(true);
    expect(answer.confidence).not.toBe("unsupported");
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.answer.replace(/\*\*/g, "")).toMatch(/lithium|250 mg/i);
  });

  it("keeps the truncation self-heal when the budget reserve still fits", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T00:00:00.000Z"));
    // Identical truncated first attempt with no wall-clock consumed: the full budget
    // remains, so the strong self-heal retry must still run.
    const { answer, generateStructuredTextResult } = await lithiumTruncatedGenerationAnswer(0);

    expect(generateStructuredTextResult).toHaveBeenCalledTimes(2);
    expect(answer.latencyTimings?.answer_retry_reasons).toEqual([
      "strong_max_output_tokens_retry_strong",
      "strong_max_output_tokens",
    ]);
    expect(answer.latencyTimings?.answer_retry_count).toBe(2);
    expect(answer.routingReason).toContain("source_backed_extractive_fallback");
  });
});
