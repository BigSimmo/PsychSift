import { loadEnvConfig } from "@next/env";
import { buildVisualEvidence } from "@/lib/evidence";
import {
  loadCapturedRagEvalCases,
  mergeRagEvalCases,
  selectRagEvalCases,
  type RagEvalCase,
  type SupabaseEvalCaseClient,
} from "@/lib/rag/rag-eval-cases";
import type { SearchResult } from "@/lib/types";
import {
  expectedFileCoverage,
  expectedFileHit,
  hasInvalidVisualEvidence,
  loadAdminClient,
  percentile,
  resolveEvalOwnerId,
} from "./eval-utils";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

loadEnvConfig(process.cwd());

type EvalArgs = {
  ownerEmail?: string;
  ownerId?: string;
  limit?: number;
  question?: string;
  json: boolean;
  failOnThreshold: boolean;
};

export type SearchEvalResult = {
  id: string;
  question: string;
  category: RagEvalCase["category"];
  supported: boolean;
  expectedFileCount: number;
  expectedHitTop3: boolean;
  expectedAllHitTop5: boolean | null;
  missingExpectedFiles: string[];
  resultCount: number;
  payloadBytes: number;
  topScore: number;
  topFiles: string[];
  latencyMs: number;
  retrievalStrategy: string | null;
  queryClass: string | null;
  textCandidateBudget: number | null;
  textFastPathReason: string | null;
  embeddingSkipReason: string | null;
  searchCacheHit: boolean;
  embeddingSkipped: boolean;
  embeddingCacheHit: boolean;
  fallbackToEmbedding: boolean;
  visualEvidence: number;
  latencyTargetMs: number;
  relevanceGrade?: RagEvalCase["relevanceGrade"];
  failures: string[];
};

function parseArgs(argv: string[]): EvalArgs {
  const args: EvalArgs = {
    ownerEmail: process.env.RAG_EVAL_OWNER_EMAIL,
    ownerId: process.env.RAG_EVAL_OWNER_ID ?? process.env.LOCAL_NO_AUTH_OWNER_ID,
    json: false,
    failOnThreshold: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--fail-on-threshold") {
      args.failOnThreshold = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    index += 1;

    if (token === "--owner-email") args.ownerEmail = value;
    if (token === "--owner-id") args.ownerId = value;
    if (token === "--limit") args.limit = Number.parseInt(value, 10);
    if (token === "--question") args.question = value;
  }

  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit <= 0)) {
    throw new Error("--limit must be a positive integer.");
  }

  return args;
}

function topScore(results: SearchResult[]) {
  return results.reduce((max, result) => Math.max(max, result.hybrid_score ?? result.similarity), 0);
}

function validateSearchResult(testCase: RagEvalCase, result: Omit<SearchEvalResult, "failures">) {
  const failures: string[] = [];

  if (testCase.supported && result.expectedFileCount > 1 && result.expectedAllHitTop5 === false) {
    failures.push(`expected documents missing from top 5: ${result.missingExpectedFiles.join(", ")}`);
  } else if (testCase.supported && result.expectedFileCount === 1 && !result.expectedHitTop3) {
    failures.push("expected document not in top 3");
  }
  if (testCase.supported && result.resultCount === 0) failures.push("expected search results");
  if (!testCase.supported && result.topScore >= 0.82)
    failures.push("unsupported control produced high-confidence match");
  if (testCase.falsePositiveControl && result.resultCount > 0 && result.topScore >= 0.78)
    failures.push("false-positive control produced plausible match");
  if (testCase.relevanceGrade === "unsupported" && result.payloadBytes > 100_000)
    failures.push(`unsupported payload too large: ${result.payloadBytes} bytes`);
  if (testCase.category === "routine" && result.payloadBytes > 550_000)
    failures.push(`routine payload too large: ${result.payloadBytes} bytes`);
  if (result.latencyMs > Math.max(testCase.latencyTargetMs * 2, testCase.latencyTargetMs + 3000)) {
    failures.push(`latency over case budget: ${result.latencyMs}ms > ${testCase.latencyTargetMs}ms`);
  }
  if (testCase.expectedQueryClass && result.queryClass !== testCase.expectedQueryClass) {
    failures.push(`expected query class ${testCase.expectedQueryClass}, got ${result.queryClass ?? "none"}`);
  }
  return failures;
}

export function summarizeFailures(results: SearchEvalResult[]) {
  const routine = results.filter((result) => result.category === "routine");
  const supported = results.filter((result) => result.supported);
  const unsupported = results.filter((result) => !result.supported);
  const expectedCoverageCases = supported.filter((result) => result.expectedFileCount > 0);
  const routineLatencies = routine.map((result) => result.latencyMs);
  const expectedHits = expectedCoverageCases.filter((result) =>
    result.expectedFileCount > 1 ? result.expectedAllHitTop5 : result.expectedHitTop3,
  ).length;
  const routineEmbeddingSkipped = routine.filter((result) => result.embeddingSkipped).length;
  const unsupportedHighConfidence = unsupported.filter((result) => result.topScore >= 0.82).length;
  const oversizedPayloads = results.filter((result) => result.payloadBytes > 750_000).length;
  const failures: string[] = [];

  if (expectedCoverageCases.length >= 18 && expectedHits < expectedCoverageCases.length)
    failures.push(`expected document coverage ${expectedHits}/${expectedCoverageCases.length}`);
  if (routineLatencies.length >= 18 && percentile(routineLatencies, 95) > 2000)
    failures.push("routine search p95 over 2000ms");
  if (routine.length > 0 && routineEmbeddingSkipped / routine.length < 0.7) {
    failures.push(`routine embedding skipped ${routineEmbeddingSkipped}/${routine.length}`);
  }
  if (unsupportedHighConfidence > 0) failures.push(`unsupported high-confidence matches ${unsupportedHighConfidence}`);
  if (oversizedPayloads > 0) failures.push(`oversized search payloads ${oversizedPayloads}`);
  if (supported.some((result) => result.failures.length > 0)) failures.push("supported case-level search failure(s)");
  if (unsupported.some((result) => result.failures.length > 0))
    failures.push("unsupported case-level search failure(s)");

  return failures;
}

function printHumanSummary(results: SearchEvalResult[]) {
  const latencies = results.map((result) => result.latencyMs);
  const routineLatencies = results.filter((result) => result.category === "routine").map((result) => result.latencyMs);
  const expectedCoverageCases = results.filter((result) => result.supported && result.expectedFileCount > 0);
  const expectedHits = expectedCoverageCases.filter((result) =>
    result.expectedFileCount > 1 ? result.expectedAllHitTop5 : result.expectedHitTop3,
  ).length;
  const multiDocumentCoverage = expectedCoverageCases.filter((result) => result.expectedFileCount > 1);
  const multiDocumentHits = multiDocumentCoverage.filter((result) => result.expectedAllHitTop5).length;
  const textFast = results.filter((result) => result.retrievalStrategy === "text_fast_path").length;
  const embeddingSkipped = results.filter((result) => result.embeddingSkipped).length;
  const fallbackToEmbedding = results.filter((result) => result.fallbackToEmbedding).length;
  const strategyCounts = results.reduce<Record<string, number>>((counts, result) => {
    const strategy = result.retrievalStrategy ?? "none";
    counts[strategy] = (counts[strategy] ?? 0) + 1;
    return counts;
  }, {});

  console.log("");
  console.log("Search eval summary:");
  console.log(`  expected_document_coverage=${expectedHits}/${expectedCoverageCases.length}`);
  console.log(`  multi_document_all_expected_top5=${multiDocumentHits}/${multiDocumentCoverage.length}`);
  console.log(`  average_latency_ms=${Math.round(latencies.reduce((sum, value) => sum + value, 0) / results.length)}`);
  console.log(`  p50_latency_ms=${percentile(latencies, 50)}`);
  console.log(`  p95_latency_ms=${percentile(latencies, 95)}`);
  console.log(`  routine_p95_latency_ms=${percentile(routineLatencies, 95)}`);
  console.log(`  text_fast_path=${textFast}/${results.length}`);
  console.log(`  embedding_skipped=${embeddingSkipped}/${results.length}`);
  console.log(`  fallback_to_embedding=${fallbackToEmbedding}/${results.length}`);
  console.log(`  max_payload_bytes=${Math.max(0, ...results.map((result) => result.payloadBytes))}`);
  console.log(`  strategy_counts=${JSON.stringify(strategyCounts)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const [{ requireOpenAIEnv, requireServerEnv }, { searchChunksWithTelemetry }, supabase] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/rag/rag"),
    loadAdminClient(),
  ]);

  requireServerEnv();
  requireOpenAIEnv();

  const ownerId = await resolveEvalOwnerId(supabase, args);
  const scope = args.ownerId ? "owner:id" : args.ownerEmail ? `owner:${args.ownerEmail}` : "public";
  const baseCases = selectRagEvalCases({ question: args.question });
  const capturedCaseClient = supabase as unknown as SupabaseEvalCaseClient;
  const capturedCases = args.question
    ? []
    : await loadCapturedRagEvalCases({ supabase: capturedCaseClient, ownerId, limit: args.limit });
  const cases = mergeRagEvalCases(baseCases, capturedCases).slice(0, args.limit ?? undefined);
  const results: SearchEvalResult[] = [];

  if (!args.json) console.log(`Running ${cases.length} search eval case(s), scope=${scope}.`);

  for (const testCase of cases) {
    let attempts = 0;
    const maxAttempts = 6;
    let search;
    let startedAt = Date.now();

    while (attempts < maxAttempts) {
      try {
        startedAt = Date.now();
        search = await searchChunksWithTelemetry({
          query: testCase.question,
          ownerId,
          topK: 12,
          minSimilarity: 0.12,
          skipCache: true,
        });
        break;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isRateLimit = /rate limit|rate_limit|429/i.test(errorMessage);
        attempts += 1;
        if (isRateLimit && attempts < maxAttempts) {
          const delayMs = Math.pow(2, attempts) * 8000 + Math.random() * 3000;
          console.warn(
            `Rate limit hit on query: "${testCase.question}". Waiting ${Math.round(delayMs / 1000)}s before retry ${attempts}/${maxAttempts}...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          console.error(`ERROR running search eval for "${testCase.question}":`, errorMessage);
          throw error;
        }
      }
    }

    if (!search) {
      throw new Error(`Failed to perform search for question: ${testCase.question}`);
    }

    const latencyMs =
      search.telemetry.supabase_rpc_latency_ms +
        search.telemetry.embedding_latency_ms +
        search.telemetry.rerank_latency_ms || Date.now() - startedAt;
    const visuals = buildVisualEvidence(search.results);
    const top3Coverage = expectedFileCoverage(testCase.expectedFiles, search.results, 3);
    const top5Coverage = expectedFileCoverage(testCase.expectedFiles, search.results, 5);
    const baseResult = {
      id: testCase.id,
      question: testCase.question,
      category: testCase.category,
      supported: testCase.supported,
      expectedFileCount: testCase.expectedFiles.length,
      expectedHitTop3: expectedFileHit(testCase.expectedFiles, search.results, 3),
      expectedAllHitTop5: testCase.expectedFiles.length > 1 ? top5Coverage.allHit : null,
      missingExpectedFiles: testCase.expectedFiles.length > 1 ? top5Coverage.missingFiles : top3Coverage.missingFiles,
      resultCount: search.results.length,
      payloadBytes: Buffer.byteLength(JSON.stringify(search.results), "utf8"),
      topScore: topScore(search.results),
      topFiles: Array.from(new Set(search.results.slice(0, 3).map((result) => result.file_name))),
      latencyMs,
      retrievalStrategy: search.telemetry.retrieval_strategy ?? null,
      queryClass: search.telemetry.query_class ?? null,
      textCandidateBudget: search.telemetry.text_candidate_budget ?? null,
      textFastPathReason: search.telemetry.text_fast_path_reason ?? null,
      embeddingSkipReason: search.telemetry.embedding_skip_reason ?? null,
      searchCacheHit: search.telemetry.search_cache_hit,
      embeddingSkipped: search.telemetry.embedding_skipped,
      embeddingCacheHit: search.telemetry.embedding_cache_hit,
      fallbackToEmbedding: !search.telemetry.embedding_skipped,
      visualEvidence: visuals.length,
      latencyTargetMs: testCase.latencyTargetMs,
      relevanceGrade: testCase.relevanceGrade,
    } satisfies Omit<SearchEvalResult, "failures">;
    const failures = validateSearchResult(testCase, baseResult);
    if (hasInvalidVisualEvidence(visuals)) failures.push("decorative or zero-relevance visual evidence returned");
    const result = { ...baseResult, failures };
    results.push(result);

    if (!args.json) {
      const failureSuffix = result.failures.length ? ` FAIL=${result.failures.join("; ")}` : "";
      const expectedCoverage = result.expectedFileCount > 1 ? ` allExpectedTop5=${result.expectedAllHitTop5}` : "";
      console.log(
        `SEARCH ${result.latencyMs}ms strategy=${result.retrievalStrategy ?? "none"} skippedEmbedding=${result.embeddingSkipped} skipReason=${result.embeddingSkipReason ?? "none"} textBudget=${result.textCandidateBudget ?? "n/a"} expectedHit=${result.expectedHitTop3}${expectedCoverage} topScore=${result.topScore.toFixed(3)}${failureSuffix}`,
      );
      console.log(`  Q: ${testCase.question}`);
      console.log(`  Top files: ${result.topFiles.join("; ") || "none"} payloadBytes=${result.payloadBytes}`);
    }

    // Small delay to space out OpenAI calls
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  const thresholdFailures = summarizeFailures(results);

  if (args.json) {
    console.log(JSON.stringify({ scope, results, thresholdFailures }, null, 2));
  } else {
    printHumanSummary(results);
    if (thresholdFailures.length > 0) {
      console.log(`  threshold_failures=${JSON.stringify(thresholdFailures)}`);
    }
  }

  if (args.failOnThreshold && thresholdFailures.length > 0) process.exit(1);
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
