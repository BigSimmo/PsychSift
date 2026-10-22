/**
 * Route-level Supabase round-trip budget for `POST /api/search` (ledger `#098`
 * residual, `#189`).
 *
 * `tests/search-round-trip-budget.test.ts` pins the offline **retrieval core**
 * (`searchChunksWithTelemetry`) but says so explicitly: everything the route
 * does *around* retrieval — auth, rate limiting, scope resolution,
 * related-document enrichment, and the telemetry write — is invisible there. This
 * file drives `POST` itself with a counted Supabase client, following the
 * `tests/answer-route-preamble.test.ts` pattern of importing the route fresh per
 * scenario with `vi.doMock`, so a round trip added anywhere in the route
 * preamble or post-processing becomes a red gate instead of something a
 * reviewer has to notice by reading a diff.
 *
 * **The numbers here are measured, not derived.** They record what the route
 * does today for one representative anonymous, filter-free, non-cached search.
 * A failure means "the traffic changed" — information, not automatically a
 * defect. Read the printed breakdown, decide whether the change was intended,
 * and move the budget in the same commit as the change that moved it.
 *
 * The pinned breakdown below issues `match_document_chunks_text_v2` and
 * `match_document_table_facts_text_v2` three times each. That is not
 * accidental fan-out: `rag-candidate-sources.ts` probes up to
 * `maxTextRpcQueryVariants` (3) lexical query-variant phrasings — primary plus
 * up to two siblings — per text surface, to rescue recall when the primary
 * phrasing misses. A PT-02 early exit (`firstVariantPoolIsStrong` in
 * `rag-retrieval-variants.ts`) already skips the sibling RPCs when the primary
 * pool is deep and precisely anchored; this fixture's single mocked chunk never
 * clears that depth bar, so the full ×3 fan-out fires here — the worst-case
 * shape, not the typical one for a well-matched corpus. Disposition recorded
 * in this PR's body rather than duplicated here so it stays in one place.
 *
 * Scope: what travels through the mocked `@/lib/supabase/admin` client for this
 * one request shape. A different request shape (authenticated caller, active
 * filters, documents/differentials mode, a cache hit, a rate-limit denial) pays
 * a different bill and is not claimed here. Traffic via another client, a
 * direct `fetch`, or a provider SDK is invisible to this counter.
 *
 * Provider-free and DB-free. No retrieval, ranking, or selection behaviour is
 * changed by this file; it only observes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { countSupabaseRoundTrips } from "./helpers/supabase-round-trip-counter";
import type { SearchResult } from "../src/lib/types";

/** Minimal indexed chunk; only the fields retrieval reads are populated. Mirrors
 * the fixture in `tests/search-round-trip-budget.test.ts` so the retrieval-core
 * traffic underneath this route budget matches that pinned shape. */
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
      "Withhold clozapine if the absolute neutrophil count (ANC) falls below 1.5 x10^9/L. Mandatory FBC monitoring is weekly for the first 18 weeks of clozapine treatment.",
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
  } as SearchResult;
}

function rateLimitRow(limited: boolean) {
  return {
    limited,
    limit_value: 60,
    remaining: limited ? 0 : 59,
    retry_after_seconds: limited ? 60 : 0,
    reset_at: new Date(Date.now() + 60_000).toISOString(),
  };
}

/**
 * Fluent no-op builder for every `.from()` call the route's own preamble and
 * post-processing make: `resolveSearchScope`'s (unreached here) document/label
 * paging, `fetchRelatedDocuments`' metadata/visual enrichment, and the
 * fire-and-forget `rag_retrieval_logs` / `rag_queries` / `rag_query_misses`
 * inserts. Every chained method returns `this`; execution (`then`) yields an
 * empty, error-free result — including for `.insert()`, which the real client
 * also returns as an awaitable builder rather than a bare promise.
 */
class RouteQuery implements PromiseLike<{ data: unknown[]; error: null }> {
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
  insert() {
    return this;
  }
  then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected);
  }
}

/**
 * Drives `POST /api/search` for one anonymous request through a counted
 * Supabase client, returning the parsed response and the round-trip counter.
 *
 * Reset before mocking, not only in `afterEach`: a test that calls this twice
 * would otherwise get the *first* run's mocked `createAdminClient` on the
 * second call (`tests/search-round-trip-budget.test.ts` hit this first).
 */
async function postSearchWithCountedClient(
  body: Record<string, unknown>,
  textSources: SearchResult[],
  options: { limited?: boolean; signedOut?: boolean } = {},
) {
  vi.resetModules();
  vi.stubEnv("RAG_PROVIDER_MODE", "offline");
  vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");

  const rpc = vi.fn(async (name: string) => {
    if (name === "consume_api_subject_rate_limit" || name === "consume_api_rate_limit") {
      return { data: [rateLimitRow(options.limited ?? false)], error: null };
    }
    if (name === "match_document_chunks_text_v2" || name === "match_document_chunks_text") {
      return { data: textSources, error: null };
    }
    return { data: [], error: null };
  });

  // #3728: /api/search needs sign-in, so the representative request is a signed-in one. The
  // session check is an Auth API call, not a database round trip, so it is not counted.
  const auth = {
    getUser: vi.fn(async (token?: string) =>
      token === "synthetic-session-token"
        ? { data: { user: { id: "11111111-1111-4111-8111-111111111111" } }, error: null }
        : { data: { user: null }, error: { message: "Invalid token" } },
    ),
  };
  const { client, counter } = countSupabaseRoundTrips({ rpc, from: vi.fn(() => new RouteQuery()), auth });

  vi.doMock("@/lib/env", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/env")>()),
    isDemoMode: () => false,
    isLocalNoAuthMode: () => false,
  }));
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
  vi.doMock("@/lib/openai", () => ({
    embedTextWithTelemetry: vi.fn(),
    generateStructuredTextResult: vi.fn(),
  }));

  const { POST } = await import("../src/app/api/search/route");
  const response = await POST(
    new Request("http://localhost/api/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options.signedOut ? {} : { Authorization: "Bearer synthetic-session-token" }),
      },
      body: JSON.stringify(body),
    }),
  );
  const payload = (await response.json()) as Record<string, unknown>;

  // logRetrievalDiagnostics / logSearchObservation are fire-and-forget: the
  // route neither awaits nor blocks on them, so their Supabase inserts land in
  // the microtask queue after `await POST(...)` already returned. A macrotask
  // tick flushes every microtask queued by then, so this reads the client's
  // traffic after telemetry has actually landed rather than mid-flight.
  await new Promise((resolve) => setTimeout(resolve, 0));

  return { response, payload, counter };
}

afterEach(() => {
  // `doMock` registrations survive both `restoreAllMocks` (which targets spies)
  // and `resetModules` (which clears the module cache, not the mock registry),
  // so they are dropped explicitly — the pattern the sibling suites already use
  // (`tests/rag-variant-early-exit.test.ts:110`, `tests/search-round-trip-budget.test.ts`).
  vi.doUnmock("@/lib/env");
  vi.doUnmock("@/lib/supabase/admin");
  vi.doUnmock("@/lib/openai");
  vi.restoreAllMocks();
  // The rag_aliases cache lives on globalThis (shared with the startup warm), so resetting
  // modules no longer empties it; clear it so each scenario counts its own alias read.
  (globalThis as { [key: symbol]: Map<string, unknown> | undefined })[Symbol.for("psychsift.ragAliasCache")]?.clear();
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("Supabase round-trip budget on the /api/search route", () => {
  // #3728: from 1 November 2026 /api/search needs sign-in. The anonymous request that the
  // 19-trip budget below used to describe is now refused before any database traffic at all.
  it("spends no round trip on a signed-out request, which is refused with 401", async () => {
    const { response, counter } = await postSearchWithCountedClient(
      { query: "What ANC threshold should withhold clozapine?" },
      [source()],
      { signedOut: true },
    );

    expect(response.status).toBe(401);
    expect(counter.total(), `a signed-out request must cost nothing — ${JSON.stringify(counter.breakdown())}`).toBe(0);
  });

  it("pins the route-level round-trip count for a signed-in, filter-free clinical search", async () => {
    const { response, payload, counter } = await postSearchWithCountedClient(
      { query: "What ANC threshold should withhold clozapine?" },
      [source()],
    );

    // Non-vacuity before the budget: a budget asserted against a request that
    // never actually reached the retrieval core would pass while proving
    // nothing (the failure mode `#120` was filed from).
    expect(response.status, "the route must actually answer, or the budget proves nothing").toBe(200);
    expect(
      Array.isArray(payload.results) ? payload.results.length : 0,
      "the route must actually retrieve, or the budget proves nothing",
    ).toBeGreaterThan(0);
    const retrievalRpcCount =
      counter.countOf("match_document_chunks_text_v2") + counter.countOf("match_document_table_facts_text_v2");
    expect(retrievalRpcCount, "the route must issue retrieval RPCs, or the budget proves nothing").toBeGreaterThan(0);

    // #3728 (2026-10-21): this pin used to describe the ANONYMOUS request (19 trips, PS-025).
    // Signed-out search is now refused with no database traffic (pinned at 0 above), so the
    // representative request is a signed-in one. That path was never pinned; its existing
    // cost is 24, recorded here unchanged rather than tuned:
    //   1  consume_api_rate_limit (owner rate limiting, in place of the anonymous subject limiter)
    //   2  rag_aliases (query classification)
    //   3  match_document_chunks_text_v2 (primary probe + 2 lexical query variants)
    //   3  match_document_table_facts_text_v2 (primary probe + 2 lexical query variants)
    //   3  match_documents_for_query_v2 (owner related-document matching)
    //   2  document_labels, 2 document_summaries, 3 documents, 1 document_index_quality
    //   2  document_images (visual enrichment)
    //   1  rag_retrieval_logs, 1 rag_queries (fire-and-forget telemetry)
    //
    // Total pinned so a reviewer does not have to eyeball every PR: an added
    // change (in the preamble, retrieval core, enrichment, or telemetry write)
    // has to be deliberate. Update in the commit that moves it.
    expect(counter.total(), `search route round trips changed — ${JSON.stringify(counter.breakdown())}`).toBe(24);

    // The shape matters as much as the total: a refactor that removed one probe
    // and added an unrelated query would keep 19 while changing the traffic.
    // See the file header for why the two text-RPC surfaces below are ×3, not ×1.
    expect(counter.breakdown(), "search route round-trip shape changed").toEqual({
      "rpc:consume_api_rate_limit": 1,
      "from:rag_aliases": 2,
      "rpc:match_document_chunks_text_v2": 3,
      "rpc:match_document_table_facts_text_v2": 3,
      "rpc:match_documents_for_query_v2": 3,
      "from:document_labels": 2,
      "from:document_summaries": 2,
      "from:documents": 3,
      "from:document_index_quality": 1,
      "from:document_images": 2,
      "from:rag_retrieval_logs": 1,
      "from:rag_queries": 1,
    });
  }, 60_000);

  it("spends no rate-limit-denied request on retrieval traffic beyond the limiter check", async () => {
    // A route budget also has to say what a *denied* caller costs: the limiter
    // check itself, and nothing past it. This is the route-level analogue of
    // `tests/answer-route-preamble.test.ts`'s "dispatches no scope query at all
    // when the limiter denies" — same claim, this route's own preamble.
    const { response, counter } = await postSearchWithCountedClient(
      { query: "What ANC threshold should withhold clozapine?" },
      [source()],
      { limited: true },
    );

    expect(response.status).toBe(429);
    expect(
      counter.total(),
      `a rate-limited request must cost only the limiter check — ${JSON.stringify(counter.breakdown())}`,
    ).toBe(1);
    expect(counter.countOf("consume_api_rate_limit")).toBe(1);
  });
});
