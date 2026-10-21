import { describe, expect, it } from "vitest";
import type { SearchTelemetry } from "../src/lib/rag/rag-contracts";
import { searchTextChunkCandidates } from "../src/lib/rag/rag-candidate-sources";
import { createSearchTiming, finishSearch, measureSearchPhase } from "../src/lib/rag/rag-search-timing";
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
});
