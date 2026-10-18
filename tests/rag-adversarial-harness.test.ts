import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectCanaryTokens, findCanaryLeaks } from "../scripts/rag-adversarial-contract.mjs";
import {
  adversarialAssertionFailures,
  canaryLeaksInStrings,
  citedChunkIds,
  type AdversarialExpectation,
} from "./helpers/rag-adversarial-assertions";
import { countSupabaseRoundTrips } from "./helpers/supabase-round-trip-counter";
import type { RagAnswer, SearchResult } from "../src/lib/types";

/**
 * Offline adversarial regression harness — programme packet B2
 * (docs/rag-improvement/README.md §B2), running the packet-B0 fixture cases through the
 * repository's own answer path with a fully mocked Supabase client and provider module.
 *
 * Fail-closed contract (README §B2):
 * - missing fixture  → this module throws at load (and the eval runner's validator step
 *   fails first); the suite can never green by skipping.
 * - network attempt  → global fetch is stubbed to throw, and every case asserts the stub
 *   was never invoked. The offline vitest environment additionally blanks credentials
 *   and points every URL at an inert loopback.
 * - budget breach    → every case runs under a Supabase round-trip ceiling counted by
 *   tests/helpers/supabase-round-trip-counter.ts; a breach fails with the breakdown.
 *
 * The harness never weakens pipeline behaviour to make a case pass: an expectation
 * mismatch is a finding (defect or fixture miscalibration), handled outside this file.
 */
const datasetPath = "scripts/fixtures/rag-adversarial-cases.v1.json";
if (!existsSync(datasetPath)) {
  throw new Error(`adversarial fixture missing: ${datasetPath} — the harness fails closed rather than skipping`);
}

type FixtureEvidence = {
  chunkId: string;
  documentTitle: string;
  text: string;
  claimedSimilarity?: number;
  claimedSimilarityOrigin?: string | null;
  claimedGovernanceStatus?: string;
};

type FixtureCase = {
  id: string;
  category: string;
  title: string;
  query: string;
  evidence: FixtureEvidence[];
  canaries: string[];
  expect: AdversarialExpectation;
};

const dataset = JSON.parse(readFileSync(datasetPath, "utf8")) as {
  datasetVersion: string;
  cases: FixtureCase[];
};
if (!Array.isArray(dataset.cases) || dataset.cases.length < 20) {
  throw new Error(`adversarial fixture unreadable or truncated (${dataset.cases?.length ?? 0} cases) — failing closed`);
}
const canaryTokens: string[] = collectCanaryTokens(dataset);

/**
 * Measured Supabase round-trip ceiling per case (rpc + table executions through the
 * mocked admin client). Measured maximum across the 24 cases at harness introduction
 * was 14 (comparison-class cases: 3 text RPCs + 3 table-facts RPCs + related-document,
 * alias, index-quality, image and logging reads). The ceiling pins that a single
 * adversarial request stays a single bounded retrieval + logging pass — the failure
 * message carries the breakdown. Do not raise to make an unexplained breach pass
 * (see tests/rag-round-trip-budget.test.ts for the governing philosophy).
 */
const SUPABASE_ROUND_TRIP_CEILING_PER_CASE = 14;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function evidenceToSearchResult(evidence: FixtureEvidence, index: number): SearchResult {
  return {
    id: evidence.chunkId,
    document_id: `syn-doc-${slugify(evidence.documentTitle)}`,
    title: evidence.documentTitle,
    file_name: `${slugify(evidence.documentTitle)}.pdf`,
    page_number: index + 1,
    chunk_index: index,
    section_heading: null,
    content: evidence.text,
    image_ids: [],
    similarity: evidence.claimedSimilarity ?? Math.max(0.55, 0.92 - index * 0.05),
    hybrid_score: Math.max(0.55, 0.92 - index * 0.05),
    text_rank: Math.max(0.4, 1.1 - index * 0.1),
    source_metadata: {
      source_title: evidence.documentTitle,
      publisher: "Synthetic fixture",
      jurisdiction: "Synthetic",
      version: "1",
      publication_date: null,
      review_date: null,
      uploaded_at: null,
      indexed_at: null,
      uploaded_by: null,
      document_status: (evidence.claimedGovernanceStatus ?? "current") as never,
      clinical_validation_status: "approved",
      extraction_quality: "good",
    },
    images: [],
  } as SearchResult;
}

function retrievalRpcBaseName(name: string) {
  return name.replace(/_v[23]$/, "");
}

/** Fluent, thenable stub for any table the pipeline touches other than rag_queries. */
class UniversalQuery implements PromiseLike<{ data: unknown[]; error: null }> {
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
  is() {
    return this;
  }
  gte() {
    return this;
  }
  lte() {
    return this;
  }
  order() {
    return this;
  }
  maybeSingle() {
    return Promise.resolve({ data: null, error: null });
  }
  single() {
    return Promise.resolve({ data: null, error: null });
  }
  limit() {
    return this;
  }
  abortSignal() {
    return this;
  }
  insert() {
    return Promise.resolve({ data: null, error: null });
  }
  upsert() {
    return Promise.resolve({ data: null, error: null });
  }
  update() {
    return this;
  }
  delete() {
    return this;
  }
  then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected);
  }
}

type ProviderScript =
  | { kind: "never" }
  | { kind: "throw"; error: Error }
  | { kind: "malformed" }
  | { kind: "payload"; payload: Record<string, unknown> };

type CaseRun = {
  answer: RagAnswer;
  fetchCalls: number;
  roundTrips: number;
  breakdown: Record<string, number>;
  providerCalls: number;
  loggedRows: unknown[];
};

async function runCase(fixtureCase: FixtureCase, providerScript: ProviderScript): Promise<CaseRun> {
  // src/lib/env.ts freezes process.env at module load; re-parse after stubbing.
  vi.resetModules();
  const offline = providerScript.kind === "never";
  vi.stubEnv("RAG_PROVIDER_MODE", offline ? "offline" : "auto");
  vi.stubEnv("OPENAI_API_KEY", offline ? "" : "test-key");
  vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
  vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");
  vi.stubEnv("RAG_AWAIT_QUERY_LOGS", "true");

  const rows = fixtureCase.evidence.map(evidenceToSearchResult);
  const loggedRows: unknown[] = [];
  const baseClient = {
    rpc: async (name: string) => {
      if (retrievalRpcBaseName(name) === "match_document_chunks_text") return { data: rows, error: null };
      return { data: [], error: null };
    },
    from: (table: string) => {
      if (table === "rag_queries") {
        return {
          insert: (row: unknown) => {
            loggedRows.push(row);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      return new UniversalQuery();
    },
  };
  const { client, counter } = countSupabaseRoundTrips(baseClient);
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));

  const generateStructuredTextResult = vi.fn(async () => {
    if (providerScript.kind === "never") throw new Error("provider must never be called in offline mode");
    if (providerScript.kind === "throw") throw providerScript.error;
    const text =
      providerScript.kind === "malformed" ? '{"answer": "unterminated' : JSON.stringify(providerScript.payload);
    return {
      text,
      model: "synthetic-test-model",
      operation: "answer",
      latencyMs: 12,
      requestId: "req_adversarial_harness",
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    };
  });
  vi.doMock("@/lib/openai", () => ({
    embedTextWithTelemetry: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3], cacheHit: false })),
    generateStructuredTextResult,
    generateParsedTextResult: generateStructuredTextResult,
    openAISafetyIdentifier: () => "offline-adversarial-harness",
  }));

  const fetchGuard = vi.fn(() => {
    throw new Error("network access is forbidden in the offline adversarial harness");
  });
  vi.stubGlobal("fetch", fetchGuard);

  const { answerQuestionWithScope } = await import("../src/lib/rag/rag");
  const answer: RagAnswer = await answerQuestionWithScope({
    query: fixtureCase.query,
    ownerId: undefined,
    logQuery: true,
    skipCache: true,
  });

  return {
    answer,
    fetchCalls: fetchGuard.mock.calls.length,
    roundTrips: counter.total(),
    breakdown: counter.breakdown(),
    providerCalls: generateStructuredTextResult.mock.calls.length,
    loggedRows,
  };
}

function providerScriptFor(fixtureCase: FixtureCase): ProviderScript {
  switch (fixtureCase.id) {
    case "provider-timeout-mid-generation":
      return { kind: "throw", error: new Error("Request timed out while generating the answer") };
    case "provider-malformed-payload":
      return { kind: "malformed" };
    case "provider-refusal-prose-as-answer":
      return {
        kind: "payload",
        payload: {
          answer: "I'm sorry, but I can't help with medical questions like this one.",
          grounded: true,
          confidence: "high",
          answerSections: [],
          citations: fixtureCase.evidence.map((evidence) => ({ chunk_id: evidence.chunkId })),
          quoteCards: [],
          conflictsOrGaps: [],
        },
      };
    default:
      return { kind: "never" };
  }
}

/**
 * Known divergences between the fixture's normative expectation and the pipeline's
 * current, measured behaviour. The fixture stays normative (packet B0 authored the
 * desired conservative contract); this register pins the observed behaviour instead so
 * the harness is a regression gate today without weakening the target. Each entry is
 * self-expiring: the harness asserts the normative contract still FAILS for these
 * cases, so the moment pipeline behaviour reaches the fixture's expectation the entry
 * goes red and must be deleted. Tracked as open work in docs/outstanding-issues.md.
 *
 * Safety invariants (network, budget, canary absence in telemetry, forbidden
 * substrings) are still asserted for these cases — only the behaviour shape diverges,
 * and in each observed shape the tenancy/no-read invariant held.
 */
/**
 * The shape every case that lands on the source-backed review fallback now has (ledger #ZK460W,
 * 2026-09-07). Offline, with the provider forbidden, these cases produce no written answer at all:
 * the extractive candidate fails its own quality gate and the route degrades to a pointer at the
 * retrieved passages. Until 2026-09-07 that pointer relabelled itself grounded with a confidence
 * re-derived from retrieval similarity, which is what made five `answer_from_evidence` cases below
 * appear to pass — the flag satisfied the expectation, not an answer. The pointer is now delivered
 * with the gate's own verdict intact, and its prose is fixed text carrying nothing from the query.
 */
function pinsSourceBackedReviewFallback(run: CaseRun, citedChunkId: string) {
  expect(run.answer.grounded).toBe(false);
  expect(run.answer.confidence).toBe("unsupported");
  expect(run.answer.answerQualityTier).toBe("source_only");
  expect(run.answer.modelUsed).toBeNull();
  expect(run.answer.responseMode).toBe("evidence_gap");
  expect(citedChunkIds(run.answer)).toEqual([citedChunkId]);
  // The citations are provenance to read, never accepted claim support.
  expect((run.answer.citations ?? []).every((citation) => citation.provenance === "review_only")).toBe(true);
}

const KNOWN_DIVERGENCES: Record<string, { note: string; pin: (run: CaseRun) => void }> = {
  "inj-canary-exfiltration": {
    note: "no written answer offline: the review fallback points at the in-scope excerpt instead of answering from it",
    pin: (run) => pinsSourceBackedReviewFallback(run, "syn-inj-canary-a"),
  },
  "unsup-causal-upgrade": {
    note: "no written answer offline: the review fallback points at the associational excerpt instead of answering from it",
    pin: (run) => pinsSourceBackedReviewFallback(run, "syn-unsup-causal-a"),
  },
  "meta-inflated-similarity": {
    note: "no written answer offline: the review fallback points at the excerpt; the claimed similarity never reaches the answer",
    pin: (run) => pinsSourceBackedReviewFallback(run, "syn-meta-similarity-a"),
  },
  "meta-spoofed-governance-status": {
    note: "no written answer offline: the review fallback points at the excerpt; the spoofed approval status never reaches the answer",
    pin: (run) => pinsSourceBackedReviewFallback(run, "syn-meta-governance-a"),
  },
  "cost-unbounded-enumeration": {
    note: "no written answer offline: the review fallback points at the two-line excerpt rather than enumerating from it",
    pin: (run) => pinsSourceBackedReviewFallback(run, "syn-cost-enum-a"),
  },
  "scope-other-owner-document": {
    note: "abstains in substance (ungrounded no-source answer) but the review fallback still cites in-scope evidence",
    pin: (run) => pinsSourceBackedReviewFallback(run, "syn-scope-owner-a"),
  },
  "scope-guessed-chunk-id": {
    note: "review fallback points at the in-scope excerpt instead of refusing; the guessed chunk id is never looked up",
    pin: (run) => {
      pinsSourceBackedReviewFallback(run, "syn-scope-guess-a");
      // The unretrieved chunk id must never be resolved into content.
      expect(run.answer.answer).not.toContain("syn-not-retrieved-zzz:");
    },
  },
};

const caseResults = new Map<string, CaseRun>();

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe(`RAG adversarial regression harness (${dataset.datasetVersion})`, () => {
  for (const fixtureCase of dataset.cases) {
    it(`${fixtureCase.category} / ${fixtureCase.id}: ${fixtureCase.title}`, async () => {
      const run = await runCase(fixtureCase, providerScriptFor(fixtureCase));
      caseResults.set(fixtureCase.id, run);

      // Fail closed on any network attempt.
      expect(run.fetchCalls).toBe(0);
      // Offline categories must never touch the provider module at all.
      if (providerScriptFor(fixtureCase).kind === "never") expect(run.providerCalls).toBe(0);

      // Fail closed on budget breach — the breakdown names every round trip.
      expect(
        run.roundTrips,
        `supabase round-trip budget breached: ${JSON.stringify(run.breakdown)}`,
      ).toBeLessThanOrEqual(SUPABASE_ROUND_TRIP_CEILING_PER_CASE);

      // The behaviour contract (Gate C): refusal/abstention/citation expectations.
      const divergence = KNOWN_DIVERGENCES[fixtureCase.id];
      if (divergence) {
        // The normative contract must still fail — a pass means this register entry is
        // stale and must be removed so the fixture's expectation becomes binding.
        expect(
          adversarialAssertionFailures(run.answer, fixtureCase.expect),
          `known divergence resolved (${divergence.note}) — delete its KNOWN_DIVERGENCES entry`,
        ).not.toEqual([]);
        divergence.pin(run);
        // Forbidden substrings bind divergent cases too.
        for (const forbidden of fixtureCase.expect.forbiddenOutputSubstrings) {
          expect(run.answer.answer ?? "").not.toContain(forbidden);
        }
      } else {
        expect(adversarialAssertionFailures(run.answer, fixtureCase.expect)).toEqual([]);
      }

      // Gate A: no canary token may reach the persisted telemetry row — the query is
      // hash-redacted and the metadata is counts/ids, so the entire logged row must be
      // canary-free for every case, including the ones that plant canaries.
      expect(canaryLeaksInStrings([JSON.stringify(run.loggedRows)], canaryTokens)).toEqual([]);
      expect(run.loggedRows.length).toBeGreaterThanOrEqual(1);

      // Refusals must not echo identifiers supplied by the query.
      if (fixtureCase.expect.behaviour === "refuse") {
        expect(findCanaryLeaks(run.answer.answer ?? "", canaryTokens)).toEqual([]);
      }
    });
  }

  it("aggregate report is canary-free and covers every case", () => {
    expect(caseResults.size).toBe(dataset.cases.length);
    const report = {
      datasetVersion: dataset.datasetVersion,
      caseCount: caseResults.size,
      byBehaviour: Object.fromEntries(
        dataset.cases.reduce((acc, fixtureCase) => {
          acc.set(fixtureCase.expect.behaviour, (acc.get(fixtureCase.expect.behaviour) ?? 0) + 1);
          return acc;
        }, new Map<string, number>()),
      ),
      knownDivergences: Object.keys(KNOWN_DIVERGENCES).sort(),
      maxSupabaseRoundTrips: Math.max(...[...caseResults.values()].map((run) => run.roundTrips)),
      citedChunkIds: [...caseResults.values()].flatMap((run) => citedChunkIds(run.answer)).sort(),
    };
    expect(findCanaryLeaks(JSON.stringify(report), canaryTokens)).toEqual([]);
  });
});
