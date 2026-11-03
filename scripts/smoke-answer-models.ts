import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  comparisonConfig,
  comparisonIdentity,
  comparisonOutputPath,
  comparisonRoot,
  consumeComparisonApproval,
  deterministicChecks,
  frozenSources,
  latencyDistribution,
  offlineComparisonExecutor,
  parseComparisonFixtures,
  validateApproval,
  validatePriceCard,
  type Approval,
  type ComparisonCase,
  type ComparisonOutcome,
  type PriceCard,
  type RunIdentity,
} from "./compare-answer-models";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

export const smokeLimits = Object.freeze({
  generationRequests: 24,
  countRequests: 24,
  maxRequests: 48,
  maxOutputTokens: 16000,
  maxOutputTokensAggregate: 384000,
  maxInputTokens: 1000000,
  maxUsd: 15,
  maxRuntimeMs: 840000,
  countTimeoutMs: 5000,
  generationTimeoutMs: 30000,
});
export type SmokePriceCard = PriceCard & { counting: { usdPerRequest: number; source: string; verifiedAt: string } };
export type SmokeRequest = {
  model: string;
  caseId: string;
  arm: "control" | "candidate";
  route: "fast" | "strong";
  tokenBody: Record<string, unknown>;
};
export type SmokeCaps = {
  maxUsd: number;
  remainingMonthlyUsd: number;
  maxRequests: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxRuntimeMs: number;
};
export type SmokeTransportOptions = {
  plan: SmokeRequest[];
  card: SmokePriceCard;
  caps: SmokeCaps;
  persist: (record: Readonly<Record<string, unknown>>) => Promise<void>;
  dispatch: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
};

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const positive = (v: number) => Number.isSafeInteger(v) && v > 0;
const official = (url: unknown) =>
  typeof url === "string" && /^https:\/\/(?:developers|platform)\.openai\.com\//.test(url);
const tokenKeys = ["model", "input", "instructions", "reasoning", "text"];
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  const encoded = JSON.stringify(value);
  if (typeof encoded !== "string") return refused("body_invalid");
  return encoded;
}
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
function refused(reason: string): never {
  throw new Error(`model_smoke_${reason}`);
}

/** All rates in this transport are operator-verified bounds, never tokenizer guesses.
 * Count results belong to the exact frozen model/instructions/input/schema/effort.
 * Count fees and generation ceilings are reserved durably before each dispatch. */
export function createSmokeTransport(options: SmokeTransportOptions): {
  fetch(url: unknown, init?: RequestInit): Promise<Response>;
  startGeneration(): void;
  snapshot(): Record<string, unknown>;
} {
  const plan = structuredClone(options.plan),
    caps = Object.freeze({ ...options.caps });
  const prices = validatePriceCard(options.card);
  const counting = options.card.counting;
  if (
    !counting ||
    !Number.isFinite(counting.usdPerRequest) ||
    counting.usdPerRequest < 0 ||
    !official(counting.source) ||
    !Number.isFinite(Date.parse(counting.verifiedAt))
  )
    refused("count_pricing_unverified");
  if (
    !Number.isFinite(caps.maxUsd) ||
    caps.maxUsd <= 0 ||
    caps.maxUsd > smokeLimits.maxUsd ||
    !Number.isFinite(caps.remainingMonthlyUsd) ||
    caps.remainingMonthlyUsd > 30 ||
    caps.maxUsd > caps.remainingMonthlyUsd ||
    caps.maxRequests !== smokeLimits.maxRequests ||
    !positive(caps.maxInputTokens) ||
    caps.maxInputTokens > smokeLimits.maxInputTokens ||
    caps.maxOutputTokens !== smokeLimits.maxOutputTokensAggregate ||
    caps.maxRuntimeMs !== smokeLimits.maxRuntimeMs
  )
    refused("approval_caps_invalid");
  if (
    plan.length !== 24 ||
    new Set(plan.map((p) => p.caseId)).size !== 12 ||
    ["control", "candidate"].some((arm) => plan.filter((p) => p.arm === arm).length !== 12)
  )
    refused("plan_invalid");
  for (const p of plan) {
    const expectedModel = p.arm === "candidate" ? "gpt-6.1-sol" : p.route === "fast" ? "gpt-5.6-terra" : "gpt-5.6-sol";
    if (
      !["fast", "strong"].includes(p.route) ||
      p.model !== expectedModel ||
      p.tokenBody.model !== p.model ||
      Object.keys(p.tokenBody).sort().join() !== [...tokenKeys].sort().join() ||
      typeof p.tokenBody.input !== "string" ||
      typeof p.tokenBody.instructions !== "string" ||
      !object(p.tokenBody.reasoning) ||
      p.tokenBody.reasoning.effort !== (p.route === "fast" ? "low" : "medium") ||
      !object(p.tokenBody.text)
    )
      refused("plan_invalid");
    const pair = plan.filter((q) => q.caseId === p.caseId);
    if (pair.length !== 2 || pair[0]!.arm === pair[1]!.arm || pair[0]!.route !== pair[1]!.route)
      refused("plan_invalid");
  }
  const now = options.now ?? Date.now,
    started = now();
  const maximumMicroUsd = BigInt(Math.floor(caps.maxUsd * 1e6));
  const countMicroUsd = BigInt(Math.ceil(counting.usdPerRequest * 1e6));
  if (countMicroUsd * 24n > maximumMicroUsd) refused("count_plan_exceeds_budget");
  let stage: "counting" | "generation" | "complete" | "refused" = "counting";
  let countRequests = 0,
    generationRequests = 0,
    inputTokens = 0,
    outputTokens = 0,
    reserved = 0n,
    active = false;
  const counted: number[] = [],
    generationReservations: bigint[] = [];
  const fail = (reason: string): never => {
    stage = "refused";
    return refused(reason);
  };
  const check = () => {
    if (stage === "refused" || now() - started >= caps.maxRuntimeMs) fail("run_closed");
  };
  const generationMicroUsd = (p: SmokeRequest, n: number) => {
    const price = prices.models[p.model]!;
    const inputRate = Math.max(price.input, price.cachedInput ?? 0, price.cacheWrite ?? price.input);
    return BigInt(Math.ceil(n * inputRate + smokeLimits.maxOutputTokens * price.output) + 1);
  };
  return {
    snapshot: () => ({
      stage,
      countRequests,
      generationRequests,
      inputTokens,
      outputTokens,
      countedInputs: counted.map((n, index) => ({
        model: plan[index]!.model,
        caseId: plan[index]!.caseId,
        bodySha256: hash(plan[index]!.tokenBody),
        inputTokens: n,
      })),
      reservedMicroUsd: reserved.toString(),
    }),
    startGeneration() {
      check();
      if (active || stage !== "counting" || counted.length !== plan.length || countRequests !== plan.length)
        fail("counts_incomplete");
      const totalInput = counted.reduce((sum, n) => sum + n, 0);
      if (!Number.isSafeInteger(totalInput) || totalInput > caps.maxInputTokens) fail("exact_input_cap");
      for (const [index, p] of plan.entries()) {
        if (counted[index]! + smokeLimits.maxOutputTokens > prices.models[p.model]!.maxContextTokens)
          fail("context_cap");
        generationReservations.push(generationMicroUsd(p, counted[index]!));
      }
      if (reserved + generationReservations.reduce((a, b) => a + b, 0n) > maximumMicroUsd)
        fail("full_generation_budget");
      stage = "generation";
    },
    async fetch(url, init) {
      check();
      if (active || stage === "complete") return fail("unexpected_request");
      active = true;
      try {
        const isCount = stage === "counting",
          ordinal = isCount ? countRequests : generationRequests;
        const expected = plan[ordinal];
        if (
          !expected ||
          String(url) !== `https://api.openai.com/v1/responses${isCount ? "/input_tokens" : ""}` ||
          init?.method !== "POST" ||
          !/^application\/json(?:\s*;|$)/i.test(new Headers(init.headers).get("content-type") ?? "") ||
          typeof init.body !== "string" ||
          Buffer.byteLength(init.body) > 256000
        )
          return fail("wire_invalid");
        const body: unknown = JSON.parse(init.body);
        if (!object(body)) return fail("wire_invalid");
        const projection = Object.fromEntries(tokenKeys.map((key) => [key, body[key]]));
        if (hash(projection) !== hash(expected.tokenBody)) return fail("counted_body_changed");
        const allowed = isCount
          ? tokenKeys
          : [
              ...tokenKeys,
              "max_output_tokens",
              "store",
              "service_tier",
              "metadata",
              "prompt_cache_key",
              "prompt_cache_options",
            ];
        if (
          Object.keys(body).some((key) => !allowed.includes(key)) ||
          (!isCount &&
            (body.store !== false ||
              body.service_tier !== "default" ||
              body.max_output_tokens !== 16000 ||
              (body.metadata !== undefined && canonical(body.metadata) !== canonical({ operation: "answer" })) ||
              (body.prompt_cache_key !== undefined && body.prompt_cache_key !== "synthetic-answer-model-smoke-v1") ||
              (body.prompt_cache_options !== undefined &&
                canonical(body.prompt_cache_options) !== canonical({ ttl: "30m" }))))
        )
          return fail("wire_invalid");
        init.signal?.throwIfAborted();
        const reserve = isCount ? countMicroUsd : generationReservations[ordinal]!;
        if (reserved + reserve > maximumMicroUsd || countRequests + generationRequests + 1 > caps.maxRequests)
          return fail("reservation_cap");
        await options.persist(
          Object.freeze({
            phase: isCount ? "count" : "generation",
            ordinal,
            model: expected.model,
            caseId: expected.caseId,
            bodySha256: hash(projection),
            reservedMicroUsd: reserve.toString(),
            cumulativeMicroUsd: (reserved + reserve).toString(),
            inputTokens: isCount ? null : counted[ordinal],
            maxOutputTokens: isCount ? 0 : 16000,
          }),
        );
        check();
        init.signal?.throwIfAborted();
        reserved += reserve;
        if (isCount) countRequests++;
        else {
          generationRequests++;
          inputTokens += counted[ordinal]!;
          outputTokens += 16000;
        }
        const timeout = Math.min(isCount ? 5000 : 30000, caps.maxRuntimeMs - (now() - started));
        if (timeout <= 0) return fail("run_closed");
        const signal = init.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)])
          : AbortSignal.timeout(timeout);
        const response = await options.dispatch(String(url), { ...init, signal, redirect: "error" });
        check();
        if (!response.ok) return fail("provider_refused");
        if (isCount) {
          const text = await response.clone().text();
          if (Buffer.byteLength(text) > 16384) return fail("count_response_invalid");
          const data: unknown = JSON.parse(text);
          if (
            !object(data) ||
            data.object !== "response.input_tokens" ||
            !positive(Number(data.input_tokens)) ||
            typeof data.input_tokens !== "number"
          )
            return fail("count_response_invalid");
          counted.push(data.input_tokens);
        } else if (generationRequests === plan.length) stage = "complete";
        return response;
      } catch {
        return fail("run_closed");
      } finally {
        active = false;
      }
    },
  };
}

export async function buildSmokePlan(cases: readonly ComparisonCase[]): Promise<SmokeRequest[]> {
  const [{ answerInstructions }, { buildRagSourceBlock }, { answerJsonOutputSchemaForResults }, { env }] =
    await Promise.all([
      import("../src/lib/rag/rag-answer-instructions"),
      import("../src/lib/rag/rag-source-block"),
      import("../src/lib/rag/rag-answer-schema"),
      import("../src/lib/env"),
    ]);
  return cases.flatMap((c, index) =>
    (index % 2 ? (["candidate", "control"] as const) : (["control", "candidate"] as const)).map((arm) => {
      const model = comparisonConfig.arms[arm][c.route],
        sources = frozenSources(c);
      return {
        arm,
        model,
        caseId: c.id,
        route: c.route,
        tokenBody: {
          model,
          input: `Question:\n<user_query>\n${c.question.replace(/<\/?user_query>/gi, "")}\n</user_query>\n\nSources:\n${buildRagSourceBlock(sources, { query: c.question })}`,
          instructions: answerInstructions,
          reasoning: { effort: c.route === "fast" ? "low" : "medium" },
          text: {
            format: {
              type: "json_schema",
              name: "clinical_rag_answer",
              strict: true,
              schema: answerJsonOutputSchemaForResults(sources),
            },
            ...(/^gpt-5(?:[.-]|$)/.test(model) ? { verbosity: env.OPENAI_TEXT_VERBOSITY } : {}),
          },
        },
      };
    }),
  );
}

export async function runOfflineSmoke(cases: readonly ComparisonCase[]) {
  const plan = await buildSmokePlan(cases),
    execute = await offlineComparisonExecutor();
  const outcomes: ComparisonOutcome[] = [];
  for (const p of plan) {
    const execution = { arm: p.arm, caseId: p.caseId, model: p.model, route: p.route, pass: 1, warmup: false };
    outcomes.push({
      ...execution,
      ...(await execute(
        execution,
        cases.find((c) => c.id === p.caseId)!,
      )),
    });
  }
  return {
    complete: outcomes.length === 24 && outcomes.every((o) => o.status === "completed"),
    accepted: false,
    providerRequests: 0,
    outcomes,
  };
}

export type SmokeApproval = Approval & {
  remainingMonthlyUsd: number;
  monthlyBudgetMonth: string;
  monthlyUsageEvidenceSha256: string;
  maxRuntimeMs: number;
};
export function validateSmokeApproval(
  value: unknown,
  identity: RunIdentity,
  priceHash: string,
  now = Date.now(),
): SmokeApproval {
  validateApproval(value, identity, priceHash, now);
  const v = value as SmokeApproval;
  if (
    v.maxRequests !== 48 ||
    v.maxOutputTokens !== 384000 ||
    v.maxRuntimeMs !== 840000 ||
    v.monthlyBudgetMonth !== new Date(now).toISOString().slice(0, 7) ||
    !/^sha256:[a-f0-9]{64}$/.test(v.monthlyUsageEvidenceSha256) ||
    !Number.isFinite(v.remainingMonthlyUsd) ||
    v.remainingMonthlyUsd > 30 ||
    v.remainingMonthlyUsd < v.maxUsd
  )
    refused("monthly_or_scope_approval_invalid");
  return structuredClone(v);
}

/** Fresh CLI only: no existing SDK client or cross-run token counts are accepted. */
export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  cwd = await comparisonRoot(cwd);
  let mode: "dry-run" | "offline" | "paid" = "dry-run",
    explicit = false;
  let pricePath: string | undefined, approvalPath: string | undefined, output: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (["--dry-run", "--offline", "--paid"].includes(flag!)) {
      if (explicit) refused("mode_invalid");
      explicit = true;
      mode = flag!.slice(2) as typeof mode;
    } else if (["--price-card", "--approval", "--output"].includes(flag!)) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) refused("option_missing");
      if (flag === "--price-card") pricePath = value;
      else if (flag === "--approval") approvalPath = value;
      else output = value;
    } else refused("option_invalid");
  }
  const fixtureText = await readFile(resolve(cwd, "scripts/fixtures/rag-model-comparison.json"), "utf8");
  const cases = parseComparisonFixtures(fixtureText),
    plan = await buildSmokePlan(cases);
  const baseIdentity = await comparisonIdentity(cwd, fixtureText);
  const identity = {
    ...baseIdentity,
    sourceSha256: hash({
      base: baseIdentity.sourceSha256,
      smokeSource: await readFile(resolve(cwd, "scripts/smoke-answer-models.ts"), "utf8"),
    }),
    configurationSha256: hash({ limits: smokeLimits, plan }),
  };
  const preflight = {
    mode,
    identity,
    limits: smokeLimits,
    countRequests: 24,
    generationRequests: 24,
    outputTokenCeiling: 384000,
    inputTokens: "unknown_until_exact_count_endpoint_responses",
    exactTokenRequestHashes: plan.map((p) => ({ model: p.model, caseId: p.caseId, sha256: hash(p.tokenBody) })),
    limitations:
      "One synthetic component pass, no warmups or live retrieval. Requires verified prices/count fees/model access, current monthly balance and bounded approval. Does not activate a model or prove clinical quality.",
    budget:
      "At most approved USD cap, never above US$15 or verified remaining US$30 monthly budget. Count fees included; exact complete-plan cost must fit before generation. No retries, judges, embeddings, hosted jobs or indexing.",
  };
  if (mode === "dry-run") {
    console.log(JSON.stringify(preflight, null, 2));
    return preflight;
  }
  if (!output) refused("output_required");
  const out = comparisonOutputPath(output, cwd);
  let approval: SmokeApproval | undefined, card: SmokePriceCard | undefined;
  if (mode === "paid") {
    if (!isDirectEntrypoint(import.meta.url)) refused("standalone_cli_required");
    if (!pricePath || !approvalPath) refused("verified_price_and_approval_required");
    if (!process.env.OPENAI_API_KEY) refused("runtime_authentication_required");
    if (process.env.OPENAI_BASE_URL && process.env.OPENAI_BASE_URL !== "https://api.openai.com/v1")
      refused("custom_provider_origin");
    const priceText = await readFile(resolve(cwd, pricePath), "utf8");
    card = JSON.parse(priceText) as SmokePriceCard;
    approval = validateSmokeApproval(
      JSON.parse(await readFile(resolve(cwd, approvalPath), "utf8")),
      identity,
      createHash("sha256").update(priceText).digest("hex"),
    );
    // Validate the complete count scope and all ceilings before consuming approval.
    createSmokeTransport({
      plan,
      card,
      caps: { ...approval, maxRuntimeMs: approval.maxRuntimeMs },
      persist: async () => refused("preflight_only"),
      dispatch: async () => refused("preflight_only"),
    });
    await consumeComparisonApproval(approval, out, cwd);
  } else {
    await mkdir(resolve(out, ".."), { recursive: true });
    await mkdir(out);
  }
  const nativeFetch = globalThis.fetch;
  const journal = await open(resolve(out, "reservations.jsonl"), "wx");
  let transport: ReturnType<typeof createSmokeTransport> | undefined;
  const outcomes: ComparisonOutcome[] = [];
  try {
    if (approval && card)
      transport = createSmokeTransport({
        plan,
        card,
        caps: { ...approval, maxRuntimeMs: approval.maxRuntimeMs },
        persist: async (entry) => {
          await journal.write(JSON.stringify(entry) + "\n");
          await journal.sync();
        },
        dispatch: (url, init) => nativeFetch(url, init),
      });
    globalThis.fetch = (async (url, init) => {
      if (!transport) return refused("offline_network_forbidden");
      return transport.fetch(url, init);
    }) as typeof fetch;
    if (mode === "offline") {
      const report = { ...preflight, ...(await runOfflineSmoke(cases)) };
      await writeFile(resolve(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
      console.log(JSON.stringify({ complete: report.complete, providerRequests: 0, output: out }));
      return report;
    }
    const { createOpenAIClient, generateStructuredTextResult } = await import("../src/lib/openai");
    const { parseAnswerJson } = await import("../src/lib/rag/rag");
    const client = createOpenAIClient();
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), smokeLimits.maxRuntimeMs);
    let failure: string | undefined;
    try {
      for (const p of plan)
        await client.responses.inputTokens.count(p.tokenBody, {
          maxRetries: 0,
          timeout: 5000,
          signal: controller.signal,
        });
      transport!.startGeneration();
      for (const p of plan) {
        const c = cases.find((item) => item.id === p.caseId)!,
          sources = frozenSources(c),
          started = performance.now();
        const text = p.tokenBody.text as { format: { schema: Record<string, unknown> } };
        const result = await generateStructuredTextResult(p.tokenBody.input as string, text.format.schema, {
          model: p.model,
          operation: "answer",
          instructions: p.tokenBody.instructions as string,
          schemaName: "clinical_rag_answer",
          maxOutputTokens: 16000,
          reasoningEffort: p.route === "fast" ? "low" : "medium",
          maxRetries: 0,
          timeoutMs: 30000,
          signal: controller.signal,
          store: false,
          serviceTier: "default",
          promptCacheKey: "synthetic-answer-model-smoke-v1",
        });
        const answer = parseAnswerJson(result.text, sources, c.question);
        const providerMatches =
          !!result.providerModel &&
          (result.providerModel === p.model || result.providerModel.startsWith(`${p.model}-`));
        outcomes.push({
          arm: p.arm,
          caseId: p.caseId,
          model: p.model,
          route: p.route,
          pass: 1,
          warmup: false,
          status: result.truncated || !providerMatches ? "failed" : "completed",
          latencyMs: performance.now() - started,
          providerModel: result.providerModel ?? null,
          requestId: result.requestId ?? null,
          usage: result.usage,
          checks: deterministicChecks(c, result.text, answer),
          answer: answer.answer,
          review: {
            answerSections: answer.answerSections,
            citations: answer.citations,
            conflictsOrGaps: answer.conflictsOrGaps,
          },
        });
        if (outcomes.at(-1)!.status === "failed") break;
        console.log(JSON.stringify({ phase: "generation", completed: outcomes.length, planned: 24 }));
      }
    } catch {
      failure = "provider_or_budget_run_stopped";
      if (Number(transport!.snapshot().generationRequests) > outcomes.length) {
        const p = plan[outcomes.length]!;
        outcomes.push({
          arm: p.arm,
          caseId: p.caseId,
          model: p.model,
          route: p.route,
          pass: 1,
          warmup: false,
          status: "failed",
          latencyMs: 0,
          reason: "generation_failed_usage_unknown",
          providerModel: null,
          requestId: null,
        });
      }
    } finally {
      clearTimeout(timer);
    }
    const { estimateProviderAttemptsCost } = await import("./eval-utils");
    const snapshot = transport!.snapshot();
    const summary = Object.fromEntries(
      (["control", "candidate"] as const).map((arm) => {
        const attempts = outcomes.filter((o) => o.arm === arm),
          successful = attempts.filter((o) => o.status === "completed" && o.checks?.passed);
        const generation = estimateProviderAttemptsCost(attempts, card!.models);
        const countFeeEstimateUsd =
          plan.slice(0, Number(snapshot.countRequests)).filter((p) => p.arm === arm).length *
          card!.counting.usdPerRequest;
        const total = generation.estimatedCostUsd === null ? null : generation.estimatedCostUsd + countFeeEstimateUsd;
        return [
          arm,
          {
            attempted: attempts.length,
            deterministicPassed: successful.length,
            latency: latencyDistribution(attempts.map((o) => o.latencyMs)),
            generation,
            countFeeEstimateUsd,
            totalEstimatedUsd: total,
            costPerSuccessfulOutputUsd: successful.length && total !== null ? total / successful.length : null,
          },
        ];
      }),
    );
    const report = {
      ...preflight,
      accepted: false,
      complete: !failure && outcomes.length === 24 && outcomes.every((o) => o.status === "completed"),
      failure,
      outcomes,
      summary,
      transport: snapshot,
      generationCost: estimateProviderAttemptsCost(outcomes, card!.models),
      countFeeEstimateUsd: Number(snapshot.countRequests) * card!.counting.usdPerRequest,
      costNote:
        "Token-rate estimates include count fees and failed attempts; missing usage remains unknown. Reservations are worst-case ceilings, not provider invoices.",
      acceptance:
        "Requires owner quality/cost review and separate activation. Missing provider identity or failed/unknown usage is not passing evidence; offline results cannot establish model access.",
    };
    await writeFile(resolve(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    const seed = randomBytes(32).toString("hex"),
      mapping = hash(seed).charCodeAt(0) % 2 ? { control: "A", candidate: "B" } : { control: "B", candidate: "A" };
    const blind = outcomes
      .filter((o) => o.status === "completed")
      .map((o) => ({
        caseId: o.caseId,
        label: mapping[o.arm],
        answer: o.answer,
        ...o.review,
        question: cases.find((c) => c.id === o.caseId)!.question,
        sources: frozenSources(cases.find((c) => c.id === o.caseId)!),
      }));
    blind.sort((a, b) => hash([seed, a.caseId, a.label]).localeCompare(hash([seed, b.caseId, b.label])));
    await writeFile(resolve(out, "blind-review.json"), JSON.stringify(blind, null, 2), { flag: "wx" });
    await writeFile(resolve(out, "blind-key.json"), JSON.stringify({ seed, mapping }, null, 2), { flag: "wx" });
    console.log(
      JSON.stringify({ complete: report.complete, accepted: false, output: out, transport: report.transport }),
    );
    if (!report.complete) refused("incomplete_report_written");
    return report;
  } finally {
    globalThis.fetch = nativeFetch;
    await journal.close();
  }
}

if (isDirectEntrypoint(import.meta.url))
  main().catch(() => {
    console.error(
      "Model smoke refused or incomplete; inspect local preflight/report. Provider error text and credentials are not printed.",
    );
    process.exitCode = 1;
  });
