import { describe, expect, it } from "vitest";
import type { SearchTelemetry } from "../src/lib/rag/rag-contracts";
import { searchTextChunkCandidates } from "../src/lib/rag/rag-candidate-sources";
import {
  createSearchTiming,
  finishSearch,
  measureSearchPhase,
  MAX_STAGE_NAME_LENGTH,
  MAX_STAGE_TIMELINE_ENTRIES,
  mergeNestedSearchStages,
  recordSearchStage,
} from "../src/lib/rag/rag-search-timing";
import type { SearchResult } from "../src/lib/types";

const DOC = "11111111-1111-4111-8111-111111111111";

function row(id: string, textRank: number): SearchResult {
  return {
    id,
    document_id: DOC,
    content: `content ${id}`,
    page_number: 1,
    chunk_index: 0,
    section_heading: null,
    file_name: "doc.pdf",
    title: "Doc",
    similarity: 0,
    text_rank: textRank,
    hybrid_score: textRank,
    image_ids: [],
    images: [],
    source_metadata: {},
  } as unknown as SearchResult;
}

/** Deterministic fake Supabase: rows depend only on the query text, so runs are comparable. */
function fakeSupabase(rowsFor: (queryText: string) => SearchResult[]) {
  const calls: string[] = [];
  const supabase = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push(`${name}:${String(args.query_text ?? args.input_query)}`);
      const data = name.startsWith("match_document_chunks_text") ? rowsFor(String(args.query_text)) : null;
      return Promise.resolve({ data, error: null });
    },
  };
  return { supabase: supabase as never, calls };
}

const scenarios: Record<string, (queryText: string) => SearchResult[]> = {
  // Deep primary pool anchored by a precise hit: follow-up variants are skipped (PT-02).
  strongPrimary: (q) =>
    q === "active community pt ed" ? Array.from({ length: 30 }, (_, i) => row(`p${i}`, i === 0 ? 2.7 : 0.1)) : [],
  // Weak primary pool: follow-up variants run.
  weakPrimary: (q) =>
    q === "active community pt ed"
      ? [row("p0", 0.2), row("p1", 0.1)]
      : [row(`f-${q.length}-0`, 0.15), row("p1", 0.12), row(`f-${q.length}-1`, 0.05)],
  // Every strict variant empty: trigram-correction + OR-relaxation fallbacks.
  empty: (q) => (q.includes(" OR ") ? [row("or0", 0.3), row("or1", 0.2)] : []),
};

const variants = [
  "active community pt ed",
  "active community pt ed pt patient patients pts ed emergency department",
  "active community emergency department pt ed",
];

async function run(scenario: keyof typeof scenarios, withTelemetry: boolean) {
  const { supabase, calls } = fakeSupabase(scenarios[scenario]);
  const telemetry = withTelemetry ? ({} as SearchTelemetry) : undefined;
  const results = await searchTextChunkCandidates({ supabase, queryVariants: variants, matchCount: 30, telemetry });
  return { results, calls, telemetry };
}

describe("text RPC per-variant timing telemetry is measurement-only", () => {
  for (const scenario of Object.keys(scenarios) as (keyof typeof scenarios)[]) {
    it(`returns identical results, order and RPC sequence with telemetry on (${scenario})`, async () => {
      const off = await run(scenario, false);
      const on = await run(scenario, true);
      expect(on.results.map((r) => r.id)).toEqual(off.results.map((r) => r.id));
      expect(on.results).toEqual(off.results);
      expect(on.calls).toEqual(off.calls);
      const timings = on.telemetry?.text_rpc_variant_timings ?? [];
      const ran = timings.filter((t) => t.ran);
      expect(ran.length).toBe(on.calls.filter((c) => c.startsWith("match_document_chunks_text")).length);
      for (const t of ran) {
        expect(t.rpc_ms).toBeGreaterThanOrEqual(0);
        expect(t.finished_offset_ms).toBeGreaterThanOrEqual(t.started_offset_ms ?? 0);
        expect(typeof t.row_count).toBe("number");
      }
    });
  }

  it("labels primary, run follow-ups, and skipped follow-ups", async () => {
    const strong = (await run("strongPrimary", true)).telemetry?.text_rpc_variant_timings ?? [];
    expect(strong.map((t) => [t.role, t.variant_index, t.ran, t.row_count])).toEqual([
      ["primary", 0, true, 30],
      ["follow_up", 1, false, null],
      ["follow_up", 2, false, null],
    ]);
    expect(strong[1]?.skipped_reason).toBe("primary_pool_strong");
    const weak = (await run("weakPrimary", true)).telemetry?.text_rpc_variant_timings ?? [];
    expect(weak.map((t) => [t.role, t.variant_index, t.ran])).toEqual([
      ["primary", 0, true],
      ["follow_up", 1, true],
      ["follow_up", 2, true],
    ]);
  });

  it("stage timeline does not alter the search payload", async () => {
    const timing = createSearchTiming();
    const value = await measureSearchPhase(timing, "memory_hydration", async () => 42);
    expect(value).toBe(42);
    const results = [row("a", 1), row("b", 0.5)];
    const out = finishSearch(timing, { results, telemetry: {} as SearchTelemetry });
    expect(out.results).toBe(results);
    expect(out.telemetry.retrieval_stage_timeline_ms?.map((s) => s.stage)).toEqual(["memory_hydration"]);
  });

  it("finishSearch never carries over a stale timeline when this request ran no stages", () => {
    const timing = createSearchTiming();
    const stale = {
      retrieval_stage_timeline_ms: [{ stage: "text_candidates", started_offset_ms: 0, finished_offset_ms: 9000 }],
    } as SearchTelemetry;
    const out = finishSearch(timing, { results: [], telemetry: stale });
    expect(out.telemetry.retrieval_stage_timeline_ms).toBeUndefined();
  });

  it("merges a nested (typo-corrected) search timeline onto the outer clock", () => {
    const timing = createSearchTiming();
    timing.startedAt = 1_000;
    timing.stages = [{ stage: "text_candidates", started_offset_ms: 0, finished_offset_ms: 50 }];
    mergeNestedSearchStages(
      timing,
      [{ stage: "text_candidates", started_offset_ms: 5, finished_offset_ms: 25 }],
      1_100,
    );
    expect(timing.stages).toEqual([
      { stage: "text_candidates", started_offset_ms: 0, finished_offset_ms: 50 },
      { stage: "nested:text_candidates", started_offset_ms: 105, finished_offset_ms: 125 },
    ]);
  });

  it("records the timing with rpc_error when the text RPC returns an error", async () => {
    const supabase = {
      rpc: () => Promise.resolve({ data: null, error: { message: "boom", code: "XX000" } }),
    } as never;
    const telemetry = {} as SearchTelemetry;
    const results = await searchTextChunkCandidates({ supabase, queryVariants: ["abc"], matchCount: 10, telemetry });
    expect(results).toEqual([]);
    const [primary] = telemetry.text_rpc_variant_timings ?? [];
    expect(primary).toMatchObject({ role: "primary", ran: true, rpc_error: true, row_count: 0 });
    expect(primary?.rpc_ms).toBeGreaterThanOrEqual(0);
  });

  it("keeps the variant timings, with rpc_error, when the text RPC throws", async () => {
    const supabase = {
      rpc: (name: string) =>
        name.startsWith("match_document_chunks_text")
          ? Promise.reject(new Error("socket hang up"))
          : Promise.resolve({ data: null, error: null }),
    } as never;
    const telemetry = {} as SearchTelemetry;
    await expect(
      searchTextChunkCandidates({ supabase, queryVariants: ["abc"], matchCount: 10, telemetry }),
    ).rejects.toThrow("socket hang up");
    const timings = telemetry.text_rpc_variant_timings ?? [];
    expect(timings).toHaveLength(1);
    expect(timings[0]).toMatchObject({ role: "primary", ran: true, rpc_error: true, row_count: 0 });
    expect(timings[0]?.finished_offset_ms).not.toBeNull();
  });

  it("times the trigram-corrected strict retry (corrected-search branch)", async () => {
    const supabase = {
      rpc: (name: string, args: Record<string, unknown>) => {
        if (name === "correct_clinical_query_terms")
          return Promise.resolve({ data: "clozapine monitoring", error: null });
        const data = args.query_text === "clozapine monitoring" ? [row("c0", 0.9)] : [];
        return Promise.resolve({ data, error: null });
      },
    } as never;
    const telemetry = {} as SearchTelemetry;
    const results = await searchTextChunkCandidates({
      supabase,
      queryVariants: ["clozapin monitoring"],
      matchCount: 10,
      telemetry,
    });
    expect(results.map((r) => r.id)).toEqual(["c0"]);
    expect((telemetry.text_rpc_variant_timings ?? []).map((t) => [t.role, t.ran, t.row_count])).toEqual([
      ["primary", true, 0],
      ["corrected", true, 1],
    ]);
  });

  it("caps the stage timeline length and stage name length", () => {
    const timing = createSearchTiming();
    for (let i = 0; i < MAX_STAGE_TIMELINE_ENTRIES + 20; i += 1) {
      recordSearchStage(timing, `stage_${i}_${"x".repeat(200)}`, timing.startedAt + i, timing.startedAt + i + 1);
    }
    mergeNestedSearchStages(timing, [{ stage: "late", started_offset_ms: 0, finished_offset_ms: 1 }], timing.startedAt);
    const out = finishSearch(timing, { results: [], telemetry: {} as SearchTelemetry });
    const stages = out.telemetry.retrieval_stage_timeline_ms ?? [];
    expect(stages).toHaveLength(MAX_STAGE_TIMELINE_ENTRIES);
    expect(stages.every((s) => s.stage.length <= MAX_STAGE_NAME_LENGTH)).toBe(true);
    expect(stages.some((s) => s.stage === "nested:late")).toBe(false);
  });

  it("caps nested:* stages and keeps timeline entries unique when a nested timeline is merged twice", () => {
    const timing = createSearchTiming();
    timing.startedAt = 1_000;
    const nested = [
      { stage: "text_candidates", started_offset_ms: 5, finished_offset_ms: 25 },
      { stage: "nested:vector_candidates", started_offset_ms: 6, finished_offset_ms: 30 },
    ];
    mergeNestedSearchStages(timing, nested, 1_100);
    mergeNestedSearchStages(timing, nested, 1_100);
    const keys = (timing.stages ?? []).map((s) => `${s.stage}|${s.started_offset_ms}|${s.finished_offset_ms}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect((timing.stages ?? []).map((s) => s.stage)).toEqual(["nested:text_candidates", "nested:vector_candidates"]);

    const flood = Array.from({ length: MAX_STAGE_TIMELINE_ENTRIES * 2 }, (_, i) => ({
      stage: `s${i}`,
      started_offset_ms: i,
      finished_offset_ms: i + 1,
    }));
    mergeNestedSearchStages(timing, flood, 1_000);
    expect(timing.stages).toHaveLength(MAX_STAGE_TIMELINE_ENTRIES);
    expect(timing.stages?.every((s) => s.stage.startsWith("nested:") && !s.stage.startsWith("nested:nested:"))).toBe(
      true,
    );
  });
});
