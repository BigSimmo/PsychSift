// Component experiment: frozen synthetic retrieval, production generation wrapper,
// source fencing, instructions, schema and parse/citation/numeric validation. This
// does not execute the full route's planner, retrieval, packing, cache or recovery.
import { createHash, randomBytes } from "node:crypto";
import { open, readFile, readdir, mkdir, writeFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenAITextResult } from "../src/lib/openai";
import type { OpenAITokenUsage, RagAnswer, SearchResult } from "../src/lib/types";
import type { EvalModelPrices } from "./eval-utils";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

export const comparisonConfig = Object.freeze({
  version: 1,
  componentOnly: true,
  syntheticOnly: true,
  arms: {
    control: { fast: "gpt-5.6-terra", strong: "gpt-5.6-sol" },
    candidate: { fast: "gpt-6.1-sol", strong: "gpt-6.1-sol" },
  },
  efforts: { fast: "low", strong: "medium" },
  measuredPasses: 2,
  warmupsPerArm: 1,
  concurrency: 1,
  sdkRetries: 0,
  outerRetries: 0,
  maxOutputTokens: 16_000,
  maxRequests: 150,
  maxInputTokens: 1_000_000,
  maxOutputTokensAggregate: 400_000,
  maxUsd: 15,
  maxWireBytes: 256_000,
  serviceTier: "default",
  region: "global",
} as const);
Object.values(comparisonConfig.arms).forEach(Object.freeze);
Object.freeze(comparisonConfig.arms);
Object.freeze(comparisonConfig.efforts);
type Arm = keyof typeof comparisonConfig.arms;
type Route = "fast" | "strong";
export type ComparisonCase = {
  id: string;
  category: "lookup" | "synthesis" | "conflict" | "table" | "unsupported" | "injection";
  route: Route;
  question: string;
  sources: string[];
  expectedTerms: string[];
  forbiddenTerms?: string[];
  unsupported: boolean;
};
export type Execution = { arm: Arm; caseId: string; pass: number; warmup: boolean; model: string; route: Route };
export type PriceCard = {
  verifiedAt: string;
  sources: string[];
  serviceTier: "default";
  region: "global";
  models: Record<
    string,
    {
      input: number;
      cachedInput?: number;
      cacheWrite?: number;
      output: number;
      maxContextTokens: number;
      maxOutputTokens: number;
    }
  >;
};
export type RunIdentity = {
  sourceSha256: string;
  fixturesSha256: string;
  configurationSha256: string;
  environmentSha256: string;
};
export type Approval = RunIdentity & {
  version: 1;
  approvalReference: string;
  outputDirectory: string;
  approvedAt: string;
  expiresAt: string;
  priceCardSha256: string;
  maxUsd: number;
  maxRequests: number;
  maxInputTokens: number;
  maxOutputTokens: number;
};
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) > 0;
const finiteRate = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

export function parseComparisonFixtures(text: string): ComparisonCase[] {
  const fixture: unknown = JSON.parse(text);
  if (
    !record(fixture) ||
    fixture.version !== 1 ||
    fixture.synthetic !== true ||
    !Array.isArray(fixture.cases) ||
    fixture.cases.length !== 12
  )
    throw new Error("Expected exactly 12 explicitly synthetic comparison cases.");
  const ids = new Set<string>();
  const categories = new Map<string, number>();
  for (const item of fixture.cases) {
    if (
      !record(item) ||
      typeof item.id !== "string" ||
      !/^[a-z][a-z-]+$/.test(item.id) ||
      ids.has(item.id) ||
      !["lookup", "synthesis", "conflict", "table", "unsupported", "injection"].includes(String(item.category)) ||
      !["fast", "strong"].includes(String(item.route)) ||
      typeof item.question !== "string" ||
      !item.question.trim() ||
      item.question.length > 1_000 ||
      !Array.isArray(item.sources) ||
      item.sources.length < 1 ||
      item.sources.length > 3 ||
      item.sources.some((s) => typeof s !== "string" || !s.trim() || s.length > 4_000) ||
      !Array.isArray(item.expectedTerms) ||
      item.expectedTerms.some((s) => typeof s !== "string") ||
      typeof item.unsupported !== "boolean" ||
      (item.forbiddenTerms !== undefined &&
        (!Array.isArray(item.forbiddenTerms) || item.forbiddenTerms.some((s) => typeof s !== "string")))
    )
      throw new Error("Invalid or duplicate synthetic fixture.");
    ids.add(item.id);
    categories.set(String(item.category), (categories.get(String(item.category)) ?? 0) + 1);
  }
  if (categories.size !== 6 || [...categories.values()].some((n) => n !== 2))
    throw new Error("Each of six categories needs two cases.");
  return fixture.cases as ComparisonCase[];
}

export function planExecutions(cases: readonly ComparisonCase[]): Execution[] {
  const executions: Execution[] = [];
  const add = (arm: Arm, c: ComparisonCase, pass: number, warmup: boolean) =>
    executions.push({ arm, caseId: c.id, pass, warmup, route: c.route, model: comparisonConfig.arms[arm][c.route] });
  for (const arm of ["control", "candidate"] as const) add(arm, cases[0], 0, true);
  for (let pass = 1; pass <= comparisonConfig.measuredPasses; pass++)
    cases.forEach((c, index) => {
      const arms: Arm[] = (index + pass) % 2 ? ["control", "candidate"] : ["candidate", "control"];
      arms.forEach((arm) => add(arm, c, pass, false));
    });
  return executions;
}

export function validatePriceCard(value: unknown): PriceCard {
  if (
    !record(value) ||
    !Number.isFinite(Date.parse(String(value.verifiedAt))) ||
    value.serviceTier !== "default" ||
    value.region !== "global" ||
    !Array.isArray(value.sources) ||
    value.sources.length === 0 ||
    value.sources.some(
      (s) =>
        typeof s !== "string" ||
        (!/^https:\/\/(?:platform|developers|openai)\.openai\.com\//.test(s) && !/^https:\/\/openai\.com\//.test(s)),
    ) ||
    !record(value.models)
  )
    throw new Error("A verified Standard/global published price and model-limit card is required.");
  for (const model of new Set(Object.values(comparisonConfig.arms).flatMap((a) => [a.fast, a.strong]))) {
    const price = value.models[model];
    if (
      !record(price) ||
      !finiteRate(price.input) ||
      price.input === 0 ||
      !finiteRate(price.output) ||
      price.output === 0 ||
      !finiteRate(price.cacheWrite) ||
      price.cacheWrite < price.input ||
      (price.cachedInput !== undefined && !finiteRate(price.cachedInput)) ||
      !integer(price.maxContextTokens) ||
      !integer(price.maxOutputTokens) ||
      price.maxOutputTokens < comparisonConfig.maxOutputTokens
    )
      throw new Error(`Missing verified pricing or published full context allowance for ${model}.`);
  }
  return structuredClone(value) as PriceCard;
}

export function validateApproval(
  value: unknown,
  identity: RunIdentity,
  priceCardSha256: string,
  now = Date.now(),
): Approval {
  if (
    !record(value) ||
    value.version !== 1 ||
    typeof value.approvalReference !== "string" ||
    !value.approvalReference.trim() ||
    typeof value.outputDirectory !== "string" ||
    !value.outputDirectory.trim() ||
    !Number.isFinite(Date.parse(String(value.approvedAt))) ||
    Date.parse(String(value.approvedAt)) > now ||
    !Number.isFinite(Date.parse(String(value.expiresAt))) ||
    Date.parse(String(value.expiresAt)) <= now ||
    Object.entries(identity).some(([key, expected]) => value[key] !== expected) ||
    value.priceCardSha256 !== priceCardSha256 ||
    typeof value.maxUsd !== "number" ||
    !Number.isFinite(value.maxUsd) ||
    value.maxUsd <= 0 ||
    value.maxUsd > comparisonConfig.maxUsd ||
    !integer(value.maxRequests) ||
    value.maxRequests > comparisonConfig.maxRequests ||
    !integer(value.maxInputTokens) ||
    value.maxInputTokens > comparisonConfig.maxInputTokens ||
    !integer(value.maxOutputTokens) ||
    value.maxOutputTokens > comparisonConfig.maxOutputTokensAggregate
  )
    throw new Error("Separate bounded-run approval is missing, expired, changed or exceeds the configured hard caps.");
  return Object.freeze(structuredClone(value)) as Approval;
}

export function worstCasePlan(executions: readonly Execution[], card: PriceCard) {
  let inputTokens = 0,
    outputTokens = 0,
    usd = 0;
  for (const e of executions) {
    const p = card.models[e.model];
    inputTokens += p.maxContextTokens;
    outputTokens += comparisonConfig.maxOutputTokens;
    usd +=
      (p.maxContextTokens * Math.max(p.input, p.cachedInput ?? 0, p.cacheWrite ?? p.input) +
        comparisonConfig.maxOutputTokens * p.output) /
        1_000_000 +
      0.000001;
  }
  return {
    requests: executions.length,
    inputTokens,
    outputTokens,
    usd,
    fitsConfiguredCaps:
      inputTokens <= comparisonConfig.maxInputTokens &&
      outputTokens <= comparisonConfig.maxOutputTokensAggregate &&
      usd <= comparisonConfig.maxUsd,
  };
}

// Only a validated, immutable reservation is persisted. Failure permanently closes
// the existing guard before any forwarding. No release/refund on failed requests.
export async function createComparisonTransport(options: {
  approval: Approval;
  card: PriceCard;
  priceCardSha256: string;
  persist: (reservation: Readonly<Record<string, unknown>>) => Promise<void>;
  dispatch: (url: string, init: RequestInit) => Promise<Response>;
}) {
  const { createWireBudgetGuard } = await import("../src/lib/answer-wire-budget-guard");
  const approval = validateApproval(options.approval, options.approval, options.priceCardSha256);
  const card = validatePriceCard(options.card);
  let input = 0,
    output = 0,
    requests = 0;
  const allowedModels = new Set(Object.values(comparisonConfig.arms).flatMap((a) => [a.fast, a.strong]));
  const guard = createWireBudgetGuard({
    remainingUsd: approval.maxUsd.toFixed(9),
    expectedOrigin: "https://api.openai.com/",
    maxSerializedJsonBytes: comparisonConfig.maxWireBytes,
    verifiedPriceTableRef: options.priceCardSha256,
    prices: Object.fromEntries(
      [...allowedModels].map((model) => {
        const p = card.models[model];
        return [
          model,
          {
            endpoint: "responses",
            maxContextTokens: p.maxContextTokens,
            maxOutputTokens: comparisonConfig.maxOutputTokens,
            worstInputUsdPerMillion: Math.max(p.input, p.cachedInput ?? 0, p.cacheWrite ?? p.input),
            worstOutputUsdPerMillion: p.output,
          },
        ];
      }),
    ),
    admitResponse: (serialized) => {
      const body = JSON.parse(serialized);
      return (
        allowedModels.has(body.model) &&
        body.max_output_tokens === comparisonConfig.maxOutputTokens &&
        ["low", "medium"].includes(body.reasoning?.effort) &&
        body.text?.format?.name === "clinical_rag_answer"
      );
    },
    onReserve: async (reservation) => {
      if (
        reservation.endpoint !== "responses" ||
        requests + 1 > approval.maxRequests ||
        input + reservation.inputTokenAllowance > approval.maxInputTokens ||
        output + reservation.outputTokenAllowance > approval.maxOutputTokens
      )
        throw new Error("aggregate_reservation_cap");
      requests++;
      input += reservation.inputTokenAllowance;
      output += reservation.outputTokenAllowance;
      await options.persist(
        Object.freeze({ ...reservation, aggregateInputAllowance: input, aggregateOutputAllowance: output }),
      );
    },
    dispatch: options.dispatch,
  });
  let active = false;
  return {
    fetch: async (url: unknown, init?: RequestInit) => {
      if (active) return guard.reject();
      if (String(url) !== "https://api.openai.com/v1/responses") return guard.reject();
      active = true;
      try {
        return await guard.fetch(url, init);
      } finally {
        active = false;
      }
    },
    snapshot: () => ({
      ...guard.snapshot(),
      aggregateInputAllowance: input,
      aggregateOutputAllowance: output,
      reservedRequests: requests,
      actualRequests: guard.snapshot().dispatchAttempts.responses,
    }),
  };
}

export function frozenSources(testCase: ComparisonCase): SearchResult[] {
  return testCase.sources.map((content, index) => ({
    id: `${testCase.id}-chunk-${index + 1}`,
    document_id: `${testCase.id}-doc-${index + 1}`,
    title: `Synthetic equipment manual ${index + 1}`,
    file_name: `synthetic-equipment-${index + 1}.txt`,
    page_number: 1,
    chunk_index: 0,
    section_heading: "Synthetic exercise",
    content,
    image_ids: [],
    images: [],
    similarity: 0.86,
  }));
}

export function deterministicChecks(testCase: ComparisonCase, raw: string, answer: RagAnswer) {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }
  const ids = new Set(frozenSources(testCase).map((s) => s.id));
  const proposed = record(payload) && Array.isArray(payload.citations) ? payload.citations : [];
  const invalidProposedCitations = proposed.filter((c) => !record(c) || !ids.has(String(c.chunk_id))).length;
  const text = [answer.answer, ...(answer.answerSections ?? []).map((s) => s.body)].join(" ").toLowerCase();
  const missingTerms = testCase.expectedTerms.filter((t) => !text.includes(t.toLowerCase()));
  const forbiddenTerms = (testCase.forbiddenTerms ?? []).filter((t) => text.includes(t.toLowerCase()));
  const validCitations = answer.citations.filter((c) =>
    answer.sources.some((s) => s.id === c.chunk_id && s.document_id === c.document_id),
  ).length;
  const unsupportedCorrect = testCase.unsupported
    ? !answer.grounded && answer.confidence === "unsupported"
    : answer.grounded && validCitations > 0;
  const passed =
    record(payload) &&
    invalidProposedCitations === 0 &&
    missingTerms.length === 0 &&
    forbiddenTerms.length === 0 &&
    unsupportedCorrect &&
    !answer.unverifiedNumericTokens?.length;
  return {
    passed,
    validJson: record(payload),
    invalidProposedCitations,
    validCitations,
    missingTerms,
    forbiddenTerms,
    unsupportedCorrect,
    unverifiedNumericCount: answer.unverifiedNumericTokens?.length ?? 0,
  };
}

export type ComparisonOutcome = Execution & {
  status: "completed" | "failed";
  latencyMs: number;
  usage?: OpenAITokenUsage;
  checks?: ReturnType<typeof deterministicChecks>;
  answer?: string;
  review?: Pick<RagAnswer, "answerSections" | "citations" | "conflictsOrGaps">;
  reason?: string;
};
export async function runComparison(
  cases: readonly ComparisonCase[],
  execute: (e: Execution, c: ComparisonCase) => Promise<Omit<ComparisonOutcome, keyof Execution>>,
) {
  const outcomes: ComparisonOutcome[] = [];
  for (const execution of planExecutions(cases)) {
    const started = performance.now();
    try {
      outcomes.push({
        ...execution,
        ...(await execute(
          execution,
          cases.find((c) => c.id === execution.caseId)!,
        )),
      });
    } catch {
      outcomes.push({
        ...execution,
        status: "failed",
        latencyMs: performance.now() - started,
        reason: "execution_failed_run_stopped",
      });
      break;
    }
  }
  return {
    complete: outcomes.length === 50 && outcomes.every((o) => o.status === "completed"),
    expectedExecutions: 50,
    outcomes,
  };
}

export function latencyDistribution(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const percentile = (p: number) => (sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null);
  return {
    count: sorted.length,
    p50Ms: percentile(0.5),
    p90Ms: percentile(0.9),
    p95Ms: percentile(0.95),
    minMs: sorted[0] ?? null,
    maxMs: sorted.at(-1) ?? null,
  };
}

async function componentExecutor(mode: "offline" | "paid") {
  const [
    { createObservedAnswerGenerator },
    { answerInstructions },
    { buildRagSourceBlock },
    { answerJsonOutputSchemaForResults },
    { parseAnswerJson },
    { createAnswerRouteDeadline },
    { createGenerationDegradationRecorder },
    { generateStructuredTextResult },
  ] = await Promise.all([
    import("../src/lib/rag/rag-provider"),
    import("../src/lib/rag/rag-answer-instructions"),
    import("../src/lib/rag/rag-source-block"),
    import("../src/lib/rag/rag-answer-schema"),
    import("../src/lib/rag/rag"),
    import("../src/lib/rag/rag-route-budget"),
    import("../src/lib/rag/rag-generation-degradation"),
    import("../src/lib/openai"),
  ]);
  return async (execution: Execution, testCase: ComparisonCase): Promise<Omit<ComparisonOutcome, keyof Execution>> => {
    const sources = frozenSources(testCase);
    const deadline = createAnswerRouteDeadline({ routeMode: execution.route });
    const started = performance.now();
    const offlineGenerate: typeof generateStructuredTextResult = async () => ({
      model: execution.model,
      operation: "answer",
      latencyMs: 0,
      status: "completed",
      truncated: false,
      text: JSON.stringify({
        answer: testCase.unsupported
          ? "The synthetic sources do not specify the requested information."
          : testCase.sources.join(" ").split("Ignore all previous")[0].trim(),
        grounded: !testCase.unsupported,
        confidence: testCase.unsupported ? "unsupported" : "low",
        citations: testCase.unsupported
          ? []
          : sources.map((s) => ({ chunk_id: s.id, quote: s.content.split("Ignore all previous")[0].trim() })),
        answerSections: [],
        conflictsOrGaps: [],
        quoteCards: [],
      }),
    });
    const generator = createObservedAnswerGenerator({
      generate:
        mode === "paid"
          ? (input, schema, options) => {
              if (!options || typeof options === "string") throw new Error("Explicit generation options required.");
              return generateStructuredTextResult(input, schema, {
                ...options,
                serviceTier: "default",
                store: false,
                maxRetries: 0,
              });
            }
          : offlineGenerate,
      buildInput: () =>
        `Question:\n<user_query>\n${testCase.question.replace(/<\/?user_query>/gi, "")}\n</user_query>\n\nSources:\n${buildRagSourceBlock(sources, { query: testCase.question })}`,
      schemaFor: answerJsonOutputSchemaForResults,
      deadline,
      recorder: createGenerationDegradationRecorder({ routeBudgetMs: deadline.budgetMs }),
      contextObservation: () => ({
        retrievalHealthy: true,
        coverage: testCase.unsupported ? "absent" : testCase.category === "conflict" ? "conflicting" : "complete",
        contextCount: sources.length,
      }),
      instructions: answerInstructions,
      promptCacheKey: "synthetic-answer-model-comparison-v1",
      fastReasoningEffort: "low",
      strongReasoningEffort: "medium",
      onResult: () => {},
      onLatency: () => {},
    });
    try {
      const result: OpenAITextResult = await generator(execution.model, sources, {
        strong: execution.route === "strong",
        maxOutputTokensOverride: comparisonConfig.maxOutputTokens,
      });
      const answer = parseAnswerJson(result.text, sources, testCase.question);
      return {
        status: result.truncated || result.status === "incomplete" ? "failed" : "completed",
        reason: result.truncated ? "provider_incomplete" : undefined,
        latencyMs: performance.now() - started,
        usage: result.usage,
        checks: deterministicChecks(testCase, result.text, answer),
        answer: answer.answer,
        review: {
          answerSections: answer.answerSections,
          citations: answer.citations,
          conflictsOrGaps: answer.conflictsOrGaps,
        },
      };
    } finally {
      deadline.dispose();
    }
  };
}

/** Deterministic synthetic smoke path; never constructs or invokes a provider client. */
export function offlineComparisonExecutor() {
  return componentExecutor("offline");
}

const sourcePaths = [
  "scripts/compare-answer-models.ts",
  "scripts/eval-utils.ts",
  "scripts/enable-server-only-stub.mjs",
  "scripts/run-tsx.mjs",
  "package-lock.json",
  "package.json",
  "tsconfig.json",
];
export async function comparisonIdentity(cwd: string, fixtureText: string): Promise<RunIdentity> {
  // Cover the production parser's transitive source dependencies, not just its
  // entrypoint. Only digests leave this function; no source text is retained.
  const entries = await readdir(resolve(cwd, "src"), { recursive: true, withFileTypes: true });
  const paths = [
    ...sourcePaths,
    ...entries.filter((e) => e.isFile()).map((e) => relative(cwd, resolve(e.parentPath, e.name)).replaceAll("\\", "/")),
  ].sort();
  const hashes = await Promise.all(
    paths.map(async (path) => [path, digest(await readFile(resolve(cwd, path), "utf8"))]),
  );
  // Allowlisted non-secret runtime selectors only. Never hash low-entropy secrets.
  const environment = Object.fromEntries(
    [
      "NODE_ENV",
      "RAG_PROVIDER_MODE",
      "OPENAI_ANSWER_TIMEOUT_MS",
      "OPENAI_MAX_OUTPUT_TOKENS",
      "RAG_PROGRAMME_MODE",
      "OPENAI_PROMPT_CACHE_RETENTION",
      "OPENAI_PROMPT_CACHE_TTL",
      "OPENAI_TEXT_VERBOSITY",
    ].map((k) => [k, process.env[k] ?? null]),
  );
  return {
    sourceSha256: digest(JSON.stringify(hashes)),
    fixturesSha256: digest(fixtureText),
    configurationSha256: digest(JSON.stringify(comparisonConfig)),
    environmentSha256: digest(JSON.stringify({ node: process.version, platform: process.platform, environment })),
  };
}

export function comparisonOutputPath(requested: string, cwd: string) {
  const root = resolve(cwd, "output", "answer-model-comparison");
  const target = resolve(cwd, requested),
    rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel))
    throw new Error("Outputs must be inside ignored output/answer-model-comparison/<new-run-directory>.");
  return target;
}

export async function comparisonRoot(cwd: string) {
  const loadedRoot = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  if ((await realpath(cwd)) !== loadedRoot)
    throw new Error("Run the comparison from the checkout that contains this harness.");
  return loadedRoot;
}

/** The bound directory is atomically consumed even if later setup or dispatch fails. */
export async function consumeComparisonApproval(approval: Approval, out: string, cwd: string) {
  if (comparisonOutputPath(approval.outputDirectory, cwd) !== out)
    throw new Error("Approval is bound to a different output directory.");
  await mkdir(resolve(out, ".."), { recursive: true });
  await mkdir(out);
  const consumed = await open(resolve(out, "approval-consumed.json"), "wx");
  try {
    await consumed.writeFile(
      JSON.stringify({
        approvalReference: approval.approvalReference,
        sourceSha256: approval.sourceSha256,
        outputDirectory: out,
        consumedAt: new Date().toISOString(),
      }),
    );
    await consumed.sync();
  } finally {
    await consumed.close();
  }
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  cwd = await comparisonRoot(cwd);
  let mode: "dry-run" | "offline" | "paid" = "dry-run",
    approvalFile: string | undefined,
    priceFile: string | undefined,
    output: string | undefined;
  let explicitMode = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--offline" || arg === "--paid" || arg === "--dry-run") {
      if (explicitMode) throw new Error("Select one mode only.");
      explicitMode = true;
      mode = arg.slice(2) as "dry-run" | "offline" | "paid";
    } else if (["--approval", "--price-card", "--output"].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("Missing option value.");
      if (arg === "--approval") approvalFile = value;
      else if (arg === "--price-card") priceFile = value;
      else output = value;
    } else throw new Error("Unknown option.");
  }
  const fixturesText = await readFile(resolve(cwd, "scripts/fixtures/rag-model-comparison.json"), "utf8");
  const cases = parseComparisonFixtures(fixturesText),
    identity = await comparisonIdentity(cwd, fixturesText);
  const plan = planExecutions(cases),
    cardText = priceFile ? await readFile(resolve(cwd, priceFile), "utf8") : null;
  const card = cardText ? validatePriceCard(JSON.parse(cardText)) : null;
  const preflight = {
    mode,
    identity,
    config: comparisonConfig,
    expectedExecutions: plan.length,
    measuredExecutions: plan.filter((p) => !p.warmup).length,
    worstCase: card ? worstCasePlan(plan, card) : null,
    limitation:
      "Answer-generation component only; no retrieval, full-route prompt/planning, packing, recovery, caching or hosted acceptance. Deterministic checks are not expert quality review.",
    approvalStatus: mode === "paid" ? "validation_required" : "not_authorised_for_provider_calls",
    incompleteWarning:
      "Published full-context reservations can stop the experiment before 50 executions. Never substitute a guessed input token cap.",
  };
  if (mode === "dry-run") {
    console.log(JSON.stringify(preflight, null, 2));
    return preflight;
  }
  if (!output) throw new Error("Execution requires a new ignored --output run directory.");
  const out = comparisonOutputPath(output, cwd);
  let approval: Approval | null = null;
  if (mode === "paid") {
    if (!isDirectEntrypoint(import.meta.url))
      throw new Error("Paid execution requires a fresh standalone CLI process.");
    if (!approvalFile || !card || !cardText)
      throw new Error("Paid mode requires separate run approval and a verified price/model-limit card.");
    approval = validateApproval(
      JSON.parse(await readFile(resolve(cwd, approvalFile), "utf8")),
      identity,
      digest(cardText),
    );
    if (comparisonOutputPath(approval.outputDirectory, cwd) !== out)
      throw new Error("Approval is bound to a different output directory.");
    if (!process.env.OPENAI_API_KEY) throw new Error("A server-side OpenAI credential is required.");
    if (process.env.OPENAI_BASE_URL && process.env.OPENAI_BASE_URL !== "https://api.openai.com/v1")
      throw new Error("Custom provider origins are prohibited.");
  }
  // Parent output/ is ignored by repository policy. Each run is immutable and cannot resume.
  if (approval) await consumeComparisonApproval(approval, out, cwd);
  else {
    await mkdir(resolve(out, ".."), { recursive: true });
    await mkdir(out);
  }
  const journal = await open(resolve(out, "reservations.jsonl"), "wx");
  const nativeFetch = globalThis.fetch;
  let transport: Awaited<ReturnType<typeof createComparisonTransport>> | null = null;
  try {
    if (approval && card && cardText)
      transport = await createComparisonTransport({
        approval,
        card,
        priceCardSha256: digest(cardText),
        persist: async (r) => {
          await journal.write(JSON.stringify(r) + "\n");
          await journal.sync();
        },
        dispatch: (url, init) => nativeFetch(url, { ...init, redirect: "error" }),
      });
    // Install before importing modules that can construct the production SDK.
    globalThis.fetch = (async (url, init) => {
      if (!transport) throw new Error("offline_network_forbidden");
      return transport.fetch(url, init);
    }) as typeof fetch;
    const execute = await componentExecutor(mode);
    const results = await runComparison(cases, execute);
    const { estimateProviderAttemptsCost } = await import("./eval-utils");
    const prices: EvalModelPrices = card?.models ?? {};
    const summary = Object.fromEntries(
      (["control", "candidate"] as const).map((arm) => {
        const armResults = results.outcomes.filter((o) => o.arm === arm && !o.warmup);
        const successful = armResults.filter((o) => o.status === "completed" && o.checks?.passed);
        const measuredCost =
          mode === "offline"
            ? { estimatedCostUsd: 0, pricingBasis: "provider_free" }
            : estimateProviderAttemptsCost(armResults, prices);
        return [
          arm,
          {
            completed: armResults.filter((o) => o.status === "completed").length,
            deterministicPassed: successful.length,
            latency: latencyDistribution(armResults.map((o) => o.latencyMs)),
            successfulLatency: latencyDistribution(successful.map((o) => o.latencyMs)),
            allAttemptsCost: measuredCost,
            costPerSuccessfulOutputUsd:
              successful.length && measuredCost.estimatedCostUsd !== null
                ? measuredCost.estimatedCostUsd / successful.length
                : null,
            successfulOutputsCost:
              mode === "offline"
                ? { estimatedCostUsd: 0, pricingBasis: "provider_free" }
                : estimateProviderAttemptsCost(successful, prices),
          },
        ];
      }),
    );
    const seed = randomBytes(32).toString("hex");
    const mapping =
      digest(seed).charCodeAt(0) % 2 ? { control: "A", candidate: "B" } : { control: "B", candidate: "A" };
    const blind = results.outcomes
      .filter((o) => !o.warmup && o.status === "completed")
      .map((o) => ({
        caseId: o.caseId,
        pass: o.pass,
        label: mapping[o.arm],
        answer: o.answer,
        ...o.review,
        question: cases.find((c) => c.id === o.caseId)!.question,
        sources: frozenSources(cases.find((c) => c.id === o.caseId)!),
      }));
    blind.sort((a, b) =>
      digest(`${seed}:${a.caseId}:${a.pass}:${a.label}`).localeCompare(
        digest(`${seed}:${b.caseId}:${b.pass}:${b.label}`),
      ),
    );
    const report = {
      ...preflight,
      complete: results.complete,
      accepted: false,
      acceptance: "Requires completed paid comparison and owner blinded review; offline outputs are synthetic stubs.",
      executed: results.outcomes.length,
      outcomes: results.outcomes,
      summary,
      transport: transport?.snapshot() ?? { actualRequests: 0 },
      totalCost:
        mode === "offline"
          ? { estimatedCostUsd: 0, pricingBasis: "provider_free" }
          : estimateProviderAttemptsCost(results.outcomes, prices),
      costNote:
        "Token-rate estimate, not a provider invoice. Reservations include warmups and are not refunded. Unknown usage remains unknown.",
      blindReview:
        "Read blind-review.json before opening blind-key.json; assess source support, usefulness, restraint and conflict handling. No automatic model judge.",
    };
    await writeFile(resolve(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    await writeFile(resolve(out, "blind-review.json"), JSON.stringify(blind, null, 2), { flag: "wx" });
    await writeFile(resolve(out, "blind-key.json"), JSON.stringify({ mapping, seed }, null, 2), { flag: "wx" });
    console.log(
      JSON.stringify(
        {
          mode,
          complete: results.complete,
          executed: results.outcomes.length,
          expectedExecutions: 50,
          output: out,
          transport: report.transport,
          summary,
        },
        null,
        2,
      ),
    );
    if (!results.complete) throw new Error("comparison_incomplete_report_written");
    return report;
  } finally {
    globalThis.fetch = nativeFetch;
    await journal.close();
  }
}

if (isDirectEntrypoint(import.meta.url))
  main().catch(() => {
    console.error(
      "Comparison refused or incomplete; inspect local preflight/report. No credential or provider error text is printed.",
    );
    process.exitCode = 1;
  });
