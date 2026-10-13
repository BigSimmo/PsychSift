import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import {
  classifyFeedbackForEval,
  validFeedbackInteractionId,
  type FeedbackEvalTriage,
} from "../src/lib/rag/feedback-eval-triage";
import {
  checkSupabaseProjectConfig,
  expectedSupabaseProject,
  type SupabaseProjectConfig,
} from "../src/lib/supabase/project";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const limits = Object.freeze({
  maxWindowMs: 7 * 24 * 60 * 60_000,
  maxFeedbackRows: 200,
  feedbackPageSize: 50,
  maxFeedbackPages: 5,
  joinBatchSize: 50,
  maxJoinRowsPerBatch: 100,
  joinSentinelLimit: 101,
  maxJoinRequests: 8,
  maxRequests: 13,
  requestTimeoutMs: 15_000,
  maxReceiptValidityMs: 15 * 60_000,
  maxLocalFileBytes: 2 * 1024 * 1024,
});
const operation = "answer_feedback_eval_triage_read";
const projections = {
  feedback: "interaction_id,feedback_category",
  answer:
    "interactionId:metadata->>interaction_id,generation_outcome:metadata->rag_diagnostics->>generation_outcome,required_part_count:metadata->rag_diagnostics->required_part_count,represented_part_count:metadata->rag_diagnostics->represented_part_count",
  retrieval:
    "interactionId:metadata->answer->>interaction_id,generation_outcome:metadata->answer->rag_diagnostics->>generation_outcome,required_part_count:metadata->answer->rag_diagnostics->required_part_count,represented_part_count:metadata->answer->rag_diagnostics->represented_part_count",
} as const;

type Row = Record<string, unknown>;
function record(value: unknown): value is Row {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function utc(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
}
class ReportError extends Error {
  constructor(
    readonly code:
      | "FEEDBACK_ARGUMENTS_INVALID"
      | "FEEDBACK_EXPORT_INVALID"
      | "FEEDBACK_APPROVAL_INVALID"
      | "FEEDBACK_IDENTITY_INVALID"
      | "FEEDBACK_READ_FAILED"
      | "FEEDBACK_READ_EXHAUSTED",
  ) {
    super(code);
  }
}

export function buildFeedbackReadPlan(args: { projectRef: string; from: string; to: string }, now = Date.now()) {
  const from = utc(args.from),
    to = utc(args.to);
  if (
    args.projectRef !== expectedSupabaseProject.ref ||
    !Number.isFinite(now) ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from >= to ||
    to > now ||
    to - from > limits.maxWindowMs
  )
    throw new ReportError("FEEDBACK_ARGUMENTS_INVALID");
  const plan = {
    version: "answer-feedback-read-plan-v1",
    operation,
    projectRef: expectedSupabaseProject.ref,
    projectUrl: expectedSupabaseProject.url,
    feedbackWindow: { from: args.from, to: args.to, predicate: "created_at >= from AND created_at < to" },
    feedback: {
      table: "rag_answer_feedback",
      projection: projections.feedback,
      order: "interaction_id.asc",
      pagination: "bounded_offset_with_sentinel",
      count: "exact",
    },
    joins: [
      {
        table: "rag_queries",
        projection: projections.answer,
        interactionFilter: "metadata->>interaction_id",
        extraFilter: null,
      },
      {
        table: "rag_retrieval_logs",
        projection: projections.retrieval,
        interactionFilter: "metadata->answer->>interaction_id",
        extraFilter: { column: "metadata->answer->>log_source", value: "answer" },
      },
    ],
    telemetryTimePolicy: "any_created_at_for_exact_feedback_interaction_ids",
    joinPolicy: "batched_ids_exact_count_no_pagination_sentinel_fails_scan_duplicates_incomplete",
    output: "stdout_json_content_free_aggregates_and_validated_candidate_ids",
    transport: { retries: 0, redirects: "error", timeout: "min_request_cap_and_remaining_receipt_validity" },
    consistency: "bounded_reads_not_a_database_snapshot",
    limits,
    requiresDeidentificationReview: true,
    mayAutoPromote: false,
  };
  return { ...plan, planDigest: createHash("sha256").update(JSON.stringify(plan)).digest("hex") };
}

type ReadPlan = ReturnType<typeof buildFeedbackReadPlan>;
type Options = { mode: "input"; input: string } | { mode: "live" | "print-plan"; plan: ReadPlan; receipt?: string };
function parseArgs(argv: readonly string[], now: number): Options {
  const values = new Map<string, string>();
  const seen = new Set<string>();
  const flags = ["--live", "--print-plan"];
  const valueFlags = ["--input", "--from", "--to", "--project-ref", "--confirm-project-ref", "--authorization-receipt"];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (seen.has(flag)) throw new ReportError("FEEDBACK_ARGUMENTS_INVALID");
    seen.add(flag);
    if (flags.includes(flag)) continue;
    if (!valueFlags.includes(flag)) throw new ReportError("FEEDBACK_ARGUMENTS_INVALID");
    const value = argv[++i];
    if (!value || value.startsWith("--") || /[\u0000-\u001f\u007f]/.test(value))
      throw new ReportError("FEEDBACK_ARGUMENTS_INVALID");
    values.set(flag, value);
  }
  if (seen.has("--input")) {
    if (seen.size !== 1) throw new ReportError("FEEDBACK_ARGUMENTS_INVALID");
    return { mode: "input", input: values.get("--input")! };
  }
  if (seen.has("--live") === seen.has("--print-plan")) throw new ReportError("FEEDBACK_ARGUMENTS_INVALID");
  const live = seen.has("--live");
  if (
    seen.size !== (live ? 6 : 5) ||
    seen.has("--authorization-receipt") !== live ||
    !values.get("--project-ref") ||
    values.get("--project-ref") !== values.get("--confirm-project-ref")
  )
    throw new ReportError("FEEDBACK_ARGUMENTS_INVALID");
  return {
    mode: live ? "live" : "print-plan",
    plan: buildFeedbackReadPlan(
      { projectRef: values.get("--project-ref")!, from: values.get("--from")!, to: values.get("--to")! },
      now,
    ),
    receipt: values.get("--authorization-receipt"),
  };
}

function assertReceipt(value: unknown, plan: ReadPlan, now: number) {
  if (!record(value)) throw new ReportError("FEEDBACK_APPROVAL_INVALID");
  const authorizedAt = utc(value.authorizedAt),
    expiresAt = utc(value.expiresAt);
  if (
    Object.keys(value).sort().join(",") !== "authorizedAt,expiresAt,operation,planDigest,projectRef,version" ||
    value.version !== "provider-authorization-v1" ||
    value.operation !== operation ||
    value.projectRef !== plan.projectRef ||
    value.planDigest !== plan.planDigest ||
    !Number.isFinite(now) ||
    !Number.isFinite(authorizedAt) ||
    !Number.isFinite(expiresAt) ||
    authorizedAt > now ||
    expiresAt <= now ||
    authorizedAt >= expiresAt ||
    expiresAt - authorizedAt > limits.maxReceiptValidityMs
  )
    throw new ReportError("FEEDBACK_APPROVAL_INVALID");
}
function assertIdentity(config: SupabaseProjectConfig, plan: ReadPlan) {
  const check = checkSupabaseProjectConfig(config, { requireMetadata: true });
  // Exact spelling also rejects explicit :443, userinfo, paths, query, fragments and normalization tricks.
  if (
    config.NEXT_PUBLIC_SUPABASE_URL !== expectedSupabaseProject.url ||
    check.status !== "ready" ||
    check.expected.ref !== plan.projectRef ||
    check.observed.urlRef !== plan.projectRef ||
    check.observed.configuredRef !== plan.projectRef ||
    check.observed.environment !== "production"
  )
    throw new ReportError("FEEDBACK_IDENTITY_INVALID");
}

type ReadResponse = { data: unknown; error: unknown; count: number | null };
type ReadQuery = PromiseLike<ReadResponse> & {
  gte(column: string, value: unknown): ReadQuery;
  lt(column: string, value: unknown): ReadQuery;
  eq(column: string, value: unknown): ReadQuery;
  in(column: string, values: readonly string[]): ReadQuery;
  order(column: string, options: { ascending: boolean }): ReadQuery;
  range(from: number, to: number): ReadQuery;
  limit(count: number): ReadQuery;
  abortSignal(signal: AbortSignal): ReadQuery;
  retry(enabled: boolean): ReadQuery;
};
export type FeedbackReadClient = {
  from(table: string): { select(projection: string, options: { count: "exact" }): ReadQuery };
};
export type FeedbackReportDependencies = {
  readJson(path: string): Promise<unknown>;
  loadConfig(): Promise<SupabaseProjectConfig>;
  createClient(url: string): Promise<FeedbackReadClient>;
  now(): number;
};

type FeedbackExport = {
  version: "answer-feedback-export-v1";
  feedback: unknown[];
  answers: unknown[];
  retrievals: unknown[];
};
function exportInput(value: unknown): FeedbackExport {
  if (
    !record(value) ||
    value.version !== "answer-feedback-export-v1" ||
    !Array.isArray(value.feedback) ||
    !Array.isArray(value.answers) ||
    !Array.isArray(value.retrievals) ||
    value.feedback.length > limits.maxFeedbackRows ||
    value.answers.length > limits.maxJoinRowsPerBatch * 4 ||
    value.retrievals.length > limits.maxJoinRowsPerBatch * 4
  )
    throw new ReportError("FEEDBACK_EXPORT_INVALID");
  return {
    version: "answer-feedback-export-v1",
    feedback: value.feedback,
    answers: value.answers,
    retrievals: value.retrievals,
  };
}

function groupByInteraction(rows: unknown[]) {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    if (!record(row) || !validFeedbackInteractionId(row.interactionId))
      throw new ReportError("FEEDBACK_EXPORT_INVALID");
    const id = row.interactionId.toLowerCase();
    grouped.set(id, [...(grouped.get(id) ?? []), row]);
  }
  return grouped;
}

function report(input: FeedbackExport) {
  const feedback = groupByInteraction(input.feedback),
    answers = groupByInteraction(input.answers),
    retrievals = groupByInteraction(input.retrievals);
  const records: FeedbackEvalTriage[] = [];
  for (const [interactionId, rows] of feedback) {
    const answer = answers.get(interactionId) ?? [],
      retrieval = retrievals.get(interactionId) ?? [];
    const triage = classifyFeedbackForEval({
      feedback: {
        interactionId,
        category: rows.length === 1 && typeof rows[0]!.category === "string" ? rows[0]!.category : "unknown",
      },
      answerMetadata: answer.length === 1 ? answer[0]! : null,
      retrievalMetadata: retrieval.length === 1 ? retrieval[0]! : null,
    });
    for (const [side, matches] of [
      ["feedback", rows],
      ["answer", answer],
      ["retrieval", retrieval],
    ] as const) {
      if (matches.length > 1) triage.diagnosticReasonCodes.push(`${side}_join_ambiguous`);
    }
    records.push(triage);
  }
  const count = (values: string[]) =>
    values.reduce<Record<string, number>>((result, value) => {
      result[value] = (result[value] ?? 0) + 1;
      return result;
    }, {});
  return {
    version: "answer-feedback-triage-report-v1",
    status: "complete",
    totalFeedback: input.feedback.length,
    distinctInteractions: records.length,
    incompleteRecords: records.filter((row) =>
      row.diagnosticReasonCodes.some((code) =>
        /_missing$|_incomplete$|_ambiguous$|_invalid$|_conflict$|^feedback_unknown$/.test(code),
      ),
    ).length,
    categoryCounts: count(records.map((row) => row.category)),
    actionCounts: count(records.map((row) => row.recommendedAction)),
    diagnosticReasonCounts: count(records.flatMap((row) => row.diagnosticReasonCodes)),
    candidateInteractionIds: records
      .filter((row) => row.recommendedAction === "candidate_eval_case" || row.recommendedAction === "clinical_review")
      .map((row) => row.interactionId)
      .sort(),
    requiresDeidentificationReview: true,
    mayAutoPromote: false,
  };
}

async function liveExport(
  plan: ReadPlan,
  receipt: unknown,
  client: FeedbackReadClient,
  now: () => number,
): Promise<FeedbackExport> {
  let requests = 0,
    joinRequests = 0;
  const read = async (query: ReadQuery, cap: number): Promise<{ rows: Row[]; count: number }> => {
    const requestAt = now();
    assertReceipt(receipt, plan, requestAt);
    if (++requests > limits.maxRequests) throw new ReportError("FEEDBACK_READ_EXHAUSTED");
    const remainingValidity = utc((receipt as Row).expiresAt) - requestAt;
    const { data, error, count } = await query
      .retry(false)
      .abortSignal(AbortSignal.timeout(Math.min(limits.requestTimeoutMs, remainingValidity)));
    assertReceipt(receipt, plan, now());
    if (
      error ||
      !Array.isArray(data) ||
      !data.every(record) ||
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 0
    )
      throw new ReportError("FEEDBACK_READ_FAILED");
    if (data.length > cap || count > cap) throw new ReportError("FEEDBACK_READ_EXHAUSTED");
    return { rows: data, count };
  };
  const feedback: Row[] = [];
  const seenFeedbackIds = new Set<string>();
  let finished = false;
  let feedbackCount: number | null = null;
  for (let page = 0; page < limits.maxFeedbackPages; page++) {
    const offset = page * limits.feedbackPageSize;
    const pageSize = Math.min(limits.feedbackPageSize, limits.maxFeedbackRows - feedback.length + 1);
    const { rows, count } = await read(
      client
        .from(plan.feedback.table)
        .select(plan.feedback.projection, { count: "exact" })
        .gte("created_at", plan.feedbackWindow.from)
        .lt("created_at", plan.feedbackWindow.to)
        .order("interaction_id", { ascending: true })
        .range(offset, offset + pageSize - 1),
      limits.maxFeedbackRows,
    );
    if (
      (feedbackCount !== null && feedbackCount !== count) ||
      rows.length !== Math.min(pageSize, Math.max(0, count - offset))
    )
      throw new ReportError("FEEDBACK_READ_EXHAUSTED");
    // The live table has UNIQUE interaction_id. Repeated IDs mean paging drift,
    // unlike duplicate rows in a local export, which remain incomplete triage.
    for (const row of rows) {
      if (!validFeedbackInteractionId(row.interaction_id)) throw new ReportError("FEEDBACK_READ_FAILED");
      const interactionId = row.interaction_id.toLowerCase();
      if (seenFeedbackIds.has(interactionId)) throw new ReportError("FEEDBACK_READ_EXHAUSTED");
      seenFeedbackIds.add(interactionId);
    }
    feedbackCount = count;
    feedback.push(...rows.map((row) => ({ interactionId: row.interaction_id, category: row.feedback_category })));
    if (feedback.length > limits.maxFeedbackRows) throw new ReportError("FEEDBACK_READ_EXHAUSTED");
    if (rows.length < pageSize) {
      finished = true;
      break;
    }
  }
  if (!finished) throw new ReportError("FEEDBACK_READ_EXHAUSTED");
  const ids = [...groupByInteraction(feedback).keys()];
  const sides: Row[][] = [[], []];
  for (let offset = 0; offset < ids.length; offset += limits.joinBatchSize) {
    const batch = ids.slice(offset, offset + limits.joinBatchSize);
    for (const [index, join] of plan.joins.entries()) {
      if (++joinRequests > limits.maxJoinRequests) throw new ReportError("FEEDBACK_READ_EXHAUSTED");
      let query = client.from(join.table).select(join.projection, { count: "exact" }).in(join.interactionFilter, batch);
      if (join.extraFilter) query = query.eq(join.extraFilter.column, join.extraFilter.value);
      const { rows, count } = await read(query.limit(limits.joinSentinelLimit), limits.maxJoinRowsPerBatch);
      if (rows.length !== count) throw new ReportError("FEEDBACK_READ_EXHAUSTED");
      if (
        rows.some(
          (row) => !validFeedbackInteractionId(row.interactionId) || !batch.includes(row.interactionId.toLowerCase()),
        )
      )
        throw new ReportError("FEEDBACK_READ_FAILED");
      sides[index]!.push(...rows);
    }
  }
  return { version: "answer-feedback-export-v1", feedback, answers: sides[0]!, retrievals: sides[1]! };
}

/** All credential-bearing imports and reads are deferred until exact plan/receipt/identity validation. */
const defaultDependencies: FeedbackReportDependencies = {
  async readJson(path) {
    const file = await open(resolve(path), "r");
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > limits.maxLocalFileBytes) throw new ReportError("FEEDBACK_EXPORT_INVALID");
      const bytes = Buffer.alloc(limits.maxLocalFileBytes + 1);
      let length = 0;
      while (length < bytes.length) {
        const next = await file.read(bytes, length, bytes.length - length, null);
        if (next.bytesRead === 0) break;
        length += next.bytesRead;
      }
      if (length > limits.maxLocalFileBytes) throw new ReportError("FEEDBACK_EXPORT_INVALID");
      return JSON.parse(bytes.subarray(0, length).toString("utf8")) as unknown;
    } finally {
      await file.close();
    }
  },
  async loadConfig() {
    return {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_PROJECT_REF: process.env.SUPABASE_PROJECT_REF,
      SUPABASE_PROJECT_NAME: process.env.SUPABASE_PROJECT_NAME,
      SUPABASE_STAGING_PROJECT_REF: process.env.SUPABASE_STAGING_PROJECT_REF,
      SUPABASE_STAGING_PROJECT_NAME: process.env.SUPABASE_STAGING_PROJECT_NAME,
    };
  },
  async createClient(url) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new ReportError("FEEDBACK_IDENTITY_INVALID");
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, redirect: "error" }) },
    });
    // Adapt only the used read operations. Comparing the entire generic Supabase
    // builder to ReadQuery recursively instantiates its schema/projection types.
    return {
      from(table) {
        return {
          select(projection, options) {
            const query = client.from(table).select(projection, options);
            const bounded: ReadQuery = {
              gte(column, value) {
                query.gte(column, value);
                return bounded;
              },
              lt(column, value) {
                query.lt(column, value);
                return bounded;
              },
              eq(column, value) {
                query.eq(column, value);
                return bounded;
              },
              in(column, values) {
                query.in(column, values);
                return bounded;
              },
              order(column, options) {
                query.order(column, options);
                return bounded;
              },
              range(from, to) {
                query.range(from, to);
                return bounded;
              },
              limit(count) {
                query.limit(count);
                return bounded;
              },
              abortSignal(signal) {
                query.abortSignal(signal);
                return bounded;
              },
              retry(enabled) {
                query.retry(enabled);
                return bounded;
              },
              then(onfulfilled, onrejected) {
                const response: Promise<ReadResponse> = Promise.resolve(query).then(({ data, error, count }) => ({
                  data,
                  error,
                  count,
                }));
                return response.then(onfulfilled, onrejected);
              },
            };
            return bounded;
          },
        };
      },
    };
  },
  now: () => Date.now(),
};

export async function runFeedbackReport(
  argv: readonly string[],
  dependencies: FeedbackReportDependencies = defaultDependencies,
): Promise<{ exitCode: number; output: unknown }> {
  let live = false;
  try {
    const options = parseArgs(argv, dependencies.now());
    if (options.mode === "input")
      return { exitCode: 0, output: report(exportInput(await dependencies.readJson(options.input))) };
    if (options.mode === "print-plan") return { exitCode: 0, output: options.plan };
    const receipt = await dependencies.readJson(options.receipt!);
    assertReceipt(receipt, options.plan, dependencies.now());
    assertIdentity(await dependencies.loadConfig(), options.plan);
    assertReceipt(receipt, options.plan, dependencies.now());
    live = true;
    const client = await dependencies.createClient(options.plan.projectUrl);
    return { exitCode: 0, output: report(await liveExport(options.plan, receipt, client, dependencies.now)) };
  } catch (error) {
    const reasonCode =
      error instanceof ReportError ? error.code : live ? "FEEDBACK_READ_FAILED" : "FEEDBACK_EXPORT_INVALID";
    return {
      exitCode: 1,
      output: {
        status: live ? "failed" : "refused",
        reasonCode,
        requiresDeidentificationReview: true,
        mayAutoPromote: false,
      },
    };
  }
}

if (isDirectEntrypoint(import.meta.url)) {
  void runFeedbackReport(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
    process.exitCode = result.exitCode;
  });
}
