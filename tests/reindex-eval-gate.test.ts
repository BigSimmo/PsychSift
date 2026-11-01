import { describe, expect, it } from "vitest";
import { decideReindexGate, type QualityGateSummary, type RetrievalGateSummary } from "../src/lib/reindex-eval-gate";

function retrieval(overrides: Partial<RetrievalGateSummary> = {}): RetrievalGateSummary {
  return {
    case_count: 4,
    failed_case_count: 0,
    document_recall_at_5: 0.9,
    content_recall_at_5: 0.9,
    top_k_hit_rate: 0.95,
    content_mrr_at_10: 0.9,
    content_mrr_case_count: 3,
    mrr_at_10: 0.8,
    p90_latency_ms: 8000,
    ...overrides,
  };
}

function quality(overrides: Partial<QualityGateSummary> = {}): QualityGateSummary {
  return {
    case_count: 4,
    grounded_supported_rate: 0.95,
    unsupported_count: 1,
    unsupported_correct_rate: 1,
    expected_hit_rate: 0.9,
    citation_failure_rate: 0,
    numeric_grounding_failure_rate: 0,
    source_governance_danger_failure_rate: 0,
    expected_danger_warning_missing_count: 0,
    stale_review_unknown_rate: 0.1,
    review_required_rate: 0.1,
    p95_latency_ms: 18000,
    ...overrides,
  };
}

describe("decideReindexGate — retrieval", () => {
  it.each([
    { case_count: 0, content_mrr_case_count: 0 },
    { content_mrr_case_count: 0 },
    { case_count: 4.5 },
    { content_mrr_case_count: 5 },
    { failed_case_count: -1 },
    { document_recall_at_5: 1.1 },
    { content_mrr_at_10: -0.1 },
    { mrr_at_10: Number.NaN },
    { p90_latency_ms: -1 },
  ])("refuses invalid evidence even when both summaries match: %j", (overrides) => {
    const summary = retrieval(overrides);
    expect(
      decideReindexGate({
        baselineRetrieval: summary,
        candidateRetrieval: summary,
        qualityMode: "retrieval_only",
      }).decision,
    ).toBe("NO_GO");
  });
  it("returns GO when the candidate matches or beats the baseline and clears the floors", () => {
    const decision = decideReindexGate({
      baselineRetrieval: retrieval(),
      candidateRetrieval: retrieval({ content_recall_at_5: 0.92 }),
      qualityMode: "retrieval_only",
    });
    expect(decision.decision).toBe("GO");
    expect(decision.failures).toEqual([]);
  });

  it("returns NO_GO when an absolute floor is breached", () => {
    const decision = decideReindexGate({
      baselineRetrieval: retrieval({ content_recall_at_5: 0.78 }),
      candidateRetrieval: retrieval({ content_recall_at_5: 0.75 }),
      qualityMode: "retrieval_only",
    });
    expect(decision.decision).toBe("NO_GO");
    expect(decision.failures.join(" ")).toMatch(/content_recall_at_5 0.75 below absolute floor 0.8/);
  });

  it("returns NO_GO on a real regression even when both values clear the floor", () => {
    // Baseline 0.98, candidate 0.85 — both above the 0.8 floor, but a 13-point drop is a
    // regression well beyond the 0.02 tolerance.
    const decision = decideReindexGate({
      baselineRetrieval: retrieval({ document_recall_at_5: 0.98 }),
      candidateRetrieval: retrieval({ document_recall_at_5: 0.85 }),
      qualityMode: "retrieval_only",
    });
    expect(decision.decision).toBe("NO_GO");
    expect(decision.failures.join(" ")).toMatch(/document_recall_at_5 regressed/);
  });

  it("tolerates sub-threshold eval noise below the baseline", () => {
    // 0.90 -> 0.89 is within the 0.02 tolerance and still above the floor => GO.
    const decision = decideReindexGate({
      baselineRetrieval: retrieval({ content_recall_at_5: 0.9 }),
      candidateRetrieval: retrieval({ content_recall_at_5: 0.89 }),
      qualityMode: "retrieval_only",
    });
    expect(decision.decision).toBe("GO");
  });

  it("flags a p90 latency regression beyond the allowed drift", () => {
    const decision = decideReindexGate({
      baselineRetrieval: retrieval({ p90_latency_ms: 8000 }),
      candidateRetrieval: retrieval({ p90_latency_ms: 14000 }),
      qualityMode: "retrieval_only",
    });
    expect(decision.decision).toBe("NO_GO");
    expect(decision.failures.join(" ")).toMatch(/p90_latency_ms regressed/);
  });

  it("fails closed when retrieval summaries omit failed-case counts", () => {
    const baselineWithoutFailedCaseCount = {
      case_count: 4,
      document_recall_at_5: 0.9,
      content_recall_at_5: 0.9,
      top_k_hit_rate: 0.9,
      content_mrr_at_10: 0.9,
      content_mrr_case_count: 3,
    } as Partial<RetrievalGateSummary> as RetrievalGateSummary;
    const decision = decideReindexGate({
      baselineRetrieval: baselineWithoutFailedCaseCount,
      candidateRetrieval: {
        case_count: 4,
        failed_case_count: 0,
        document_recall_at_5: 0.9,
        content_recall_at_5: 0.9,
        top_k_hit_rate: 0.9,
        content_mrr_at_10: 0.9,
        content_mrr_case_count: 3,
      },
      qualityMode: "retrieval_only",
    });
    expect(decision.decision).toBe("NO_GO");
    expect(decision.failures.join(" ")).toMatch(/baselineRetrieval\.failed_case_count/);
  });

  it("skips optional metrics when either summary omits them", () => {
    const decision = decideReindexGate({
      baselineRetrieval: {
        case_count: 4,
        failed_case_count: 0,
        document_recall_at_5: 0.9,
        content_recall_at_5: 0.9,
        top_k_hit_rate: 0.9,
        content_mrr_at_10: 0.9,
        content_mrr_case_count: 3,
      },
      candidateRetrieval: {
        case_count: 4,
        failed_case_count: 0,
        document_recall_at_5: 0.9,
        content_recall_at_5: 0.9,
        top_k_hit_rate: 0.9,
        content_mrr_at_10: 0.9,
        content_mrr_case_count: 3,
      },
      qualityMode: "retrieval_only",
    });
    expect(decision.decision).toBe("GO");
    expect(decision.checks.some((check) => check.metric === "mrr_at_10")).toBe(false);
    expect(decision.checks.some((check) => check.metric === "p90_latency_ms")).toBe(false);
  });

  it("returns NO_GO when passage MRR regresses even if the doc-level MRR improves", () => {
    // Doc-level mrr_at_10 is blind to intra-document passage order, so a chunking/OCR change can
    // lift it while the answer passage sinks below distractors. content_mrr_at_10 must catch that.
    const decision = decideReindexGate({
      baselineRetrieval: retrieval({ mrr_at_10: 0.8, content_mrr_at_10: 0.9 }),
      candidateRetrieval: retrieval({ mrr_at_10: 0.9, content_mrr_at_10: 0.7 }),
      qualityMode: "retrieval_only",
    });
    expect(decision.decision).toBe("NO_GO");
    expect(decision.failures.join(" ")).toMatch(/content_mrr_at_10 regressed/);
  });

  it("fails closed when the passage MRR metric is missing", () => {
    const candidateWithoutContentMrr = {
      case_count: 4,
      failed_case_count: 0,
      document_recall_at_5: 0.9,
      content_recall_at_5: 0.9,
      top_k_hit_rate: 0.9,
      content_mrr_case_count: 3,
    } as Partial<RetrievalGateSummary> as RetrievalGateSummary;
    const decision = decideReindexGate({
      baselineRetrieval: retrieval(),
      candidateRetrieval: candidateWithoutContentMrr,
      qualityMode: "retrieval_only",
    });
    expect(decision.decision).toBe("NO_GO");
    expect(decision.failures.join(" ")).toMatch(/candidateRetrieval\.content_mrr_at_10/);
  });

  it("fails closed when the passage-MRR case population differs", () => {
    const decision = decideReindexGate({
      baselineRetrieval: retrieval({ content_mrr_case_count: 3 }),
      candidateRetrieval: retrieval({ content_mrr_case_count: 5 }),
      qualityMode: "retrieval_only",
    });
    expect(decision.decision).toBe("NO_GO");
    expect(decision.failures.join(" ")).toMatch(/content_mrr_case_count mismatch/);
  });

  it("treats equal passage MRR as neutral for a standard re-index but insufficient for chunking", () => {
    const equalPassageMrr = {
      baselineRetrieval: retrieval({ content_mrr_at_10: 0.9 }),
      candidateRetrieval: retrieval({ content_mrr_at_10: 0.9 }),
      qualityMode: "retrieval_only" as const,
    };
    // Standard re-index: holding passage rank is fine.
    expect(decideReindexGate(equalPassageMrr).decision).toBe("GO");
    // Chunking experiment: a neutral result cannot justify the re-index spend.
    const chunkingDecision = decideReindexGate({ ...equalPassageMrr, chunkingExperiment: true });
    expect(chunkingDecision.decision).toBe("NO_GO");
    expect(chunkingDecision.failures.join(" ")).toMatch(/content_mrr_at_10 0.9 below absolute floor/);
  });

  it("returns GO for a chunking experiment only when passage rank clears the noise band", () => {
    const decision = decideReindexGate({
      baselineRetrieval: retrieval({ content_mrr_at_10: 0.9 }),
      candidateRetrieval: retrieval({ content_mrr_at_10: 0.95 }),
      qualityMode: "retrieval_only",
      chunkingExperiment: true,
    });
    expect(decision.decision).toBe("GO");
  });

  it("fails closed when retrieval eval reports failed cases", () => {
    const decision = decideReindexGate({
      baselineRetrieval: retrieval(),
      candidateRetrieval: retrieval({ failed_case_count: 1 }),
      qualityMode: "retrieval_only",
    });
    expect(decision.decision).toBe("NO_GO");
    expect(decision.failures.join(" ")).toMatch(/failed_case_count 1 above absolute ceiling 0/);
  });

  it("fails closed when retrieval summaries cover different eval populations", () => {
    const decision = decideReindexGate({
      baselineRetrieval: retrieval({ case_count: 12 }),
      candidateRetrieval: retrieval({ case_count: 4 }),
      qualityMode: "retrieval_only",
    });
    expect(decision.decision).toBe("NO_GO");
    expect(decision.failures.join(" ")).toMatch(/retrieval case_count mismatch/);
  });

  it("fails closed when retrieval case fingerprints differ", () => {
    const decision = decideReindexGate({
      baselineRetrieval: retrieval({ case_fingerprint: "all-cases-v1" }),
      candidateRetrieval: retrieval({ case_fingerprint: "limited-cases-v1" }),
      qualityMode: "retrieval_only",
    });
    expect(decision.decision).toBe("NO_GO");
    expect(decision.failures.join(" ")).toMatch(/retrieval case_fingerprint mismatch/);
  });

  it("fails closed when quality summaries are omitted by default", () => {
    const decision = decideReindexGate({
      baselineRetrieval: retrieval(),
      candidateRetrieval: retrieval(),
    });
    expect(decision.decision).toBe("NO_GO");
    expect(decision.failures.join(" ")).toMatch(/quality summaries are required/);
  });
});

describe("decideReindexGate — quality", () => {
  it.each([
    { case_count: 0, unsupported_count: 0 },
    { unsupported_count: 5 },
    { unsupported_count: 0.5 },
    { citation_failure_rate: -0.1 },
    { grounded_supported_rate: 1.1 },
    { expected_danger_warning_missing_count: -1 },
    { expected_hit_rate: Number.POSITIVE_INFINITY },
    { p95_latency_ms: -1 },
  ])("refuses invalid quality evidence: %j", (overrides) => {
    expect(
      decideReindexGate({
        baselineRetrieval: retrieval(),
        candidateRetrieval: retrieval(),
        baselineQuality: quality(overrides),
        candidateQuality: quality(overrides),
      }).decision,
    ).toBe("NO_GO");
  });
  it("returns GO when retrieval and quality both hold", () => {
    const decision = decideReindexGate({
      baselineRetrieval: retrieval(),
      candidateRetrieval: retrieval(),
      baselineQuality: quality(),
      candidateQuality: quality(),
    });
    expect(decision.decision).toBe("GO");
  });

  it("returns NO_GO when any hard-zero failure rate is non-zero", () => {
    const decision = decideReindexGate({
      baselineRetrieval: retrieval(),
      candidateRetrieval: retrieval(),
      baselineQuality: quality(),
      candidateQuality: quality({ citation_failure_rate: 0.05 }),
    });
    expect(decision.decision).toBe("NO_GO");
    expect(decision.failures.join(" ")).toMatch(/citation_failure_rate 0.05 above absolute ceiling 0/);
  });

  it("skips unsupported_correct_rate when there are no unsupported cases", () => {
    const decision = decideReindexGate({
      baselineRetrieval: retrieval(),
      candidateRetrieval: retrieval(),
      baselineQuality: quality({ unsupported_count: 0, unsupported_correct_rate: 0 }),
      candidateQuality: quality({ unsupported_count: 0, unsupported_correct_rate: 0 }),
    });
    expect(decision.decision).toBe("GO");
    expect(decision.checks.some((check) => check.metric === "unsupported_correct_rate")).toBe(false);
  });

  it("returns NO_GO when an expected danger warning is missing", () => {
    const decision = decideReindexGate({
      baselineRetrieval: retrieval(),
      candidateRetrieval: retrieval(),
      baselineQuality: quality(),
      candidateQuality: quality({ expected_danger_warning_missing_count: 1 }),
    });
    expect(decision.decision).toBe("NO_GO");
    expect(decision.failures.join(" ")).toMatch(/expected_danger_warning_missing_count 1 above absolute ceiling 0/);
  });

  it("returns NO_GO when grounded_supported_rate falls below the floor", () => {
    const decision = decideReindexGate({
      baselineRetrieval: retrieval(),
      candidateRetrieval: retrieval(),
      baselineQuality: quality({ grounded_supported_rate: 0.92 }),
      candidateQuality: quality({ grounded_supported_rate: 0.85 }),
    });
    expect(decision.decision).toBe("NO_GO");
    expect(decision.failures.join(" ")).toMatch(/grounded_supported_rate 0.85 below absolute floor 0.9/);
  });

  it("returns NO_GO when p95 latency exceeds the ceiling", () => {
    const decision = decideReindexGate({
      baselineRetrieval: retrieval(),
      candidateRetrieval: retrieval(),
      baselineQuality: quality(),
      candidateQuality: quality({ p95_latency_ms: 61000 }),
    });
    expect(decision.decision).toBe("NO_GO");
    expect(decision.failures.join(" ")).toMatch(/p95_latency_ms 61000 above absolute ceiling 60000/);
  });

  it("fails closed when only one side supplies a quality summary", () => {
    const decision = decideReindexGate({
      baselineRetrieval: retrieval(),
      candidateRetrieval: retrieval(),
      candidateQuality: quality(),
    });
    expect(decision.decision).toBe("NO_GO");
    expect(decision.failures.join(" ")).toMatch(/quality summaries are required/);
  });

  it("fails closed when quality summaries omit required source governance rates", () => {
    const withoutGovernanceRates = quality() as Partial<QualityGateSummary>;
    delete withoutGovernanceRates.stale_review_unknown_rate;
    delete withoutGovernanceRates.review_required_rate;

    const decision = decideReindexGate({
      baselineRetrieval: retrieval(),
      candidateRetrieval: retrieval(),
      baselineQuality: quality(),
      candidateQuality: withoutGovernanceRates as QualityGateSummary,
    });
    expect(decision.decision).toBe("NO_GO");
    expect(decision.failures.join(" ")).toMatch(/candidateQuality\.stale_review_unknown_rate/);
    expect(decision.failures.join(" ")).toMatch(/candidateQuality\.review_required_rate/);
  });

  it("fails closed when quality summaries cover different eval populations", () => {
    const decision = decideReindexGate({
      baselineRetrieval: retrieval(),
      candidateRetrieval: retrieval(),
      baselineQuality: quality({ case_count: 9 }),
      candidateQuality: quality({ case_count: 3 }),
    });
    expect(decision.decision).toBe("NO_GO");
    expect(decision.failures.join(" ")).toMatch(/quality case_count mismatch/);
  });
});
