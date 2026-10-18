import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { z } from "zod";
import { loadCapturedRagEvalCases, type RagEvalCase, type SupabaseEvalCaseClient } from "@/lib/rag/rag-eval-cases";
import type { SearchResult } from "@/lib/types";
import {
  loadAdminClient,
  pauseBetweenEvalCases,
  percentile,
  resolveEvalOwnerId,
  withProviderBackoff,
} from "./eval-utils";
// Alias tables live in a shared module so the offline ranking-snapshot builder grades
// candidates with the same sanctioned expansions this live eval's gates use.
import { clinicalContentAliases, clinicalDocumentAliases } from "./lib/clinical-aliases";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

loadEnvConfig(process.cwd());

const contentExpectationSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

const goldenCaseSchema = z.object({
  id: z.string().min(1),
  query: z.string().min(1),
  expectedQueryClass: z.string().min(1),
  expectedDocumentSubstrings: z.array(z.string().min(1)).default([]),
  expectedContentTerms: z.array(contentExpectationSchema).default([]),
  topK: z.number().int().positive().default(8),
  expectTableEvidence: z.boolean().default(false),
  // Bypass the lexical text-fast-path so this case always exercises the embedding/vector
  // index. Use for "vector-*" probes that would otherwise be answered by a lexical shortcut,
  // so a re-index's effect on vector retrieval is actually measured.
  forceEmbedding: z.boolean().optional(),
});

const goldenCasesSchema = z.array(goldenCaseSchema);

export type GoldenRetrievalCase = z.infer<typeof goldenCaseSchema>;

type EvalArgs = {
  fixture: string;
  ownerEmail?: string;
  ownerId?: string;
  limit?: number;
  query?: string;
  json: boolean;
  jsonOut?: string;
  failOnThreshold: boolean;
  allowPartial: boolean;
  mode: "combined" | "quality" | "latency";
  caseTimeoutMs: number;
  p90BudgetMs: number;
  p50BudgetMs: number;
  forceEmbedding: boolean;
};

export type GoldenRetrievalResult = {
  id: string;
  query: string;
  forceEmbedding: boolean;
  expectedQueryClass: string;
  actualQueryClass: string | null;
  expectedDocumentSubstrings: string[];
  missingDocumentSubstrings: string[];
  expectedContentTerms: string[];
  missingContentTerms: string[];
  documentRecallAt5: number;
  contentRecallAt5: number;
  hitAtK: boolean;
  topK: number;
  reciprocalRankAt10: number;
  contentReciprocalRankAt10: number;
  declaredSignalCount: number;
  ndcgAt10: number;
  irrelevantSourceRateAt10: number;
  requiredSignalCoverageAt10: number;
  latencyMs: number;
  searchTotalLatencyMs?: number;
  retrievalPhaseLatenciesMs?: Record<string, number>;
  retrievalStrategy: string | null;
  retrievalPlan: string | null;
  embeddingSkipped: boolean;
  embeddingSkipReason: string | null;
  textFastPathReason: string | null;
  textCandidateBudget: number | null;
  textCandidateCount: number | null;
  vectorCandidateCount: number | null;
  retrievalLayerCounts?: Record<string, number>;
  retrievalLayerTopScores?: Record<string, number>;
  retrievalLayerLatenciesMs?: Record<string, number>;
  coverageGateDecision?: string | null;
  coverageGateReason?: string | null;
  vectorSkippedReason?: string | null;
  sourceImageRequired?: boolean;
  sourceImageSatisfied?: boolean;
  secondStageRerankUsed: boolean;
  resultCount: number;
  tableEvidenceFound: boolean;
  timedOut?: boolean;
  latencyFailures?: string[];
  failures: string[];
  topResults: Array<{
    rank: number;
    title: string;
    file_name: string;
    chunk_id: string;
    page_number: number | null;
    document_status?: string | null;
    clinical_validation_status?: string | null;
    clinical_validation_evidence_status?: string | null;
    clinical_validation_evidence_basis?: string | null;
    clinical_validation_evidence_type?: string | null;
    extraction_quality?: string | null;
    publisher_code?: string | null;
    jurisdiction?: string | null;
    hybrid_score: number | null;
    similarity: number;
    text_rank: number | null;
    rrf_score: number | null;
    score_explanation?: SearchResult["score_explanation"];
    relevanceGrade: number | null;
    matchedDeclaredSignals: string[];
    content_preview: string;
  }>;
};

export function parseArgs(argv: string[]): EvalArgs {
  const lifecycle = process.env.npm_lifecycle_event ?? "";
  const inferredMode = lifecycle.includes("latency")
    ? "latency"
    : lifecycle.includes("quality")
      ? "quality"
      : "combined";
  const args: EvalArgs = {
    fixture: join(process.cwd(), "scripts", "fixtures", "rag-retrieval-golden.json"),
    ownerEmail: process.env.RAG_EVAL_OWNER_EMAIL,
    ownerId: process.env.RAG_EVAL_OWNER_ID ?? process.env.LOCAL_NO_AUTH_OWNER_ID,
    json: false,
    failOnThreshold: false,
    allowPartial: false,
    mode: inferredMode,
    caseTimeoutMs: inferredMode === "latency" ? 25_000 : 0,
    p90BudgetMs: 20_000,
    p50BudgetMs: 8_000,
    forceEmbedding: false,
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
    if (token === "--allow-partial") {
      args.allowPartial = true;
      continue;
    }
    if (token === "--quality") {
      args.mode = "quality";
      continue;
    }
    if (token === "--latency") {
      args.mode = "latency";
      if (args.caseTimeoutMs <= 0) args.caseTimeoutMs = 25_000;
      continue;
    }
    if (token === "--force-embedding") {
      args.forceEmbedding = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    index += 1;

    if (token === "--fixture") args.fixture = value;
    if (token === "--owner-email") args.ownerEmail = value;
    if (token === "--owner-id") args.ownerId = value;
    if (token === "--limit") args.limit = Number.parseInt(value, 10);
    if (token === "--query") args.query = value;
    // Deliberately independent of --json: the eval canary tees stdout into a log that both
    // humans and the failure-issue analyzer read, so the artifact file must not silence the
    // per-case PASS/FAIL lines and human summary.
    if (token === "--json-out") args.jsonOut = value;
    if (token === "--mode") {
      if (!["combined", "quality", "latency"].includes(value))
        throw new Error("--mode must be combined, quality, or latency.");
      args.mode = value as EvalArgs["mode"];
    }
    if (token === "--case-timeout-ms") args.caseTimeoutMs = Number.parseInt(value, 10);
    if (token === "--p90-ms") args.p90BudgetMs = Number.parseInt(value, 10);
    if (token === "--p50-ms") args.p50BudgetMs = Number.parseInt(value, 10);
  }

  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit <= 0)) {
    throw new Error("--limit must be a positive integer.");
  }
  if (!Number.isInteger(args.caseTimeoutMs) || args.caseTimeoutMs < 0)
    throw new Error("--case-timeout-ms must be >= 0.");
  if (!Number.isInteger(args.p90BudgetMs) || args.p90BudgetMs <= 0) throw new Error("--p90-ms must be positive.");
  if (!Number.isInteger(args.p50BudgetMs) || args.p50BudgetMs <= 0) throw new Error("--p50-ms must be positive.");

  return args;
}

export function resolveEvaluationCases({
  allCases,
  query,
  limit,
  allowPartial = false,
}: {
  allCases: GoldenRetrievalCase[];
  query?: string;
  limit?: number;
  allowPartial?: boolean;
}): GoldenRetrievalCase[] {
  const filteredCases = query
    ? allCases.filter((item) => item.query.toLowerCase().includes(query.toLowerCase()) || item.id === query)
    : allCases;
  const cases = filteredCases.slice(0, limit ?? filteredCases.length);

  if (cases.length === 0) {
    throw new Error(
      "No retrieval eval cases matched the selection. eval-retrieval must not report success over an empty case set.",
    );
  }

  if (!allowPartial && allCases.length > 0 && cases.length < allCases.length) {
    throw new Error(
      `eval-retrieval: selection resolved ${cases.length} of ${allCases.length} case(s) without --allow-partial. ` +
        `Pass --allow-partial to explicitly run a partial golden fixture set under --limit or --query.`,
    );
  }

  return cases;
}

export function loadGoldenRetrievalCases(path: string) {
  const parsed = goldenCasesSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  return parsed;
}

export function capturedRagCaseToGoldenCase(testCase: RagEvalCase): GoldenRetrievalCase {
  return {
    id: testCase.id,
    query: testCase.question,
    expectedQueryClass: testCase.expectedQueryClass ?? "document_lookup",
    expectedDocumentSubstrings: testCase.expectedFiles,
    expectedContentTerms: [],
    topK: 8,
    expectTableEvidence: Boolean(testCase.requireVisualEvidence),
  };
}

function normalized(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizedDocumentName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentExpectationAlternatives(expectation: GoldenRetrievalCase["expectedContentTerms"][number]) {
  const terms = Array.isArray(expectation) ? expectation : [expectation];
  return Array.from(
    new Set(
      terms.flatMap((term) => {
        const normalizedTerm = normalized(term);
        return [normalizedTerm, ...(clinicalContentAliases[normalizedTerm] ?? [])].filter(Boolean);
      }),
    ),
  );
}

function contentExpectationLabel(expectation: GoldenRetrievalCase["expectedContentTerms"][number]) {
  return Array.isArray(expectation) ? expectation.join(" OR ") : expectation;
}

function documentExpectationAlternatives(expectation: string) {
  return [expectation, ...(clinicalDocumentAliases[expectation] ?? [])].map(normalizedDocumentName);
}

/**
 * Word-boundary clinical-term matcher (exported for direct unit tests).
 *
 * Boundaries and internal separators accept any non-alphanumeric run, not just whitespace,
 * so punctuation-joined corpus tokens ("CIWA-Ar", "treatment,", "(opioid", "ptsd.[35]",
 * line-broken "ciwa- ar") match their fixture terms. This is a STRICT SUPERSET of the
 * previous whitespace-delimited matcher (whitespace ⊂ non-alphanumeric for both boundaries
 * and internal separators), proven by artifact replay on canary #53: every previous match is
 * preserved, so live gates can only stay equal or become more satisfiable — never fail a
 * previously-passing case. Substring-inside-a-word still cannot match ("ed" vs "managed").
 */
export function textContainsClinicalTerm(text: string, term: string) {
  const normalizedTerm = normalized(term);
  if (!normalizedTerm) return false;
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[^a-z0-9]+");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(text);
}

function resultDocumentText(result: SearchResult) {
  return normalizedDocumentName(`${result.title} ${result.file_name}`);
}

function resultDocumentEvidenceText(result: SearchResult) {
  return normalizedDocumentName(
    `${result.title} ${result.file_name} ${result.section_heading ?? ""} ${result.section_path?.join(" ") ?? ""}`,
  );
}

function resultContentText(result: SearchResult) {
  return normalized(
    [
      result.title,
      result.file_name,
      result.section_heading,
      result.section_path?.join(" "),
      resultContentEvidenceText(result),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function resultContentEvidenceText(result: SearchResult) {
  const tableFactText = (result.table_facts ?? [])
    .map((fact) =>
      [fact.table_title, fact.row_label, fact.clinical_parameter, fact.threshold_value, fact.action]
        .filter(Boolean)
        .join(" "),
    )
    .join(" ");
  const imageText = (result.images ?? [])
    .map((image) =>
      [
        image.caption,
        image.tableTitle,
        image.tableLabel,
        image.tableTextSnippet,
        image.accessibleTableMarkdown,
        (image.tableRows ?? []).flat().join(" "),
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join(" ");
  // First-class table/visual evidence: when a hit carries the answer in a typed index unit
  // (medication-chart row, risk-matrix cell, flowchart step, …) it is not in `content`, so
  // include it here — otherwise contentReciprocalRankAt10 would miss table/visual answers.
  const indexUnitText = result.index_unit
    ? [result.index_unit.title, result.index_unit.content].filter(Boolean).join(" ")
    : "";
  return normalized(
    [result.retrieval_synopsis, result.content, tableFactText, imageText, indexUnitText].filter(Boolean).join(" "),
  );
}

function expectedDocumentHits(expectedSubstrings: string[], results: SearchResult[], limit: number) {
  const topResults = results.slice(0, limit);
  const hits = expectedSubstrings.filter((expected) => {
    const alternatives = documentExpectationAlternatives(expected);
    const useEvidenceText = !clinicalDocumentAliases[expected] && !/\.pdf$/i.test(expected);
    const texts = topResults.map(useEvidenceText ? resultDocumentEvidenceText : resultDocumentText);
    return texts.some((documentText) => alternatives.some((alternative) => documentText.includes(alternative)));
  });
  return { hits, missing: expectedSubstrings.filter((expected) => !hits.includes(expected)) };
}

function expectedContentHits(
  expectedTerms: GoldenRetrievalCase["expectedContentTerms"],
  results: SearchResult[],
  limit: number,
) {
  const topResults = results.slice(0, limit);
  const hits = expectedTerms.filter((expectation) =>
    topResults.some((result) => contentExpectationMatchesResult(expectation, result)),
  );
  return {
    hits: hits.map(contentExpectationLabel),
    missing: expectedTerms.filter((expectation) => !hits.includes(expectation)).map(contentExpectationLabel),
  };
}

function contentExpectationMatchesResult(
  expectation: GoldenRetrievalCase["expectedContentTerms"][number],
  result: SearchResult,
) {
  const contentText = resultContentText(result);
  return contentExpectationAlternatives(expectation).some((term) => textContainsClinicalTerm(contentText, term));
}

function reciprocalRankAt10(expectedSubstrings: string[], results: SearchResult[]) {
  if (expectedSubstrings.length === 0) return 0;
  const index = results.slice(0, 10).findIndex((result) =>
    expectedSubstrings.some((expectation) => {
      const text =
        !clinicalDocumentAliases[expectation] && !/\.pdf$/i.test(expectation)
          ? resultDocumentEvidenceText(result)
          : resultDocumentText(result);
      return documentExpectationAlternatives(expectation).some((substring) => text.includes(substring));
    }),
  );
  return index >= 0 ? 1 / (index + 1) : 0;
}

/**
 * Passage-level rank quality ("best-passage rank"): the mean over expected content terms of
 * the reciprocal rank of the earliest top-10 result whose content carries that term. Where
 * `contentRecallAt5` only asks *whether* an answer-bearing passage appears in the top 5, this
 * asks *how high* it ranks — so a rerank/chunking change that lifts the right passage from #5
 * to #1 is measurable (content recall stays 1.0 across that move; doc-level `mrr@10` is blind
 * to passage order within a document). 1.0 iff every expected term rides the rank-1 passage.
 * Cases with no expected content terms return 0 and are excluded from the summary average.
 */
function contentReciprocalRankAt10(
  expectedTerms: GoldenRetrievalCase["expectedContentTerms"],
  results: SearchResult[],
) {
  if (expectedTerms.length === 0) return 0;
  const top = results.slice(0, 10);
  const total = expectedTerms.reduce((sum, expectation) => {
    const alternatives = contentExpectationAlternatives(expectation);
    const index = top.findIndex((result) =>
      alternatives.some((term) => textContainsClinicalTerm(resultContentEvidenceText(result), term)),
    );
    return sum + (index >= 0 ? 1 / (index + 1) : 0);
  }, 0);
  return total / expectedTerms.length;
}

type RetrievalSignalMetrics = {
  declaredSignalCount: number;
  ndcgAt10: number;
  irrelevantSourceRateAt10: number;
  requiredSignalCoverageAt10: number;
  topResultSignalMatches: Array<{
    relevanceGrade: number | null;
    matchedDeclaredSignals: string[];
  }>;
};

type DeclaredRetrievalSignal = {
  label: string;
  matches: (result: SearchResult) => boolean;
};

/**
 * Scores only signals explicitly declared by a golden case. Each document expectation,
 * content expectation group, and required table-evidence flag is one signal. A result's
 * graded relevance is the number of those signals it carries; nDCG uses the ideal ordering
 * of the observed grades, so it measures ordering independently from coverage.
 */
function retrievalSignalMetricsAt10(testCase: GoldenRetrievalCase, results: SearchResult[]): RetrievalSignalMetrics {
  const top = results.slice(0, 10);
  const documentSignals: DeclaredRetrievalSignal[] = testCase.expectedDocumentSubstrings.map((expectation) => ({
    label: `document:${expectation}`,
    matches: (result: SearchResult) => {
      const text =
        !clinicalDocumentAliases[expectation] && !/\.pdf$/i.test(expectation)
          ? resultDocumentEvidenceText(result)
          : resultDocumentText(result);
      return documentExpectationAlternatives(expectation).some((alternative) => text.includes(alternative));
    },
  }));
  const contentSignals: DeclaredRetrievalSignal[] = testCase.expectedContentTerms.map((expectation) => ({
    label: `content:${contentExpectationLabel(expectation)}`,
    matches: (result: SearchResult) => contentExpectationMatchesResult(expectation, result),
  }));
  const signals: DeclaredRetrievalSignal[] = [
    ...documentSignals,
    ...contentSignals,
    ...(testCase.expectTableEvidence
      ? [{ label: "table_evidence", matches: (result: SearchResult) => hasTableEvidence([result], 1) }]
      : []),
  ];
  const declaredSignalCount = signals.length;
  const resultSignalMatches = top.map((result) => signals.map((signal) => signal.matches(result)));
  const topResultSignalMatches = resultSignalMatches.map((matches) => {
    const matchedDeclaredSignals = signals
      .filter((_, signalIndex) => matches[signalIndex])
      .map((signal) => signal.label);
    return {
      relevanceGrade: declaredSignalCount === 0 ? null : matchedDeclaredSignals.length,
      matchedDeclaredSignals,
    };
  });
  if (declaredSignalCount === 0) {
    return {
      declaredSignalCount: 0,
      ndcgAt10: 1,
      irrelevantSourceRateAt10: 0,
      requiredSignalCoverageAt10: 1,
      topResultSignalMatches,
    };
  }

  const grades = topResultSignalMatches.map((result) => result.relevanceGrade ?? 0);
  const dcg = (values: number[]) =>
    values.reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
  const idealDcg = dcg([...grades].sort((left, right) => right - left));
  const matchedSignals = signals.filter((_, signalIndex) =>
    resultSignalMatches.some((matches) => matches[signalIndex]),
  ).length;

  return {
    declaredSignalCount,
    ndcgAt10: idealDcg > 0 ? dcg(grades) / idealDcg : 0,
    irrelevantSourceRateAt10: top.length > 0 ? grades.filter((grade) => grade === 0).length / top.length : 0,
    requiredSignalCoverageAt10: matchedSignals / declaredSignalCount,
    topResultSignalMatches,
  };
}

export function retrievalLimitForGoldenCase(testCase: GoldenRetrievalCase) {
  return Math.max(testCase.topK, 10);
}

function hasTableEvidence(results: SearchResult[], limit = 5) {
  return results.slice(0, limit).some((result) => {
    if ((result.table_facts?.length ?? 0) > 0) return true;
    if (
      [
        "visual_summary",
        "flowchart_step",
        "diagram_decision",
        "risk_matrix_cell",
        "medication_chart_row",
        "chart_finding",
        "visual_askable_question",
        "table_threshold",
      ].includes(result.index_unit?.unit_type ?? "")
    )
      return true;
    if (
      /\b(?:flow\s*chart|flowchart|risk matrix|red zone|visual alert)\b/i.test(
        `${result.section_heading ?? ""} ${result.section_path?.join(" ") ?? ""}`,
      )
    )
      return true;
    return (result.images ?? []).some(
      (image) =>
        image.image_type === "clinical_table" ||
        image.image_type === "flowchart_algorithm" ||
        image.image_type === "graph" ||
        image.image_type === "risk_matrix" ||
        image.image_type === "medication_chart" ||
        image.source_kind === "table_crop" ||
        Boolean(image.tableTitle || image.tableLabel || image.tableTextSnippet),
    );
  });
}

function topResultSummary(results: SearchResult[], signalMatches: RetrievalSignalMetrics["topResultSignalMatches"]) {
  // Top 10, not 5: irrelevant_source_rate@10 and rr@10 are top-10 metrics, so the artifact
  // must carry the rows those metrics saw — enabling the offline irrelevant@10 labeling
  // audit (docs/observability-slos.md §3.1) and deeper trend drill-downs without a live rerun.
  return results.slice(0, 10).map((result, index) => {
    const validationEvidence =
      result.source_metadata?.clinical_validation_evidence &&
      typeof result.source_metadata.clinical_validation_evidence === "object" &&
      !Array.isArray(result.source_metadata.clinical_validation_evidence)
        ? (result.source_metadata.clinical_validation_evidence as Record<string, unknown>)
        : {};
    return {
      rank: index + 1,
      title: result.title,
      file_name: result.file_name,
      chunk_id: result.id,
      page_number: result.page_number,
      document_status: result.source_metadata?.document_status ?? null,
      clinical_validation_status: result.source_metadata?.clinical_validation_status ?? null,
      clinical_validation_evidence_status:
        typeof validationEvidence.status === "string" ? validationEvidence.status : null,
      clinical_validation_evidence_basis:
        typeof validationEvidence.basis === "string" ? validationEvidence.basis : null,
      clinical_validation_evidence_type:
        typeof validationEvidence.evidence_type === "string" ? validationEvidence.evidence_type : null,
      extraction_quality: result.source_metadata?.extraction_quality ?? null,
      publisher_code: result.source_metadata?.publisher_code ?? null,
      jurisdiction: result.source_metadata?.jurisdiction ?? null,
      hybrid_score: result.hybrid_score ?? null,
      similarity: result.similarity,
      text_rank: result.text_rank ?? null,
      rrf_score: result.rrf_score ?? null,
      score_explanation: result.score_explanation,
      relevanceGrade: signalMatches[index]?.relevanceGrade ?? null,
      matchedDeclaredSignals: signalMatches[index]?.matchedDeclaredSignals ?? [],
      content_preview: (result.retrieval_synopsis || result.content).replace(/\s+/g, " ").trim().slice(0, 220),
    };
  });
}

export function evaluateGoldenRetrievalCase(args: {
  testCase: GoldenRetrievalCase;
  results: SearchResult[];
  telemetry: {
    query_class?: string | null;
    retrieval_strategy?: string | null;
    retrieval_plan?: string | null;
    embedding_skipped?: boolean | null;
    embedding_skip_reason?: string | null;
    text_fast_path_reason?: string | null;
    text_candidate_budget?: number | null;
    text_candidate_count?: number | null;
    vector_candidate_count?: number | null;
    retrieval_layer_counts?: Record<string, number> | null;
    retrieval_layer_top_scores?: Record<string, number> | null;
    retrieval_layer_latencies_ms?: Record<string, number> | null;
    coverage_gate_decision?: string | null;
    coverage_gate_reason?: string | null;
    vector_skipped_reason?: string | null;
    source_image_required?: boolean | null;
    source_image_satisfied?: boolean | null;
    second_stage_rerank_used?: boolean | null;
    search_total_latency_ms?: number | null;
    retrieval_phase_latencies_ms?: Record<string, number> | null;
  };
  latencyMs: number;
  timedOut?: boolean;
  latencyFailures?: string[];
  globalForceEmbedding?: boolean;
}): GoldenRetrievalResult {
  const forceEmbedding = Boolean(args.testCase.forceEmbedding || args.globalForceEmbedding);
  const documentHits = expectedDocumentHits(args.testCase.expectedDocumentSubstrings, args.results, 5);
  const contentHits = expectedContentHits(args.testCase.expectedContentTerms, args.results, 5);
  const topK = args.testCase.topK;
  const documentHitsAtK = expectedDocumentHits(args.testCase.expectedDocumentSubstrings, args.results, topK);
  const contentHitsAtK = expectedContentHits(args.testCase.expectedContentTerms, args.results, topK);
  const documentRecallAt5 =
    args.testCase.expectedDocumentSubstrings.length === 0
      ? 1
      : documentHits.hits.length / args.testCase.expectedDocumentSubstrings.length;
  const contentRecallAt5 =
    args.testCase.expectedContentTerms.length === 0
      ? 1
      : contentHits.hits.length / args.testCase.expectedContentTerms.length;
  const tableEvidenceFound = hasTableEvidence(args.results, 5);
  const tableEvidenceFoundAtK = hasTableEvidence(args.results, topK);
  const { topResultSignalMatches, ...signalMetrics } = retrievalSignalMetricsAt10(args.testCase, args.results);
  const actualQueryClass = args.telemetry.query_class ?? null;
  const failures: string[] = [];
  const vectorLayerCount = Object.entries(args.telemetry.retrieval_layer_counts ?? {}).reduce(
    (sum, [layer, count]) =>
      ["embedding_fields", "index_units", "hybrid_vector", "vector_fallback"].includes(layer) ? sum + count : sum,
    0,
  );
  const hitAtK =
    documentHitsAtK.missing.length === 0 &&
    contentHitsAtK.missing.length === 0 &&
    (!args.testCase.expectTableEvidence || tableEvidenceFoundAtK);

  if (actualQueryClass !== args.testCase.expectedQueryClass) {
    failures.push(`expected query class ${args.testCase.expectedQueryClass}, got ${actualQueryClass ?? "none"}`);
  }
  if (documentHits.missing.length > 0) {
    failures.push(`missing expected document(s) in top 5: ${documentHits.missing.join(", ")}`);
  }
  if (contentHits.missing.length > 0) {
    failures.push(`missing expected content term(s) in top 5: ${contentHits.missing.join(", ")}`);
  }
  if (args.testCase.expectTableEvidence && !tableEvidenceFound) {
    failures.push("expected table evidence in top 5");
  }
  if (forceEmbedding) {
    if (args.telemetry.embedding_skipped) failures.push("forceEmbedding expected embedding to run");
    if (args.telemetry.retrieval_strategy === "search_cache") failures.push("forceEmbedding served search cache");
    if (
      args.telemetry.retrieval_strategy === "text_fast_path" ||
      args.telemetry.retrieval_strategy === "document_lookup_fast_path"
    ) {
      failures.push(`forceEmbedding returned lexical strategy ${args.telemetry.retrieval_strategy}`);
    }
    if (args.telemetry.coverage_gate_decision === "accepted") failures.push("forceEmbedding returned coverage gate");
    if (vectorLayerCount <= 0) failures.push("forceEmbedding found no vector-layer candidates");
  }

  return {
    id: args.testCase.id,
    query: args.testCase.query,
    forceEmbedding,
    expectedQueryClass: args.testCase.expectedQueryClass,
    actualQueryClass,
    expectedDocumentSubstrings: args.testCase.expectedDocumentSubstrings,
    missingDocumentSubstrings: documentHits.missing,
    expectedContentTerms: args.testCase.expectedContentTerms.map(contentExpectationLabel),
    missingContentTerms: contentHits.missing,
    documentRecallAt5,
    contentRecallAt5,
    hitAtK,
    topK,
    reciprocalRankAt10: reciprocalRankAt10(args.testCase.expectedDocumentSubstrings, args.results),
    contentReciprocalRankAt10: contentReciprocalRankAt10(args.testCase.expectedContentTerms, args.results),
    ...signalMetrics,
    latencyMs: args.latencyMs,
    searchTotalLatencyMs: args.telemetry.search_total_latency_ms ?? undefined,
    retrievalPhaseLatenciesMs: args.telemetry.retrieval_phase_latencies_ms ?? undefined,
    retrievalStrategy: args.telemetry.retrieval_strategy ?? null,
    retrievalPlan: args.telemetry.retrieval_plan ?? null,
    embeddingSkipped: args.telemetry.embedding_skipped ?? false,
    embeddingSkipReason: args.telemetry.embedding_skip_reason ?? null,
    textFastPathReason: args.telemetry.text_fast_path_reason ?? null,
    textCandidateBudget: args.telemetry.text_candidate_budget ?? null,
    textCandidateCount: args.telemetry.text_candidate_count ?? null,
    vectorCandidateCount: args.telemetry.vector_candidate_count ?? null,
    retrievalLayerCounts: args.telemetry.retrieval_layer_counts ?? undefined,
    retrievalLayerTopScores: args.telemetry.retrieval_layer_top_scores ?? undefined,
    retrievalLayerLatenciesMs: args.telemetry.retrieval_layer_latencies_ms ?? undefined,
    coverageGateDecision: args.telemetry.coverage_gate_decision ?? null,
    coverageGateReason: args.telemetry.coverage_gate_reason ?? null,
    vectorSkippedReason: args.telemetry.vector_skipped_reason ?? null,
    sourceImageRequired: args.telemetry.source_image_required ?? false,
    sourceImageSatisfied: args.telemetry.source_image_satisfied ?? false,
    secondStageRerankUsed: args.telemetry.second_stage_rerank_used ?? false,
    resultCount: args.results.length,
    tableEvidenceFound,
    timedOut: args.timedOut ?? false,
    latencyFailures: args.latencyFailures ?? [],
    failures,
    topResults: topResultSummary(args.results, topResultSignalMatches),
  };
}

export function summarizeGoldenRetrievalResults(results: GoldenRetrievalResult[]) {
  const documentRecallDenominator = Math.max(results.length, 1);
  const contentRecallDenominator = Math.max(results.length, 1);
  // Passage-rank quality is only meaningful for cases that declare answer-bearing content
  // terms; averaging over cases without them would dilute the signal with structural zeros.
  const contentRankCases = results.filter((result) => result.expectedContentTerms.length > 0);
  const strategyCounts = results.reduce<Record<string, number>>((counts, result) => {
    const strategy = result.retrievalStrategy ?? "none";
    counts[strategy] = (counts[strategy] ?? 0) + 1;
    return counts;
  }, {});
  const retrievalPlanCounts = results.reduce<Record<string, number>>((counts, result) => {
    const plan = result.retrievalPlan ?? "none";
    counts[plan] = (counts[plan] ?? 0) + 1;
    return counts;
  }, {});
  const embeddingSkipReasonCounts = results.reduce<Record<string, number>>((counts, result) => {
    const reason = result.embeddingSkipped ? (result.embeddingSkipReason ?? "embedding_skipped") : "embedding_used";
    counts[reason] = (counts[reason] ?? 0) + 1;
    return counts;
  }, {});
  const textFastPathReasonCounts = results.reduce<Record<string, number>>((counts, result) => {
    const reason = result.textFastPathReason ?? "none";
    counts[reason] = (counts[reason] ?? 0) + 1;
    return counts;
  }, {});
  const textCandidateBudgets = results
    .map((result) => result.textCandidateBudget)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const latencyFailures = results.filter((result) => (result.latencyFailures ?? []).length > 0 || result.timedOut);
  const layerCounts = results.reduce<Record<string, number>>((counts, result) => {
    for (const [layer, count] of Object.entries(result.retrievalLayerCounts ?? {})) {
      counts[layer] = (counts[layer] ?? 0) + count;
    }
    return counts;
  }, {});
  const forceEmbeddingResults = results.filter((result) => result.forceEmbedding);
  const signalMetricResults = results.filter((result) => result.declaredSignalCount > 0);
  const signalMetricAverage = (select: (result: GoldenRetrievalResult) => number, neutral: number) =>
    signalMetricResults.length > 0
      ? Number(
          (signalMetricResults.reduce((sum, result) => sum + select(result), 0) / signalMetricResults.length).toFixed(
            4,
          ),
        )
      : neutral;
  return {
    case_count: results.length,
    document_recall_at_5: Number(
      (results.reduce((sum, result) => sum + result.documentRecallAt5, 0) / documentRecallDenominator).toFixed(4),
    ),
    content_recall_at_5: Number(
      (results.reduce((sum, result) => sum + result.contentRecallAt5, 0) / contentRecallDenominator).toFixed(4),
    ),
    top_k_hit_rate: Number((results.filter((result) => result.hitAtK).length / Math.max(results.length, 1)).toFixed(4)),
    mrr_at_10: Number(
      (results.reduce((sum, result) => sum + result.reciprocalRankAt10, 0) / Math.max(results.length, 1)).toFixed(4),
    ),
    content_mrr_at_10: Number(
      (
        contentRankCases.reduce((sum, result) => sum + result.contentReciprocalRankAt10, 0) /
        Math.max(contentRankCases.length, 1)
      ).toFixed(4),
    ),
    content_mrr_case_count: contentRankCases.length,
    ndcg_at_10: signalMetricAverage((result) => result.ndcgAt10, 1),
    irrelevant_source_rate_at_10: signalMetricAverage((result) => result.irrelevantSourceRateAt10, 0),
    required_signal_coverage_at_10: signalMetricAverage((result) => result.requiredSignalCoverageAt10, 1),
    signal_metric_case_count: signalMetricResults.length,
    median_latency_ms: percentile(
      results.map((result) => result.latencyMs),
      50,
    ),
    p90_latency_ms: percentile(
      results.map((result) => result.latencyMs),
      90,
    ),
    retrieval_strategy_counts: strategyCounts,
    retrieval_plan_counts: retrievalPlanCounts,
    embedding_skipped_rate: Number(
      (results.filter((result) => result.embeddingSkipped).length / Math.max(results.length, 1)).toFixed(4),
    ),
    embedding_skip_reason_counts: embeddingSkipReasonCounts,
    text_fast_path_reason_counts: textFastPathReasonCounts,
    retrieval_layer_counts: layerCounts,
    force_embedding_case_count: forceEmbeddingResults.length,
    force_embedding_failure_count: forceEmbeddingResults.filter((result) => result.failures.length > 0).length,
    median_text_candidate_budget: percentile(textCandidateBudgets, 50),
    second_stage_rerank_rate: Number(
      (results.filter((result) => result.secondStageRerankUsed).length / Math.max(results.length, 1)).toFixed(4),
    ),
    failed_cases: results.filter((result) => result.failures.length > 0),
    latency_failed_cases: latencyFailures,
  };
}

function latencyFromTelemetry(telemetry: {
  search_total_latency_ms?: number;
  supabase_rpc_latency_ms?: number;
  embedding_latency_ms?: number;
  rerank_latency_ms?: number;
}) {
  if (typeof telemetry.search_total_latency_ms === "number") return telemetry.search_total_latency_ms;
  return (
    (telemetry.supabase_rpc_latency_ms ?? 0) +
    (telemetry.embedding_latency_ms ?? 0) +
    (telemetry.rerank_latency_ms ?? 0)
  );
}

const visualEvalUnitTypes = [
  "visual_summary",
  "flowchart_step",
  "diagram_decision",
  "risk_matrix_cell",
  "medication_chart_row",
  "chart_finding",
  "visual_askable_question",
  "table_threshold",
];

function caseNeedsVisualUnits(testCase: GoldenRetrievalCase) {
  return (
    testCase.expectTableEvidence ||
    /\b(?:source|image|table|chart|flowchart|risk matrix|red zone|visual|dose route)\b/i.test(testCase.query)
  );
}

async function visualReadinessWarnings(
  supabase: Awaited<ReturnType<typeof loadAdminClient>>,
  cases: GoldenRetrievalCase[],
) {
  const visualCases = cases.filter(caseNeedsVisualUnits);
  if (visualCases.length === 0) return [] as string[];
  const { count, error } = await supabase
    .from("document_index_units")
    .select("id", { count: "exact", head: true })
    .in("unit_type", visualEvalUnitTypes);
  if (error) return [`visual readiness check failed: ${error.message}`];
  const visualUnitCount = count ?? 0;
  if (visualUnitCount === 0) return ["visual eval cases are present but no visual index units were found"];
  if (visualUnitCount < visualCases.length) {
    return [
      `visual eval cases are present but visual index unit coverage is sparse: ${visualUnitCount} unit(s) for ${visualCases.length} visual case(s)`,
    ];
  }
  return [];
}

function printHumanSummary(summary: ReturnType<typeof summarizeGoldenRetrievalResults>) {
  console.log("");
  console.log("Golden retrieval eval summary:");
  console.log(`  cases=${summary.case_count}`);
  console.log(`  document_recall@5=${summary.document_recall_at_5}`);
  console.log(`  content_recall@5=${summary.content_recall_at_5}`);
  console.log(`  top_k_hit_rate=${summary.top_k_hit_rate}`);
  console.log(`  mrr@10=${summary.mrr_at_10}`);
  console.log(
    `  content_mrr@10=${summary.content_mrr_at_10} (over ${summary.content_mrr_case_count} content-term case(s))`,
  );
  console.log(`  ndcg@10=${summary.ndcg_at_10} (over ${summary.signal_metric_case_count} signal case(s))`);
  console.log(`  irrelevant_source_rate@10=${summary.irrelevant_source_rate_at_10}`);
  console.log(`  required_signal_coverage@10=${summary.required_signal_coverage_at_10}`);
  console.log(`  median_latency_ms=${summary.median_latency_ms}`);
  console.log(`  p90_latency_ms=${summary.p90_latency_ms}`);
  console.log(`  retrieval_strategy_counts=${JSON.stringify(summary.retrieval_strategy_counts)}`);
  console.log(`  retrieval_plan_counts=${JSON.stringify(summary.retrieval_plan_counts)}`);
  console.log(`  retrieval_layer_counts=${JSON.stringify(summary.retrieval_layer_counts)}`);
  console.log(`  force_embedding_case_count=${summary.force_embedding_case_count}`);
  console.log(`  force_embedding_failure_count=${summary.force_embedding_failure_count}`);
  console.log(`  embedding_skipped_rate=${summary.embedding_skipped_rate}`);
  console.log(`  embedding_skip_reason_counts=${JSON.stringify(summary.embedding_skip_reason_counts)}`);
  console.log(`  text_fast_path_reason_counts=${JSON.stringify(summary.text_fast_path_reason_counts)}`);
  console.log(`  median_text_candidate_budget=${summary.median_text_candidate_budget}`);
  console.log(`  second_stage_rerank_rate=${summary.second_stage_rerank_rate}`);
  console.log(`  failed_cases=${summary.failed_cases.length}`);
  console.log(`  latency_failed_cases=${summary.latency_failed_cases.length}`);
  for (const failed of summary.latency_failed_cases) {
    console.log(`\nLATENCY ${failed.id}: ${(failed.latencyFailures ?? []).join("; ") || "timed out"}`);
    console.log(`  Q: ${failed.query}`);
    console.log(
      `  latency=${failed.latencyMs}ms strategy=${failed.retrievalStrategy ?? "none"} layers=${JSON.stringify(failed.retrievalLayerLatenciesMs ?? {})}`,
    );
  }
  for (const failed of summary.failed_cases) {
    console.log(`\nFAIL ${failed.id}: ${failed.failures.join("; ")}`);
    console.log(`  Q: ${failed.query}`);
    for (const result of failed.topResults.slice(0, 3)) {
      console.log(
        `  #${result.rank} ${result.file_name} p${result.page_number ?? "?"} hybrid=${result.hybrid_score ?? "n/a"} sim=${result.similarity.toFixed(3)} text=${result.text_rank ?? "n/a"} rrf=${result.rrf_score ?? "n/a"}`,
      );
      if (result.score_explanation) console.log(`     score=${JSON.stringify(result.score_explanation)}`);
      console.log(`     ${result.content_preview}`);
    }
  }
}

function latencyFailuresForCase(result: Pick<GoldenRetrievalResult, "latencyMs" | "timedOut">, args: EvalArgs) {
  const failures: string[] = [];
  if (result.timedOut) failures.push(`case timed out after ${args.caseTimeoutMs}ms`);
  if (args.mode === "latency" && result.latencyMs > args.caseTimeoutMs && args.caseTimeoutMs > 0) {
    failures.push(`latency over case timeout budget: ${result.latencyMs}ms > ${args.caseTimeoutMs}ms`);
  }
  return failures;
}

async function withCaseTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  if (timeoutMs <= 0) return { timedOut: false, value: await promise };
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then((value) => ({ timedOut: false as const, value })),
      new Promise<{ timedOut: true }>((resolve) => {
        timeout = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
  const capturedCaseClient = supabase as unknown as SupabaseEvalCaseClient;
  const capturedCases = await loadCapturedRagEvalCases({ supabase: capturedCaseClient, ownerId, limit: args.limit });
  const allCases = [...capturedCases.map(capturedRagCaseToGoldenCase), ...loadGoldenRetrievalCases(args.fixture)];
  const cases = resolveEvaluationCases({
    allCases,
    query: args.query,
    limit: args.limit,
    allowPartial: args.allowPartial,
  });
  const readinessWarnings = await visualReadinessWarnings(supabase, cases);

  if (!args.json) {
    console.log(
      `Running ${cases.length} golden retrieval case(s). mode=${args.mode} caseTimeoutMs=${args.caseTimeoutMs || "none"}`,
    );
    for (const warning of readinessWarnings) console.warn(`WARN ${warning}`);
  }

  function pLimit(concurrency: number) {
    let active = 0;
    const queue: Array<() => void> = [];
    return async <T>(fn: () => Promise<T>): Promise<T> => {
      if (active >= concurrency) await new Promise<void>((resolve) => queue.push(resolve));
      active += 1;
      try {
        return await fn();
      } finally {
        active -= 1;
        queue.shift()?.();
      }
    };
  }

  // Latency mode stays serial so p50/p90 timing is not distorted by concurrent load.
  const concurrency = args.mode === "latency" ? 1 : 5;
  const limitEvaluations = pLimit(concurrency);

  const results: GoldenRetrievalResult[] = await Promise.all(
    cases.map((testCase, caseIndex) =>
      limitEvaluations(async () => {
        await pauseBetweenEvalCases({
          caseIndex,
          forceEmbedding: testCase.forceEmbedding || args.forceEmbedding,
        });
        const startedAt = Date.now();
        const searchPromise = withProviderBackoff(`retrieval:${testCase.id}`, () =>
          searchChunksWithTelemetry({
            query: testCase.query,
            ownerId,
            topK: retrievalLimitForGoldenCase(testCase),
            minSimilarity: 0.12,
            skipCache: args.mode !== "latency",
            forceEmbedding: testCase.forceEmbedding || args.forceEmbedding,
          }),
        );
        const searchOutcome = await withCaseTimeout(searchPromise, args.caseTimeoutMs);
        const search = searchOutcome.timedOut
          ? {
              results: [] as SearchResult[],
              telemetry: {
                query_class: testCase.expectedQueryClass,
                retrieval_strategy: "timeout",
                embedding_skipped: false,
                text_fast_path_latency_ms: 0,
                embedding_latency_ms: 0,
                supabase_rpc_latency_ms: args.caseTimeoutMs,
                rerank_latency_ms: 0,
                retrieval_layer_counts: {},
                retrieval_layer_top_scores: {},
                retrieval_layer_latencies_ms: {},
              },
            }
          : searchOutcome.value;
        const latencyMs = searchOutcome.timedOut
          ? args.caseTimeoutMs
          : latencyFromTelemetry(search.telemetry) || Date.now() - startedAt;
        const latencyFailures = latencyFailuresForCase({ latencyMs, timedOut: searchOutcome.timedOut }, args);
        const result = evaluateGoldenRetrievalCase({
          testCase,
          results: search.results,
          telemetry: search.telemetry,
          latencyMs,
          timedOut: searchOutcome.timedOut,
          latencyFailures,
          globalForceEmbedding: args.forceEmbedding,
        });

        if (!args.json) {
          const status =
            args.mode === "latency"
              ? result.latencyFailures?.length
                ? "SLOW"
                : "OK"
              : result.failures.length
                ? "FAIL"
                : "PASS";
          console.log(
            `${status} ${result.id} hit@${result.topK}=${result.hitAtK ? "1" : "0"} docRecall@5=${result.documentRecallAt5.toFixed(2)} contentRecall@5=${result.contentRecallAt5.toFixed(2)} rr@10=${result.reciprocalRankAt10.toFixed(2)} contentRR@10=${result.contentReciprocalRankAt10.toFixed(2)} ndcg@10=${result.ndcgAt10.toFixed(2)} irrelevant@10=${result.irrelevantSourceRateAt10.toFixed(2)} signalCoverage@10=${result.requiredSignalCoverageAt10.toFixed(2)} latency=${result.latencyMs}ms strategy=${result.retrievalStrategy ?? "none"} gate=${result.coverageGateReason ?? "none"} layers=${JSON.stringify(result.retrievalLayerCounts ?? {})}`,
          );
        }
        return result;
      }),
    ),
  );

  const summary = summarizeGoldenRetrievalResults(results);
  const latencyThresholdFailures =
    args.mode === "latency"
      ? [
          summary.median_latency_ms > args.p50BudgetMs
            ? `p50 latency over budget: ${summary.median_latency_ms}ms > ${args.p50BudgetMs}ms`
            : "",
          summary.p90_latency_ms > args.p90BudgetMs
            ? `p90 latency over budget: ${summary.p90_latency_ms}ms > ${args.p90BudgetMs}ms`
            : "",
        ].filter(Boolean)
      : [];
  if (args.json || args.jsonOut) {
    const payload = {
      fixture: args.fixture,
      mode: args.mode,
      readinessWarnings,
      latencyThresholdFailures,
      results,
      summary,
    };
    const json = JSON.stringify(payload, null, 2);
    if (args.jsonOut) {
      mkdirSync(dirname(args.jsonOut), { recursive: true });
      writeFileSync(args.jsonOut, `${json}\n`);
    }
    if (args.json) console.log(json);
  }
  if (!args.json) {
    printHumanSummary(summary);
    if (latencyThresholdFailures.length) {
      console.log("");
      console.log("Latency threshold failures:");
      for (const failure of latencyThresholdFailures) console.log(`  - ${failure}`);
    }
  }

  const qualityThresholdFailed = args.mode !== "latency" && summary.failed_cases.length > 0;
  const latencyThresholdFailed =
    args.mode === "latency" && (summary.latency_failed_cases.length > 0 || latencyThresholdFailures.length > 0);
  if (args.failOnThreshold && (qualityThresholdFailed || latencyThresholdFailed)) process.exit(1);
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
