import { describe, expect, it } from "vitest";

import {
  clinicalQualityTriageMutationSchema,
  projectContentMaturity,
  projectQualityQueue,
  projectSourceImpact,
  qualitySignalTypeForFeedback,
  ragAnswerFeedbackRowSchema,
} from "@/lib/clinical-quality-dashboard";

const feedback = ragAnswerFeedbackRowSchema.parse({
  id: "00000000-0000-4000-8000-000000000001",
  interaction_id: "00000000-0000-4000-8000-000000000002",
  answer_hash: "sha256:abc",
  feedback_category: "unsupported_answer",
  source_ids: ["00000000-0000-4000-8000-000000000010"],
  cited_source_ids: [],
  created_at: "2026-08-23T02:00:00.000Z",
});

describe("clinical quality dashboard projections", () => {
  it("keeps implementation, review, support, and currency distinct and preserves unknowns", () => {
    const bands = projectContentMaturity(
      ["dictionary", "services", "forms", "therapies", "differentials", "specifiers"].map((area, index) => ({
        area: area as "dictionary",
        total: 10,
        implemented: index === 0 ? null : 10,
        clinicalReviewed: 2,
        clinicalOverdue: 1,
        sourceSupported: 6,
        sourcePartiallySupported: 2,
        sourceCurrent: 5,
        sourceReviewDue: 1,
        sourceOverdue: 2,
        asOf: "2026-08-23T00:00:00.000Z",
        evidenceSource: `static:${area}`,
      })),
    );

    expect(bands).toHaveLength(6);
    expect(bands[0]).toMatchObject({
      implementation: { available: null },
      clinicalReview: { reviewed: 2, pending: 7, overdue: 1, unknown: 0 },
      sourceSupport: { supported: 6, partial: 2, unknown: 2 },
      sourceCurrency: { current: 5, reviewDue: 1, overdue: 2, unknown: 2 },
      evidence: { state: "partial", source: "static:dictionary" },
    });
  });

  it("projects a privacy-safe queue without query, answer, or excerpt fields", () => {
    const queue = projectQualityQueue({
      feedbackRows: [feedback],
      retrievalRows: [],
      evaluationRows: [],
      triageRows: [],
      chunkDocumentRows: [
        {
          id: "00000000-0000-4000-8000-000000000010",
          document_id: "00000000-0000-4000-8000-000000000099",
        },
      ],
      triageState: "complete",
    });
    expect(queue[0]).toMatchObject({
      signalType: "unsupported_claim",
      signalId: feedback.id,
      feedbackId: feedback.id,
      priority: "high",
      triage: { status: "untriaged" },
    });
    expect(JSON.stringify(queue[0])).not.toMatch(/query|excerpt|answerText|patient/i);
    expect(() => ragAnswerFeedbackRowSchema.parse({ ...feedback, query: "sensitive text" })).toThrow();
  });

  it("shows administrators a record report's page, slug and note, and defaults older rows to answers", () => {
    const recordReport = ragAnswerFeedbackRowSchema.parse({
      ...feedback,
      id: "00000000-0000-4000-8000-000000000003",
      feedback_category: "outdated_guidance",
      record_type: "medication",
      record_id: "lithium",
      note: "Synthetic note: monitoring interval differs.",
    });
    const queue = projectQualityQueue({
      feedbackRows: [feedback, recordReport],
      retrievalRows: [],
      evaluationRows: [],
      triageRows: [],
      triageState: "complete",
    });
    expect(queue.find((item) => item.signalId === recordReport.id)).toMatchObject({
      recordType: "medication",
      recordId: "lithium",
      note: "Synthetic note: monitoring interval differs.",
    });
    expect(queue.find((item) => item.signalId === feedback.id)).toMatchObject({
      recordType: "answer",
      recordId: null,
      note: null,
    });
    expect(() => ragAnswerFeedbackRowSchema.parse({ ...recordReport, note: "a".repeat(501) })).toThrow();
    expect(() => ragAnswerFeedbackRowSchema.parse({ ...recordReport, record_type: "pharmacy" })).toThrow();
  });

  it("includes retrieval and persisted evaluation failures without query or result text", () => {
    const queue = projectQualityQueue({
      feedbackRows: [],
      retrievalRows: [
        {
          id: "00000000-0000-4000-8000-000000000040",
          created_at: "2026-08-23T02:00:00.000Z",
          selected_document_ids: [],
          is_miss: true,
          miss_reason: "retrieval_rpc_error",
        },
      ],
      evaluationRows: [
        {
          id: "00000000-0000-4000-8000-000000000050",
          case_id: "00000000-0000-4000-8000-000000000051",
          document_id: "00000000-0000-4000-8000-000000000010",
          passed: false,
          top_hit: false,
          matched_count: 0,
          created_at: "2026-08-23T01:00:00.000Z",
        },
      ],
      triageRows: [],
      triageState: "complete",
    });
    expect(queue.map((item) => item.signalType)).toEqual(["retrieval_failure", "evaluation_failure"]);
    expect(JSON.stringify(queue)).not.toMatch(/query|resultText|patient/i);
  });

  it("routes wrong-source feedback into the source-conflict workflow", () => {
    const queue = projectQualityQueue({
      feedbackRows: [
        {
          ...feedback,
          id: "00000000-0000-4000-8000-000000000060",
          feedback_category: "wrong_source",
        },
      ],
      retrievalRows: [],
      evaluationRows: [],
      triageRows: [],
      triageState: "complete",
    });
    expect(queue[0]).toMatchObject({ signalType: "source_conflict", category: "wrong_source" });
  });

  it("does not infer untriaged when the workflow read is sampled", () => {
    const queue = projectQualityQueue({
      feedbackRows: [feedback],
      retrievalRows: [],
      evaluationRows: [],
      triageRows: [],
      triageState: "partial",
    });
    expect(queue[0]?.triage.status).toBe("unknown");
  });

  it("derives deterministic source priority from review state and privacy-safe reach", () => {
    const impact = projectSourceImpact({
      sourceReviews: [
        {
          id: "00000000-0000-4000-8000-000000000011",
          document_id: "00000000-0000-4000-8000-000000000010",
          decision: "superseded",
          new_document_status: "superseded",
          new_validation_status: "review_due",
          replacement_document_id: null,
          review_date: "2026-08-23",
          created_at: "2026-08-23T01:00:00.000Z",
        },
      ],
      registryLinks: [
        {
          document_id: "00000000-0000-4000-8000-000000000010",
          record_id: "00000000-0000-4000-8000-000000000020",
        },
      ],
      registryRecords: [{ id: "00000000-0000-4000-8000-000000000020", kind: "service", route: "/services/example" }],
      retrievalLogs: [
        {
          id: "00000000-0000-4000-8000-000000000030",
          created_at: "2026-08-23T01:30:00.000Z",
          selected_document_ids: ["00000000-0000-4000-8000-000000000010"],
          is_miss: false,
          miss_reason: null,
        },
      ],
      feedbackRows: [feedback],
      chunkDocumentRows: [
        {
          id: "00000000-0000-4000-8000-000000000010",
          document_id: "00000000-0000-4000-8000-000000000010",
        },
      ],
    });

    expect(impact[0]).toMatchObject({
      priority: "critical",
      retrievalReach: 1,
      feedbackReach: 1,
      affectedAreas: ["services"],
    });
  });

  it("resolves chunk feedback references to documents before calculating source reach", () => {
    const impact = projectSourceImpact({
      sourceReviews: [
        {
          id: "00000000-0000-4000-8000-000000000011",
          document_id: "00000000-0000-4000-8000-000000000099",
          decision: "superseded",
          new_document_status: "superseded",
          new_validation_status: "review_due",
          replacement_document_id: null,
          review_date: "2026-08-23",
          created_at: "2026-08-23T01:00:00.000Z",
        },
      ],
      registryLinks: [],
      registryRecords: [],
      retrievalLogs: [],
      feedbackRows: [feedback],
      chunkDocumentRows: [
        {
          id: "00000000-0000-4000-8000-000000000010",
          document_id: "00000000-0000-4000-8000-000000000099",
        },
      ],
    });
    expect(impact[0]).toMatchObject({ documentId: "00000000-0000-4000-8000-000000000099", feedbackReach: 1 });
  });

  it("keeps active triage visible when its older source signal cannot be hydrated", () => {
    const queue = projectQualityQueue({
      feedbackRows: [],
      retrievalRows: [],
      evaluationRows: [],
      triageRows: [
        {
          signal_type: "retrieval_failure",
          signal_id: "00000000-0000-4000-8000-000000000080",
          status: "awaiting_retest",
          owner_role: "engineering",
          owner_user_id: null,
          resolution_code: null,
          retest_reference: "eval:2026-08-23",
          updated_by: "00000000-0000-4000-8000-000000000081",
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-08-23T00:00:00.000Z",
          resolved_at: null,
        },
      ],
      triageState: "complete",
    });
    expect(queue[0]).toMatchObject({
      signalType: "retrieval_failure",
      category: "source_signal_unavailable",
      triage: { status: "awaiting_retest" },
    });
  });

  it.each([
    ["verified", "answer_feedback"],
    ["needs_correction", "answer_feedback"],
    ["source_insufficient", "unsupported_claim"],
    ["wrong_source", "source_conflict"],
    ["missing_source", "unsupported_claim"],
    ["unsupported_answer", "unsupported_claim"],
    ["numeric_error", "unsupported_claim"],
    ["outdated_guidance", "unsupported_claim"],
  ] as const)("maps persisted feedback category %s to %s", (category, expected) => {
    expect(qualitySignalTypeForFeedback(category)).toBe(expected);
    expect(() => ragAnswerFeedbackRowSchema.parse({ ...feedback, feedback_category: category })).not.toThrow();
  });

  it("requires resolution and retest evidence for terminal workflow transitions", () => {
    expect(() =>
      clinicalQualityTriageMutationSchema.parse({
        signalType: "unsupported_claim",
        signalId: feedback.id,
        status: "resolved",
        ownerRole: "clinical_governance",
      }),
    ).toThrow(/resolution code/i);
    expect(() =>
      clinicalQualityTriageMutationSchema.parse({
        signalType: "retrieval_failure",
        signalId: feedback.id,
        status: "awaiting_retest",
        ownerRole: "engineering",
      }),
    ).toThrow(/retest reference/i);
  });
});
