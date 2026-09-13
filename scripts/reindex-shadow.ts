import { createHash } from "node:crypto";

import { decideReindexGate, type RetrievalGateSummary, type QualityGateSummary } from "../src/lib/reindex-eval-gate";
import {
  assertDocumentGenerationLifecycleRollbackPair,
  assertDocumentGenerationLifecycleRollbackReceipt,
  assertDocumentGenerationPromotionReceipt,
  assertPromotableShadowGeneration,
  type DocumentGenerationLifecycleRollbackReceiptV1,
  type DocumentGenerationPromotionReceiptV1,
  type PromotableShadowGenerationV1,
  type ShadowGenerationPromotionAuthorizationV1,
} from "../src/lib/reindex-pipeline";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../src/lib/supabase/database.types";
import type { ShadowEvaluationSqlDependenciesV1, ShadowEvaluationRuntimeResultV1 } from "./lib/reindex-eval-runtime";
import { runShadowEvaluationRuntimeV1 } from "./lib/reindex-eval-runtime";
import {
  encodeShadowNodeJsonCanonicalPayload,
  readShadowEvaluationArgumentsV1,
  readShadowCandidateCaseReportV1,
  createShadowNodeJsonByteEnvelope,
  prepareShadowPersistenceV1,
  readShadowWaveReadbackV1,
  validateShadowEnvelopeBytes,
  type ShadowRawEnvelope,
  captureShadowProducerInputV1,
  parseShadowExecutionProfileEnvelope,
  readShadowProducerInputV1,
  type ShadowEvaluationOperationV1,
} from "./lib/reindex-eval-session";

type EvaluationSqlContext = Parameters<ShadowEvaluationSqlDependenciesV1["readAliases"]>[0];
type EvaluationClient = Pick<SupabaseClient<Database>, "rpc">;
const validatedShadowStagesV1 = new WeakSet<object>();
const validatedShadowEvaluationsV1 = new WeakSet<object>();

/** No client construction, environment loading, SQL or provider calls occur on import. */
export function createShadowEvaluationSqlDependenciesV1(client: EvaluationClient): ShadowEvaluationSqlDependenciesV1 {
  const argsFor = (context: EvaluationSqlContext, operation: ShadowEvaluationOperationV1) => {
    if (context.call.operation !== operation) throw new Error("U04 fixed SQL operation mismatch.");
    const args = readShadowEvaluationArgumentsV1(operation, context.call.originalArguments);
    const encoded = JSON.parse(encodeShadowNodeJsonCanonicalPayload({ ...args, p_context: context })) as Record<string, Json>;
    // Keep exact pgvector spelling from the admitted call; PostgreSQL performs conversion.
    return encoded;
  };
  const read = async (query: { abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }> }) => {
    const result = await query.abortSignal(AbortSignal.timeout(20_000));
    if (result.error !== null) throw result.error;
    return result.data;
  };
  return Object.freeze({
    readAliases: (context) => read(client.rpc("u04_eval_aliases_v1",
      argsFor(context, "aliases") as Database["public"]["Functions"]["u04_eval_aliases_v1"]["Args"])),
    readCorpusTermStats: (context) => read(client.rpc("u04_eval_corpus_terms_v1",
      argsFor(context, "corpus_terms") as Database["public"]["Functions"]["u04_eval_corpus_terms_v1"]["Args"])),
    correctClinicalTerms: (context) => read(client.rpc("u04_eval_correct_terms_v1",
      argsFor(context, "correct_terms") as Database["public"]["Functions"]["u04_eval_correct_terms_v1"]["Args"])),
    readTextChunks: (context) => read(client.rpc("u04_eval_text_chunks_v1",
      argsFor(context, "text_chunks") as Database["public"]["Functions"]["u04_eval_text_chunks_v1"]["Args"])),
    readHybridChunks: (context) => read(client.rpc("u04_eval_hybrid_chunks_v1",
      argsFor(context, "hybrid_chunks") as Database["public"]["Functions"]["u04_eval_hybrid_chunks_v1"]["Args"])),
    readVectorChunks: (context) => read(client.rpc("u04_eval_vector_chunks_v1",
      argsFor(context, "vector_chunks") as Database["public"]["Functions"]["u04_eval_vector_chunks_v1"]["Args"])),
    readLookupChunks: (context) => read(client.rpc("u04_eval_lookup_chunks_v1",
      argsFor(context, "lookup_chunks") as Database["public"]["Functions"]["u04_eval_lookup_chunks_v1"]["Args"])),
    readLookupChunkTerms: (context) => read(client.rpc("u04_eval_lookup_chunk_terms_v1",
      argsFor(context, "lookup_chunk_terms") as Database["public"]["Functions"]["u04_eval_lookup_chunk_terms_v1"]["Args"])),
    readLookupChunkPrefix: (context) => read(client.rpc("u04_eval_lookup_chunk_prefix_v1",
      argsFor(context, "lookup_chunk_prefix") as Database["public"]["Functions"]["u04_eval_lookup_chunk_prefix_v1"]["Args"])),
    readLookupDocuments: (context) => read(client.rpc("u04_eval_lookup_documents_v1",
      argsFor(context, "lookup_documents") as Database["public"]["Functions"]["u04_eval_lookup_documents_v1"]["Args"])),
    readLookupDocumentTerms: (context) => read(client.rpc("u04_eval_lookup_document_terms_v1",
      argsFor(context, "lookup_document_terms") as Database["public"]["Functions"]["u04_eval_lookup_document_terms_v1"]["Args"])),
    readTableFacts: (context) => read(client.rpc("u04_eval_table_facts_v1",
      argsFor(context, "table_facts") as Database["public"]["Functions"]["u04_eval_table_facts_v1"]["Args"])),
    readEmbeddingFields: (context) => read(client.rpc("u04_eval_embedding_fields_v1",
      argsFor(context, "embedding_fields") as Database["public"]["Functions"]["u04_eval_embedding_fields_v1"]["Args"])),
    readIndexUnits: (context) => read(client.rpc("u04_eval_index_units_v1",
      argsFor(context, "index_units") as Database["public"]["Functions"]["u04_eval_index_units_v1"]["Args"])),
    readMemoryCardsHybrid: (context) => read(client.rpc("u04_eval_memory_cards_hybrid_v1",
      argsFor(context, "memory_cards_hybrid") as Database["public"]["Functions"]["u04_eval_memory_cards_hybrid_v1"]["Args"])),
    readMemoryCardsLexical: (context) => read(client.rpc("u04_eval_memory_cards_lexical_v1",
      argsFor(context, "memory_cards_lexical") as Database["public"]["Functions"]["u04_eval_memory_cards_lexical_v1"]["Args"])),
    readChunksByIds: (context) => read(client.rpc("u04_eval_chunks_by_ids_v1",
      argsFor(context, "chunks_by_ids") as Database["public"]["Functions"]["u04_eval_chunks_by_ids_v1"]["Args"])),
    readChunksByIndexes: (context) => read(client.rpc("u04_eval_chunks_by_indexes_v1",
      argsFor(context, "chunks_by_indexes") as Database["public"]["Functions"]["u04_eval_chunks_by_indexes_v1"]["Args"])),
    readDocumentSnapshots: (context) => read(client.rpc("u04_eval_documents_v1",
      argsFor(context, "documents") as Database["public"]["Functions"]["u04_eval_documents_v1"]["Args"])),
    readRankingMetadata: (context) => read(client.rpc("u04_eval_ranking_metadata_v1",
      argsFor(context, "ranking_metadata") as Database["public"]["Functions"]["u04_eval_ranking_metadata_v1"]["Args"])),
    readRelatedDocuments: (context) => read(client.rpc("u04_eval_related_documents_v1",
      argsFor(context, "related_documents") as Database["public"]["Functions"]["u04_eval_related_documents_v1"]["Args"])),
    readQuality: (context) => read(client.rpc("u04_eval_quality_v1",
      argsFor(context, "quality") as Database["public"]["Functions"]["u04_eval_quality_v1"]["Args"])),
    readImagesByIds: (context) => read(client.rpc("u04_eval_images_by_ids_v1",
      argsFor(context, "images_by_ids") as Database["public"]["Functions"]["u04_eval_images_by_ids_v1"]["Args"])),
    readImagesByPages: (context) => read(client.rpc("u04_eval_images_by_pages_v1",
      argsFor(context, "images_by_pages") as Database["public"]["Functions"]["u04_eval_images_by_pages_v1"]["Args"])),
    readVisualCounts: (context) => read(client.rpc("u04_eval_visual_rows_v1",
      argsFor(context, "visual_rows") as Database["public"]["Functions"]["u04_eval_visual_rows_v1"]["Args"])),
    readAdjacentChunks: (context) => read(client.rpc("u04_eval_adjacent_chunks_v1",
      argsFor(context, "adjacent_chunks") as Database["public"]["Functions"]["u04_eval_adjacent_chunks_v1"]["Args"])),
  });
}


/** Both complete reports and the fresh candidate state are validated before any numerical verdict. */
export function evaluateShadowReindexV1(...input: Parameters<typeof readShadowCandidateCaseReportV1>) {
  const validated = readShadowCandidateCaseReportV1(...input);
  const casesDigest = validated.executionProfile.payload.cases.digest;
  type CaseReport = typeof validated.candidateCaseReport.payload;
  const summaries = (caseReport: CaseReport) => {
    const report = caseReport.report;
    const retrieval: RetrievalGateSummary = {
      case_count: report.retrieval.summary.case_count,
      case_fingerprint: casesDigest,
      failed_case_count: report.retrieval.summary.failed_cases.length,
      document_recall_at_5: report.retrieval.summary.document_recall_at_5,
      content_recall_at_5: report.retrieval.summary.content_recall_at_5,
      top_k_hit_rate: report.retrieval.summary.top_k_hit_rate,
      content_mrr_at_10: report.retrieval.summary.content_mrr_at_10,
      content_mrr_case_count: report.retrieval.summary.content_mrr_case_count,
      mrr_at_10: report.retrieval.summary.mrr_at_10,
      p90_latency_ms: report.retrieval.summary.p90_latency_ms,
    };
    const quality: QualityGateSummary = {
      case_count: report.rag.summary.case_count,
      case_fingerprint: casesDigest,
      grounded_supported_rate: report.rag.summary.grounded_supported_rate,
      unsupported_count: report.rag.summary.unsupported_count,
      unsupported_correct_rate: report.rag.summary.unsupported_correct_rate,
      expected_hit_rate: report.rag.summary.expected_hit_rate,
      citation_failure_rate: report.rag.summary.citation_failure_rate,
      numeric_grounding_failure_rate: report.rag.summary.numeric_grounding_failure_rate,
      source_governance_danger_failure_rate: report.rag.summary.source_governance_danger_failure_rate,
      expected_danger_warning_missing_count: report.rag.summary.expected_danger_warning_missing_count,
      stale_review_unknown_rate: report.retrieval.source_governance.stale_review_unknown_rate,
      review_required_rate: report.retrieval.source_governance.review_required_rate,
      p95_latency_ms: report.rag.summary.p95_latency_ms,
    };
    return { retrieval, quality };
  };
  const baseline = summaries(validated.baselineCaseReport.payload);
  const candidate = summaries(validated.candidateCaseReport.payload);
  const numerical = decideReindexGate({
    baselineRetrieval: baseline.retrieval, candidateRetrieval: candidate.retrieval,
    baselineQuality: baseline.quality, candidateQuality: candidate.quality, qualityMode: "required",
    chunkingExperiment: validated.plan.payload.plan.chunkingExperiment,
  }, validated.configuration.payload.gate);
  const failures = [...numerical.failures];
  for (const [side, result] of [["baseline", validated.baselineCaseReport.payload],
    ["candidate", validated.candidateCaseReport.payload]] as const) {
    if (result.executions.some(execution => execution.outcome !== "complete" || execution.limitations.length > 0))
      failures.push(`${side} evaluation is incomplete`);
    if (result.report.accepted_threshold_failures.length !== 0 || result.report.source_metadata_debt_acceptance.status !== "not_requested")
      failures.push(`${side} evaluation contains an unadmitted acceptance exception`);
  }
  failures.push(...validated.candidateCaseReport.payload.report.blocking_threshold_failures);
  const decision = { ...numerical, decision: failures.length === 0 ? "GO" as const : "NO_GO" as const, failures };
  const payload = {
    version: 1, planDigest: validated.plan.envelope.digest,
    stageReceiptDigest: validated.waveReceipt.envelope.digest,
    recoveryEvidenceDigest: validated.waveReceipt.payload.recoveryEvidenceDigest,
    populationFingerprint: validated.plan.payload.plan.populationFingerprint,
    candidateGenerationId: validated.waveReceipt.payload.candidateGenerationId,
    baseline, candidate, decision,
  };
  const result = Object.freeze({ report: createShadowNodeJsonByteEnvelope(payload, "evaluation_report").envelope,
    decision, evidence: validated });
  validatedShadowEvaluationsV1.add(result);
  return result;
}


/** Prepare the complete P04/baseline/recovery-bound reservation before constructing a connected adapter. */
export function prepareShadowReindexStageV1(...input: Parameters<typeof prepareShadowPersistenceV1>) {
  return prepareShadowPersistenceV1(...input);
}

/** Reservation is distinct from a sealed stage receipt and cannot be reported as terminal success. */
export async function stageShadowReindexV1(
  input: Readonly<{ parameters: unknown; independentlyAdmitted: unknown; trustedNow(): string }>,
  connection: Readonly<{ projectRef: string; client: EvaluationClient }>,
) {
  const prepared = prepareShadowPersistenceV1(input.parameters, input.independentlyAdmitted, input.trustedNow());
  if (connection.projectRef !== prepared.plan.targetProjectRef) throw new Error("U04 staging client targets a different project.");
  const args = JSON.parse(encodeShadowNodeJsonCanonicalPayload(prepared.parameters)) as Database["public"]["Functions"]["enqueue_shadow_reindex_generation"]["Args"];
  const { data, error } = await connection.client.rpc("enqueue_shadow_reindex_generation", args)
    .abortSignal(AbortSignal.timeout(20_000));
  if (error) throw error;
  const retained = createShadowNodeJsonByteEnvelope(data, "control").envelope;
  const fail = (): never => {
    const error = new Error("U04 reservation result failed validation; retain the response and do not retry automatically.");
    Object.defineProperty(error, "retainedResponse", { value: retained, enumerable: true });
    throw error;
  };
  if (!data || typeof data !== "object" || Array.isArray(data)) return fail();
  const keys = Object.keys(data).sort();
  if (data.kind === "existing_reservation") {
    if (keys.join("|") !== ["ok", "kind", "candidate_generation_id", "plan_digest", "terminal_acceptance"].sort().join("|") ||
      data.ok !== true || data.candidate_generation_id !== prepared.plan.candidateGenerationId ||
      data.plan_digest !== prepared.plan.digest || data.terminal_acceptance !== "unavailable") return fail();
    return Object.freeze({ kind: "shadow-reservation-recorded" as const, prepared, reservation: retained,
      terminalAcceptance: "unavailable" as const });
  }
  if (keys.join("|") !== ["ok", "kind", "candidate_generation_id", "plan_digest", "jobs", "terminal_acceptance"].sort().join("|") ||
    data.ok !== true || data.kind !== "reserved" || data.candidate_generation_id !== prepared.plan.candidateGenerationId ||
    data.plan_digest !== prepared.plan.digest || data.terminal_acceptance !== "unavailable" || !Array.isArray(data.jobs) ||
    data.jobs.length !== prepared.plan.documents.length) return fail();
  const jobs = new Set<string>();
  for (const [index, entry] of data.jobs.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).sort().join("|") !== "document_id|job_id" ||
      entry.document_id !== prepared.plan.documents[index]!.documentId || typeof entry.job_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(entry.job_id) || jobs.has(entry.job_id)) return fail();
    jobs.add(entry.job_id);
  }
  return Object.freeze({ kind: "shadow-reservation-recorded" as const, prepared, reservation: retained,
    terminalAcceptance: "unavailable" as const });
}

/** Complete immutable readback validation; this function never promotes or starts a worker. */
export function readShadowReindexStageV1(...input: Parameters<typeof readShadowWaveReadbackV1>) {
  const result = readShadowWaveReadbackV1(...input);
  validatedShadowStagesV1.add(result);
  return result;
}


export type ShadowCaseDocumentExpectationV1 = Readonly<{
  kind: "retrieval" | "quality"; index: number; caseId: string;
  documentId: string; expectedDocumentRank: number | null;
}>;

/** Builds report bytes from the actual workload; separate phase consumers still decide semantic validity. */
export function buildShadowEvaluationCaseReportV1(
  runtime: ShadowEvaluationRuntimeResultV1,
  expectations: readonly ShadowCaseDocumentExpectationV1[],
) {
  if (!runtime.complete || runtime.failureLatched || !runtime.workload.complete || runtime.workload.failureLatched || !runtime.workload.report)
    throw new Error("U04 workload is incomplete; retain its full execution evidence instead of manufacturing a complete case report.");
  const profile = parseShadowExecutionProfileEnvelope(runtime.executionProfileEnvelope);
  const request = validateShadowEnvelopeBytes(runtime.requestEnvelope, "u04-evaluation-request-v1", "node-json-v1").envelope;
  const requestPayload = JSON.parse(request.canonicalPayload) as { originalOriginDigest: string; sourceBindings: unknown };
  const seen = new Set<ShadowCaseDocumentExpectationV1>();
  const executions = [
    ...runtime.workload.retrieval.occurrences.map(occurrence => ({
      kind: "retrieval" as const, index: occurrence.address.ordinal, caseId: occurrence.address.id,
      searchResults: occurrence.output.results, answer: null,
    })),
    ...runtime.workload.rag.occurrences.map(occurrence => ({
      kind: "quality" as const, index: occurrence.address.ordinal, caseId: occurrence.address.id,
      searchResults: occurrence.output.sources, answer: occurrence.output,
    })),
  ].map(execution => {
    const orderedDocumentIds = [...new Set(execution.searchResults.map(result => result.document_id))];
    const documentResults = profile.payload.documentIds.map(documentId => {
      const matching = expectations.filter(value => value.kind === execution.kind && value.index === execution.index &&
        value.caseId === execution.caseId && value.documentId === documentId);
      if (matching.length !== 1) throw new Error("U04 case document expectations are missing or ambiguous.");
      const expected = matching[0]!;
      if (expected.expectedDocumentRank !== null && (!Number.isSafeInteger(expected.expectedDocumentRank) || expected.expectedDocumentRank < 1))
        throw new Error("U04 expected document rank is malformed.");
      seen.add(expected);
      const index = orderedDocumentIds.indexOf(documentId);
      const actualDocumentRank = index < 0 ? null : index + 1;
      const failureCodes: string[] = [];
      if (actualDocumentRank === null) failureCodes.push("document_not_retrieved");
      else if (expected.expectedDocumentRank !== null && actualDocumentRank > expected.expectedDocumentRank)
        failureCodes.push("document_rank_exceeded");
      const insufficiency = execution.answer?.programmeDiagnostics?.insufficiencyReason;
      if (insufficiency === "source_role_mismatch" || insufficiency === "governance_block") failureCodes.push(insufficiency);
      return { documentId, expectedDocumentRank: expected.expectedDocumentRank, actualDocumentRank, failureCodes };
    });
    return { ...execution, outcome: "complete" as const, limitations: [], documentResults };
  });
  if (seen.size !== expectations.length) throw new Error("U04 case document expectations contain unbound entries.");
  const native = captureShadowProducerInputV1({
    kind: "u04-audit-case-results-v1", evidenceMode: profile.payload.evidenceMode,
    originDigest: requestPayload.originalOriginDigest, executionProfileDigest: profile.bytes.envelope.digest,
    caseSetDigest: profile.cases.bytes.envelope.digest, configurationDigest: profile.configuration.bytes.envelope.digest,
    providerMode: profile.payload.providerMode, comparisonClock: profile.payload.comparisonClock,
    documentIds: profile.payload.documentIds, manualAliasIds: profile.payload.manualAliasIds,
    sourceBindings: requestPayload.sourceBindings,
    inputBinding: { requestEnvelope: request, authorityEnvelope: runtime.authorityEnvelope },
    report: runtime.workload.report, executions,
  });
  const caseReport = createShadowNodeJsonByteEnvelope(native.input, "evaluation_report").envelope;
  const evidence = createShadowNodeJsonByteEnvelope({
    kind: "u04-evaluation-execution-evidence-v1", caseReportEnvelope: caseReport,
    nativeCaseReport: native, runtime: captureShadowProducerInputV1(runtime),
  }, "u04-retained-evidence-v1").envelope;
  return Object.freeze({ caseReport, evidence });
}

/** Executes only through the admitted, injected session dependencies; never promotes. */
export async function runShadowReindexEvaluationV1(
  input: Parameters<typeof runShadowEvaluationRuntimeV1>[0],
  expectations: readonly ShadowCaseDocumentExpectationV1[],
) {
  const snapshot = <T>(value: T): T => readShadowProducerInputV1(captureShadowProducerInputV1(value)).nativeInput as T;
  const independentlyAdmitted = snapshot(input.independentlyAdmitted);
  const candidateEvidence = snapshot(input.candidateEvidence ?? null);
  const expected = snapshot(expectations);
  const runtime = await runShadowEvaluationRuntimeV1({ ...input, independentlyAdmitted, candidateEvidence });
  const retainedRuntime = () => createShadowNodeJsonByteEnvelope({
    kind: "u04-evaluation-execution-evidence-v1", runtime: captureShadowProducerInputV1(runtime),
  }, "u04-retained-evidence-v1").envelope;
  if (!runtime.complete || runtime.failureLatched) return Object.freeze({
    kind: "shadow-evaluation-incomplete" as const, decision: "NO_GO" as const, evidence: retainedRuntime(),
  });
  let built: ReturnType<typeof buildShadowEvaluationCaseReportV1> | null = null;
  try {
    built = buildShadowEvaluationCaseReportV1(runtime, expected);
    if (candidateEvidence === null) return Object.freeze({
      kind: "shadow-baseline-evaluation-recorded" as const, ...built,
      acceptance: "requires-complete-audit-consumer" as const,
    });
    const completion = runtime.completionRead;
    if (!completion?.resultEnvelope || completion.status !== "complete" || completion.finishedAt === null)
      throw new Error("U04 candidate evaluation has no complete final current-state observation.");
    const nativeEnvelope = readShadowProducerInputV1(completion.resultEnvelope).nativeInput as ShadowRawEnvelope;
    const bytes = validateShadowEnvelopeBytes(nativeEnvelope, nativeEnvelope.domain, nativeEnvelope.encoding).envelope;
    const payload = JSON.parse(bytes.canonicalPayload) as { observedAt: unknown; guard: unknown; environment: unknown };
    const evaluated = evaluateShadowReindexV1(built.caseReport, runtime.requestEnvelope, runtime.authorityEnvelope,
      independentlyAdmitted, { observedAt: payload.observedAt, guard: payload.guard, environment: payload.environment },
      completion.operation, completion.startedAt, completion.finishedAt, candidateEvidence);
    return Object.freeze({ kind: "shadow-candidate-evaluation-recorded" as const, ...built, evaluated });
  } catch (cause) {
    const error = new Error("U04 report failed construction or semantic acceptance; retain the complete execution evidence.", { cause });
    Object.defineProperty(error, "retainedEvidence", { value: built?.evidence ?? retainedRuntime(), enumerable: true });
    throw error;
  }
}

type LifecycleDigest = `sha256:${string}`;

export type ShadowPromotionAuthorizationManifestV1 = Readonly<{
  authorization: ShadowGenerationPromotionAuthorizationV1;
  promoteAuthorizationDigest: LifecycleDigest;
}>;

export type DocumentGenerationRollbackManifestV1 = Readonly<{
  authorization: Readonly<{
    version: 1;
    operation: "rollback";
    targetProjectRef: string;
    promotionOperationId: string;
    promotionReceiptDigest: LifecycleDigest;
    candidateGenerationId: string;
    expectedDocumentIds: readonly string[];
    expectedDocumentCount: number;
    reasonCode: string;
    authorizedAt: string;
    expiresAt: string;
    retainedUntil: string;
    confirmationSha256: LifecycleDigest;
  }>;
  rollbackManifestDigest: LifecycleDigest;
}>;

type LifecycleRpcResult = { data: unknown; error: { message: string } | null };
type LifecycleRpcQuery = PromiseLike<LifecycleRpcResult> & {
  abortSignal?(signal: AbortSignal): PromiseLike<LifecycleRpcResult>;
};
export type DocumentGenerationLifecycleRpc = Readonly<{
  rpc(name: string, args: Record<string, unknown>): LifecycleRpcQuery;
}>;

const lifecycleUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const lifecycleSha = /^sha256:[0-9a-f]{64}$/;

function lifecycleDriverRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function lifecycleDriverKeys(value: Record<string, unknown>, expected: readonly string[], label: string) {
  if (Object.keys(value).sort().join("|") !== [...expected].sort().join("|")) {
    throw new Error(`${label} contains missing or unexpected fields.`);
  }
}

function lifecycleDriverString(value: unknown, pattern: RegExp, label: string) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function lifecycleDriverTimestamp(value: unknown, label: string) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function lifecycleNodeDigest(value: unknown): LifecycleDigest {
  return `sha256:${createHash("sha256").update(encodeShadowNodeJsonCanonicalPayload(value), "utf8").digest("hex")}`;
}

function freezeLifecycleDriver<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) freezeLifecycleDriver(nested);
    Object.freeze(value);
  }
  return value;
}

export function readShadowPromotionAuthorizationManifestV1(input: unknown): ShadowPromotionAuthorizationManifestV1 {
  const manifest = lifecycleDriverRecord(input, "Promote authorization manifest");
  lifecycleDriverKeys(manifest, ["authorization", "promoteAuthorizationDigest"], "Promote authorization manifest");
  const authorization = lifecycleDriverRecord(manifest.authorization, "Promote authorization payload");
  lifecycleDriverKeys(authorization, [
    "version", "operation", "targetProjectRef", "candidateGenerationId", "planDigest", "stageReceiptDigest",
    "evaluationReportDigest", "recoveryEvidenceDigest", "stageAuthorizationDigest", "expectedDocumentIds",
    "expectedDocumentCount", "expectedTechnicalEvidenceReceiptDigests", "authorizedAt", "expiresAt", "retainedUntil",
    "confirmationSha256",
  ], "Promote authorization payload");
  const supplied = lifecycleDriverString(
    manifest.promoteAuthorizationDigest,
    lifecycleSha,
    "Promote authorization digest",
  ) as LifecycleDigest;
  if (lifecycleNodeDigest(authorization) !== supplied) throw new Error("Promote authorization digest mismatch.");
  return freezeLifecycleDriver(manifest as ShadowPromotionAuthorizationManifestV1);
}

export function readDocumentGenerationRollbackManifestV1(
  input: unknown,
  trustedNowValue: unknown,
): DocumentGenerationRollbackManifestV1 {
  const manifest = lifecycleDriverRecord(input, "Rollback manifest");
  lifecycleDriverKeys(manifest, ["authorization", "rollbackManifestDigest"], "Rollback manifest");
  const authorization = lifecycleDriverRecord(manifest.authorization, "Rollback authorization payload");
  lifecycleDriverKeys(
    authorization,
    [
      "version", "operation", "targetProjectRef", "promotionOperationId", "promotionReceiptDigest",
      "candidateGenerationId", "expectedDocumentIds", "expectedDocumentCount", "retainedUntil", "reasonCode",
      "authorizedAt", "expiresAt", "confirmationSha256",
    ],
    "Rollback authorization payload",
  );
  if (authorization.version !== 1 || authorization.operation !== "rollback") throw new Error("Rollback manifest kind is invalid.");
  lifecycleDriverString(authorization.targetProjectRef, /^[a-z]{20}$/, "Rollback target project");
  lifecycleDriverString(authorization.promotionOperationId, lifecycleUuid, "Promotion operation ID");
  lifecycleDriverString(authorization.promotionReceiptDigest, lifecycleSha, "Promotion receipt digest");
  const candidateGenerationId = lifecycleDriverString(
    authorization.candidateGenerationId,
    lifecycleUuid,
    "Rollback candidate generation",
  );
  if (!Array.isArray(authorization.expectedDocumentIds) || authorization.expectedDocumentIds.length === 0) {
    throw new Error("Rollback manifest document population is empty.");
  }
  const ids = authorization.expectedDocumentIds.map((value) =>
    lifecycleDriverString(value, lifecycleUuid, "Rollback document ID"));
  if ([...ids].sort().join("|") !== ids.join("|") || new Set(ids).size !== ids.length) {
    throw new Error("Rollback manifest document IDs must be sorted and unique.");
  }
  if (!Number.isSafeInteger(authorization.expectedDocumentCount) || authorization.expectedDocumentCount !== ids.length) {
    throw new Error("Rollback manifest document count mismatch.");
  }
  lifecycleDriverString(authorization.reasonCode, /^[a-z0-9][a-z0-9_-]{0,119}$/, "Rollback reason code");
  const trustedNow = lifecycleDriverTimestamp(trustedNowValue, "Rollback trusted clock");
  const authorizedAt = lifecycleDriverTimestamp(authorization.authorizedAt, "Rollback authorization time");
  const expiresAt = lifecycleDriverTimestamp(authorization.expiresAt, "Rollback authorization expiry");
  const retainedUntil = lifecycleDriverTimestamp(authorization.retainedUntil, "Rollback retention deadline");
  if (Date.parse(authorizedAt) > Date.parse(trustedNow)) {
    throw new Error("Rollback authorization is future-issued.");
  }
  if (Date.parse(expiresAt) <= Date.parse(authorizedAt) || Date.parse(retainedUntil) <= Date.parse(authorizedAt)) {
    throw new Error("Rollback authorization time bounds are invalid.");
  }
  lifecycleDriverString(authorization.confirmationSha256, lifecycleSha, "Rollback confirmation digest");
  const supplied = lifecycleDriverString(manifest.rollbackManifestDigest, lifecycleSha, "Rollback manifest digest");
  if (lifecycleNodeDigest(authorization) !== supplied) throw new Error("Rollback manifest digest mismatch.");
  return freezeLifecycleDriver(manifest as DocumentGenerationRollbackManifestV1);
}

async function lifecycleRpc(
  client: DocumentGenerationLifecycleRpc,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const query = client.rpc(name, args);
  const result = query.abortSignal
    ? await query.abortSignal(AbortSignal.timeout(20_000))
    : await query;
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

function assertPromotionReceiptMatchesReadiness(
  receipt: DocumentGenerationPromotionReceiptV1,
  readiness: PromotableShadowGenerationV1,
) {
  if (Date.parse(receipt.promotedAt) < Date.parse(readiness.trustedNow)) {
    throw new Error("Promotion receipt time precedes the trusted operation clock.");
  }
  if (
    receipt.projectRef !== readiness.projectRef ||
    receipt.candidateGenerationId !== readiness.candidateGenerationId ||
    receipt.planDigest !== readiness.planDigest ||
    receipt.stageReceiptDigest !== readiness.stageReceiptDigest ||
    receipt.evaluationReportDigest !== readiness.evaluationReportDigest ||
    receipt.recoveryEvidenceDigest !== readiness.recoveryEvidenceDigest ||
    receipt.stageAuthorizationDigest !== readiness.stageAuthorizationDigest ||
    receipt.promoteAuthorizationDigest !== readiness.promoteAuthorizationDigest ||
    encodeShadowNodeJsonCanonicalPayload(receipt.technicalEvidenceReceiptDigests) !==
      encodeShadowNodeJsonCanonicalPayload(readiness.technicalEvidence.map((value) => value.receiptDigest)) ||
    receipt.transitions.length !== readiness.documents.length
  ) {
    throw new Error("Promotion receipt is not bound to the exact validated readiness evidence.");
  }
  for (const [index, transition] of receipt.transitions.entries()) {
    const document = readiness.documents[index]!;
    if (
      transition.documentId !== document.documentId ||
      transition.fromGenerationId !== document.baselineGenerationId ||
      transition.toGenerationId !== readiness.candidateGenerationId ||
      transition.retainedUntil !== readiness.authorization.retainedUntil
    ) {
      throw new Error("Promotion receipt changed an authorized pointer or retention deadline.");
    }
  }
}

/** Calls only the injected U05 promotion RPC after exact U04 scalar and byte binding. */
export async function promoteShadowDocumentGenerationV1(
  input: Readonly<{
    readiness: unknown;
    validatedStage: unknown;
    validatedEvaluation: unknown;
    authorizationManifest: unknown;
  }>,
  connection: Readonly<{ projectRef: string; client: DocumentGenerationLifecycleRpc }>,
) {
  const readiness = assertPromotableShadowGeneration(input.readiness);
  if (connection.projectRef !== readiness.projectRef) throw new Error("Promotion client targets a different project.");
  if (
    !input.validatedStage || typeof input.validatedStage !== "object" ||
    !validatedShadowStagesV1.has(input.validatedStage) ||
    !input.validatedEvaluation || typeof input.validatedEvaluation !== "object" ||
    !validatedShadowEvaluationsV1.has(input.validatedEvaluation)
  ) {
    throw new Error("Promotion requires the full validated U04 stage and evaluation results.");
  }
  const stage = input.validatedStage as ReturnType<typeof readShadowReindexStageV1>;
  const evaluation = input.validatedEvaluation as ReturnType<typeof evaluateShadowReindexV1>;
  const plan = validateShadowEnvelopeBytes(evaluation.evidence.plan.envelope, "plan", "node-json-v1").envelope;
  const stageReceipt = validateShadowEnvelopeBytes(stage.waveReceipt, "wave_receipt", "pg-jsonb-text-v1").envelope;
  const evaluationWaveReceipt = validateShadowEnvelopeBytes(
    evaluation.evidence.waveReceipt.envelope,
    "wave_receipt",
    "pg-jsonb-text-v1",
  ).envelope;
  const evaluationReport = validateShadowEnvelopeBytes(evaluation.report, "evaluation_report", "node-json-v1").envelope;
  const authorizationManifest = readShadowPromotionAuthorizationManifestV1(input.authorizationManifest);
  const planCore = evaluation.evidence.plan.payload.plan;
  const wavePayload = evaluation.evidence.waveReceipt.payload;
  if (
    plan.digest !== readiness.planDigest ||
    stageReceipt.digest !== readiness.stageReceiptDigest ||
    evaluationWaveReceipt.digest !== stageReceipt.digest ||
    evaluationReport.digest !== readiness.evaluationReportDigest ||
    evaluation.decision.decision !== "GO" ||
    planCore.targetProjectRef !== readiness.projectRef ||
    planCore.candidateGenerationId !== readiness.candidateGenerationId ||
    wavePayload.candidateGenerationId !== readiness.candidateGenerationId ||
    wavePayload.planDigest !== readiness.planDigest ||
    wavePayload.recoveryEvidenceDigest !== readiness.recoveryEvidenceDigest ||
    wavePayload.operationManifestDigest !== readiness.stageAuthorizationDigest ||
    planCore.documents.length !== readiness.documents.length ||
    wavePayload.members.length !== readiness.documents.length ||
    authorizationManifest.promoteAuthorizationDigest !== readiness.promoteAuthorizationDigest ||
    encodeShadowNodeJsonCanonicalPayload(authorizationManifest.authorization) !==
      encodeShadowNodeJsonCanonicalPayload(readiness.authorization)
  ) {
    throw new Error("Promotion driver inputs do not match the validated lifecycle evidence.");
  }
  for (const [index, document] of readiness.documents.entries()) {
    const planned = planCore.documents[index]!;
    const staged = wavePayload.members[index]!;
    const memberReceiptPayload = JSON.parse(staged.memberReceiptEnvelope.canonicalPayload) as {
      binding?: { source?: { authorityDigest?: unknown } };
    };
    if (
      planned.documentId !== document.documentId ||
      planned.baselineGenerationId !== document.baselineGenerationId ||
      planned.expectedStateDigest !== document.expectedStateDigest ||
      staged.documentId !== document.documentId ||
      staged.memberReceiptEnvelope.digest !== document.stageMemberReceiptDigest ||
      memberReceiptPayload.binding?.source?.authorityDigest !== document.stageAuthorityDigest
    ) {
      throw new Error("Promotion driver document population differs from the validated U04 wave.");
    }
  }
  const data = await lifecycleRpc(connection.client, "promote_shadow_document_generation", {
    p_plan: plan,
    p_stage_receipt: stageReceipt,
    p_evaluation_report: evaluationReport,
    p_authorization_manifest: authorizationManifest,
  });
  const receipt = assertDocumentGenerationPromotionReceipt(data);
  assertPromotionReceiptMatchesReadiness(receipt, readiness);
  return receipt;
}

/** Rollback consumes the immutable promotion receipt and does not recheck recovery freshness. */
export async function rollbackDocumentIndexGenerationV1(
  input: Readonly<{ promotionReceipt: unknown; rollbackManifest: unknown; trustedNow: string }>,
  connection: Readonly<{ projectRef: string; client: DocumentGenerationLifecycleRpc }>,
) {
  const promotionReceipt = assertDocumentGenerationPromotionReceipt(input.promotionReceipt);
  if (connection.projectRef !== promotionReceipt.projectRef) throw new Error("Rollback client targets a different project.");
  const rollbackManifest = readDocumentGenerationRollbackManifestV1(input.rollbackManifest, input.trustedNow);
  const promotedDocumentIds = promotionReceipt.transitions.map((transition) => transition.documentId);
  if (
    rollbackManifest.authorization.targetProjectRef !== promotionReceipt.projectRef ||
    rollbackManifest.authorization.promotionOperationId !== promotionReceipt.operationId ||
    rollbackManifest.authorization.promotionReceiptDigest !== promotionReceipt.receiptDigest ||
    rollbackManifest.authorization.candidateGenerationId !== promotionReceipt.candidateGenerationId ||
    rollbackManifest.authorization.expectedDocumentCount !== promotionReceipt.transitions.length ||
    encodeShadowNodeJsonCanonicalPayload(rollbackManifest.authorization.expectedDocumentIds) !==
      encodeShadowNodeJsonCanonicalPayload(promotedDocumentIds)
  ) {
    throw new Error("Rollback manifest is not bound to the exact promotion receipt.");
  }
  const expectedInverseTransitions = promotionReceipt.transitions.map((transition) => ({
    documentId: transition.documentId,
    fromGenerationId: transition.toGenerationId,
    toGenerationId: transition.fromGenerationId,
    retainedUntil: rollbackManifest.authorization.retainedUntil,
  }));
  const data = await lifecycleRpc(connection.client, "rollback_document_index_generation", {
    p_promotion_receipt: promotionReceipt,
    p_rollback_manifest: rollbackManifest,
  });
  const rollbackReceipt = assertDocumentGenerationLifecycleRollbackReceipt(data);
  if (Date.parse(rollbackReceipt.rolledBackAt) < Date.parse(rollbackManifest.authorization.authorizedAt)) {
    throw new Error("Rollback receipt time precedes its authorization.");
  }
  if (Date.parse(rollbackReceipt.rolledBackAt) >= Date.parse(rollbackManifest.authorization.expiresAt)) {
    throw new Error("Rollback receipt time is outside its authorization window.");
  }
  if (
    rollbackReceipt.rollbackManifestDigest !== rollbackManifest.rollbackManifestDigest ||
    encodeShadowNodeJsonCanonicalPayload(rollbackReceipt.transitions) !==
      encodeShadowNodeJsonCanonicalPayload(expectedInverseTransitions) ||
    rollbackReceipt.transitions.some((transition) => transition.retainedUntil !== rollbackManifest.authorization.retainedUntil)
  ) {
    throw new Error("Rollback receipt changed the authorized manifest or retention deadline.");
  }
  assertDocumentGenerationLifecycleRollbackPair(promotionReceipt, rollbackReceipt);
  return rollbackReceipt as DocumentGenerationLifecycleRollbackReceiptV1;
}
