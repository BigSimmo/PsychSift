import { describe, expect, it } from "vitest";
import { sourceSegment } from "./helpers/source-contract";
import { enrichmentRepairDecision, ingestionFailureDecision, visionImageRejectionSkipReason } from "../worker/behavior";

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

describe("vision per-image error isolation (L12)", () => {
  class ProviderError extends Error {
    details: { code: string };
    constructor(message: string, code: string) {
      super(message);
      this.name = "PublicApiError";
      this.details = { code };
    }
  }

  it("isolates a non-retryable provider rejection as a skip reason for that image", () => {
    expect(
      visionImageRejectionSkipReason(
        new ProviderError(
          "OpenAI rejected the request. Check the model, schema, and input configuration.",
          "openai_invalid_request",
        ),
      ),
    ).toBe("vision provider rejected this image (openai_invalid_request)");

    expect(
      visionImageRejectionSkipReason(
        new ProviderError("OpenAI could not complete the response because it was filtered.", "openai_content_filtered"),
      ),
    ).toBe("vision provider rejected this image (openai_content_filtered)");

    expect(visionImageRejectionSkipReason(new Error("You uploaded an unsupported image. Please retry."))).toBe(
      "vision provider rejected this image (unsupported or unreadable image data)",
    );
  });

  it("never leaks the provider's raw message into the recorded skip reason", () => {
    const reason = visionImageRejectionSkipReason(
      new ProviderError("invalid image: sk-secret-looking-token in payload", "openai_invalid_request"),
    );
    expect(reason).not.toBeNull();
    expect(reason).not.toContain("sk-secret-looking-token");
  });

  it("propagates transient and unknown failures so the document still retries", () => {
    // A rate limit or timeout must NOT be swallowed as a per-image skip: silently
    // dropping every image during an outage is worse than failing the job.
    expect(visionImageRejectionSkipReason(new Error("OpenAI is rate limited. Retry in a moment."))).toBeNull();
    expect(visionImageRejectionSkipReason(new Error("fetch failed"))).toBeNull();
    expect(visionImageRejectionSkipReason(new Error("ETIMEDOUT"))).toBeNull();
    expect(
      visionImageRejectionSkipReason(new ProviderError("OpenAI service error. Retry shortly.", "openai_service_error")),
    ).toBeNull();
    expect(visionImageRejectionSkipReason(new Error("something else went wrong"))).toBeNull();
    expect(visionImageRejectionSkipReason(null)).toBeNull();
  });

  it("routes the worker's per-task vision call through the isolation guard", async () => {
    // The captioning stage moved out of worker/main.ts into worker/image-captioning.ts.
    const source = String(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(new URL("../worker/image-captioning.ts", import.meta.url), "utf8"),
      ),
    );
    // Fenced leases: the vision call now runs inside runIngestionPreparedWork (lease heartbeat
    // + attempt signal), and terminal egress/abort errors are rethrown before the L12 skip.
    const window = sourceSegment(
      source,
      "classification = await runIngestionPreparedWork(",
      "return { task, classification",
      {
        label: "worker per-task vision call",
      },
    );
    expect(window).toContain("classifyAndCaptionImageFromBase64({");
    expect(window).toContain("visionImageRejectionSkipReason(");
    expect(window).toContain("visionRejectedClassification(");
    expect(window.indexOf("rethrowTerminalProviderError(error);")).toBeGreaterThan(-1);
    expect(window.indexOf("rethrowTerminalProviderError(error);")).toBeLessThan(
      window.indexOf("visionImageRejectionSkipReason("),
    );
  });
});
