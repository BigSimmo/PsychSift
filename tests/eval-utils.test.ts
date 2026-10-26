import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EVAL_OWNER_ID,
  expectedFileCoverage,
  isProviderQuotaError,
  isProviderRateLimitError,
  pauseBetweenEvalCases,
  resolveEvalOwnerId,
  validateRagAnswer,
  withProviderBackoff,
  withProviderBackoffProgress,
  type SupabaseAdmin,
} from "../scripts/eval-utils";
import { ragEvalCases, type RagEvalCase } from "../src/lib/rag/rag-eval-cases";
import type { RagAnswer } from "../src/lib/types";

describe("RAG eval source identity matching", () => {
  it("matches legacy expected shorthand against current indexed document-family titles", () => {
    const coverage = expectedFileCoverage(
      ["MHSP.NOCC.pdf", "CG.MHSP.PtSafetyPlan.pdf"],
      [
        {
          title: "National Outcomes And Casemix Collection(NOCC)(AKG)",
          file_name: "National Outcomes and Casemix Collection (NOCC) (AKG).pdf",
        },
        {
          title: "Safety Planning - Mother Baby Unit(KEMH)",
          file_name: "Safety Planning - Mother Baby Unit (KEMH).pdf",
        },
      ],
      5,
    );

    expect(coverage).toMatchObject({
      matchedFiles: ["MHSP.NOCC.pdf", "CG.MHSP.PtSafetyPlan.pdf"],
      missingFiles: [],
      allHit: true,
    });
  });

  it("does not match unrelated retrieved files just because aliases exist", () => {
    const coverage = expectedFileCoverage(
      ["MHSP.Discharge.pdf"],
      [
        {
          title: "Pantoprazole Guideline(NMHS)",
          file_name: "Pantoprazole Guideline (NMHS).pdf",
        },
      ],
      5,
    );

    expect(coverage.anyHit).toBe(false);
    expect(coverage.missingFiles).toEqual(["MHSP.Discharge.pdf"]);
  });

  it("maps legacy community-admission expectations to current combined policies", () => {
    const coverage = expectedFileCoverage(
      ["MHSP.AdmissionCommunityPts.pdf"],
      [
        {
          title: "Admission to Discharge for Community Mental Health",
          file_name: "Admission to Discharge for Community Mental Health (NMHS).pdf",
        },
        {
          title: "Referral, Admission and Discharge - Mental Health Hospital in the Home",
          file_name:
            "Referral, Admission and Discharge - Mental Health Hospital in the Home (MHHITH) Policy and Procedure (RKPG).pdf",
        },
      ],
      5,
    );

    expect(coverage).toMatchObject({
      matchedFiles: ["MHSP.AdmissionCommunityPts.pdf"],
      missingFiles: [],
      allHit: true,
    });
  });

  it("fails supported clinical eval cases when numeric faithfulness warnings are present", () => {
    const testCase: RagEvalCase = {
      id: "dose-warning",
      question: "What clozapine dose should be used?",
      category: "routine",
      supported: true,
      expectedFiles: ["clozapine.pdf"],
      allowedRoutes: ["fast", "strong"],
      minCitations: 1,
      latencyTargetMs: 10_000,
    };
    const answer = {
      answer: "Use clozapine 200 mg.",
      grounded: true,
      confidence: "high",
      citations: [{ chunk_id: "chunk-1", document_id: "doc-1", title: "Clozapine", file_name: "clozapine.pdf" }],
      sources: [{ title: "Clozapine", file_name: "clozapine.pdf" }],
      routingMode: "fast",
      visualEvidence: [],
      unverifiedNumericTokens: ["200mg"],
      faithfulnessWarning: "verify against source",
      latencyTimings: { total_latency_ms: 100 },
    } as unknown as RagAnswer;

    const validation = validateRagAnswer(testCase, answer);

    expect(validation.failures).toContain("clinical numeric faithfulness warning present (1 unverified token(s))");
  });

  it("accepts a source-only answer for acceptSourceOnly cases when expected documents are still cited", () => {
    const testCase: RagEvalCase = {
      id: "discharge-documentation",
      question: "What should discharge documentation include?",
      category: "routine",
      supported: true,
      acceptSourceOnly: true,
      expectedFiles: ["MHSP.Discharge.pdf"],
      allowedRoutes: ["extractive", "fast"],
      minCitations: 2,
      latencyTargetMs: 2000,
    };
    const dischargeSources = [
      {
        title: "Admission to Discharge for Mental Health Inpatients",
        file_name: "Admission to Discharge for Mental Health Inpatients (NMHS).pdf",
      },
      {
        title: "Referral, Admission and Discharge - MHHITH",
        file_name:
          "Referral, Admission and Discharge - Mental Health Hospital in the Home (MHHITH) Policy and Procedure (RKPG).pdf",
      },
    ];
    const sourceOnly = {
      answer: "The following indexed discharge documents are available.",
      grounded: false,
      confidence: "high",
      citations: dischargeSources.map((source, index) => ({
        chunk_id: `c${index}`,
        document_id: `d${index}`,
        ...source,
      })),
      sources: dischargeSources,
      routingMode: "extractive",
      visualEvidence: [],
      latencyTimings: { total_latency_ms: 800 },
    } as unknown as RagAnswer;

    const validation = validateRagAnswer(testCase, sourceOnly);

    expect(validation.expectedHit).toBe(true);
    expect(validation.failures).not.toContain("expected grounded answer");
    expect(validation.failures).toEqual([]);
  });

  it("accepts the owner-accepted review fallback only for its named gate reason", () => {
    const testCase: RagEvalCase = {
      id: "agitation-arousal-typo-dosing",
      question: "What agitaton and arousl dosing guidance applies to psychiatric inpatients?",
      category: "routine",
      expectedQueryClass: "medication_dose_risk",
      supported: true,
      expectedFiles: ["MHSP.AgitationArousalPharmaMgt.pdf"],
      allowedRoutes: ["extractive", "fast", "strong"],
      minCitations: 1,
      latencyTargetMs: 2000,
      acceptedReviewFallbackReason: "dose_without_named_medication",
    };
    const reviewStub = (gateReason: string) =>
      ({
        answer: "Passages to review.",
        grounded: false,
        confidence: "low",
        citations: [],
        sources: [],
        queryClass: "medication_dose_risk",
        routingMode: "extractive",
        routingReason: `medication_dose_risk_strong_route; source_backed_review_fallback; extractive_quality_gate:${gateReason}`,
        visualEvidence: [],
        latencyTimings: { total_latency_ms: 800 },
      }) as unknown as RagAnswer;

    expect(validateRagAnswer(testCase, reviewStub("dose_without_named_medication")).failures).toEqual([]);
    expect(validateRagAnswer(testCase, reviewStub("fragment_like_answer")).failures).toEqual(
      expect.arrayContaining(["expected grounded answer", "expected at least 1 citations"]),
    );
  });

  it("still fails an acceptSourceOnly case when the expected documents are no longer retrieved", () => {
    const testCase: RagEvalCase = {
      id: "discharge-documentation",
      question: "What should discharge documentation include?",
      category: "routine",
      supported: true,
      acceptSourceOnly: true,
      expectedFiles: ["MHSP.Discharge.pdf"],
      allowedRoutes: ["extractive", "fast"],
      minCitations: 2,
      latencyTargetMs: 2000,
    };
    const wrongSources = [
      { title: "Pantoprazole Guideline", file_name: "Pantoprazole Guideline (NMHS).pdf" },
      { title: "Pantoprazole Guideline", file_name: "Pantoprazole Guideline (NMHS).pdf" },
    ];
    const sourceOnlyMissingDocs = {
      answer: "A source-only answer citing unrelated documents.",
      grounded: false,
      confidence: "high",
      citations: wrongSources.map((source, index) => ({ chunk_id: `c${index}`, document_id: `d${index}`, ...source })),
      sources: wrongSources,
      routingMode: "extractive",
      visualEvidence: [],
      latencyTimings: { total_latency_ms: 800 },
    } as unknown as RagAnswer;

    const validation = validateRagAnswer(testCase, sourceOnlyMissingDocs);

    expect(validation.expectedHit).toBe(false);
    expect(validation.failures).toContain("expected document not in retrieved sources");
  });

  it("requires an expected document citation when the canary opts in", () => {
    const testCase: RagEvalCase = {
      id: "patient-safety-plan",
      question: "What should a patient safety plan include?",
      category: "routine",
      supported: true,
      expectedFiles: ["CG.MHSP.PtSafetyPlan.pdf"],
      allowedRoutes: ["extractive", "fast"],
      minCitations: 1,
      requireExpectedFileCitation: true,
      latencyTargetMs: 2000,
    };
    const answer = {
      answer: "Create a collaborative safety plan.",
      grounded: true,
      confidence: "high",
      citations: [{ chunk_id: "other", document_id: "other", title: "Other", file_name: "Other.pdf" }],
      sources: [
        { title: "Patient Safety Plan", file_name: "CG.MHSP.PtSafetyPlan.pdf" },
        { title: "Other", file_name: "Other.pdf" },
      ],
      routingMode: "fast",
      visualEvidence: [],
      latencyTimings: { total_latency_ms: 800 },
    } as unknown as RagAnswer;

    const validation = validateRagAnswer(testCase, answer);

    expect(validation.failures).toContain("expected documents missing from citations: CG.MHSP.PtSafetyPlan.pdf");
  });

  it("requires one complete neuroleptic escalation claim bound to its exact expected-file citation", () => {
    const testCase = ragEvalCases.find((candidate) => candidate.id === "neuroleptic-side-effect-escalation")!;
    const expectedSource = {
      title: "Neuroleptic Side Effects (AKG)",
      file_name: "Neuroleptic Side Effects (AKG).pdf",
    };
    const completeClaim = {
      claimId: "claim-1",
      text: "Escalate any neuroleptic side effect causing distress, irrespective of score, to the treating doctor.",
      riskClass: "high_risk" as const,
      supportingChunkIds: ["distress-rule"],
      supportStatus: "direct" as const,
    };
    const answer = {
      answer: completeClaim.text,
      grounded: true,
      confidence: "medium",
      citations: [
        {
          chunk_id: "distress-rule",
          document_id: "doc-1",
          page_number: 1,
          chunk_index: 0,
          ...expectedSource,
        },
      ],
      sources: [expectedSource],
      supportedClaims: [completeClaim],
      queryClass: "medication_dose_risk",
      routingMode: "strong",
      visualEvidence: [],
      latencyTimings: { total_latency_ms: 500 },
    } as unknown as RagAnswer;

    expect(validateRagAnswer(testCase, answer).failures).toEqual([]);

    const deterministicFallbackClaim = {
      ...completeClaim,
      text: "For neuroleptic, any side effect which is causing distress irrespective of score should be escalated to the treating doctor and reviewed.",
    };
    expect(
      validateRagAnswer(testCase, {
        ...answer,
        answer: deterministicFallbackClaim.text,
        supportedClaims: [deterministicFallbackClaim],
      }).failures,
    ).toEqual([]);

    for (const supportedParaphrase of [
      "Any distressing neuroleptic side effect should be escalated to the treating doctor, regardless of score.",
      "Neuroleptic side effects that cause the patient distress must be escalated to the treating doctor, irrespective of the LUNSERS score.",
      "Any neuroleptic side effect causing distress should be escalated to the treating doctor, no matter what the score.",
      "Any neuroleptic side effect causing distress should be escalated to the treating doctor independently of score.",
    ]) {
      expect(
        validateRagAnswer(testCase, {
          ...answer,
          answer: supportedParaphrase,
          supportedClaims: [{ ...completeClaim, text: supportedParaphrase }],
        }).failures,
        supportedParaphrase,
      ).toEqual([]);
    }

    const noCitation = validateRagAnswer(testCase, { ...answer, citations: [] });
    expect(noCitation.failures).toContain("expected at least 1 citations");
    expect(noCitation.failures).toContain("required direct claim is not fully covered by an expected-file citation");

    const incompleteClaim = validateRagAnswer(testCase, {
      ...answer,
      citations: [
        ...answer.citations,
        {
          chunk_id: "score-context",
          document_id: "doc-1",
          page_number: 1,
          chunk_index: 1,
          ...expectedSource,
        },
      ],
      supportedClaims: [
        {
          ...completeClaim,
          text: "Escalate neuroleptic side effects to the treating doctor.",
          supportingChunkIds: ["distress-rule", "score-context"],
        },
      ],
    });
    expect(incompleteClaim.failures).toContain(
      "required direct claim is not fully covered by an expected-file citation",
    );

    const supportNotBoundToExpectedCitation = validateRagAnswer(testCase, {
      ...answer,
      citations: [
        {
          chunk_id: "expected-but-not-supporting",
          document_id: "doc-1",
          page_number: 1,
          chunk_index: 0,
          ...expectedSource,
        },
        {
          chunk_id: "wrong-support",
          document_id: "doc-2",
          title: "Other guidance",
          file_name: "Other.pdf",
          page_number: 1,
          chunk_index: 0,
        },
      ],
      supportedClaims: [{ ...completeClaim, supportingChunkIds: ["wrong-support"] }],
    });
    expect(supportNotBoundToExpectedCitation.failures).toContain(
      "required direct claim is not fully covered by an expected-file citation",
    );

    for (const unsafeLookalike of [
      "De-escalate any neuroleptic side effect causing distress, irrespective of score, with the treating doctor.",
      "The neuroleptic side effect distress escalation section lists the treating doctor's contact details, regardless of score.",
      "Notify the treating doctor not to escalate a neuroleptic side effect causing distress, irrespective of score.",
      "Escalation of neuroleptic side effect distress to the treating doctor was audited, irrespective of score.",
      "Escalate chest pain to the treating doctor. A neuroleptic side effect causing distress is recorded irrespective of score.",
      "Escalate chest pain to the treating doctor; a neuroleptic side effect causing distress is recorded irrespective of score.",
      "Escalate any neuroleptic side effect not causing distress, irrespective of score, to the treating doctor.",
      "Escalate any neuroleptic side effect causing no distress, irrespective of score, to the treating doctor.",
      "Escalate no neuroleptic side effect causing distress, irrespective of score, to the treating doctor.",
      "Escalate any neuroleptic side effect without causing distress, irrespective of score, to the treating doctor.",
      "Escalate any neuroleptic side effect not necessarily causing distress, irrespective of score, to the treating doctor.",
      "Escalate any neuroleptic side effect causing distress to the treating doctor, not independently of score.",
      "Neuroleptic side effects causing distress should be documented; irrespective of score, chest pain should be escalated to the treating doctor.",
      "Neuroleptic side effects causing distress should be escalated to the treating doctor only when the score is high; observations are recorded regardless of score.",
      "Neuroleptic side effects causing distress should be escalated to nursing staff, while chest pain regardless of score should be escalated to the treating doctor.",
    ]) {
      const unsafeValidation = validateRagAnswer(testCase, {
        ...answer,
        answer: unsafeLookalike,
        supportedClaims: [{ ...completeClaim, text: unsafeLookalike }],
      });
      expect(unsafeValidation.failures, unsafeLookalike).toContain(
        "required direct claim is not fully covered by an expected-file citation",
      );
    }
  });

  it("retries transient provider rate-limit errors for eval operations", async () => {
    let attempts = 0;

    const result = await withProviderBackoff(
      "test-rate-limit",
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("OpenAI is rate limited. Retry in a moment.");
        return "ok";
      },
      { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1 },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(2);
    expect(isProviderRateLimitError(new Error("429 too many requests"))).toBe(true);
  });

  it("retries structured provider rate-limit errors that are not Error instances", async () => {
    const operation = vi.fn(async () => {
      if (operation.mock.calls.length === 1) throw { message: "rate limit exceeded" };
      return "ok";
    });

    await expect(
      withProviderBackoff("test-structured-rate-limit", operation, {
        maxAttempts: 2,
        initialDelayMs: 1,
        maxDelayMs: 1,
      }),
    ).resolves.toBe("ok");

    expect(operation).toHaveBeenCalledTimes(2);
    expect(isProviderRateLimitError({ message: "rate limit exceeded" })).toBe(true);
  });

  it("fails immediately when provider quota is exhausted", async () => {
    const operation = vi.fn(async () => {
      throw Object.assign(new Error("OpenAI quota is exhausted. Falling back to a source-only answer."), {
        status: 429,
        details: { code: "insufficient_quota" },
      });
    });

    await expect(
      withProviderBackoff("test-quota", operation, { maxAttempts: 6, initialDelayMs: 1, maxDelayMs: 1 }),
    ).rejects.toThrow(/quota is exhausted/i);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(isProviderQuotaError(new Error("Billing hard limit reached."))).toBe(true);
    expect(
      isProviderRateLimitError(
        Object.assign(new Error("429 too many requests"), { details: { code: "insufficient_quota" } }),
      ),
    ).toBe(false);
  });

  it("keeps progress only from the successful provider attempt", async () => {
    let attempts = 0;

    const outcome = await withProviderBackoffProgress<string, string>(
      "test-progress-rate-limit",
      async (onProgress) => {
        attempts += 1;
        onProgress(`attempt-${attempts}:retrieved`);
        if (attempts === 1) {
          onProgress("attempt-1:supplementary-selected");
          throw new Error("429 too many requests");
        }
        onProgress("attempt-2:finalized");
        return "ok";
      },
      { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1 },
    );

    expect(outcome).toEqual({
      result: "ok",
      progress: ["attempt-2:retrieved", "attempt-2:finalized"],
    });
    expect(attempts).toBe(2);
  });

  it("pauses between eval cases when configured", async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("RAG_EVAL_CASE_DELAY_MS", "15");
      vi.stubEnv("RAG_EVAL_FORCE_EMBEDDING_DELAY_MS", "15");

      const pausePromise = pauseBetweenEvalCases({ caseIndex: 1, forceEmbedding: true });
      await vi.advanceTimersByTimeAsync(30);
      await pausePromise;

      await pauseBetweenEvalCases({ caseIndex: 0, forceEmbedding: true });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });
});

describe("resolveEvalOwnerId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function adminClientWithUsers(users: Array<{ id: string; email: string }>): SupabaseAdmin {
    return {
      auth: { admin: { listUsers: async () => ({ data: { users }, error: null }) } },
    } as unknown as SupabaseAdmin;
  }

  it("prefers an explicit ownerId over email lookup and the sentinel", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const listUsers = vi.fn();
    const supabase = { auth: { admin: { listUsers } } } as unknown as SupabaseAdmin;

    const ownerId = await resolveEvalOwnerId(supabase, {
      ownerId: "explicit-owner",
      ownerEmail: "user@example.com",
    });

    expect(ownerId).toBe("explicit-owner");
    expect(listUsers).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("resolves ownerEmail via Supabase Auth when no ownerId is set", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const supabase = adminClientWithUsers([{ id: "user-123", email: "Clinician@Example.com" }]);

    const ownerId = await resolveEvalOwnerId(supabase, { ownerEmail: "clinician@example.com" });

    expect(ownerId).toBe("user-123");
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back to the public-owner sentinel and warns when no owner is provided", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const supabase = adminClientWithUsers([]);

    const ownerId = await resolveEvalOwnerId(supabase, {});

    expect(ownerId).toBe(DEFAULT_EVAL_OWNER_ID);
    expect(DEFAULT_EVAL_OWNER_ID).toBe("00000000-0000-0000-0000-000000000000");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(DEFAULT_EVAL_OWNER_ID);
  });
});
