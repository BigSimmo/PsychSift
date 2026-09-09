import { describe, expect, it } from "vitest";
import { enrichmentRepairDecision, ingestionFailureDecision } from "../worker/behavior";

describe("ingestion worker behavior", () => {
  it("retries transient failures while preserving a previously indexed document", () => {
    const decision = ingestionFailureDecision({
      error: new Error("network connection reset"),
      attemptCount: 2,
      maxAttempts: 4,
      atomicReindex: true,
    });

    expect(decision).toMatchObject({
      retry: true,
      documentStatus: "indexed",
      stage: "retry scheduled after attempt 2/4",
      errorMessage: "network connection reset",
    });
    expect(decision.nextRunAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("fails closed for a partial generation write instead of automatically retrying", () => {
    const decision = ingestionFailureDecision({
      error: new Error('duplicate key value violates unique constraint "document_chunks_pkey"'),
      attemptCount: 1,
      maxAttempts: 4,
      atomicReindex: false,
    });

    expect(decision).toEqual({
      retry: false,
      documentStatus: "failed",
      stage: "needs recovery after partial index write",
      errorMessage:
        'duplicate key value violates unique constraint "document_chunks_pkey". Run npm run recover:ingestion -- --apply before retrying this document.',
    });
  });

  it("does not retry a transient failure after the attempt budget is exhausted", () => {
    expect(
      ingestionFailureDecision({
        error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
        attemptCount: 4,
        maxAttempts: 4,
        atomicReindex: false,
      }),
    ).toEqual({ retry: false, documentStatus: "failed", stage: "failed", errorMessage: "timeout" });
  });

  it("queues agent repair when optional writes fail despite inline enrichment succeeding", () => {
    expect(
      enrichmentRepairDecision({
        enrichmentStatus: "completed",
        enrichmentErrorMessage: null,
        optionalIssueCount: 2,
      }),
    ).toEqual({
      enrichmentStatus: "pending",
      enrichmentErrorMessage: "Optional index artifact writes failed; queued for indexing-v3-agent repair.",
      repairRequired: true,
      repairReason: "optional_index_write_issues",
      repairMessage: "Optional index artifact writes failed; queued for indexing-v3-agent repair.",
    });
  });

  it("marks a fully enriched generation complete without sticky repair metadata", () => {
    expect(
      enrichmentRepairDecision({
        enrichmentStatus: "completed",
        enrichmentErrorMessage: null,
        optionalIssueCount: 0,
      }),
    ).toMatchObject({ repairRequired: false, enrichmentStatus: "completed" });
  });
});
