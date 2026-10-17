import { describe, expect, it, vi } from "vitest";
import {
  createGenerationDegradationRecorder,
  compareGenerationAlternatives,
} from "../src/lib/rag/rag-generation-degradation";

function recorder() {
  return createGenerationDegradationRecorder({ enabled: true, routeBudgetMs: 35000 });
}
function response(r: ReturnType<typeof recorder>, outcome: "completed" | "incomplete_max_output_tokens" = "completed") {
  r.start({
    route: "strong",
    timeoutMs: 30000,
    outputBudget: "standard",
    retrievalHealthy: true,
    coverage: "complete",
    contextCount: 2,
  });
  r.respond({ text: "PRIVATE_RESPONSE", usage: { output_tokens: 50 }, status: "completed" }, 12, outcome);
}
const delivered = {
  answer: "Supported action.",
  grounded: true,
  citations: [{ chunk_id: "PRIVATE_CHUNK", document_id: "PRIVATE_DOC" }],
  sources: [{ id: "PRIVATE_CHUNK", document_id: "PRIVATE_DOC" }],
  unverifiedNumericTokens: [],
};

describe("generation degradation diagnostics", () => {
  it.each([
    ["timeout", "provider_initial_attempt_timeout"],
    ["incomplete", "provider_incomplete_max_output_tokens"],
    ["parse", "parse_failure_after_healthy_retrieval"],
    ["verification", "verification_collapse_after_healthy_retrieval"],
    ["quality", "provider_quality_retry_exhausted"],
  ] as const)("classifies healthy retrieval %s independently", (kind, expected) => {
    const r = recorder();
    if (kind === "timeout") {
      r.start({
        route: "strong",
        timeoutMs: 30000,
        outputBudget: "standard",
        retrievalHealthy: true,
        coverage: "complete",
        contextCount: 2,
      });
      r.fail("timeout", 30000);
    } else {
      response(r, kind === "incomplete" ? "incomplete_max_output_tokens" : "completed");
      if (kind === "parse") r.parsed({ routingReason: "structured_parse_fallback" });
      if (kind === "verification") r.verificationFailed();
      if (kind === "quality") r.retry("template_like_answer", "denied_budget", 21999);
    }
    expect(r.finish(delivered, true)?.reason).toBe(expected);
  });
  it("orders response-bearing quality rejection before timeout and counts only actual calls", () => {
    const r = recorder();
    response(r);
    r.retry("template_like_answer", "admitted", 22000);
    r.start({
      route: "strong",
      timeoutMs: 20000,
      outputBudget: "recovery",
      retrievalHealthy: true,
      coverage: "complete",
      contextCount: 2,
    });
    r.fail("timeout", 20000);
    const record = r.finish(delivered, true)!;
    expect(record.reason).toBe("provider_quality_retry_exhausted");
    expect(record.attempts.map((a) => [a.ordinal, a.stage, a.outcome, a.latencyMs])).toEqual([
      [1, "initial", "completed", 12],
      [2, "quality_retry", "timeout", 20000],
    ]);
    expect(record.completedResponseCount).toBe(1);
    expect(record.completedOutput).toMatchObject({ useful: true, validCitationCount: 1, unverifiedNumericCount: 0 });
    expect(JSON.stringify(record)).not.toMatch(/PRIVATE_|Supported action/);
  });
  it("keeps terminal parse and truncation distinct after an earlier quality rejection", () => {
    for (const terminal of ["parse", "incomplete"] as const) {
      const r = recorder();
      response(r);
      r.retry("template_like_answer", "admitted", 22000);
      response(r, terminal === "incomplete" ? "incomplete_max_output_tokens" : "completed");
      if (terminal === "parse") r.parsed({ routingReason: "structured_parse_fallback" });
      expect(r.finish(delivered, true)?.reason).toBe(
        terminal === "parse" ? "parse_failure_after_healthy_retrieval" : "provider_incomplete_max_output_tokens",
      );
    }
  });
  it("does not label caller abort or unavailable coverage as healthy generation degradation", () => {
    const r = recorder();
    response(r);
    r.fail("caller_aborted", 1);
    expect(r.finish(delivered, true)?.reason).toBeNull();
    const unknown = recorder();
    unknown.start({
      route: "strong",
      timeoutMs: 30000,
      outputBudget: "standard",
      retrievalHealthy: true,
      coverage: "unavailable",
      contextCount: 2,
    });
    unknown.fail("timeout", 30000);
    expect(unknown.finish(delivered, true)?.reason).toBeNull();
  });
  it("compares supplied observations only with isolated bounded identities and fail-closed safety", () => {
    const r = recorder();
    response(r);
    r.retry("template_like_answer", "denied_budget", 21999);
    const baseline = r.finish(delivered, true)!;
    const comparison = compareGenerationAlternatives({
      mode: "shadow",
      alternative: "retry_admission",
      baseline,
      candidate: {
        ...baseline,
        reason: null,
        totalAttemptLatencyMs: 10,
        attempts: baseline.attempts.map((a) => ({
          ...a,
          latencyMs: 10,
          qualityReason: null,
          retryAdmission: "not_requested" as const,
        })),
      },
      sameEvidence: true,
      safetyContractUnchanged: true,
    });
    expect(comparison).toMatchObject({
      mode: "shadow",
      activationAllowed: false,
      verdict: "candidate_improved",
      cacheIdentity: "generation-shadow-v1:retry_admission",
    });
    expect(
      compareGenerationAlternatives({
        mode: "shadow",
        alternative: "retry_admission",
        baseline,
        candidate: baseline,
        sameEvidence: false,
        safetyContractUnchanged: true,
      }).verdict,
    ).toBe("incomparable");
  });
});

it("bounds the existing four-call ladder and fails closed on future overflow", () => {
  const r = recorder();
  response(r, "incomplete_max_output_tokens");
  r.retry(null, "admitted", 30000, true);
  response(r);
  r.retry("template_like_answer", "admitted", 28000);
  response(r);
  r.retry("template_like_answer", "admitted", 26000);
  response(r);
  const complete = r.finish(delivered, false)!;
  expect(complete.attempts.map((a) => a.stage)).toEqual([
    "initial",
    "truncation_recovery",
    "quality_retry",
    "quality_retry",
  ]);
  expect(complete.observationComplete).toBe(true);
  response(r);
  r.fail("timeout", 30000);
  const overflow = r.finish(delivered, true)!;
  expect(overflow.attempts).toEqual(complete.attempts);
  expect(overflow.observationComplete).toBe(false);
  expect(overflow.reason).toBeNull();
  expect(
    compareGenerationAlternatives({
      mode: "shadow",
      alternative: "retry_admission",
      baseline: complete,
      candidate: overflow,
      sameEvidence: true,
      safetyContractUnchanged: true,
    }).verdict,
  ).toBe("incomparable");
});

it("projects injected metadata and unknown versions without exposing content", async () => {
  const { projectGenerationDegradation } = await import("../src/lib/rag/rag-generation-degradation");
  const r = recorder();
  response(r);
  const record = r.finish(delivered, false)!;
  const poisoned = {
    ...record,
    privateQuery: "PRIVATE_QUERY",
    attempts: [
      {
        ...record.attempts[0],
        qualityReason: "PRIVATE_REASON",
        route: "strong",
        requestId: "PRIVATE_REQUEST",
        outputText: "PRIVATE_OUTPUT",
        timeoutMs: 30000,
      },
    ],
  };
  const safe = projectGenerationDegradation(poisoned as unknown as typeof record)!;
  expect(JSON.stringify(safe)).not.toContain("PRIVATE_");
  expect(safe.attempts[0]).toMatchObject({ qualityReason: "quality_gate", route: "strong", timeoutMs: 30000 });
  expect(
    projectGenerationDegradation({ ...record, promptVersion: "PRIVATE_PROMPT" } as unknown as typeof record),
  ).toBeNull();
});

it("cannot present retry admission as a fix for zero-response initial timeout", () => {
  const r = recorder();
  r.start({
    route: "strong",
    timeoutMs: 30000,
    outputBudget: "standard",
    retrievalHealthy: true,
    coverage: "complete",
    contextCount: 2,
  });
  r.fail("timeout", 30000);
  const baseline = r.finish(delivered, true)!;
  const candidateRecorder = recorder();
  response(candidateRecorder);
  const candidate = candidateRecorder.finish(delivered, false)!;
  expect(
    compareGenerationAlternatives({
      mode: "shadow",
      alternative: "retry_admission",
      baseline,
      candidate,
      sameEvidence: true,
      safetyContractUnchanged: true,
    }).verdict,
  ).toBe("incomparable");
});

describe("supplied comparison record integrity", () => {
  const validPair = () => {
    const r = recorder();
    response(r);
    r.retry("template_like_answer", "denied_budget", 21999);
    const baseline = r.finish(delivered, true)!;
    const candidateRecorder = recorder();
    response(candidateRecorder);
    return { baseline, candidate: candidateRecorder.finish(delivered, false)! };
  };
  it.each([
    "null_attempt",
    "fifth_timeout",
    "negative_latency",
    "infinite_latency",
    "nan_latency",
    "negative_timeout",
    "negative_output_chars",
    "nan_output_tokens",
    "negative_reasoning_tokens",
    "negative_context_count",
    "negative_completed_output",
    "infinite_total_latency",
    "negative_response_count",
    "oversized_route_budget",
    "noncanonical_route_budget",
    "unknown_route",
    "missing_outcome",
  ])("rejects %s without throwing or claiming benefit", async (fault) => {
    const { projectGenerationDegradation } = await import("../src/lib/rag/rag-generation-degradation");
    const { baseline, candidate } = validPair();
    const malformed = structuredClone(candidate);
    const first = malformed.attempts[0];
    switch (fault) {
      case "null_attempt":
        malformed.attempts = [null as unknown as typeof first];
        break;
      case "fifth_timeout":
        malformed.attempts = Array.from({ length: 5 }, (_, i) => ({
          ...first,
          ordinal: i + 1,
          stage: i ? "quality_retry" : "initial",
          outcome: i === 4 ? "timeout" : "completed",
          responseReceived: i !== 4,
        }));
        break;
      case "negative_latency":
        first.latencyMs = -1;
        break;
      case "infinite_latency":
        first.latencyMs = Infinity;
        break;
      case "nan_latency":
        first.latencyMs = NaN;
        break;
      case "negative_timeout":
        first.timeoutMs = -1;
        break;
      case "negative_output_chars":
        first.outputChars = -1;
        break;
      case "nan_output_tokens":
        first.outputTokens = NaN;
        break;
      case "negative_reasoning_tokens":
        first.reasoningTokens = -1;
        break;
      case "negative_context_count":
        first.contextCount = -1;
        break;
      case "negative_completed_output":
        malformed.completedOutput.validCitationCount = -1;
        break;
      case "infinite_total_latency":
        malformed.totalAttemptLatencyMs = Infinity;
        break;
      case "negative_response_count":
        malformed.completedResponseCount = -1;
        break;
      case "oversized_route_budget":
        malformed.routeBudgetMs = 999999;
        break;
      case "noncanonical_route_budget":
        malformed.routeBudgetMs = 34999;
        break;
      case "unknown_route":
        first.route = "PRIVATE_MODEL" as typeof first.route;
        break;
      case "missing_outcome":
        delete (first as Partial<typeof first>).outcome;
        break;
    }
    expect(() => projectGenerationDegradation(malformed)).not.toThrow();
    expect(projectGenerationDegradation(malformed)).toBeNull();
    expect(
      compareGenerationAlternatives({
        mode: "shadow",
        alternative: "retry_admission",
        baseline,
        candidate: malformed,
        sameEvidence: true,
        safetyContractUnchanged: true,
      }).verdict,
    ).toBe("incomparable");
  });
  it("rejects sparse attempts without throwing while retaining valid comparison evidence", async () => {
    const { projectGenerationDegradation } = await import("../src/lib/rag/rag-generation-degradation");
    const { baseline, candidate } = validPair();
    const input = {
      mode: "shadow" as const,
      alternative: "retry_admission" as const,
      baseline,
      candidate,
      sameEvidence: true,
      safetyContractUnchanged: true,
    };
    expect(compareGenerationAlternatives(input).verdict).toBe("candidate_improved");
    const sparse = {
      ...candidate,
      attempts: Array<(typeof candidate.attempts)[number]>(1),
      completedResponseCount: 0,
      totalAttemptLatencyMs: 0,
    };
    expect(() => compareGenerationAlternatives({ ...input, candidate: sparse })).not.toThrow();
    expect(() => projectGenerationDegradation(sparse)).not.toThrow();
    expect(projectGenerationDegradation(sparse)).toBeNull();
    expect(compareGenerationAlternatives({ ...input, candidate: sparse }).verdict).toBe("incomparable");
  });
  it("retains positive evidence for a valid candidate", () => {
    const { baseline, candidate } = validPair();
    expect(
      compareGenerationAlternatives({
        mode: "shadow",
        alternative: "retry_admission",
        baseline,
        candidate,
        sameEvidence: true,
        safetyContractUnchanged: true,
      }).verdict,
    ).toBe("candidate_improved");
  });
});

describe("P12A selected generation diagnostic identity", () => {
  it("keeps the no-option legacy pair and accepts the coherent adaptive pair", async () => {
    const { projectGenerationDegradation } = await import("../src/lib/rag/rag-generation-degradation");
    expect(recorder().finish(delivered, false)).toMatchObject({
      promptVersion: "clinical-rag-answer-v19",
      schemaVersion: "clinical-rag-answer-schema-v4",
    });
    const selected = {
      promptVersion: "clinical-rag-answer-v20",
      schemaVersion: "clinical-rag-answer-schema-v5",
    } as const;
    const adaptive = createGenerationDegradationRecorder({ enabled: true, routeBudgetMs: 35000, contract: selected });
    response(adaptive);
    const record = adaptive.finish(delivered, false)!;
    expect(record).toMatchObject(selected);
    expect(projectGenerationDegradation(record)).toEqual(record);
  });
  it("fails closed on unknown or mixed pairs without repairing them to legacy", async () => {
    const { projectGenerationDegradation } = await import("../src/lib/rag/rag-generation-degradation");
    const record = recorder().finish(delivered, false)!;
    for (const pair of [
      { promptVersion: "clinical-rag-answer-v20", schemaVersion: "clinical-rag-answer-schema-v4" },
      { promptVersion: "clinical-rag-answer-v19", schemaVersion: "clinical-rag-answer-schema-v5" },
      { promptVersion: "UNKNOWN", schemaVersion: "clinical-rag-answer-schema-v5" },
    ])
      expect(projectGenerationDegradation({ ...record, ...pair } as unknown as typeof record)).toBeNull();
  });
});

describe("#231 generation degradation telemetry switch and wire", () => {
  it("records per-attempt observations when enabled=false while keeping answer.generationDegradation undefined", async () => {
    const { readObservedGenerationDegradation } = await import("../src/lib/rag/rag-generation-degradation");
    const { answerScopedEvidenceMetadata, generationDegradationTelemetryFields } =
      await import("../src/lib/rag/rag-answer-telemetry-metadata");

    const timeoutAnswer = structuredClone(delivered);
    const timeoutRecorder = createGenerationDegradationRecorder({ enabled: false, routeBudgetMs: 35000 });
    timeoutRecorder.start({
      route: "fast",
      timeoutMs: 12000,
      outputBudget: "standard",
      retrievalHealthy: true,
      coverage: "complete",
      contextCount: 3,
    });
    timeoutRecorder.fail("timeout", 12000);
    expect(timeoutRecorder.finish(timeoutAnswer, true)).toBeUndefined();
    expect(readObservedGenerationDegradation(timeoutAnswer)?.reason).toBe("provider_initial_attempt_timeout");
    expect(generationDegradationTelemetryFields(timeoutAnswer)).toEqual({
      generation_degradation_reason: "provider_initial_attempt_timeout",
      generation_degradation_attempt_count: 1,
      generation_degradation_completed_response_count: 0,
      generation_degradation_total_attempt_latency_ms: 12000,
      generation_degradation_initial_outcome: "timeout",
      generation_degradation_initial_latency_ms: 12000,
      generation_degradation_initial_timeout_ms: 12000,
    });

    const qualityAnswer = { ...structuredClone(delivered), sources: [] };
    const qualityRecorder = createGenerationDegradationRecorder({ enabled: false, routeBudgetMs: 35000 });
    response(qualityRecorder);
    qualityRecorder.retry("template_like_answer", "admitted", 22000);
    qualityRecorder.start({
      route: "strong",
      timeoutMs: 20000,
      outputBudget: "recovery",
      retrievalHealthy: true,
      coverage: "complete",
      contextCount: 3,
    });
    qualityRecorder.fail("timeout", 20000);
    expect(qualityRecorder.finish(qualityAnswer, true)).toBeUndefined();
    const metadata = answerScopedEvidenceMetadata("clozapine monitoring", "medication_dose_risk", qualityAnswer);
    expect(metadata).toMatchObject({
      generation_degradation_reason: "provider_quality_retry_exhausted",
      generation_degradation_attempt_count: 2,
      generation_degradation_completed_response_count: 1,
      generation_degradation_total_attempt_latency_ms: 20012,
      generation_degradation_initial_outcome: "completed",
      generation_degradation_initial_latency_ms: 12,
      generation_degradation_initial_timeout_ms: 30000,
    });
  });
});

describe("generationDegradationLogMetadata (#231) and worker pre-claim scope filter", () => {
  it("emits scalar telemetry metadata even when public generationDegradation rollout is off", async () => {
    const { generationDegradationLogMetadata } = await import("../src/lib/rag/rag-generation-degradation");
    const r = createGenerationDegradationRecorder({
      enabled: false,
      routeBudgetMs: 35000,
      remainingRouteBudgetMs: () => 2000,
    });
    r.start({
      route: "strong",
      timeoutMs: 30000,
      outputBudget: "standard",
      retrievalHealthy: true,
      coverage: "complete",
      contextCount: 2,
    });
    r.fail("timeout", 30000);
    expect(r.finish(delivered, true)).toBeUndefined();
    expect(r.metadata()).toEqual({
      generation_degradation_reason: "provider_initial_attempt_timeout",
      generation_degradation_attempt_count: 1,
      generation_degradation_completed_response_count: 0,
      generation_degradation_total_attempt_latency_ms: 30000,
      generation_degradation_remaining_route_budget_ms: 2000,
      provider_initial_attempt_timeout: true,
      provider_quality_retry_exhausted: false,
    });
    expect(generationDegradationLogMetadata(undefined)).toEqual({});
  });

  it("enforces WORKER_ALLOWED_DOCUMENT_IDS, WORKER_ALLOWED_FILE_TYPES, and claim_ingestion_jobs candidate eligibility", async () => {
    const { resolveWorkerClaimScopeFilter, isPreClaimCandidateAllowed, isClaimableIngestionJobCandidate } =
      await import("../worker/behavior");
    const inactive = resolveWorkerClaimScopeFilter({});
    expect(inactive.active).toBe(false);
    expect(isPreClaimCandidateAllowed({ document_id: "doc-1", file_type: "application/pdf" }, inactive)).toBe(true);

    const active = resolveWorkerClaimScopeFilter({
      WORKER_ALLOWED_DOCUMENT_IDS: "DOC-TXT-1, doc-txt-2",
      WORKER_ALLOWED_FILE_TYPES: "TEXT/PLAIN; charset=utf-8",
    });
    expect(active.active).toBe(true);
    expect(
      isPreClaimCandidateAllowed({ document_id: "doc-txt-1", file_type: "text/plain; charset=utf-8" }, active),
    ).toBe(true);
    expect(isPreClaimCandidateAllowed({ document_id: "doc-txt-1", file_type: "application/pdf" }, active)).toBe(false);
    expect(isPreClaimCandidateAllowed({ document_id: "doc-other", file_type: "text/plain" }, active)).toBe(false);

    const nowMs = Date.parse("2026-10-17T12:00:00.000Z");
    expect(isClaimableIngestionJobCandidate({ status: "pending", attempt_count: 0, max_attempts: 3 }, nowMs)).toBe(
      true,
    );
    expect(
      isClaimableIngestionJobCandidate(
        { status: "pending", attempt_count: 1, max_attempts: 3, next_run_at: "2026-10-17T12:05:00.000Z" },
        nowMs,
      ),
    ).toBe(false);
    expect(
      isClaimableIngestionJobCandidate(
        { status: "processing", attempt_count: 1, max_attempts: 3, lease_expires_at: "2026-10-17T11:59:00.000Z" },
        nowMs,
      ),
    ).toBe(true);
    expect(
      isClaimableIngestionJobCandidate(
        { status: "processing", attempt_count: 3, max_attempts: 3, lease_expires_at: "2026-10-17T11:59:00.000Z" },
        nowMs,
      ),
    ).toBe(false);
  });
});

describe("unserved production generator observations", () => {
  it("records a real observed-generator timeout and captures the deadline at completion", async () => {
    const { createObservedAnswerGenerator } = await import("../src/lib/rag/rag-provider");
    const { createAnswerRouteDeadline } = await import("../src/lib/rag/rag-route-budget");
    let elapsed = 8000;
    const deadline = createAnswerRouteDeadline({ routeMode: "strong", startedAt: 0, now: () => elapsed });
    const r = createGenerationDegradationRecorder({
      enabled: false,
      routeBudgetMs: deadline.budgetMs,
      remainingRouteBudgetMs: deadline.remainingMs,
    });
    const generate = vi.fn(async () => {
      elapsed += 25000;
      throw new Error("Request timed out");
    });
    const observed = createObservedAnswerGenerator({
      generate,
      buildInput: () => "synthetic",
      schemaFor: () => ({}),
      deadline,
      recorder: r,
      contextObservation: () => ({ retrievalHealthy: true, coverage: "complete", contextCount: 2 }),
      instructions: "synthetic",
      promptCacheKey: "synthetic",
      fastReasoningEffort: "low",
      strongReasoningEffort: "low",
      onResult: () => {},
      onLatency: () => {},
    });
    try {
      await expect(observed("synthetic-model", {})).rejects.toThrow("timed out");
      expect(r.finish(delivered, true)).toBeUndefined();
      elapsed += 1000;
      expect(r.metadata()).toMatchObject({
        generation_degradation_attempt_count: 1,
        generation_degradation_remaining_route_budget_ms: 2000,
        provider_initial_attempt_timeout: true,
      });
    } finally {
      deadline.dispose();
    }
  });
});
