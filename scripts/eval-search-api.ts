import { execFileSync } from "node:child_process";
import { loadEnvConfig } from "@next/env";
import { selectRagEvalCases } from "@/lib/rag/rag-eval-cases";

loadEnvConfig(process.cwd());

type Args = {
  baseUrl?: string;
  authToken?: string;
  limit?: number;
  question?: string;
  json: boolean;
  failOnThreshold: boolean;
};

type ApiSearchEvalResult = {
  id: string;
  question: string;
  status: number;
  ok: boolean;
  payloadBytes: number;
  resultCount: number;
  queryClass: string | null;
  retrievalStrategy: string | null;
  topFile: string | null;
  failures: string[];
};

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, failOnThreshold: false };
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
    if (token === "--base-url") args.baseUrl = value.replace(/\/+$/, "");
    if (token === "--auth-token") args.authToken = value;
    if (token === "--limit") args.limit = Number.parseInt(value, 10);
    if (token === "--question") args.question = value;
  }
  return args;
}

function ensuredBaseUrl() {
  return execFileSync(process.execPath, ["scripts/ensure-local-server.mjs", "--print-url"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

// Only dedicated eval user tokens. SUPABASE_ACCESS_TOKEN is the Supabase CLI management token
// here, which never authenticates /api/search and must not be sent to --base-url as a bearer.
function envAuthToken() {
  return process.env.RAG_EVAL_API_AUTH_TOKEN?.trim() || process.env.RAG_EVAL_AUTH_TOKEN?.trim() || "";
}

function isLocalNoAuthEval() {
  return process.env.LOCAL_NO_AUTH === "true" || process.env.NEXT_PUBLIC_LOCAL_NO_AUTH === "true";
}

function validate(result: ApiSearchEvalResult, testCase: ReturnType<typeof selectRagEvalCases>[number]) {
  const failures: string[] = [];
  if (!result.ok) failures.push(`HTTP ${result.status}`);
  if (testCase.supported && result.resultCount === 0) failures.push("expected API search results");
  if (!testCase.supported && result.resultCount > 0) failures.push("unsupported API search returned results");
  if (testCase.expectedQueryClass && result.queryClass !== testCase.expectedQueryClass) {
    failures.push(`expected query class ${testCase.expectedQueryClass}, got ${result.queryClass ?? "none"}`);
  }
  const maxPayload = testCase.supported ? 180_000 : 30_000;
  if (result.payloadBytes > maxPayload) failures.push(`payload ${result.payloadBytes} bytes exceeds ${maxPayload}`);
  return failures;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args.baseUrl ?? ensuredBaseUrl();
  const authToken = args.authToken?.trim() || envAuthToken();
  const cases = selectRagEvalCases({ limit: args.limit, question: args.question });
  const results: ApiSearchEvalResult[] = [];

  for (const testCase of cases) {
    const response = await fetch(`${baseUrl}/api/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ query: testCase.question, topK: 8 }),
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    const result: ApiSearchEvalResult = {
      id: testCase.id,
      question: testCase.question,
      status: response.status,
      ok: response.ok,
      payloadBytes: Buffer.byteLength(text, "utf8"),
      resultCount: Array.isArray(payload.results) ? payload.results.length : 0,
      queryClass: payload.telemetry?.query_class ?? null,
      retrievalStrategy: payload.telemetry?.retrieval_strategy ?? null,
      topFile: payload.results?.[0]?.file_name ?? null,
      failures: [],
    };
    result.failures = validate(result, testCase);
    results.push(result);
    if (!args.json) {
      console.log(
        `API_SEARCH ${result.id} status=${result.status} bytes=${result.payloadBytes} results=${result.resultCount} strategy=${result.retrievalStrategy ?? "none"} failures=${result.failures.join(";") || "none"}`,
      );
    }
  }

  const thresholdFailures = results.filter((result) => result.failures.length > 0).map((result) => result.id);
  const unauthorized = results.some((result) => result.status === 401);
  if (args.json) console.log(JSON.stringify({ baseUrl, results, thresholdFailures }, null, 2));
  if (unauthorized && !authToken && !isLocalNoAuthEval()) {
    console.error(
      "API search eval was rejected by the real-mode auth gate. Pass --auth-token or set RAG_EVAL_API_AUTH_TOKEN or RAG_EVAL_AUTH_TOKEN to a Supabase user access token, or run the ensured local server with LOCAL_NO_AUTH=true and NEXT_PUBLIC_LOCAL_NO_AUTH=true.",
    );
  }
  if (args.failOnThreshold && thresholdFailures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
