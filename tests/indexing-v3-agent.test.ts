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
      "Health&#100;irect",
      "Health&#x64;irect",
      "Health&#100irect",
      "Health&#x64irect",
      "Health&#0;direct",
      "Health&#1;direct",
      "Health&#55296;direct",
      "Health&#x110000;direct",
      "He&afr;lthdirect",
      "Healthd&ifr;rect",
      "Health&dd;irect",
      "Health&DifferentialD;irect",
      "Australian Medicines Hand-book",
      "Australian Medicines Hand book",
      "Australian Medicines&Tab;Handbook",
      "Australian Medicines&#9Handbook",
      "Australian Medicines Hand&#98;ook",
      "Australian Medicines H&afr;ndbook",
      "Therapeutic\u200bGuidelines",
      "Therapeutic&NewLine;Guidelines",
      "Therapeutic&#10Guidelines",
      "Therapeutic Guide&#108;ines",
      "Therapeu&tscr;ic Guidelines",
      "Health&direct",
      "Health&di!rect",
      "Health&ltdirect",
      "Health&gtdirect",
      "Therapeutic&Guidelines",
      "Australian&Medicines&Handbook",
      "Health<direct",
      "Health<!--direct",
      "Health< direct",
    ]) {
      expect(forbiddenPublicSourceIdentity(value)).not.toBeNull();
    }
  });

  it("scans actual worker chunk rows through the shared protected-identity normalizer", async () => {
    for (const content of [
      "Health&Tab;direct guidance",
      "Health&#9direct guidance",
      "Health&nbsp direct guidance",
      "Health&#100;irect guidance",
      "Health&#x64;irect guidance",
      "Health&#100irect guidance",
      "Health&#x64irect guidance",
      "Health&#0;direct guidance",
      "Health&#1;direct guidance",
      "Health&#55296;direct guidance",
      "Health&#x110000;direct guidance",
      "He&afr;lthdirect guidance",
      "Healthd&ifr;rect guidance",
      "Health&dd;irect guidance",
      "Health&DifferentialD;irect guidance",
      "Australian Medicines&Tab;Handbook excerpt",
      "Australian Medicines&#9Handbook excerpt",
      "Australian Medicines Hand&#98;ook excerpt",
      "Australian Medicines H&afr;ndbook excerpt",
      "Therapeutic&NewLine;Guidelines advice",
      "Therapeutic&#10Guidelines advice",
      "Therapeutic Guide&#108;ines advice",
      "Therapeu&tscr;ic Guidelines advice",
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

  it("pins the shared WHATWG decoder as an Edge-compatible direct dependency", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8")) as {
      packages?: Record<
        string,
        { dependencies?: Record<string, string>; version?: string; dev?: boolean; license?: string }
      >;
    };
    const denoLock = JSON.parse(readFileSync(new URL("../deno.lock", import.meta.url), "utf8")) as {
      workspace?: { packageJson?: { dependencies?: string[] } };
    };
    expect(manifest.dependencies?.entities).toBe("^8.0.0");
    expect(lock.packages?.[""]?.dependencies?.entities).toBe("^8.0.0");
    expect(lock.packages?.["node_modules/entities"]).toMatchObject({
      version: "8.0.0",
      license: "BSD-2-Clause",
    });
    expect(lock.packages?.["node_modules/entities"]?.dev).not.toBe(true);
    expect(denoLock.workspace?.packageJson?.dependencies).toContain("npm:entities@8");

    const policySource = readFileSync(
      new URL("../supabase/functions/_shared/public-source-policy.ts", import.meta.url),
      "utf8",
    );
    expect(policySource).toContain('import { decodeHTML } from "entities";');
    expect(policySource).not.toContain("jsdom");
  });

  it("retains protected identity state across the real 500-row worker page boundary", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      content: index === 498 ? "Australian" : index === 499 ? "Medicines" : "x",
    }));
    const first = protectedPublicSourceChunkPage(firstPage);
    expect(first.containsProtectedSourceContent).toBe(false);

    const second = protectedPublicSourceChunkPage([{ content: "Handbook" }], first.streamState);
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

  it("retains bounded content-free scanner state across arbitrarily long removable separators", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      content: index === 498 ? "Health" : index === 499 ? ".".repeat(300) : "x",
    }));
    const finalPage = [{ content: "direct" }];
    const first = protectedPublicSourceChunkPage(firstPage);
    const second = protectedPublicSourceChunkPage(finalPage, first.streamState);
    const pageReads: Array<[number, number]> = [];
    const paged = await scanProtectedPublicSourceChunkPages(async (offset, limit) => {
      pageReads.push([offset, limit]);
      return offset === 0 ? firstPage : finalPage;
    });

    expect(protectedPublicSourceChunkContents([...firstPage, ...finalPage])).toBe(true);
    const snapshot = (first.streamState as unknown as { snapshot(): Record<string, unknown> }).snapshot();
    const veryLong = protectedPublicSourceChunkPage([{ content: ".".repeat(100_000) }], first.streamState).streamState;
    const veryLongSnapshot = (veryLong as unknown as { snapshot(): Record<string, unknown> }).snapshot();
    expect(Object.keys(veryLongSnapshot)).toEqual(Object.keys(snapshot));
    expect(
      Object.values(veryLongSnapshot).every((value) => typeof value === "number" || typeof value === "boolean"),
    ).toBe(true);
    expect(second.containsProtectedSourceContent).toBe(true);
    expect(paged).toBe(true);
    expect(pageReads).toEqual([
      [0, 500],
      [500, 500],
    ]);
  });

  it("preserves spaced-token identity state across removable formatting characters", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      content: index === 498 ? "e" : index === 499 ? "\u200b".repeat(300) : ".",
    }));
    const finalPage = [{ content: "TG" }];

    expect(protectedPublicSourceChunkContents([...firstPage, ...finalPage])).toBe(true);
    await expect(
      scanProtectedPublicSourceChunkPages(async (offset) => (offset === 0 ? firstPage : finalPage)),
    ).resolves.toBe(true);
  });

  it("preserves a split named character reference at the worker page boundary", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      content: index === 499 ? "He&af" : "x",
    }));
    const finalPage = [{ content: "r;lthdirect" }];
    const pageReads: Array<[number, number]> = [];

    await expect(
      scanProtectedPublicSourceChunkPages(async (offset, limit) => {
        pageReads.push([offset, limit]);
        return offset === 0 ? firstPage : finalPage;
      }),
    ).resolves.toBe(true);
    expect(pageReads).toEqual([
      [0, 500],
      [500, 500],
    ]);
  });

  it("streams unlimited references, tags, and comments across worker pages", async () => {
    const fixtures = [
      [
        Array.from({ length: 500 }, (_, index) => ({
          content: index === 498 ? "Health&#" : index === 499 ? "0".repeat(300) : ".",
        })),
        [{ content: "100;irect" }],
      ],
      [
        Array.from({ length: 500 }, (_, index) => ({
          content:
            index === 498 ? "Health<" : index === 499 ? `section data-safe="${"a".repeat(300)}>still-quoted"` : ".",
        })),
        [{ content: ">direct" }],
      ],
      [
        Array.from({ length: 500 }, (_, index) => ({
          content: index === 499 ? "Health<!--" : ".",
        })),
        Array.from({ length: 500 }, (_, index) => ({
          content: index === 0 ? `${"a".repeat(300)}>still-comment` : ".",
        })),
        [{ content: "-->direct" }],
      ],
    ] as const;

    for (const pages of fixtures) {
      const reads: Array<[number, number]> = [];
      expect(protectedPublicSourceChunkContents(pages.flat())).toBe(true);
      await expect(
        scanProtectedPublicSourceChunkPages(async (offset, limit) => {
          reads.push([offset, limit]);
          return pages[Math.floor(offset / 500)] ?? [];
        }),
      ).resolves.toBe(true);
      expect(reads).toEqual(pages.map((_, index) => [index * 500, 500]));
    }
  });

  it("continues named, numeric, and spaced-acronym identity state across three worker pages", async () => {
    const fixtures = [
      ["He&af", "r;", ".", "lthdirect"],
      ["Health&#x6", "4", ".", "irect"],
      ["e&ts", "cr;", "\u200b", "G"],
    ] as const;

    for (const [pageOneTail, pageTwoStart, pageTwoSeparator, pageThreeStart] of fixtures) {
      const pages = [
        Array.from({ length: 500 }, (_, index) => ({ content: index === 499 ? pageOneTail : "." })),
        Array.from({ length: 500 }, (_, index) => ({
          content: index === 0 ? pageTwoStart : pageTwoSeparator,
        })),
        [{ content: pageThreeStart }],
      ];
      const reads: Array<[number, number]> = [];

      expect(protectedPublicSourceChunkContents(pages.flat())).toBe(true);
      await expect(
        scanProtectedPublicSourceChunkPages(async (offset, limit) => {
          reads.push([offset, limit]);
          return pages[Math.floor(offset / 500)] ?? [];
        }),
      ).resolves.toBe(true);
      expect(reads).toEqual([
        [0, 500],
        [500, 500],
        [1000, 500],
      ]);
    }
  });

  it("preserves malformed entity and markup text across real worker pages", async () => {
    for (const value of [
      "Health&direct",
      "Health&di!rect",
      "Health&ltdirect",
      "Health&gtdirect",
      "Therapeutic&Guidelines",
      "Australian&Medicines&Handbook",
      "Health<direct",
      "Health<!--direct",
      "Health< direct",
    ]) {
      const reads: Array<[number, number]> = [];
      await expect(
        scanProtectedPublicSourceChunkPages(async (offset, limit) => {
          reads.push([offset, limit]);
          return offset < value.length ? [{ content: value[offset] ?? "" }] : [];
        }, 1),
      ).resolves.toBe(true);
      expect(reads.length).toBeGreaterThan(1);
    }
  });

  it("keeps malformed lexical speculation fixed-size and content-free", () => {
    const entityState = protectedPublicSourceChunkPage([{ content: `Health&di${"x".repeat(100_000)}` }]).streamState;
    const markupState = protectedPublicSourceChunkPage([
      { content: `Health<direct${"x".repeat(100_000)}` },
    ]).streamState;
    const legacyCheckpointState = protectedPublicSourceChunkPage([{ content: "Health&lt" }]).streamState;
    const checkpointBeforeExcess = legacyCheckpointState.snapshot();
    const checkpointAfterExcess = protectedPublicSourceChunkPage(
      [{ content: "d".repeat(100_000) }],
      legacyCheckpointState,
    ).streamState.snapshot();
    const entitySnapshot = entityState.snapshot();
    const markupSnapshot = markupState.snapshot();

    expect(Object.keys(entitySnapshot)).toEqual(Object.keys(markupSnapshot));
    expect(Object.keys(checkpointBeforeExcess)).toEqual(Object.keys(checkpointAfterExcess));
    expect(checkpointBeforeExcess.entityCheckpointCount).toBeGreaterThan(0);
    expect(checkpointAfterExcess.entityCheckpointCount).toBeLessThanOrEqual(
      checkpointAfterExcess.entityCheckpointLimit,
    );
    for (const snapshot of [entitySnapshot, markupSnapshot, checkpointBeforeExcess, checkpointAfterExcess]) {
      expect(Object.values(snapshot).every((value) => typeof value === "number" || typeof value === "boolean")).toBe(
        true,
      );
      expect(JSON.stringify(snapshot).length).toBeLessThan(1_024);
    }
    expect(Object.values(entityState).every((value) => typeof value === "function")).toBe(true);
    expect(Object.values(markupState).every((value) => typeof value === "function")).toBe(true);
    expect(markupState.finish()).toBe("healthdirect");
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
