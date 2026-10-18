/**
 * Pins Supabase round-trip counts for the offline answer path (ledger `#098`).
 *
 * The 2026-07-28 latency audit argued every finding from reading code, and the
 * fixes that landed in PR #1377 were verified the same way. Nothing pinned the
 * resulting counts, so a later refactor could add a round trip to a hot path and
 * no gate would notice. These budgets exist to make that a red gate.
 *
 * **The numbers here are measured, not derived.** They record what the path
 * currently does. A failure therefore means "the traffic changed" — which is
 * information, not automatically a defect. The correct response is to look at
 * the printed breakdown and decide whether the change is intended, then update
 * the budget in the same commit as the change that moved it. Do not relax a
 * budget to make an unexplained failure pass; that converts this guard back into
 * the inference it replaced.
 *
 * Scope: what travels through the mocked `@/lib/supabase/admin` client. Traffic
 * via another client, a direct `fetch`, or a provider SDK is invisible here — so
 * these are claims about this client's round trips, not total request cost.
 *
 * Provider-free and DB-free.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { countSupabaseRoundTrips } from "./helpers/supabase-round-trip-counter";
import type { SearchResult } from "../src/lib/types";

function source(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "clozapine-chunk-1",
    document_id: "clozapine-doc",
    title: "Clozapine Prescribing Administration Monitoring",
    file_name: "CG.MHSP.ClozapinePresAdminMonitor.pdf",
    page_number: 11,
    chunk_index: 0,
    section_heading: "Monitoring",
    content:
      "Withhold clozapine if the absolute neutrophil count (ANC) falls below 1.5 x10^9/L. Mandatory FBC monitoring is weekly for the first 18 weeks of clozapine treatment, then reduces in frequency.",
    image_ids: [],
    similarity: 0.95,
    hybrid_score: 0.95,
    text_rank: 1.2,
    table_facts: [],
    source_metadata: {
      source_title: "Clozapine source",
      publisher: "Local service",
      jurisdiction: "Australia/WA",
      version: "1",
      publication_date: null,
      review_date: null,
      uploaded_at: null,
      indexed_at: null,
      uploaded_by: null,
      document_status: "current",
      clinical_validation_status: "approved",
      extraction_quality: "good",
    },
    images: [],
    ...overrides,
  };
}

/** Mirrors tests/rag-offline-answer.test.ts's harness, with the client counted. */
async function answerWithCountedClient(query: string, textSources: SearchResult[]) {
  vi.stubEnv("RAG_PROVIDER_MODE", "offline");
  vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
  vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");

  class EmptyQuery implements PromiseLike<{ data: unknown[]; error: null }> {
    select() {
      return this;
    }
    in() {
      return this;
    }
    eq() {
      return this;
    }
    neq() {
      return this;
    }
    range() {
      return this;
    }
    order() {
      return this;
    }
    limit() {
      return this;
    }
    is() {
      return this;
    }
    or() {
      return this;
    }
    abortSignal() {
      return this;
    }
    maybeSingle() {
      return this;
    }
    then<TResult1 = { data: unknown[]; error: null }>(
      onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    ): PromiseLike<TResult1> {
      return Promise.resolve({ data: [], error: null }).then(onfulfilled);
    }
  }

  const rpc = vi.fn(async (name: string) => {
    if (name === "match_document_chunks_text_v2" || name === "match_document_chunks_text") {
      return { data: textSources, error: null };
    }
    return { data: [], error: null };
  });

  const { client, counter } = countSupabaseRoundTrips({ rpc, from: vi.fn(() => new EmptyQuery()) });
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
  vi.doMock("@/lib/openai", () => ({
    embedTextWithTelemetry: vi.fn(),
    generateStructuredTextResult: vi.fn(),
  }));

  const { answerQuestionWithScope } = await import("../src/lib/rag/rag");
  const answer = await answerQuestionWithScope({
    query,
    ownerId: undefined,
    logQuery: false,
    skipCache: true,
  });
  return { answer, counter };
}

afterEach(() => {
  // The rag_aliases cache lives on globalThis (shared with the startup warm), so resetting
  // modules no longer empties it; clear it so each scenario counts its own alias read.
  (globalThis as { [key: symbol]: Map<string, unknown> | undefined })[Symbol.for("psychsift.ragAliasCache")]?.clear();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("the counter itself", () => {
  // A budget guard is only worth having if it counts what actually goes over the
  // wire. Proving that on the real path would mean editing src/lib/rag/** to
  // inject calls, so these pin the mechanism instead — and they are the exact
  // two cases the first version of this helper got wrong: a builder that is
  // never executed must cost nothing, and one executed twice must cost two.
  /** Minimal stand-in for a Supabase builder: fluent, and executes on `then`. */
  const builder = (table: string) => {
    const self = {
      select: () => self,
      eq: () => self,
      // Echoes the table back so the parameter is genuinely used, and so a
      // mis-wired proxy that swallowed arguments would show up here.
      then: <T>(onfulfilled?: (value: { data: unknown[]; error: null; table: string }) => T) =>
        Promise.resolve({ data: [], error: null, table }).then(onfulfilled),
    };
    return self;
  };

  it("charges nothing for a builder that is never executed", async () => {
    const { client, counter } = countSupabaseRoundTrips({ from: vi.fn(builder) });

    // Built and abandoned: no request was ever sent, so no trip may be charged.
    // Counting at `.from()` — the first version of this helper — got this wrong.
    client.from!("documents").select().eq();
    expect(counter.total(), "an unexecuted builder must cost zero round trips").toBe(0);
  });

  it("charges two round trips for a builder executed twice", async () => {
    const { client, counter } = countSupabaseRoundTrips({ from: vi.fn(builder) });
    const query = client.from!("documents").select();

    await query;
    expect(counter.total(), "first execution is one trip").toBe(1);
    await query;
    expect(counter.total(), "re-executing a builder really does re-request").toBe(2);
    expect(counter.breakdown()).toEqual({ "from:documents": 2 });
  });

  it("counts an executed rpc and does not mutate the client it wraps", async () => {
    const original = {
      rpc: vi.fn(async (name: string) => ({ data: [], error: null, name })),
      from: vi.fn(builder),
    };
    const { client, counter } = countSupabaseRoundTrips(original);

    await client.rpc!("match_document_chunks_text_v2");
    expect(counter.total()).toBe(1);
    expect(counter.countOf("match_document_chunks_text_v2")).toBe(1);

    // Spread-not-mutate: a suite reusing the same stub for a second scenario
    // must not inherit the first scenario's counting.
    expect(original.from, "wrapping must not replace the original's methods").not.toBe(client.from);
  });
});

describe("Supabase round-trip budgets on the offline answer path", () => {
  it("pins the round-trip count for a single-source source-only answer", async () => {
    const { answer, counter } = await answerWithCountedClient("What ANC threshold should withhold clozapine?", [
      source(),
    ]);

    // Non-vacuity first. A budget of "0 observed, 0 expected" would pass while
    // proving the path never ran — the failure mode that makes a guard useless.
    // Assert the scenario actually produced a cited answer and actually
    // talked to the client before trusting any count.
    //
    // Ledger #ZK460W. This read `answer.grounded === true` until 2026-09-07. Offline, with no
    // provider, this scenario has always ended on the source-backed review fallback, which used
    // to relabel itself grounded — so the flag proved the relabelling ran, not that the answer
    // path did. Citations are the honest non-vacuity signal: retrieval, hydration and citation
    // building all had to complete to produce one, which is exactly the work being budgeted.
    expect(
      answer.citations.length,
      "scenario must produce a cited answer, or the budget measures nothing",
    ).toBeGreaterThan(0);
    expect(counter.total(), "scenario must issue at least one round trip").toBeGreaterThan(0);
    expect(counter.breakdown()).toMatchObject({
      "from:document_labels": 2,
      "from:document_summaries": 2,
      "from:documents": 2,
    });
    expect(counter.breakdown()).not.toHaveProperty("rpc:get_related_document_metadata_v2");
    expect(counter.countOf("match_document_chunks_text_v2"), "text retrieval RPC must have run").toBeGreaterThan(0);

    // Measured budget. Update deliberately, in the same commit as any change
    // that moves it, and say why in that commit.
    expect(counter.total(), `round-trip budget exceeded — breakdown: ${JSON.stringify(counter.breakdown())}`).toBe(
      OFFLINE_SINGLE_SOURCE_ROUND_TRIPS,
    );
  });

  it("does not scale round trips with the number of retrieved sources", async () => {
    // The property worth guarding is shape, not magnitude: hydration and
    // metadata lookups must stay batched. A per-source round trip is the
    // regression this catches, and it is invisible to a single-source budget.
    //
    // Each source gets a DISTINCT document_id and page (Codex P2, 2026-07-30).
    // The first version varied only the chunk id, so all five shared one
    // document — and a regression hydrating once per distinct document would
    // still have been a single call, letting this "no scaling" claim pass over
    // an N+1 path on realistic cross-document results.
    const many = Array.from({ length: 5 }, (_, index) =>
      source({
        id: `clozapine-chunk-${index + 1}`,
        document_id: `clozapine-doc-${index + 1}`,
        page_number: 11 + index,
        chunk_index: index,
      }),
    );
    // Guard the fixture itself, so it cannot quietly revert to five chunks of one
    // document and take this assertion back to proving nothing (suggested by
    // Codex on this PR — the same non-vacuity discipline as the budgets below).
    expect(
      new Set(many.map((entry) => entry.document_id)).size,
      "fixture must span five distinct documents, or cross-document batching is untested",
    ).toBe(5);

    const { answer, counter } = await answerWithCountedClient("What ANC threshold should withhold clozapine?", many);

    // Ledger #ZK460W, same substitution as the single-source budget above.
    expect(answer.citations.length, "scenario must produce a cited answer").toBeGreaterThan(0);
    expect(counter.total(), "scenario must issue at least one round trip").toBeGreaterThan(0);
    expect(counter.breakdown()).toMatchObject({
      "from:document_labels": 2,
      "from:document_summaries": 2,
      "from:documents": 2,
    });
    expect(counter.breakdown()).not.toHaveProperty("rpc:get_related_document_metadata_v2");
    expect(
      counter.total(),
      `five sources must not cost more round trips than one — breakdown: ${JSON.stringify(counter.breakdown())}`,
    ).toBe(OFFLINE_SINGLE_SOURCE_ROUND_TRIPS);
  });
});

/**
 * Measured on 2026-07-30 against the offline source-only path. Not a target and
 * not derived from first principles — it is what the path does today. See the
 * file header before changing it.
 *
 * The 16 break down as:
 *
 *   from:rag_aliases                        1
 *   rpc:match_document_chunks_text_v2       3
 *   from:document_labels                   2
 *   from:document_summaries                 2
 *   from:documents                         2
 *   from:document_index_quality             1
 *   from:document_images                    2
 *   rpc:match_document_table_facts_text_v2  3
 *
 * It was 14 until the counter moved from construction to execution (Codex P2,
 * 2026-07-30). `document_memory_cards` is *built but never executed* on this
 * path, so it sends nothing and must not be charged. That is a small finding in
 * its own right — a constructed-and-abandoned builder — but harmless at runtime;
 * what mattered is that the original budget over-counted real traffic by one.
 *
 * Two things in that breakdown are worth a reader's attention rather than being
 * silently encoded as "correct". Three calls to each of the text-chunk,
 * table-fact and image lookups for a single query is a repeated-triple shape,
 * and `#101` records exactly that pattern — metadata/memory/visual hydration
 * repeated across branches while `rag.ts` already parallelises three RPCs
 * elsewhere. This budget does not endorse the count; it stops it growing
 * unnoticed and gives `#101` a number to improve against.
 *
 * PS-025 (2026-10-18): 12 -> 16. Two unstamped metadata RPCs become two
 * batched sets of labels, stamped summaries and admitted parent documents.
 * These reads enforce generation/access fences; the five-document case must
 * still match the single-document count.
 *
 * 13 -> 12 on 2026-09-26: a later page-image hydration in the same search now reuses the
 * rows an earlier, un-truncated read already returned for the same pages (per-search
 * cache in `attachPageVisualEvidence`), so `document_images` went from 3 reads to 2.
 */
const OFFLINE_SINGLE_SOURCE_ROUND_TRIPS = 16;
