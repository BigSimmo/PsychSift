import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { ingestionProviderEgressAvailability } from "../supabase/functions/_shared/unavailable-ingestion-provider-egress";

import { sourceFrom, sourceSegment } from "./helpers/source-contract";
import {
  agentFailureDecision,
  completionGateFromRow,
  deferralDecision,
  isAllowedAgentMethod,
  metadataNumber,
  missingArtifactPlan,
  parseAgentClaimLimit,
  parseJobStatusRpcResult,
  runClaimedJobBatch,
  shouldRunVisualArtifacts,
  type CompletionGateRow,
} from "../supabase/functions/indexing-v3-agent/behavior";

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

  it("replaces every generated enrichment family through one fenced database function", async () => {
    const edgeSource = String(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(new URL("../supabase/functions/indexing-v3-agent/index.ts", import.meta.url), "utf8"),
      ),
    );
    const functionBody = (name: string, nextName: string) =>
      sourceSegment(edgeSource, `async function ${name}`, `async function ${nextName}`, {
        label: `indexing-v3-agent function ${name}`,
      });

    const schema = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
    );
    for (const [name, nextName, rpc] of [
      ["upsertMemoryCardsFromSections", "upsertSectionIndexUnits", "replace_indexing_v3_memory_cards"],
      ["upsertSectionIndexUnits", "upsertVisualArtifacts", "replace_indexing_v3_sections"],
      ["upsertVisualArtifacts", "upsertCoreEmbeddingFields", "replace_indexing_v3_visual_artifacts"],
      ["upsertCoreEmbeddingFields", "updateQuality", "replace_indexing_v3_core_embeddings"],
    ]) {
      const body = functionBody(name, nextName);
      expect(body).toContain(`await edgeMutation(job, "${rpc}"`);
      expect(body).not.toMatch(/\b(?:delete from|insert into) public\.document_/i);
      const replacement = sourceSegment(schema, `create or replace function public.${rpc}(`, "end $$;", {
        label: `indexing-v3-agent atomic replacement ${rpc}`,
      });
      const fenceCheck = replacement.indexOf("public.assert_current_ingestion_attempt(p_fence,");
      const deletion = replacement.indexOf("delete from public.document_");
      const insertion = replacement.indexOf("insert into public.document_");
      expect(fenceCheck).toBeGreaterThanOrEqual(0);
      expect(deletion).toBeGreaterThan(fenceCheck);
      expect(insertion).toBeGreaterThan(deletion);
      expect(replacement).toContain("'indexing_v3_attempt_required'");
      expect(replacement).not.toMatch(/exception\s+when/i);
    }
  });

  // #W98GR7 claimed the agent deletes an artifact family BEFORE calling OpenAI, so a
  // provider outage leaves the family permanently empty. It does the opposite, and the
  // assertion above does not prove it: that one pins delete-before-insert INSIDE the
  // transaction, and would stay green if the embedding call were moved inside `sql.begin`,
  // which is exactly the arrangement the issue describes.
  //
  // This pins the ordering the refutation actually rests on. The `await embeddingBatch(...)`
  // completes before the fenced replacement RPC, so an outage throws before any delete
  // happens. The database function above performs the delete and insert atomically.
  // Static source assertion like its neighbour, because index.ts is
  // Deno-runtime code Vitest cannot execute — worth saying plainly rather than implying
  // behavioural coverage that does not exist.
  it("calls OpenAI before it deletes anything, so an outage cannot empty a family", async () => {
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
      const embedding = body.indexOf("await embeddingBatch(");
      const transaction = body.indexOf('await edgeMutation(job, "replace_indexing_v3_');
      expect(embedding, `${name} must call embeddingBatch`).toBeGreaterThanOrEqual(0);
      expect(transaction, `${name} must call the fenced replacement`).toBeGreaterThanOrEqual(0);
      expect(embedding, `${name} must await OpenAI before the replacement`).toBeLessThan(transaction);
      // And no second embedding call inside the transaction, which would reintroduce the
      // reported failure mode for the part of the family written after it.
      expect(body.slice(transaction)).not.toContain("await embeddingBatch(");
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

describe("indexing-v3-agent claimed-batch request loop (L13)", () => {
  type Job = { id: string };

  it("refuses an unavailable adapter before claiming work while preserving method and authorization checks", async () => {
    const source = readFileSync(new URL("../supabase/functions/indexing-v3-agent/index.ts", import.meta.url), "utf8");
    const ast = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const serveCalls = ast.statements.flatMap((statement) => {
      if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return [];
      const call = statement.expression;
      return ts.isPropertyAccessExpression(call.expression) && call.expression.getText(ast) === "Deno.serve"
        ? [call]
        : [];
    });
    expect(serveCalls).toHaveLength(1);
    const callback = serveCalls[0]!.arguments[1]!;
    expect(ts.isArrowFunction(callback)).toBe(true);
    const javascript = ts.transpileModule(`(${callback.getText(ast)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const sql = vi.fn(() => {
      throw new Error("claim must not run");
    });
    const processJob = vi.fn(() => {
      throw new Error("processing must not run");
    });
    const markJobFailure = vi.fn(() => {
      throw new Error("failure mutation must not run");
    });
    const authorizeRequest = vi.fn(async () => null as Response | null);
    const handler = runInNewContext(javascript, {
      Response,
      isAllowedAgentMethod,
      authorizeRequest,
      ingestionProviderEgressAvailability,
      sql,
      processJob,
      markJobFailure,
    }) as (request: Request) => Promise<Response>;

    expect((await handler(new Request("https://example.invalid/index", { method: "GET" }))).status).toBe(405);
    expect(authorizeRequest).not.toHaveBeenCalled();
    authorizeRequest.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
    expect((await handler(new Request("https://example.invalid/index", { method: "POST" }))).status).toBe(401);
    const unavailable = await handler(new Request("https://example.invalid/index", { method: "POST" }));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      ok: false,
      error: "provider_egress_adapter_unavailable",
      claimed: 0,
      processed: 0,
      failed: 0,
    });
    expect(sql).not.toHaveBeenCalled();
    expect(processJob).not.toHaveBeenCalled();
    expect(markJobFailure).not.toHaveBeenCalled();
  });

  it("does not strand the rest of the claimed batch when recording one job's failure throws", async () => {
    const processed: string[] = [];
    const failureAttempts: string[] = [];

    const outcome = await runClaimedJobBatch<Job>([{ id: "a" }, { id: "b" }, { id: "c" }], {
      processJob: async (job) => {
        if (job.id === "a") throw new Error("stage 3 blew up");
        processed.push(job.id);
        return { status: "completed", missing: [] };
      },
      markJobFailure: async (job) => {
        failureAttempts.push(job.id);
        // update_indexing_v3_agent_job_status returned ok:false, or the DB was
        // unreachable while recording the first failure of the batch.
        throw new Error("update_indexing_v3_agent_job_status returned ok:false");
      },
    });

    // The whole point: siblings b and c must still be processed rather than
    // left `processing` under a lock until the 45-minute stale reclaim.
    expect(processed).toEqual(["b", "c"]);
    expect(failureAttempts).toEqual(["a"]);
    expect(outcome.processed).toBe(2);
    expect(outcome.failed).toBe(1);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]?.job).toEqual({ id: "a" });
    expect(outcome.failures[0]?.error).toBe("stage 3 blew up");
    expect(outcome.failures[0]?.failure_record_error).toBe("update_indexing_v3_agent_job_status returned ok:false");
  });

  it("counts completions, deferrals and failures across the batch", async () => {
    const outcome = await runClaimedJobBatch<Job>([{ id: "a" }, { id: "b" }, { id: "c" }], {
      processJob: async (job) => {
        if (job.id === "b") return { status: "deferred", missing: ["generated_labels"] };
        if (job.id === "c") throw new Error("boom");
        return { status: "completed", missing: [] };
      },
      markJobFailure: async () => undefined,
    });

    expect(outcome).toEqual({
      processed: 1,
      deferred: 1,
      failed: 1,
      deferrals: [{ job: { id: "b" }, missing: ["generated_labels"] }],
      failures: [{ job: { id: "c" }, error: "boom", failure_record_error: null }],
    });
  });

  it("rejects a NaN limit instead of casting it into the claim RPC", () => {
    expect(parseAgentClaimLimit("abc")).toBe(8);
    expect(parseAgentClaimLimit("")).toBe(8);
    expect(parseAgentClaimLimit(null)).toBe(8);
    expect(parseAgentClaimLimit("Infinity")).toBe(8);
    expect(parseAgentClaimLimit("0")).toBe(1);
    expect(parseAgentClaimLimit("-5")).toBe(1);
    expect(parseAgentClaimLimit("12.7")).toBe(12);
    expect(parseAgentClaimLimit("999")).toBe(50);
    expect(parseAgentClaimLimit("8")).toBe(8);
  });

  it("accepts only POST on the mutating claim endpoint", async () => {
    expect(isAllowedAgentMethod("POST")).toBe(true);
    expect(isAllowedAgentMethod("GET")).toBe(false);
    expect(isAllowedAgentMethod("HEAD")).toBe(false);
    expect(isAllowedAgentMethod("DELETE")).toBe(false);

    const edgeSource = String(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(new URL("../supabase/functions/indexing-v3-agent/index.ts", import.meta.url), "utf8"),
      ),
    );
    const handler = sourceFrom(edgeSource, "Deno.serve({ port:", {
      label: "indexing-v3-agent request handler",
    });
    expect(handler).toContain("isAllowedAgentMethod(req.method)");
    expect(handler).toContain("parseAgentClaimLimit(");
    expect(handler).toContain("runClaimedJobBatch(");
    // The unguarded `await markJobFailure(job, msg)` in the catch is what
    // stranded the batch; it must not come back.
    expect(handler).not.toContain("await markJobFailure(job, msg)");
  });
});
