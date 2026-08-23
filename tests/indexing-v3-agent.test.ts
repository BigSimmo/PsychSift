import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { sourceSegment } from "./helpers/source-contract";
import {
  agentFailureDecision,
  completionGateFromRow,
  deferralDecision,
  metadataNumber,
  missingArtifactPlan,
  parseJobStatusRpcResult,
  protectedPublicSourceChunkPage,
  publicSourceWorkerPolicyViolation,
  protectedPublicSourceChunkContents,
  scanProtectedPublicSourceChunkPages,
  shouldRunVisualArtifacts,
  type CompletionGateRow,
} from "../supabase/functions/indexing-v3-agent/behavior";
import { forbiddenPublicSourceIdentity } from "../supabase/functions/_shared/public-source-policy";

const completeGateRow: CompletionGateRow = {
  sections: 3,
  memory_cards: 8,
  generated_labels: 4,
  index_units: 12,
  title_embedding: true,
  summary_embedding: true,
  quality_extraction_quality: "good",
  quality_score: 0.91,
  missing: [],
  gate_passed: true,
};
function gateRow(overrides: Partial<CompletionGateRow> = {}): CompletionGateRow {
  return { ...completeGateRow, ...overrides };
}

describe("indexing-v3-agent behavior", () => {
  it("blocks protected or incomplete public-source policy before provider or artifact work", async () => {
    expect(
      publicSourceWorkerPolicyViolation(
        {
          corpus_scope: "australian_public",
          source_catalogue_key: "wa-health",
          source_policy_version: "australian-source-policy-v1",
          content_mode: "indexed_content",
          licence_policy: "public_index_permitted",
          public_source_lifecycle: "shadow",
          source_policy_checked: true,
        },
        true,
      ),
    ).toBe("protected_source_identity");
    expect(publicSourceWorkerPolicyViolation({ corpus_scope: "australian_public" }, false)).toBe(
      "public_source_policy_invalid",
    );

    const edgeSource = String(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(new URL("../supabase/functions/indexing-v3-agent/index.ts", import.meta.url), "utf8"),
      ),
    );
    const processStart = sourceSegment(
      edgeSource,
      "async function processJob",
      "let gate = await completionGate(job)",
      {
        label: "indexing-v3-agent public-source preflight",
      },
    );
    expect(processStart).toContain("assertPublicSourceWorkerPolicy(job)");
  });

  it("normalizes protected identities identically across acquisition and worker boundaries", () => {
    for (const value of [
      "Health<em>direct</em>",
      "Health direct",
      "Health&amp;direct",
      "Health&Tab;direct",
      "Health&NewLine;direct",
      "Health&#9direct",
      "Health&#9 direct",
      "Health&nbsp direct",
      "Australian Medicines Hand-book",
      "Australian Medicines Hand book",
      "Australian Medicines&Tab;Handbook",
      "Australian Medicines&#9Handbook",
      "Therapeutic\u200bGuidelines",
      "Therapeutic&NewLine;Guidelines",
      "Therapeutic&#10Guidelines",
    ]) {
      expect(forbiddenPublicSourceIdentity(value)).not.toBeNull();
    }
  });

  it("scans actual worker chunk rows through the shared protected-identity normalizer", async () => {
    for (const content of [
      "Health&Tab;direct guidance",
      "Health&#9direct guidance",
      "Health&nbsp direct guidance",
      "Australian Medicines&Tab;Handbook excerpt",
      "Australian Medicines&#9Handbook excerpt",
      "Therapeutic&NewLine;Guidelines advice",
      "Therapeutic&#10Guidelines advice",
    ]) {
      expect(protectedPublicSourceChunkContents([{ content }])).toBe(true);
    }

    const edgeSource = String(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(new URL("../supabase/functions/indexing-v3-agent/index.ts", import.meta.url), "utf8"),
      ),
    );
    const scan = sourceSegment(
      edgeSource,
      "async function assertPublicSourceWorkerPolicy",
      "async function processJob",
      {
        label: "indexing-v3-agent protected content scan",
      },
    );
    expect(scan).toContain("select chunk.content");
    expect(scan).toContain("scanProtectedPublicSourceChunkPages(");
    expect(scan).toContain("limit ${limit}");
    expect(scan).not.toContain("chunk.content ~*");
  });

  it("retains the concatenated 256-character stream across the real 500-row worker page boundary", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      content: index === 498 ? "Australian" : index === 499 ? "Medicines" : "x",
    }));
    const first = protectedPublicSourceChunkPage(firstPage, "");
    expect(first.containsProtectedSourceContent).toBe(false);
    expect(first.trailingContent).toContain("AustralianMedicines");

    const second = protectedPublicSourceChunkPage([{ content: "Handbook" }], first.trailingContent);
    expect(second.containsProtectedSourceContent).toBe(true);

    const pageReads: Array<[number, number]> = [];
    await expect(
      scanProtectedPublicSourceChunkPages(async (offset, limit) => {
        pageReads.push([offset, limit]);
        return offset === 0 ? firstPage : [{ content: "Handbook" }];
      }),
    ).resolves.toBe(true);
    expect(pageReads).toEqual([
      [0, 500],
      [500, 500],
    ]);

    const edgeSource = readFileSync(
      new URL("../supabase/functions/indexing-v3-agent/index.ts", import.meta.url),
      "utf8",
    );
    const scan = sourceSegment(
      edgeSource,
      "async function assertPublicSourceWorkerPolicy",
      "async function processJob",
      {
        label: "indexing-v3-agent paged protected-content scan",
      },
    );
    expect(scan).toContain("scanProtectedPublicSourceChunkPages(");
  });

  it("schedules agent retries until the attempt budget is exhausted", () => {
    const retry = agentFailureDecision({ attemptCount: 2, maxAttempts: 3, nowMs: 1_000, retryDelayMs: 30_000 });
    expect(retry).toEqual({
      shouldRetry: true,
      status: "retry_pending",
      jobStatus: "pending",
      enrichmentStatus: "pending",
      nextRunAt: "1970-01-01T00:00:31.000Z",
    });

    expect(agentFailureDecision({ attemptCount: 3, maxAttempts: 3, nowMs: 1_000, retryDelayMs: 30_000 })).toEqual({
      shouldRetry: false,
      status: "failed",
      jobStatus: "failed",
      enrichmentStatus: "failed",
      nextRunAt: null,
    });
  });
  it("maps canonical strict-gate rows into pass/fail completion decisions", () => {
    const complete = completionGateFromRow(gateRow());
    expect(complete.result).toBe("complete");
    expect(complete.missing).toEqual([]);
    expect(complete.counts).toEqual({
      sections: 3,
      memory_cards: 8,
      generated_labels: 4,
      index_units: 12,
    });
    expect(complete.presence).toEqual({ title_embedding: true, summary_embedding: true });

    const missingLabels = completionGateFromRow(
      gateRow({
        generated_labels: 0,
        missing: ["generated_labels"],
        gate_passed: false,
      }),
    );
    expect(missingLabels.result).toBe("deferred");
    expect(missingLabels.counts.generated_labels).toBe(0);
    expect(missingLabels.missing).toEqual(["generated_labels"]);
  });

  it("plans only the missing enrichment stages before expensive work", () => {
    const plan = missingArtifactPlan(
      completionGateFromRow(
        gateRow({
          sections: 0,
          index_units: 0,
          title_embedding: false,
          summary_embedding: true,
          missing: ["sections", "index_units", "title_embedding"],
          gate_passed: false,
        }),
      ),
    );

    expect(plan).toEqual({
      needs_sections: true,
      needs_memory: false,
      needs_labels: false,
      needs_index_units: true,
      needs_title_embedding: true,
      needs_summary_embedding: false,
      needs_core_embeddings: true,
      needs_quality_promotion: false,
    });
  });

  it("defers missing generated labels without falsely completing the job", () => {
    const gate = completionGateFromRow(
      gateRow({
        generated_labels: 0,
        missing: ["generated_labels"],
        gate_passed: false,
      }),
    );
    const plan = missingArtifactPlan(gate);
    const decision = deferralDecision({
      metadata: { indexing_v3_agent_deferral_count: 1 },
      gate,
      maxDeferrals: 6,
      nowMs: Date.UTC(2026, 5, 25, 12, 0, 0),
    });

    expect(plan.needs_labels).toBe(true);
    expect(decision.status).toBe("deferred");
    expect(decision.enrichment_status).toBe("pending");
    expect(decision.terminal).toBe(false);
    expect(decision.details).toEqual(
      expect.objectContaining({
        code: "completion_gate_deferred",
        missing: ["generated_labels"],
        deferral_count: 2,
        max_deferrals: 6,
      }),
    );
    expect(decision.next_run_at).toBe("2026-06-25T12:30:00.000Z");
  });

  it("treats missing sections as a terminal artifact problem after repair attempts fail", () => {
    const gate = completionGateFromRow(
      gateRow({
        sections: 0,
        memory_cards: 0,
        index_units: 0,
        missing: ["sections", "memory_cards", "index_units"],
        gate_passed: false,
      }),
    );
    const plan = missingArtifactPlan(gate);
    const decision = deferralDecision({
      metadata: { indexing_v3_agent_deferral_count: 0 },
      gate,
      maxDeferrals: 6,
      nowMs: Date.UTC(2026, 5, 25, 12, 0, 0),
    });

    expect(plan.needs_sections).toBe(true);
    expect(plan.needs_index_units).toBe(true);
    expect(plan.needs_memory).toBe(true);
    expect(decision.status).toBe("needs_enrichment_artifacts");
    expect(decision.enrichment_status).toBe("needs_enrichment_artifacts");
    expect(decision.next_run_at).toBeNull();
  });

  it("does not rerun visual extraction once generated visual units exist", () => {
    expect(shouldRunVisualArtifacts({ eligible_images: 0, generated_visual_units: 0 })).toBe(false);
    expect(shouldRunVisualArtifacts({ eligible_images: 3, generated_visual_units: 0 })).toBe(true);
    expect(shouldRunVisualArtifacts({ eligible_images: 3, generated_visual_units: 2 })).toBe(false);
  });

  it("promotes quality only when artifacts are complete but quality is stale", () => {
    const staleQuality = missingArtifactPlan(
      completionGateFromRow(
        gateRow({
          quality_extraction_quality: "partial",
          quality_score: 0.7,
        }),
      ),
    );
    const currentQuality = missingArtifactPlan(completionGateFromRow(gateRow()));

    expect(staleQuality.needs_quality_promotion).toBe(true);
    expect(currentQuality.needs_quality_promotion).toBe(false);
  });

  it("documents that local worker visual units satisfy visual artifact capture", async () => {
    const edgeSource = String(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(new URL("../supabase/functions/indexing-v3-agent/index.ts", import.meta.url), "utf8"),
      ),
    );

    expect(edgeSource).toContain("metadata->>'generated_by' = 'local-worker'");
    expect(edgeSource).toContain("metadata->>'source' = 'visual_intelligence'");
  });

  it("replaces every generated enrichment family inside one database transaction", async () => {
    const edgeSource = String(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(new URL("../supabase/functions/indexing-v3-agent/index.ts", import.meta.url), "utf8"),
      ),
    );
    const functionBody = (name: string, nextName: string) =>
      sourceSegment(edgeSource, `async function ${name}`, `async function ${nextName}`, {
        label: `indexing-v3-agent function ${name}`,
      });

    for (const [name, nextName] of [
      ["upsertMemoryCardsFromSections", "upsertSectionIndexUnits"],
      ["upsertSectionIndexUnits", "upsertVisualArtifacts"],
      ["upsertVisualArtifacts", "upsertCoreEmbeddingFields"],
      ["upsertCoreEmbeddingFields", "updateQuality"],
    ]) {
      const body = functionBody(name, nextName);
      expect(body).toContain("await sql.begin(async (tx) =>");
      expect(body).toContain("await tx`");
      expect(body.indexOf("delete from public.document_")).toBeLessThan(body.indexOf("insert into public.document_"));
    }
  });

  it("normalizes metadata counters for repeated idempotent runs", () => {
    expect(metadataNumber({ indexing_v3_agent_deferral_count: "4" }, "indexing_v3_agent_deferral_count")).toBe(4);
    expect(metadataNumber({ indexing_v3_agent_deferral_count: "bad" }, "indexing_v3_agent_deferral_count")).toBe(0);
    expect(metadataNumber(null, "indexing_v3_agent_deferral_count", 2)).toBe(2);
  });

  it("parses strict completion RPC rows returned as direct table columns", () => {
    const result = parseJobStatusRpcResult(
      {
        ok: true,
        gate_passed: true,
        status: "completed",
        missing: [],
      },
      "complete_strict_enrichment_job",
    );

    expect(result).toEqual({
      ok: true,
      gate_passed: true,
      status: "completed",
      missing: [],
    });
  });

  it("parses strict completion RPC rows returned as nested jsonb function columns", () => {
    const result = parseJobStatusRpcResult(
      {
        complete_strict_enrichment_job: {
          ok: true,
          gate_passed: true,
          status: "completed",
          missing: [],
        },
      },
      "complete_strict_enrichment_job",
    );

    expect(result).toEqual({
      ok: true,
      gate_passed: true,
      status: "completed",
      missing: [],
    });
  });

  it("treats null missing arrays from completion RPCs as no missing artifacts", () => {
    const result = parseJobStatusRpcResult(
      {
        complete_strict_enrichment_job: {
          ok: true,
          gate_passed: true,
          status: "completed",
          missing: null,
        },
      },
      "complete_strict_enrichment_job",
    );

    expect(result).toEqual({
      ok: true,
      gate_passed: true,
      status: "completed",
      missing: [],
    });
  });
});
