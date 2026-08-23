// prettier-ignore
// @ts-expect-error Deno edge imports require explicit TypeScript extensions.
import { containsForbiddenPublicSourceChunkContent, publicSourcePolicyViolation } from "../_shared/public-source-policy.ts";

export type CompletionGate = {
  counts: {
    sections: number;
    memory_cards: number;
    generated_labels: number;
    index_units: number;
  };
  presence: {
    title_embedding: boolean;
    summary_embedding: boolean;
  };
  quality: {
    extraction_quality: string;
    score: number;
  };
  missing: string[];
  result: "complete" | "deferred";
};

export type CompletionGateRow = {
  sections: number;
  memory_cards: number;
  generated_labels: number;
  index_units: number;
  title_embedding: boolean;
  summary_embedding: boolean;
  quality_extraction_quality: string;
  quality_score: number;
  missing: string[];
  gate_passed: boolean;
};

export type MissingArtifactPlan = {
  needs_sections: boolean;
  needs_memory: boolean;
  needs_labels: boolean;
  needs_index_units: boolean;
  needs_title_embedding: boolean;
  needs_summary_embedding: boolean;
  needs_core_embeddings: boolean;
  needs_quality_promotion: boolean;
};

export type DeferralDecision = {
  deferral_count: number;
  terminal: boolean;
  status: "deferred" | "needs_enrichment_artifacts";
  enrichment_status: "pending" | "needs_enrichment_artifacts";
  next_run_at: string | null;
  details: {
    code: "completion_gate_deferred" | "needs_enrichment_artifacts";
    missing: string[];
    counts: CompletionGate["counts"];
    presence: CompletionGate["presence"];
    deferral_count: number;
    max_deferrals: number;
  };
};

export type JobStatusRpcResult = {
  ok: boolean;
  gate_passed: boolean;
  missing: string[] | null;
  status: string;
};

export function publicSourceWorkerPolicyViolation(
  metadata: Record<string, unknown> | null | undefined,
  containsProtectedSourceContent: boolean,
) {
  return publicSourcePolicyViolation(metadata, containsProtectedSourceContent);
}

export function protectedPublicSourceChunkContents(rows: ReadonlyArray<{ content: string }>) {
  return containsForbiddenPublicSourceChunkContent(rows);
}

export function protectedPublicSourceChunkPage(
  rows: ReadonlyArray<{ content: string }>,
  trailingContent: string,
  carryLength = 256,
) {
  const scanRows = trailingContent ? [{ content: trailingContent }, ...rows] : rows;
  const concatenatedStream = `${trailingContent}${rows.map((row) => row.content).join("")}`;
  return {
    containsProtectedSourceContent: containsForbiddenPublicSourceChunkContent(scanRows),
    trailingContent: concatenatedStream.slice(-carryLength),
  };
}

export async function scanProtectedPublicSourceChunkPages(
  loadPage: (offset: number, limit: number) => Promise<ReadonlyArray<{ content: string }>>,
  batchSize = 500,
) {
  let offset = 0;
  let trailingContent = "";
  while (true) {
    const rows = await loadPage(offset, batchSize);
    const page = protectedPublicSourceChunkPage(rows, trailingContent);
    if (page.containsProtectedSourceContent) return true;
    if (rows.length < batchSize) return false;
    trailingContent = page.trailingContent;
    offset += rows.length;
  }
}

export function agentFailureDecision(args: {
  attemptCount: number;
  maxAttempts: number;
  nowMs: number;
  retryDelayMs: number;
}) {
  const shouldRetry = args.attemptCount < args.maxAttempts;
  return {
    shouldRetry,
    status: shouldRetry ? "retry_pending" : "failed",
    jobStatus: shouldRetry ? "pending" : "failed",
    enrichmentStatus: shouldRetry ? "pending" : "failed",
    nextRunAt: shouldRetry ? new Date(args.nowMs + args.retryDelayMs).toISOString() : null,
  } as const;
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function parseJobStatusRpcResult(row: unknown, rpcName: string): JobStatusRpcResult | null {
  const direct = asObjectRecord(row);
  const nested = asObjectRecord(direct?.[rpcName]);
  const candidate = direct?.ok !== undefined ? direct : nested;
  if (!candidate) return null;

  const ok = candidate.ok === true;
  const gatePassed = candidate.gate_passed === true;
  const status = typeof candidate.status === "string" ? candidate.status : "missing_result";
  const missing =
    candidate.missing === null
      ? []
      : Array.isArray(candidate.missing)
        ? candidate.missing.map((item) => String(item))
        : ["completion_rpc_failed"];

  return { ok, gate_passed: gatePassed, status, missing };
}

export function completionGateFromRow(row: CompletionGateRow): CompletionGate {
  return {
    counts: {
      sections: row.sections,
      memory_cards: row.memory_cards,
      generated_labels: row.generated_labels,
      index_units: row.index_units,
    },
    presence: {
      title_embedding: row.title_embedding,
      summary_embedding: row.summary_embedding,
    },
    quality: {
      extraction_quality: row.quality_extraction_quality,
      score: row.quality_score,
    },
    missing: row.missing,
    result: row.gate_passed ? "complete" : "deferred",
  };
}

export function missingArtifactPlan(gate: CompletionGate): MissingArtifactPlan {
  const missing = new Set(gate.missing);
  const needsTitle = missing.has("title_embedding");
  const needsSummary = missing.has("summary_embedding");
  return {
    needs_sections: missing.has("sections"),
    needs_memory: missing.has("memory_cards"),
    needs_labels: missing.has("generated_labels"),
    needs_index_units: missing.has("index_units"),
    needs_title_embedding: needsTitle,
    needs_summary_embedding: needsSummary,
    needs_core_embeddings: needsTitle || needsSummary,
    needs_quality_promotion: gate.result === "complete" && gate.quality.extraction_quality !== "good",
  };
}

export function shouldRunVisualArtifacts(args: { eligible_images: number; generated_visual_units: number }): boolean {
  return args.eligible_images > 0 && args.generated_visual_units === 0;
}

export function metadataNumber(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
  fallback = 0,
): number {
  const value = Number(metadata?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

export function deferralDecision(args: {
  metadata: Record<string, unknown> | null | undefined;
  gate: CompletionGate;
  maxDeferrals: number;
  nowMs: number;
}): DeferralDecision {
  const deferralCount = metadataNumber(args.metadata, "indexing_v3_agent_deferral_count") + 1;
  const terminal = deferralCount >= args.maxDeferrals || args.gate.missing.includes("sections");
  const status = terminal ? "needs_enrichment_artifacts" : "deferred";
  const nextRunAt = terminal
    ? null
    : new Date(args.nowMs + Math.min(24 * 60 * 60_000, 15 * 60_000 * deferralCount)).toISOString();
  return {
    deferral_count: deferralCount,
    terminal,
    status,
    enrichment_status: terminal ? "needs_enrichment_artifacts" : "pending",
    next_run_at: nextRunAt,
    details: {
      code: terminal ? "needs_enrichment_artifacts" : "completion_gate_deferred",
      missing: args.gate.missing,
      counts: args.gate.counts,
      presence: args.gate.presence,
      deferral_count: deferralCount,
      max_deferrals: args.maxDeferrals,
    },
  };
}
