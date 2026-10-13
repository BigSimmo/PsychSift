import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { DEFAULT_EVAL_OWNER_ID, loadAdminClient, resolveEvalOwnerId } from "./eval-utils";
import { redactSensitiveText } from "./sensitive-text.mjs";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

export const supportedRetrievalRpcs = [
  "match_documents_for_query",
  "match_document_chunks_text",
  "match_document_lookup_chunks_text",
  "match_document_table_facts_text",
] as const;

const supportedRetrievalRpcSet = new Set<string>(supportedRetrievalRpcs);

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const genericCredentialAssignmentPattern =
  /\b(password|passphrase|token|credential|api[-_ ]?key|secret|service[-_ ]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;

export type ProfileArgs = {
  query: string;
  ownerEmail?: string;
  ownerId?: string;
  documentIds?: string[];
  matchCount: number;
  samples: number;
  analyze: boolean;
  output?: string;
  rpcs: string[];
  help: boolean;
};

export type ProfilePhase = "first_unprimed" | "warm_repeat";

export type PlanMetrics = {
  planning_time_ms: number | null;
  execution_time_ms: number | null;
  buffers: {
    shared_hit: number;
    shared_read: number;
    shared_dirtied: number;
    shared_written: number;
    temp_read: number;
    temp_written: number;
  };
  plan_node_types: string[];
  index_names: string[];
};

export type ProfileError = {
  code: string;
  message: string;
};

export type ProfileSample = PlanMetrics & {
  index: number;
  phase: ProfilePhase;
  client_round_trip_ms: number;
  error?: ProfileError;
};

type NumericSummary = {
  median: number | null;
  p90: number | null;
  max: number | null;
};

export const profileRetrievalUsage = `Usage: npm run profile:retrieval -- [options]

Options:
  --query <text>          Query text (default: patient safety plan)
  --owner-email <email>  Resolve the owner scope by email (never written to output)
  --owner-id <uuid>      Set the owner scope directly (never written to output)
  --document-ids <csv>   Restrict profiling to document IDs
  --match-count <n>      Positive result limit (default: 24)
  --samples <n>          Positive sequential sample count (default: 1)
  --rpc <csv>            Retrieval RPC names
  --analyze              Run EXPLAIN ANALYZE with buffers
  --output <path>        Write JSON evidence to this path
  --help                  Show this help

Sample 1 is labelled first_unprimed; later samples are warm_repeat. Managed
Supabase buffers are not flushed, so this tool never claims a true cold sample.`;

function requiredValue(argv: string[], index: number, token: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
  return value;
}

function positiveInteger(value: string, token: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${token} must be a positive integer.`);
  return parsed;
}

export function parseProfileArgs(
  argv: string[],
  environment: Record<string, string | undefined> = process.env,
): ProfileArgs {
  const args: ProfileArgs = {
    query: "patient safety plan",
    ownerEmail: environment.RAG_EVAL_OWNER_EMAIL,
    ownerId: environment.RAG_EVAL_OWNER_ID ?? environment.LOCAL_NO_AUTH_OWNER_ID,
    matchCount: 24,
    samples: 1,
    analyze: false,
    rpcs: [...supportedRetrievalRpcs],
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--analyze") {
      args.analyze = true;
      continue;
    }
    if (token === "--help") {
      args.help = true;
      continue;
    }
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);

    const value = requiredValue(argv, index, token);
    index += 1;
    if (token === "--query") args.query = value;
    else if (token === "--owner-email") {
      args.ownerEmail = value;
      args.ownerId = undefined;
    } else if (token === "--owner-id") {
      args.ownerId = value;
      args.ownerEmail = undefined;
    } else if (token === "--match-count") args.matchCount = positiveInteger(value, "--match-count");
    else if (token === "--samples") args.samples = positiveInteger(value, "--samples");
    else if (token === "--document-ids") {
      args.documentIds = value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    } else if (token === "--rpc") {
      args.rpcs = value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    } else if (token === "--output") args.output = value;
    else throw new Error(`Unknown option: ${token}`);
  }

  if (!args.query.trim()) throw new Error("--query must not be empty.");
  if (!args.rpcs.length) throw new Error("--rpc must include at least one RPC name.");
  const unsupportedRpc = args.rpcs.find((rpcName) => !supportedRetrievalRpcSet.has(rpcName));
  if (unsupportedRpc) throw new Error(`Unsupported retrieval RPC: ${sanitizeProfileText(unsupportedRpc)}`);
  if (args.documentIds && !args.documentIds.length) {
    throw new Error("--document-ids must include at least one document ID.");
  }
  return args;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function explainEnvelope(value: unknown) {
  if (typeof value === "string") {
    try {
      return explainEnvelope(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) return record(value[0]);
  return record(value);
}

function numericBlock(plan: Record<string, unknown> | null, key: string) {
  return finiteNumber(plan?.[key]) ?? 0;
}

function collectPlanShape(value: unknown, nodeTypes: Set<string>, indexNames: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) collectPlanShape(item, nodeTypes, indexNames);
    return;
  }
  const item = record(value);
  if (!item) return;
  if (typeof item["Node Type"] === "string") nodeTypes.add(item["Node Type"]);
  if (typeof item["Index Name"] === "string") indexNames.add(item["Index Name"]);
  for (const nested of Object.values(item)) collectPlanShape(nested, nodeTypes, indexNames);
}

export function extractPlanMetrics(value: unknown): PlanMetrics {
  const envelope = explainEnvelope(value);
  const plan = record(envelope?.Plan);
  const nodeTypes = new Set<string>();
  const indexNames = new Set<string>();
  collectPlanShape(plan, nodeTypes, indexNames);

  const metrics: PlanMetrics = {
    planning_time_ms: finiteNumber(envelope?.["Planning Time"]),
    execution_time_ms: finiteNumber(envelope?.["Execution Time"]),
    buffers: {
      shared_hit: numericBlock(plan, "Shared Hit Blocks"),
      shared_read: numericBlock(plan, "Shared Read Blocks"),
      shared_dirtied: numericBlock(plan, "Shared Dirtied Blocks"),
      shared_written: numericBlock(plan, "Shared Written Blocks"),
      temp_read: numericBlock(plan, "Temp Read Blocks"),
      temp_written: numericBlock(plan, "Temp Written Blocks"),
    },
    plan_node_types: [...nodeTypes].sort(),
    index_names: [...indexNames].sort(),
  };
  return metrics;
}

export function phaseForSample(index: number): ProfilePhase {
  if (!Number.isInteger(index) || index <= 0) throw new Error("Sample index must be a positive integer.");
  return index === 1 ? "first_unprimed" : "warm_repeat";
}

function rounded(value: number) {
  return Number(value.toFixed(3));
}

export function percentile(values: number[], percentileValue: number) {
  if (!values.length) return null;
  if (!(percentileValue > 0 && percentileValue <= 1))
    throw new Error("Percentile must be greater than 0 and at most 1.");
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(percentileValue * sorted.length) - 1];
}

function summarize(values: Array<number | null>): NumericSummary {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (!present.length) return { median: null, p90: null, max: null };
  return {
    median: rounded(percentile(present, 0.5)!),
    p90: rounded(percentile(present, 0.9)!),
    max: rounded(Math.max(...present)),
  };
}

export function aggregateProfileSamples(samples: ProfileSample[]) {
  const firstUnprimed = samples.find((sample) => sample.phase === "first_unprimed") ?? null;
  const warm = samples.filter((sample) => sample.phase === "warm_repeat");
  return {
    sample_count: samples.length,
    success_count: samples.filter((sample) => !sample.error).length,
    error_count: samples.filter((sample) => Boolean(sample.error)).length,
    first_unprimed: firstUnprimed,
    warm_repeat: {
      sample_count: warm.length,
      success_count: warm.filter((sample) => !sample.error).length,
      error_count: warm.filter((sample) => Boolean(sample.error)).length,
      client_round_trip_ms: summarize(warm.map((sample) => sample.client_round_trip_ms)),
      planning_time_ms: summarize(warm.map((sample) => sample.planning_time_ms)),
      execution_time_ms: summarize(warm.map((sample) => sample.execution_time_ms)),
    },
    all_samples: {
      client_round_trip_ms: summarize(samples.map((sample) => sample.client_round_trip_ms)),
      planning_time_ms: summarize(samples.map((sample) => sample.planning_time_ms)),
      execution_time_ms: summarize(samples.map((sample) => sample.execution_time_ms)),
    },
  };
}

export function sanitizeProfileError(value: unknown): ProfileError {
  const error = record(value);
  const rawCode = typeof error?.code === "string" && error.code.trim() ? error.code.trim() : "profile_rpc_error";
  const rawMessage =
    typeof error?.message === "string" ? error.message : value instanceof Error ? value.message : String(value);
  const message = sanitizeProfileText(rawMessage).replace(/\s+/g, " ").trim();
  return {
    code:
      sanitizeProfileText(rawCode)
        .replace(/[^a-zA-Z0-9_.-]/g, "_")
        .slice(0, 80) || "profile_rpc_error",
    message: message.slice(0, 500) || "Retrieval RPC profiling failed.",
  };
}

export function sanitizeProfileText(value: unknown) {
  return redactSensitiveText(String(value ?? ""))
    .replace(genericCredentialAssignmentPattern, "$1=[REDACTED]")
    .replace(emailPattern, "[REDACTED_EMAIL]")
    .replace(uuidPattern, "[REDACTED_UUID]");
}

export function safeProfileResultKey(value: string) {
  return sanitizeProfileText(value).replace(/[^a-zA-Z0-9_.-]+/g, "_");
}

type RpcClient = {
  rpc: (name: string, parameters: Record<string, unknown>) => Promise<{ data: unknown; error: unknown | null }>;
};

export async function profileRpcSequentially(
  supabase: RpcClient,
  rpcName: string,
  args: ProfileArgs,
  ownerId: string | undefined,
  now: () => number = () => performance.now(),
) {
  const samples: ProfileSample[] = [];
  for (let offset = 0; offset < args.samples; offset += 1) {
    const index = offset + 1;
    const startedAt = now();
    let data: unknown = null;
    let error: unknown | null = null;
    try {
      const response = await supabase.rpc("explain_retrieval_rpc", {
        p_rpc: rpcName,
        p_query_text: args.query,
        p_match_count: args.matchCount,
        p_owner_filter: ownerId,
        p_document_filters: args.documentIds,
        p_analyze: args.analyze,
      });
      data = response.data;
      error = response.error;
    } catch (cause) {
      error = cause;
    }
    const clientRoundTripMs = rounded(Math.max(0, now() - startedAt));
    const metrics = extractPlanMetrics(data);
    const sampleError = error
      ? sanitizeProfileError(error)
      : metrics.plan_node_types.length === 0
        ? {
            code: "missing_explain_plan",
            message: "EXPLAIN did not return a parseable plan.",
          }
        : args.analyze && metrics.execution_time_ms === null
          ? {
              code: "missing_analyze_execution_time",
              message: "EXPLAIN ANALYZE did not return an execution time.",
            }
          : undefined;
    samples.push({
      index,
      phase: phaseForSample(index),
      client_round_trip_ms: clientRoundTripMs,
      ...metrics,
      ...(sampleError ? { error: sampleError } : {}),
    });
  }
  return { samples, aggregate: aggregateProfileSamples(samples) };
}

export function profileRpcResultIsComplete(
  result: Awaited<ReturnType<typeof profileRpcSequentially>>,
  args: Pick<ProfileArgs, "samples" | "analyze">,
) {
  return (
    result.samples.length === args.samples &&
    result.samples.every(
      (sample) =>
        !sample.error && sample.plan_node_types.length > 0 && (!args.analyze || sample.execution_time_ms !== null),
    )
  );
}

export function profileOwnerScope(ownerId: string) {
  return ownerId === DEFAULT_EVAL_OWNER_ID ? "public_scope" : "owner_scoped";
}

export function buildProfileEvidencePayload(
  args: ProfileArgs,
  results: Record<string, unknown>,
  complete: boolean,
  ownerId: string,
  generatedAt = new Date().toISOString(),
) {
  return {
    generated_at: generatedAt,
    query_recorded: false,
    owner_scope: profileOwnerScope(ownerId),
    document_scope: args.documentIds?.length ? "filtered" : "all_accessible",
    match_count: args.matchCount,
    requested_samples: args.samples,
    analyze: args.analyze,
    status: complete ? "complete" : "incomplete",
    results,
  };
}

async function main() {
  loadEnvConfig(process.cwd());
  const args = parseProfileArgs(process.argv.slice(2));
  if (args.help) {
    console.log(profileRetrievalUsage);
    return;
  }

  const supabase = await loadAdminClient();
  const ownerId = await resolveEvalOwnerId(supabase, args);
  const results: Record<string, unknown> = {};
  let complete = true;
  for (const rpcName of args.rpcs) {
    const result = await profileRpcSequentially(supabase as unknown as RpcClient, rpcName, args, ownerId);
    results[safeProfileResultKey(rpcName)] = result;
    complete = profileRpcResultIsComplete(result, args) && complete;
  }

  const payload = buildProfileEvidencePayload(args, results, complete, ownerId);
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  if (args.output) {
    const outputPath =
      args.output.includes("\\") || args.output.includes("/") ? args.output : join(process.cwd(), args.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, json, "utf8");
    console.log(`Retrieval RPC profile written to ${outputPath}`);
  } else {
    console.log(json.trimEnd());
  }
  if (!complete) {
    console.error("Retrieval RPC profile incomplete; inspect the sanitized sample errors in the output.");
    process.exitCode = 1;
  }
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(sanitizeProfileError(error).message);
    process.exitCode = 1;
  });
}
