import { loadEnvConfig } from "@next/env";
import {
  buildRagEvaluationDiagnostics,
  evaluateAustralianRagExpectation,
  type RagEvalProgressDiagnosticEvent,
} from "@/lib/rag/rag-eval-diagnostics";
import { selectRagEvalCases, type RagEvalCase } from "@/lib/rag/rag-eval-cases";
import type { RagAnswer } from "@/lib/types";
import {
  estimateCostUsd,
  loadAdminClient,
  percentile,
  resolveEvalOwnerId,
  validateRagAnswer,
  withProviderBackoffProgress,
} from "./eval-utils";

loadEnvConfig(process.cwd());

type EvalArgs = {
  ownerEmail?: string;
  ownerId?: string;
  limit?: number;
  question?: string;
  json: boolean;
  failOnThreshold: boolean;
  expectAustralian: boolean;
};

type EvalResult = {
  id: string;
  question: string;
  category: RagEvalCase["category"];
  supported: boolean;
  expectedFiles: string[];
  matchedFiles: string[];
  missingFiles: string[];
  expectedHit: boolean;
  grounded: boolean;
  latencyMs: number;
  route: string;
  model: string | null;
  citations: number;
  visualEvidence: number;
  failures: string[];
  retrievedSources: Array<{
    rank: number;
    chunkId: string;
    documentId: string;
    title: string;
    fileName: string;
    pageNumber: number | null;
    chunkIndex: number;
    sectionHeading: string | null;
    retrievalSignals: string[];
  }>;
  retrievalIntent?: unknown;
  sourceSelection?: unknown;
  routingReason?: string;
  unverifiedNumericTokenCount: number;
  hasFaithfulnessWarning: boolean;
  sourceWarningCount: number;
  latencyTimings: RagAnswer["latencyTimings"];
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  australianExpectationWarnings: string[];
  governanceDiagnostics: ReturnType<typeof buildRagEvaluationDiagnostics>;
};

function evalSourceDiagnostics(answer: RagAnswer): EvalResult["retrievedSources"] {
  return answer.sources.slice(0, 8).map((source, index) => ({
    rank: index + 1,
    chunkId: source.id,
    documentId: source.document_id,
    title: source.title,
    fileName: source.file_name,
    pageNumber: source.page_number,
    chunkIndex: source.chunk_index,
    sectionHeading: source.section_heading,
    retrievalSignals: (source.match_explanation?.reasons ?? [])
      .filter((reason) => reason.startsWith("retrieval_signal:"))
      .map((reason) => reason.replace(/^retrieval_signal:/, "")),
  }));
}

function parseArgs(argv: string[]): EvalArgs {
  const args: EvalArgs = {
    ownerEmail: process.env.RAG_EVAL_OWNER_EMAIL,
    ownerId: process.env.RAG_EVAL_OWNER_ID ?? process.env.LOCAL_NO_AUTH_OWNER_ID,
    json: false,
    failOnThreshold: false,
    expectAustralian: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    // A mistyped flag used to be skipped, or to swallow the next token, so a run could
    // quietly drop --fail-on-threshold and report green. Refuse anything not recognised.
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);

    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--fail-on-threshold") {
      args.failOnThreshold = true;
      continue;
    }
    if (token === "--expect-australian") {
      args.expectAustralian = true;
      continue;
    }

    if (!["--owner-email", "--owner-id", "--limit", "--question"].includes(token)) {
      throw new Error(`Unknown flag: ${token}`);
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
  if (args.expectAustralian && !args.question) throw new Error("--expect-australian requires --question.");

  return args;
}

function summarizeFailures(results: EvalResult[]) {
  const supported = results.filter((result) => result.supported);
  const unsupported = results.filter((result) => !result.supported);
  const groundedSupported = supported.filter((result) => result.grounded).length;
  const unsupportedCorrect = unsupported.filter((result) => !result.grounded).length;
  const invalidCitations = results.filter((result) => result.grounded && result.citations === 0).length;
  const routineExtractiveLatencies = results
    .filter(
      (result) =>
        result.category === "routine" &&
        result.route === "extractive" &&
        !/\bgeneration_fallback\b/.test(result.routingReason ?? ""),
    )
    .map((result) => result.latencyMs);
  const complexSlow = results.filter((result) => result.category === "complex" && result.latencyMs > 20000).length;
  const failedCases = results.filter((result) => result.failures.length > 0);
  const failures: string[] = [];

  if (supported.length >= 18 && groundedSupported < 17)
    failures.push(`supported grounded ${groundedSupported}/${supported.length}`);
  if (unsupported.length >= 2 && unsupportedCorrect !== unsupported.length) {
    failures.push(`unsupported correct ${unsupportedCorrect}/${unsupported.length}`);
  }
  if (invalidCitations > 0) failures.push(`invalid citation count ${invalidCitations}`);
  if (routineExtractiveLatencies.length >= 5 && percentile(routineExtractiveLatencies, 95) > 2000) {
    failures.push("routine extractive p95 over 2000ms");
  }
  if (complexSlow > 0) failures.push(`complex answers over 20000ms: ${complexSlow}`);
  if (failedCases.length > 0) failures.push(`${failedCases.length} case-level failure(s)`);

  return failures;
}

function printHumanSummary(results: EvalResult[]) {
  const latencies = results.map((result) => result.latencyMs);
  const grounded = results.filter((result) => result.grounded).length;
  const unsupported = results.length - grounded;
  const underTenSeconds = results.filter((result) => result.latencyMs < 10000).length;
  const expectedHits = results.filter((result) => result.expectedHit).length;
  const modelCounts = results.reduce<Record<string, number>>((counts, result) => {
    const model = result.model ?? "none";
    counts[model] = (counts[model] ?? 0) + 1;
    return counts;
  }, {});
  const routeCounts = results.reduce<Record<string, number>>((counts, result) => {
    counts[result.route] = (counts[result.route] ?? 0) + 1;
    return counts;
  }, {});
  const tokenTotals = results.reduce(
    (totals, result) => ({
      inputTokens: totals.inputTokens + result.inputTokens,
      outputTokens: totals.outputTokens + result.outputTokens,
      cachedInputTokens: totals.cachedInputTokens + result.cachedInputTokens,
      reasoningOutputTokens: totals.reasoningOutputTokens + result.reasoningOutputTokens,
      totalTokens: totals.totalTokens + result.totalTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 },
  );
  const estimatedCostUsd = results.some((result) => result.estimatedCostUsd === null)
    ? null
    : results.reduce((sum, result) => sum + (result.estimatedCostUsd ?? 0), 0);

  console.log("");
  console.log("RAG eval summary:");
  console.log(`  grounded=${grounded}/${results.length}`);
  console.log(`  unsupported=${unsupported}/${results.length}`);
  console.log(`  expected_document_hit=${expectedHits}/${results.length}`);
  console.log(`  average_latency_ms=${Math.round(latencies.reduce((sum, value) => sum + value, 0) / results.length)}`);
  console.log(`  p50_latency_ms=${percentile(latencies, 50)}`);
  console.log(`  p95_latency_ms=${percentile(latencies, 95)}`);
  console.log(`  under_10s=${underTenSeconds}/${results.length}`);
  console.log(`  model_counts=${JSON.stringify(modelCounts)}`);
  console.log(`  route_counts=${JSON.stringify(routeCounts)}`);
  console.log(`  token_totals=${JSON.stringify(tokenTotals)}`);
  console.log(
    `  estimated_cost_usd=${
      estimatedCostUsd === null
        ? "set RAG_EVAL_INPUT_USD_PER_MILLION and RAG_EVAL_OUTPUT_USD_PER_MILLION"
        : estimatedCostUsd.toFixed(6)
    }`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const [{ requireOpenAIEnv, requireServerEnv }, { answerQuestionWithScope }, supabase] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/rag/rag"),
    loadAdminClient(),
  ]);

  requireServerEnv();
  requireOpenAIEnv();

  const ownerId = await resolveEvalOwnerId(supabase, args);
  const scope = args.ownerId ? "owner:id" : args.ownerEmail ? `owner:${args.ownerEmail}` : "public";
  const cases = selectRagEvalCases({ limit: args.limit, question: args.question });
  const results: EvalResult[] = [];

  if (!args.json) console.log(`Running ${cases.length} RAG eval case(s), scope=${scope}.`);

  for (const testCase of cases) {
    const { result: answer, progress } = await withProviderBackoffProgress<RagEvalProgressDiagnosticEvent, RagAnswer>(
      `rag:${testCase.id}`,
      (onProgress) =>
        answerQuestionWithScope({
          query: testCase.question,
          ownerId,
          logQuery: false,
          skipCache: true,
          onProgress,
        }),
    );
    const latencyMs = answer.latencyTimings?.total_latency_ms ?? 0;
    const validation = validateRagAnswer(testCase, answer);
    const governanceDiagnostics = buildRagEvaluationDiagnostics(answer, progress);
    const australianExpectation = args.expectAustralian
      ? evaluateAustralianRagExpectation(governanceDiagnostics)
      : { passed: true, failures: [], warnings: [] };
    const result: EvalResult = {
      id: testCase.id,
      question: testCase.question,
      category: testCase.category,
      supported: testCase.supported,
      expectedFiles: validation.expectedCoverage.expectedFiles,
      matchedFiles: validation.expectedCoverage.matchedFiles,
      missingFiles: validation.expectedCoverage.missingFiles,
      expectedHit: validation.expectedHit,
      grounded: answer.grounded,
      latencyMs,
      route: answer.routingMode ?? "none",
      model: answer.modelUsed ?? null,
      citations: answer.citations.length,
      visualEvidence: answer.visualEvidence?.length ?? 0,
      failures: [...validation.failures, ...australianExpectation.failures],
      retrievedSources: evalSourceDiagnostics(answer),
      retrievalIntent: answer.smartApiPlan?.answerPlan.retrievalIntent,
      sourceSelection: answer.smartApiPlan?.answerPlan.sourceSelection,
      routingReason: answer.routingReason,
      unverifiedNumericTokenCount: answer.unverifiedNumericTokens?.length ?? 0,
      hasFaithfulnessWarning: Boolean(answer.faithfulnessWarning),
      sourceWarningCount: answer.sourceGovernanceWarnings?.length ?? 0,
      latencyTimings: answer.latencyTimings,
      inputTokens: answer.openAIUsage?.input_tokens ?? 0,
      outputTokens: answer.openAIUsage?.output_tokens ?? 0,
      cachedInputTokens: answer.openAIUsage?.cached_input_tokens ?? 0,
      reasoningOutputTokens: answer.openAIUsage?.reasoning_output_tokens ?? 0,
      totalTokens: answer.openAIUsage?.total_tokens ?? 0,
      estimatedCostUsd: estimateCostUsd({
        inputTokens: answer.openAIUsage?.input_tokens ?? 0,
        cachedInputTokens: answer.openAIUsage?.cached_input_tokens ?? 0,
        outputTokens: answer.openAIUsage?.output_tokens ?? 0,
      }),
      australianExpectationWarnings: australianExpectation.warnings,
      governanceDiagnostics,
    };
    results.push(result);

    if (!args.json) {
      const status = answer.grounded ? "GROUNDED" : "UNSUPPORTED";
      const failureSuffix = result.failures.length ? ` FAIL=${result.failures.join("; ")}` : "";
      const citationSummary = answer.citations
        .slice(0, 2)
        .map((citation) => `${citation.file_name} p${citation.page_number ?? "?"} c${citation.chunk_index}`)
        .join("; ");
      console.log(
        `${status} ${latencyMs}ms route=${result.route} model=${result.model ?? "none"} citations=${result.citations} visuals=${result.visualEvidence} expectedHit=${result.expectedHit}${failureSuffix}`,
      );
      console.log(`  Q: ${testCase.question}`);
      if (citationSummary) console.log(`  Sources: ${citationSummary}`);
      if (args.expectAustralian) {
        console.log(
          `  Australian evidence: passages=${governanceDiagnostics.australian_candidate_passage_count}, documents=${governanceDiagnostics.australian_candidate_document_count}, valid citations=${governanceDiagnostics.valid_australian_citation_count}, conflicts=${governanceDiagnostics.authority_conflict_count}, supplementary violation=${governanceDiagnostics.supplementary_selected_despite_sufficient_australian ? "yes" : "no"}`,
        );
        console.log(`  Progress: ${governanceDiagnostics.progress_sequence.join(" -> ") || "none"}`);
        for (const warning of result.australianExpectationWarnings) console.log(`  Warning: ${warning}`);
      }
      if (result.failures.length > 0) {
        console.log(
          [
            `  Diagnostics: expected=${result.expectedFiles.join(", ") || "none"}`,
            `missing=${result.missingFiles.join(", ") || "none"}`,
            `topFiles=${
              result.retrievedSources
                .slice(0, 5)
                .map((source) => `${source.rank}:${source.fileName}`)
                .join(" | ") || "none"
            }`,
            `route=${result.route}`,
            `grounded=${result.grounded}`,
            `citations=${result.citations}`,
            `numericWarnings=${result.unverifiedNumericTokenCount}`,
            `faithfulnessWarning=${result.hasFaithfulnessWarning ? "yes" : "no"}`,
            `sourceWarnings=${result.sourceWarningCount}`,
          ].join(" "),
        );
        if (result.routingReason) console.log(`  Routing: ${result.routingReason}`);
      }
    }
  }

  const thresholdFailures = summarizeFailures(results);

  if (args.json) {
    console.log(
      JSON.stringify(
        { scope, expectations: { australian: args.expectAustralian }, results, thresholdFailures },
        null,
        2,
      ),
    );
  } else {
    printHumanSummary(results);
    if (thresholdFailures.length > 0) {
      console.log(`  threshold_failures=${JSON.stringify(thresholdFailures)}`);
    }
  }

  if (args.failOnThreshold && results.length === 0) {
    console.error("--fail-on-threshold: no eval cases were selected, so nothing was checked.");
    process.exit(1);
  }
  if (args.failOnThreshold && thresholdFailures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
