// Answer-quality / targeting eval (P3). Runs the 48-case `answerQualityEvalCases` fixture through
// the live answer path and reports the five answer-quality metrics PLUS a structural per-intent
// `targeting` metric (dose→figure, red-result→withhold action, monitoring→schedule, etc.).
//
// This is a SEPARATE, opt-in script (npm run eval:answer-quality) — it does not touch eval:quality
// or add spend to any existing run. All metrics are reported informationally; the script exits 0
// unless --fail-on-threshold is passed with an explicit floor, so it can be calibrated safely.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnvConfig } from "@next/env";
import {
  answerQualityEvalCases,
  answerQualityMetricLabels,
  answerTargetingMetricLabel,
  scoreAnswerQualityEvalCase,
  scoreAnswerTargeting,
  type AnswerQualityEvalCase,
  type AnswerQualityMetric,
} from "@/lib/rag/rag-eval-cases";
import type { RagAnswer } from "@/lib/types";
import { estimateCostUsd, loadAdminClient, resolveEvalOwnerId, withProviderBackoff } from "./eval-utils";

loadEnvConfig(process.cwd());

type Args = {
  ownerEmail?: string;
  ownerId?: string;
  limit?: number;
  intent?: string;
  caseIds: string[];
  json: boolean;
  failOnThreshold: boolean;
  targetingFloor?: number;
  dumpAnswers?: string;
  extraCases?: string;
};

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    ownerEmail: process.env.RAG_EVAL_OWNER_EMAIL,
    ownerId: process.env.RAG_EVAL_OWNER_ID ?? process.env.LOCAL_NO_AUTH_OWNER_ID,
    caseIds: [],
    json: false,
    failOnThreshold: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--fail-on-threshold") {
      args.failOnThreshold = true;
      continue;
    }
    const value = argv[index + 1];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    index += 1;
    if (token === "--owner-id") args.ownerId = value;
    else if (token === "--owner-email") args.ownerEmail = value;
    else if (token === "--intent") args.intent = value;
    else if (token === "--case-id") {
      if (!value.trim()) throw new Error("--case-id must be a non-empty exact case ID.");
      args.caseIds.push(value.trim());
    } else if (token === "--limit") args.limit = Number(value);
    else if (token === "--targeting-floor") args.targetingFloor = Number(value);
    else if (token === "--dump-answers") args.dumpAnswers = value;
    else if (token === "--extra-cases") args.extraCases = value;
    else throw new Error(`Unknown option: ${token}`);
  }
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit <= 0)) {
    throw new Error("--limit must be a positive integer.");
  }
  if (args.targetingFloor !== undefined && !Number.isFinite(args.targetingFloor)) {
    throw new Error("--targeting-floor must be a number.");
  }
  if (args.failOnThreshold && args.targetingFloor === undefined) {
    throw new Error("--fail-on-threshold requires --targeting-floor.");
  }
  if (args.extraCases && !args.dumpAnswers) {
    throw new Error("--extra-cases requires --dump-answers (capture-only questions exist only for answer capture).");
  }
  if (args.dumpAnswers) resolveLocalDiagnosticOutputPath(args.dumpAnswers);
  return args;
}

// Owner-chosen live questions for the Gate E blinded read (ledger #E0N0QC). Capture-only: they
// are answered and dumped, but never scored, aggregated, or counted toward --fail-on-threshold,
// and they must not collide with the fixed answerQualityEvalCases ids.
export type ExtraCaptureCase = { id: string; question: string };

export function parseExtraCaptureCases(jsonText: string, reservedIds: ReadonlySet<string>): ExtraCaptureCase[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("--extra-cases file must be valid JSON.");
  }
  const questions = (parsed as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('--extra-cases file must contain a non-empty "questions" array.');
  }
  const seen = new Set<string>();
  return questions.map((entry, index) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const question = typeof record.question === "string" ? record.question.trim() : "";
    if (!id) throw new Error(`--extra-cases entry ${index + 1} needs a non-empty string id.`);
    if (!question) throw new Error(`--extra-cases entry "${id}" needs a non-empty question.`);
    if (seen.has(id)) throw new Error(`--extra-cases duplicate id: ${id}`);
    if (reservedIds.has(id)) throw new Error(`--extra-cases id collides with a fixed answer-quality case: ${id}`);
    seen.add(id);
    return { id, question };
  });
}

export function answerTargetingThresholdFailure(args: {
  failOnThreshold: boolean;
  targetingFloor?: number;
  targetingRate: number | null;
}) {
  if (
    !args.failOnThreshold ||
    args.targetingFloor === undefined ||
    args.targetingRate === null ||
    args.targetingRate >= args.targetingFloor
  ) {
    return null;
  }
  return `targeting_rate ${args.targetingRate} < floor ${args.targetingFloor}`;
}

export function selectAnswerQualityCases(args: { caseIds?: string[]; intent?: string; limit?: number }) {
  const suppliedIds = args.caseIds ?? [];
  if (suppliedIds.some((id) => !id.trim())) throw new Error("--case-id must be a non-empty exact case ID.");
  const requestedIds = [...new Set(suppliedIds.map((id) => id.trim()))];
  const byId = new Map(answerQualityEvalCases.map((testCase) => [testCase.id, testCase] as const));
  const unknownIds = requestedIds.filter((id) => !byId.has(id));
  if (unknownIds.length) throw new Error(`Unknown answer-quality case ID: ${unknownIds.join(", ")}`);

  let cases = requestedIds.length
    ? requestedIds.map((id) => byId.get(id)!)
    : ([...answerQualityEvalCases] as AnswerQualityEvalCase[]);
  if (args.intent) cases = cases.filter((testCase) => testCase.expectedIntent === args.intent);
  return cases.slice(0, args.limit ?? cases.length);
}

const MAX_DIAGNOSTIC_SOURCES = 10;
const MAX_SOURCE_PREVIEW_CHARS = 800;
const MAX_IMAGE_PREVIEW_CHARS = 800;
const MAX_DIAGNOSTIC_QUESTION_CHARS = 1_000;
const MAX_DIAGNOSTIC_ANSWER_CHARS = 12_000;
const MAX_DIAGNOSTIC_SECTION_CHARS = 4_000;
const diagnosticUrlPattern =
  /\b(?:https?|file|ftp|mailto|data|javascript|s3|gs|supabase|postgres(?:ql)?|ssh):(?:\/\/)?[^\s<>()]+|\bwww\.[^\s<>()]+/gi;
const diagnosticBareDomainPattern =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|edu|gov|health|nhs|au|uk|io|app|dev|test)(?:\/[^\s<>()]*)?/gi;
const diagnosticEmailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const diagnosticUuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const diagnosticFormattingControlPattern =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]+/g;

export function displaySafeDiagnosticText(value: unknown, maxCharacters: number) {
  if (!Number.isInteger(maxCharacters) || maxCharacters <= 0) throw new Error("Diagnostic text cap must be positive.");
  const normalized = String(value ?? "")
    .replace(diagnosticUrlPattern, "[URL]")
    .replace(diagnosticEmailPattern, "[EMAIL]")
    .replace(diagnosticBareDomainPattern, "[URL]")
    .replace(diagnosticUuidPattern, "[ID]")
    .replace(diagnosticFormattingControlPattern, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maxCharacters) return normalized;
  if (maxCharacters <= 3) return normalized.slice(0, maxCharacters);
  return `${normalized.slice(0, maxCharacters - 3)}...`;
}

export function resolveLocalDiagnosticOutputPath(requestedPath: string, cwd = process.cwd()) {
  const candidate = requestedPath.trim();
  if (!candidate) throw new Error("Diagnostic output path must not be empty.");
  const resolvedPath = resolve(cwd, candidate);
  const allowedRoots = [resolve(cwd, ".local"), resolve(cwd, "output")];
  const allowed = allowedRoots.some((root) => {
    const fromRoot = relative(root, resolvedPath);
    return Boolean(fromRoot) && !fromRoot.startsWith("..") && !isAbsolute(fromRoot);
  });
  if (!allowed) {
    throw new Error("Diagnostic output must be a repo-local file under .local/ or output/.");
  }
  return resolvedPath;
}

export function buildBoundedRagSourceDiagnostics(sources: RagAnswer["sources"]) {
  return sources.slice(0, MAX_DIAGNOSTIC_SOURCES).map((source, index) => {
    const tableFacts = source.table_facts ?? [];
    const images = source.images ?? [];
    const tableImages = images.filter(
      (image) =>
        image.source_kind === "table_crop" ||
        image.sourceKind === "table_crop" ||
        image.image_type === "clinical_table" ||
        Boolean(image.accessibleTableMarkdown?.trim()) ||
        Boolean(image.tableTextSnippet?.trim()),
    );
    const imageTablePreview = tableImages
      .flatMap((image) => [image.tableTitle, image.accessibleTableMarkdown, image.tableTextSnippet, image.caption])
      .filter((value): value is string => Boolean(value?.trim()))
      .join(" ");
    const indexUnitType = source.index_unit?.unit_type ?? source.match_explanation?.indexUnitType ?? null;
    return {
      rank: index + 1,
      title: displaySafeDiagnosticText(source.title, 240),
      filename: displaySafeDiagnosticText(source.file_name, 240),
      page: source.page_number,
      section_heading: source.section_heading ? displaySafeDiagnosticText(source.section_heading, 240) : null,
      index_unit: indexUnitType
        ? {
            type: displaySafeDiagnosticText(indexUnitType, 80),
            heading_depth: source.index_unit?.heading_path?.length ?? 0,
            page_span:
              source.index_unit?.page_start !== null && source.index_unit?.page_start !== undefined
                ? {
                    start: source.index_unit.page_start,
                    end: source.index_unit.page_end ?? source.index_unit.page_start,
                  }
                : null,
          }
        : null,
      table_shape: {
        fact_count: tableFacts.length,
        labelled_row_count: tableFacts.filter((fact) => Boolean(fact.row_label?.trim())).length,
        parameter_count: tableFacts.filter((fact) => Boolean(fact.clinical_parameter?.trim())).length,
        threshold_count: tableFacts.filter((fact) => Boolean(fact.threshold_value?.trim())).length,
        action_count: tableFacts.filter((fact) => Boolean(fact.action?.trim())).length,
      },
      image_shape: {
        image_count: images.length,
        table_image_count: tableImages.length,
        accessible_table_count: tableImages.filter((image) => Boolean(image.accessibleTableMarkdown?.trim())).length,
      },
      image_table_preview: imageTablePreview
        ? displaySafeDiagnosticText(imageTablePreview, MAX_IMAGE_PREVIEW_CHARS)
        : null,
      content_preview: displaySafeDiagnosticText(source.content, MAX_SOURCE_PREVIEW_CHARS),
    };
  });
}

export function buildRagDiagnosticDumpRecord(id: string, question: string, answer: RagAnswer) {
  const openAIUsage = {
    input_tokens: answer.openAIUsage?.input_tokens ?? 0,
    cached_input_tokens: answer.openAIUsage?.cached_input_tokens ?? 0,
    output_tokens: answer.openAIUsage?.output_tokens ?? 0,
  };
  const hasOpenAIUsage = openAIUsage.input_tokens + openAIUsage.cached_input_tokens + openAIUsage.output_tokens > 0;
  const observedProviderRequestIdCount = answer.openAIRequestIds?.filter(Boolean).length ?? 0;
  const generationLatencyMs = answer.latencyTimings?.generation_latency_ms ?? 0;
  const providerAttempted = Boolean(
    hasOpenAIUsage ||
    observedProviderRequestIdCount > 0 ||
    answer.modelUsed ||
    generationLatencyMs > 0 ||
    /(?:^|;\s*)generation_fallback:provider_/i.test(answer.routingReason ?? ""),
  );
  return {
    id: displaySafeDiagnosticText(id, 160),
    question: displaySafeDiagnosticText(question, MAX_DIAGNOSTIC_QUESTION_CHARS),
    route: answer.routingMode ?? null,
    routing_reason: answer.routingReason ? displaySafeDiagnosticText(answer.routingReason, 2_000) : null,
    query_class: answer.queryClass ? displaySafeDiagnosticText(answer.queryClass, 160) : null,
    grounded: answer.grounded,
    confidence: answer.confidence,
    model: answer.modelUsed ? displaySafeDiagnosticText(answer.modelUsed, 160) : null,
    // Gate-outcome fields for the Gate E blinded read (#E0N0QC). All defensive/nullable so this
    // exact file also runs unmodified in a prompt-v18 (4ea310e48) capture worktree.
    answer_quality_tier: answer.answerQualityTier ?? null,
    degraded_mode: answer.degradedMode
      ? {
          active: Boolean(answer.degradedMode.active),
          reason: answer.degradedMode.reason ? displaySafeDiagnosticText(answer.degradedMode.reason, 400) : null,
        }
      : null,
    fallback_reason: answer.fallbackReason ? displaySafeDiagnosticText(answer.fallbackReason, 400) : null,
    generation_quality_gate_reasons: (answer.latencyTimings?.answer_retry_reasons ?? [])
      .filter((reason): reason is string => typeof reason === "string" && reason.startsWith("generation_quality_gate:"))
      .map((reason) => displaySafeDiagnosticText(reason.slice("generation_quality_gate:".length), 200)),
    provider_attempted: providerAttempted,
    observed_provider_request_id_count: observedProviderRequestIdCount,
    openai_usage: openAIUsage,
    estimated_cost_usd: hasOpenAIUsage
      ? estimateCostUsd({
          inputTokens: openAIUsage.input_tokens,
          cachedInputTokens: openAIUsage.cached_input_tokens,
          outputTokens: openAIUsage.output_tokens,
        })
      : providerAttempted
        ? null
        : 0,
    citation_count: answer.citations.length,
    // Only the sources the answer actually cites: the blinded reading pack renders this list
    // (not the broader retrieved-source diagnostics below) so grounding is judged on real
    // citations (PR #2208 review).
    cited_sources: buildBoundedRagSourceDiagnostics(
      answer.sources.filter((source) =>
        answer.citations.some((citation) => citation?.chunk_id && citation.chunk_id === source.id),
      ),
    ),
    answer_length: answer.answer?.length ?? 0,
    answer: displaySafeDiagnosticText(answer.answer ?? "", MAX_DIAGNOSTIC_ANSWER_CHARS),
    answer_sections: (answer.answerSections ?? []).map((section) => ({
      heading: displaySafeDiagnosticText(section.heading, 240),
      body: displaySafeDiagnosticText(section.body, MAX_DIAGNOSTIC_SECTION_CHARS),
    })),
    sources: buildBoundedRagSourceDiagnostics(answer.sources),
  };
}

// Per-case answer-text record for the --dump-answers artifact (E-3c instrument): answers are
// not retained anywhere at rest (privacy design), so diagnosing targeting misses (e.g. "no
// dose figure") needs the texts captured at eval time. Sections included because
// scoreAnswerTargeting scores over answer + sections.
export function buildAnswerDumpRecord(
  testCase: AnswerQualityEvalCase,
  answer: RagAnswer,
  targeting: ReturnType<typeof scoreAnswerTargeting>,
) {
  return {
    ...buildRagDiagnosticDumpRecord(testCase.id, testCase.question, answer),
    intent: testCase.expectedIntent,
    targeting: { applicable: targeting.applicable, score: targeting.score, reason: targeting.reason },
    capture_only: false as const,
  };
}

// Dump record for an owner-supplied capture-only question: same scrubbed shape, no scoring.
export function buildCaptureOnlyDumpRecord(extraCase: ExtraCaptureCase, answer: RagAnswer) {
  return {
    ...buildRagDiagnosticDumpRecord(extraCase.id, extraCase.question, answer),
    intent: null,
    targeting: null,
    capture_only: true as const,
  };
}

const METRICS: AnswerQualityMetric[] = ["relevance", "readability", "artifact_leaks", "intent_coverage", "fail_closed"];

export type AnswerQualityCaseOutcome = {
  testCase: AnswerQualityEvalCase;
  metricScores: ReturnType<typeof scoreAnswerQualityEvalCase>;
  targeting: ReturnType<typeof scoreAnswerTargeting>;
  answer: RagAnswer;
};

// Pure aggregation over GOLDEN-case outcomes only. Capture-only extra cases (--extra-cases)
// cannot enter this summary by construction: they carry no AnswerQualityEvalCase, and main()
// routes them through buildCaptureOnlyDumpRecord into the dump alone — so metric rates,
// targeting stats, and --fail-on-threshold always describe the fixed fixture.
export function summarizeAnswerQuality(outcomes: AnswerQualityCaseOutcome[]) {
  const metricTotals: Record<AnswerQualityMetric, number> = {
    relevance: 0,
    readability: 0,
    artifact_leaks: 0,
    intent_coverage: 0,
    fail_closed: 0,
  };
  const targetingByIntent = new Map<string, { applicable: number; hit: number }>();
  let targetingApplicable = 0;
  let targetingHit = 0;
  const targetingMisses: Array<{ id: string; intent: string; reason: string; answer_length: number }> = [];
  const caseResults: Array<Record<string, unknown>> = [];

  for (const { testCase, metricScores, targeting, answer } of outcomes) {
    for (const score of metricScores) {
      metricTotals[score.metric] += score.score;
    }
    const bucket = targetingByIntent.get(testCase.expectedIntent) ?? { applicable: 0, hit: 0 };
    if (targeting.applicable) {
      bucket.applicable += 1;
      targetingApplicable += 1;
      if (targeting.score === 1) {
        bucket.hit += 1;
        targetingHit += 1;
      } else {
        targetingMisses.push({
          id: testCase.id,
          intent: testCase.expectedIntent,
          reason: targeting.reason,
          answer_length: answer.answer?.length ?? 0,
        });
      }
    }
    targetingByIntent.set(testCase.expectedIntent, bucket);
    caseResults.push({
      id: testCase.id,
      intent: testCase.expectedIntent,
      grounded: answer.grounded,
      confidence: answer.confidence,
      route: answer.routingMode,
      query_class: answer.queryClass ?? null,
      model: answer.modelUsed ?? null,
      citation_count: answer.citations.length,
      routing_reason: answer.routingReason ?? null,
      metrics: Object.fromEntries(metricScores.map((score) => [score.metric, score.score])),
      targeting: targeting.applicable ? targeting.score : null,
      targeting_reason: targeting.reason,
      answer_length: answer.answer?.length ?? 0,
    });
  }

  const caseCount = outcomes.length;
  const metricRates = Object.fromEntries(
    METRICS.map((metric) => [metric, caseCount ? Number((metricTotals[metric] / caseCount).toFixed(4)) : 0]),
  ) as Record<AnswerQualityMetric, number>;
  const targetingRate = targetingApplicable ? Number((targetingHit / targetingApplicable).toFixed(4)) : null;
  const targetingByIntentRates = Object.fromEntries(
    [...targetingByIntent.entries()].map(([intent, { applicable, hit }]) => [
      intent,
      { applicable, hit, rate: applicable ? Number((hit / applicable).toFixed(4)) : null },
    ]),
  );

  return {
    case_count: caseCount,
    metric_labels: answerQualityMetricLabels,
    metric_rates: metricRates,
    targeting_label: answerTargetingMetricLabel,
    targeting_applicable: targetingApplicable,
    targeting_rate: targetingRate,
    targeting_by_intent: targetingByIntentRates,
    targeting_misses: targetingMisses,
    case_results: caseResults,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cases = selectAnswerQualityCases(args);
  const extraCases = args.extraCases
    ? parseExtraCaptureCases(
        await readFile(resolve(args.extraCases), "utf8"),
        new Set(answerQualityEvalCases.map((testCase) => testCase.id)),
      )
    : [];
  const [{ requireOpenAIEnv, requireServerEnv }, { answerQuestionWithScope }, supabase] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/rag/rag"),
    loadAdminClient(),
  ]);
  requireServerEnv();
  requireOpenAIEnv();

  const ownerId = await resolveEvalOwnerId(supabase, args);
  const outcomes: AnswerQualityCaseOutcome[] = [];
  const dumpRecords: Array<ReturnType<typeof buildAnswerDumpRecord> | ReturnType<typeof buildCaptureOnlyDumpRecord>> =
    [];

  for (const testCase of cases) {
    const answer = (await withProviderBackoff(`answer-quality:${testCase.id}`, () =>
      answerQuestionWithScope({ query: testCase.question, ownerId, logQuery: false, skipCache: true }),
    )) as RagAnswer;

    const metricScores = scoreAnswerQualityEvalCase(testCase, answer);
    const targeting = scoreAnswerTargeting(testCase, answer);
    outcomes.push({ testCase, metricScores, targeting, answer });
    if (args.dumpAnswers) dumpRecords.push(buildAnswerDumpRecord(testCase, answer, targeting));
  }

  // Owner-chosen capture-only questions (Gate E): answered and dumped, never scored.
  for (const extraCase of extraCases) {
    const answer = (await withProviderBackoff(`answer-quality:extra:${extraCase.id}`, () =>
      answerQuestionWithScope({ query: extraCase.question, ownerId, logQuery: false, skipCache: true }),
    )) as RagAnswer;
    dumpRecords.push(buildCaptureOnlyDumpRecord(extraCase, answer));
  }

  const summary = summarizeAnswerQuality(outcomes);

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Answer-quality eval: ${summary.case_count} case(s).`);
    console.log("  metric_rates:");
    for (const metric of METRICS) console.log(`    ${metric}=${summary.metric_rates[metric]}`);
    console.log(`  targeting_rate=${summary.targeting_rate} (applicable=${summary.targeting_applicable})`);
    console.log("  targeting_by_intent:");
    for (const [intent, value] of Object.entries(summary.targeting_by_intent)) {
      console.log(`    ${intent}=${value.rate} (${value.hit}/${value.applicable})`);
    }
    if (summary.targeting_misses.length) {
      console.log("  targeting_misses:");
      for (const miss of summary.targeting_misses) {
        console.log(`    [${miss.intent}] ${miss.id}: ${miss.reason} :: answer_length=${miss.answer_length}`);
      }
    }
  }

  if (args.dumpAnswers) {
    const dumpPath = resolveLocalDiagnosticOutputPath(args.dumpAnswers);
    await mkdir(dirname(dumpPath), { recursive: true });
    await writeFile(
      dumpPath,
      `${JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          case_count: summary.case_count,
          capture_only_count: extraCases.length,
          cases: dumpRecords,
        },
        null,
        2,
      )}\n`,
    );
    // Non-JSON mode only, mirroring the --json-out no-stdout-interference convention.
    if (!args.json) {
      console.log(
        `  answer dump written: ${dumpPath} (${dumpRecords.length} record(s), ${extraCases.length} capture-only)`,
      );
    }
  }

  const thresholdFailure = answerTargetingThresholdFailure({
    failOnThreshold: args.failOnThreshold,
    targetingFloor: args.targetingFloor,
    targetingRate: summary.targeting_rate,
  });
  if (thresholdFailure) {
    console.error(`FAIL: ${thresholdFailure}`);
    process.exit(1);
  }
}

// Main-guard (eval-quality.ts precedent) so tests can import parseArgs/buildAnswerDumpRecord
// without executing the provider-backed eval.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
