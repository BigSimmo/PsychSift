import { zodTextFormat } from "openai/helpers/zod";
import type { RagQueryClass } from "../../src/lib/types";
import type { RankingConfig } from "../../src/lib/ranking-config";
import { resolveRagContextSnapshot } from "../../src/lib/rag/rag-context-snapshot";
import {
  type RagEvaluationContext,
  type RagEvaluationFailureCode,
  type RagEvaluationFailureCollector,
  type RagEvaluationOperation,
  type RagEvaluationProviderDependencies,
  type RagEvaluationProviderOperation,
  type RagEvaluationReadDependencies,
  type RagEvaluationReadResult,
  type RagEvaluationReadScope,
} from "../../src/lib/rag/rag-contracts";
import {
  answerQuestionWithScopeForEvaluation,
  searchChunksWithTelemetryForEvaluation,
} from "../../src/lib/rag/rag";
import {
  runBoundEvalQualityWorkload,
  type BoundEvalQualityWorkloadResult,
  type EvalQualityCaseAddress,
} from "../eval-quality";
import {
  parseShadowExecutionProfileEnvelope,
  prepareShadowEvaluationRuntimeAdmissionV1,
  prepareShadowEvaluationSqlContextV1,
  readShadowEvaluationResultV1,
  captureShadowProducerInputV1,
  readShadowProducerInputV1,
  restoreShadowComparisonCases,
  type ShadowEvaluationCallV1,
  type ShadowEvaluationOperationV1,
} from "./reindex-eval-session";

type ShadowEvaluationSqlContextV1 = ReturnType<typeof prepareShadowEvaluationSqlContextV1>;
type ShadowEvaluationNativeCaptureV1 = ReturnType<typeof captureShadowProducerInputV1>;

export type ShadowEvaluationSqlDependenciesV1 = Readonly<{
  readAliases(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readCorpusTermStats(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  correctClinicalTerms(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readTextChunks(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readHybridChunks(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readVectorChunks(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readLookupChunks(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readLookupChunkTerms(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readLookupChunkPrefix(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readLookupDocuments(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readLookupDocumentTerms(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readTableFacts(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readEmbeddingFields(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readIndexUnits(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readMemoryCardsHybrid(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readMemoryCardsLexical(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readChunksByIds(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readChunksByIndexes(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readDocumentSnapshots(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readRankingMetadata(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readRelatedDocuments(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readQuality(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readImagesByIds(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readImagesByPages(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readVisualCounts(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
  readAdjacentChunks(context: ShadowEvaluationSqlContextV1): Promise<unknown>;
}>;

export type ShadowEvaluationRuntimeClockV1 = Readonly<{ trustedNow(): string; now(): number }>;
type CaseAddress = Readonly<{ kind: "retrieval" | "quality"; index: number; caseId: string }>;

export type ShadowEvaluationRuntimeReadOccurrenceV1 = Readonly<{
  address: CaseAddress;
  operation: ShadowEvaluationOperationV1;
  readOrdinal: number;
  preparedContext: ShadowEvaluationSqlContextV1 | null;
  startedAt: string;
  finishedAt: string | null;
  resultEnvelope: ShadowEvaluationNativeCaptureV1 | null;
  status: "complete" | "failed";
  error: ShadowEvaluationNativeCaptureV1 | null;
}>;

export type ShadowEvaluationRuntimeProviderOccurrenceV1 = Readonly<{
  address: CaseAddress;
  operation: RagEvaluationProviderOperation;
  input: ShadowEvaluationNativeCaptureV1;
  output: ShadowEvaluationNativeCaptureV1 | null;
  status: "complete" | "failed";
  error: ShadowEvaluationNativeCaptureV1 | null;
}>;

export type ShadowEvaluationRuntimeFailureV1 = Readonly<{
  code: RagEvaluationFailureCode;
  operation: RagEvaluationOperation | RagEvaluationProviderOperation | "context";
}>;

export type ShadowEvaluationRuntimeResultV1 = Readonly<{
  kind: "u04-evaluation-runtime-result-v1";
  complete: boolean;
  failureLatched: boolean;
  requestEnvelope: unknown;
  authorityEnvelope: unknown;
  executionProfileEnvelope: unknown;
  ragContextSnapshot: ReturnType<typeof resolveRagContextSnapshot>;
  indexingVersionAtRequestStart: string;
  readOccurrences: readonly ShadowEvaluationRuntimeReadOccurrenceV1[];
  completionRead: ShadowEvaluationRuntimeReadOccurrenceV1 | null;
  providerOccurrences: readonly ShadowEvaluationRuntimeProviderOccurrenceV1[];
  failures: readonly ShadowEvaluationRuntimeFailureV1[];
  workload: BoundEvalQualityWorkloadResult;
}>;

export type ShadowEvaluationRuntimeInputV1 = Readonly<{
  requestEnvelope: unknown;
  authorityEnvelope: unknown;
  independentlyAdmitted: unknown;
  clock: ShadowEvaluationRuntimeClockV1;
  candidateEvidence?: unknown;
  sql: ShadowEvaluationSqlDependenciesV1;
  providers: RagEvaluationProviderDependencies;
}>;

const sqlDependencyNames = Object.freeze([
  "readAliases", "readCorpusTermStats", "correctClinicalTerms", "readTextChunks", "readHybridChunks",
  "readVectorChunks", "readLookupChunks", "readLookupChunkTerms", "readLookupChunkPrefix",
  "readLookupDocuments", "readLookupDocumentTerms", "readTableFacts", "readEmbeddingFields", "readIndexUnits",
  "readMemoryCardsHybrid", "readMemoryCardsLexical", "readChunksByIds", "readChunksByIndexes",
  "readDocumentSnapshots", "readRankingMetadata", "readRelatedDocuments", "readQuality", "readImagesByIds",
  "readImagesByPages", "readVisualCounts", "readAdjacentChunks",
] as const);
const providerDependencyNames = Object.freeze([
  "embedQuery", "generateClassifier", "generateRerank", "generateAnswer",
] as const);
const clockDependencyNames = Object.freeze(["trustedNow", "now"] as const);

function assertClosedFunctions(value: object, expected: readonly string[], label: string) {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length ||
    keys.some((key) => typeof key !== "string" || !expected.includes(key)) ||
    expected.some((key) => typeof Object.getOwnPropertyDescriptor(value, key)?.value !== "function")) {
    throw new Error(`Invalid U04 evaluation ${label} dependency surface.`);
  }
}

function captureClosedFunctions<T extends object>(value: T, expected: readonly string[], label: string): T {
  assertClosedFunctions(value, expected, label);
  return Object.freeze(Object.fromEntries(expected.map((key) => {
    const method = Object.getOwnPropertyDescriptor(value, key)?.value;
    if (typeof method !== "function") throw new Error(`Invalid U04 evaluation ${label} dependency surface.`);
    return [key, (...args: unknown[]) => Reflect.apply(method, value, args)];
  }))) as T;
}

function immutableNativeSnapshot<T>(value: T): T {
  return readShadowProducerInputV1(captureShadowProducerInputV1(value)).nativeInput as T;
}

function retainedError(error: unknown): ShadowEvaluationNativeCaptureV1 {
  if (!(error instanceof Error)) return captureShadowProducerInputV1({ thrown: error });
  const properties: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(error)) {
    if (typeof key !== "string" || key === "name" || key === "message" || key === "stack" || key === "cause") continue;
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    if (descriptor && "value" in descriptor) properties[key] = descriptor.value;
  }
  const cause = "cause" in error ? error.cause : undefined;
  return captureShadowProducerInputV1({
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: cause instanceof Error
      ? { name: cause.name, message: cause.message, stack: cause.stack }
      : cause,
    properties,
  });
}

function providerOptionsEvidence(value: object) {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const options: Record<string, unknown> = {};
  for (const key of Object.keys(descriptors)) {
    if (key === "signal") continue;
    const descriptor = descriptors[key]!;
    if (!("value" in descriptor) || !descriptor.enumerable)
      throw new Error("Invalid U04 evaluation provider options.");
    options[key] = descriptor.value;
  }
  const signalDescriptor = descriptors.signal;
  const signal = signalDescriptor && "value" in signalDescriptor ? signalDescriptor.value : undefined;
  if (signal !== undefined && !(signal instanceof AbortSignal))
    throw new Error("Invalid U04 evaluation provider signal.");
  return {
    options,
    signal: signal === undefined
      ? { present: false as const }
      : {
          present: true as const,
          aborted: signal.aborted,
          reason: signal.aborted ? retainedError(signal.reason) : null,
        },
  };
}

function zodSchemaEvidence(schema: Parameters<RagEvaluationProviderDependencies["generateClassifier"]>[1], name: string) {
  const format = zodTextFormat(schema, name);
  return { type: format.type, name: format.name, strict: format.strict, schema: format.schema };
}

function sameTextArray(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function mutableRankingConfig(
  value: ReturnType<typeof parseShadowExecutionProfileEnvelope>["configuration"]["payload"]["ranking"],
): RankingConfig {
  const queryClasses = [
    "document_lookup", "table_threshold", "medication_dose_risk",
    "comparison", "broad_summary", "unsupported_or_general",
  ] as const satisfies readonly RagQueryClass[];
  const featureFusion = Object.fromEntries(queryClasses.map((queryClass) => [
    queryClass, { ...value.featureFusion[queryClass] },
  ])) as RankingConfig["featureFusion"];
  return {
    secondStage: { ...value.secondStage },
    featureFusion,
    documentDiversityPenalty: value.documentDiversityPenalty,
    documentDiversityPenaltyCap: value.documentDiversityPenaltyCap,
    freshness: { ...value.freshness },
  };
}

function runtimeAddress(address: EvalQualityCaseAddress): CaseAddress {
  return Object.freeze({ kind: address.kind, index: address.ordinal, caseId: address.id });
}
function caseKey(address: Pick<CaseAddress, "kind" | "index">) {
  return `${address.kind}:${address.index}`;
}
type ReadValue<M extends keyof RagEvaluationReadDependencies> =
  Awaited<ReturnType<RagEvaluationReadDependencies[M]>> extends RagEvaluationReadResult<infer Value> ? Value : never;
type CaseState = {
  readonly address: CaseAddress;
  readonly documentIds: readonly string[];
  readonly cacheContext: {
    readonly ragContextSnapshot: ReturnType<typeof resolveRagContextSnapshot>;
    readonly indexingVersionAtRequestStart: Promise<string>;
  };
  readOrdinal: number;
  evaluation: RagEvaluationContext | null;
};

export async function runShadowEvaluationRuntimeV1(
  input: ShadowEvaluationRuntimeInputV1,
): Promise<ShadowEvaluationRuntimeResultV1> {
  const sql = captureClosedFunctions(input.sql, sqlDependencyNames, "SQL");
  const providers = captureClosedFunctions(input.providers, providerDependencyNames, "provider");
  const clock = captureClosedFunctions(input.clock, clockDependencyNames, "clock");
  const requestEnvelope = immutableNativeSnapshot(input.requestEnvelope);
  const authorityEnvelope = immutableNativeSnapshot(input.authorityEnvelope);
  const independentlyAdmitted = immutableNativeSnapshot(input.independentlyAdmitted);
  const candidateEvidence = immutableNativeSnapshot(input.candidateEvidence ?? null);

  const admittedAt = clock.trustedNow();
  const request = immutableNativeSnapshot(prepareShadowEvaluationRuntimeAdmissionV1(
    requestEnvelope, authorityEnvelope, independentlyAdmitted, admittedAt, candidateEvidence,
  ));
  const profile = immutableNativeSnapshot(
    parseShadowExecutionProfileEnvelope(request.authority.executionProfileEnvelope),
  );
  const restoredCases = immutableNativeSnapshot(restoreShadowComparisonCases(profile.cases.payload));
  type WorkloadInput = Parameters<typeof runBoundEvalQualityWorkload>[0];
  const workloadCases = structuredClone(restoredCases) as Readonly<{
    retrieval: WorkloadInput["retrievalCases"];
    quality: WorkloadInput["qualityCases"];
  }>;
  const syntheticIndexIdentity = `u04-evaluation:${request.envelope.digest}`;
  const ragContextSnapshot = immutableNativeSnapshot(resolveRagContextSnapshot({
    expectedSiteStaticManifestDigest: null,
    activePublicSiteRelease: null,
    publicSiteChangeEpoch: null,
    pendingPublicSiteChangeCount: 0,
    pendingPublicSiteLogicalIds: [],
    documentIndexGeneration: syntheticIndexIdentity,
    sourcePolicyVersion: profile.payload.sourcePolicyVersion,
    rolloutVersion: profile.payload.rolloutMode,
    australianPublic: { indexGeneration: null, releaseDigest: null },
    resolvedAt: profile.payload.comparisonClock,
  }));
  const indexingVersionAtRequestStart = Promise.resolve(syntheticIndexIdentity);
  const failures: ShadowEvaluationRuntimeFailureV1[] = [];
  const readOccurrences: ShadowEvaluationRuntimeReadOccurrenceV1[] = [];
  const providerOccurrences: ShadowEvaluationRuntimeProviderOccurrenceV1[] = [];
  let failureLatched = false;

  const failureCollector: RagEvaluationFailureCollector = Object.freeze({
    record(failure) {
      failureLatched = true;
      failures.push(Object.freeze({ ...failure }));
    },
    assertComplete() {
      if (failureLatched) throw new Error("U04 evaluation session has a retained failure.");
    },
  });

  const access = profile.payload.access;
  const ownerId = access.mode === "owner" ? access.ownerId : null;
  const includePublic = access.mode === "owner" ? access.includePublic : true;
  const configuration: RagEvaluationContext["configuration"] = immutableNativeSnapshot({
    generation: { ...profile.configuration.payload.generation },
    ranking: mutableRankingConfig(profile.configuration.payload.ranking),
    retrieval: { ...profile.configuration.payload.retrieval },
  });
  const providerPolicy: RagEvaluationContext["providerPolicy"] = immutableNativeSnapshot({
    ...profile.payload.providerPolicy,
    routeBudgetMs: { ...profile.payload.providerPolicy.routeBudgetMs },
  });
  const caseStates = new Map<string, CaseState>();
  for (const scope of request.payload.caseScopes.scopes) {
    const address = Object.freeze({ ...scope.case });
    caseStates.set(caseKey(address), {
      address, documentIds: scope.documentIds,
      cacheContext: Object.freeze({ ragContextSnapshot, indexingVersionAtRequestStart }),
      readOrdinal: 0, evaluation: null,
    });
  }

  const requireCaseState = (addressValue: EvalQualityCaseAddress) => {
    const address = runtimeAddress(addressValue);
    const state = caseStates.get(caseKey(address));
    if (!state || state.address.caseId !== address.caseId) {
      failureCollector.record({ code: "context_mismatch", operation: "context" });
      throw new Error("U04 evaluation case address is outside the admitted request.");
    }
    return state;
  };

  const bindingFor = (state: CaseState, operation: ShadowEvaluationOperationV1, provenanceDigest: string) =>
    Object.freeze({
      sessionId: request.payload.sessionId, side: request.payload.phase.side, operation,
      documentIds: state.documentIds, snapshotDigest: request.envelope.digest, ownerId, includePublic, provenanceDigest,
    });

  const assertReadScope = (state: CaseState, operation: ShadowEvaluationOperationV1, value: RagEvaluationReadScope) => {
    if (value.sessionId !== request.payload.sessionId || value.side !== request.payload.phase.side ||
      value.snapshotDigest !== request.envelope.digest || value.ownerId !== ownerId ||
      value.includePublic !== includePublic || !sameTextArray(value.documentIds, state.documentIds)) {
      failureCollector.record({ code: "context_mismatch", operation });
      throw new Error(`U04 evaluation read scope mismatch for ${operation}.`);
    }
  };


  const executeRead = async <M extends keyof RagEvaluationReadDependencies>(
    state: CaseState,
    _method: M,
    operation: ShadowEvaluationOperationV1,
    requestValue: Parameters<RagEvaluationReadDependencies[M]>[0],
    originalArguments: unknown,
    dispatch: (context: ShadowEvaluationSqlContextV1) => Promise<unknown>,
  ): Promise<RagEvaluationReadResult<ReadValue<M>>> => {
    assertReadScope(state, operation, requestValue);
    const readOrdinal = state.readOrdinal++;
    const startedAt = clock.trustedNow();
    let preparedContext: ShadowEvaluationSqlContextV1;
    try {
      preparedContext = immutableNativeSnapshot(prepareShadowEvaluationSqlContextV1(
        request.envelope, request.authority.envelope, independentlyAdmitted, startedAt,
        operation, state.address, readOrdinal, originalArguments, candidateEvidence,
      ));
    } catch (error) {
      failureCollector.record({ code: "context_mismatch", operation });
      readOccurrences.push(Object.freeze({
        address: state.address, operation, readOrdinal, preparedContext: null, startedAt,
        finishedAt: null, resultEnvelope: null, status: "failed" as const, error: retainedError(error),
      }));
      throw error;
    }

    let resultEnvelope: unknown = null;
    try {
      const dispatched = await dispatch(preparedContext);
      resultEnvelope = immutableNativeSnapshot(dispatched);
      const finishedAt = clock.trustedNow();
      const validated = readShadowEvaluationResultV1(
        resultEnvelope, request.envelope, request.authority.envelope, independentlyAdmitted,
        startedAt, finishedAt, preparedContext.call as ShadowEvaluationCallV1<ShadowEvaluationOperationV1>,
        candidateEvidence,
      );
      readOccurrences.push(Object.freeze({
        address: state.address, operation, readOrdinal, preparedContext, startedAt, finishedAt,
        resultEnvelope: captureShadowProducerInputV1(resultEnvelope), status: "complete" as const, error: null,
      }));
      return Object.freeze({
        kind: "success" as const,
        binding: bindingFor(state, operation, validated.envelope.digest),
        value: validated.result as ReadValue<M>,
      });
    } catch (error) {
      failureCollector.record({ code: "dependency_error", operation });
      readOccurrences.push(Object.freeze({
        address: state.address, operation, readOrdinal, preparedContext, startedAt,
        finishedAt: clock.trustedNow(),
        resultEnvelope: resultEnvelope === null ? null : captureShadowProducerInputV1(resultEnvelope),
        status: "failed" as const, error: retainedError(error),
      }));
      throw error;
    }
  };

  const wrapProvider = async <Value>(
    state: CaseState,
    operation: RagEvaluationProviderOperation,
    providerInput: ShadowEvaluationNativeCaptureV1,
    call: () => Promise<Value>,
  ): Promise<Value> => {
    if (profile.payload.providerMode !== "openai") {
      const error = new Error(`U04 offline evaluation cannot dispatch ${operation}.`);
      failureCollector.record({ code: "provider_error", operation });
      providerOccurrences.push(Object.freeze({
        address: state.address, operation, input: providerInput, output: null,
        status: "failed" as const, error: retainedError(error),
      }));
      throw error;
    }
    try {
      const output = await call();
      providerOccurrences.push(Object.freeze({
        address: state.address, operation, input: providerInput,
        output: captureShadowProducerInputV1(output),
        status: "complete" as const, error: null,
      }));
      return output;
    } catch (error) {
      failureCollector.record({ code: "provider_error", operation });
      providerOccurrences.push(Object.freeze({
        address: state.address, operation, input: providerInput, output: null,
        status: "failed" as const, error: retainedError(error),
      }));
      throw error;
    }
  };

  const buildReaders = (state: CaseState): RagEvaluationReadDependencies => Object.freeze({
    readAliases: (read) => executeRead(state, "readAliases", "aliases", read, {},
      (context) => sql.readAliases(context)),
    readCorpusTermStats: (read) => executeRead(state, "readCorpusTermStats", "corpus_terms", read,
      { terms: read.terms }, (context) => sql.readCorpusTermStats(context)),
    correctClinicalTerms: (read) => executeRead(state, "correctClinicalTerms", "correct_terms", read,
      { input_query: read.input_query, min_sim: read.min_sim },
      (context) => sql.correctClinicalTerms(context)),
    readTextChunks: (read) => executeRead(state, "readTextChunks", "text_chunks", read,
      { query_text: read.query_text, match_count: read.match_count, document_filters: read.document_filters },
      (context) => sql.readTextChunks(context)),
    readHybridChunks: (read) => executeRead(state, "readHybridChunks", "hybrid_chunks", read,
      { query_embedding: read.query_embedding, query_text: read.query_text, match_count: read.match_count,
        min_similarity: read.min_similarity, document_filters: read.document_filters },
      (context) => sql.readHybridChunks(context)),
    readVectorChunks: (read) => executeRead(state, "readVectorChunks", "vector_chunks", read,
      { query_embedding: read.query_embedding, match_count: read.match_count,
        min_similarity: read.min_similarity, document_filter: read.document_filter },
      (context) => sql.readVectorChunks(context)),
    readLookupChunks: (read) => executeRead(state, "readLookupChunks", "lookup_chunks", read,
      { query_text: read.query_text, document_filters: read.document_filters, match_count: read.match_count },
      (context) => sql.readLookupChunks(context)),
    readLookupChunkTerms: (read) => executeRead(state, "readLookupChunkTerms", "lookup_chunk_terms", read,
      { document_filters: read.document_filters, terms: read.terms, match_count: read.match_count },
      (context) => sql.readLookupChunkTerms(context)),
    readLookupChunkPrefix: (read) => executeRead(state, "readLookupChunkPrefix", "lookup_chunk_prefix", read,
      { document_filters: read.document_filters, match_count: read.match_count },
      (context) => sql.readLookupChunkPrefix(context)),
    readLookupDocuments: (read) => executeRead(state, "readLookupDocuments", "lookup_documents", read,
      { query_text: read.query_text, match_count: read.match_count },
      (context) => sql.readLookupDocuments(context)),
    readLookupDocumentTerms: (read) => executeRead(state, "readLookupDocumentTerms", "lookup_document_terms", read,
      { terms: read.terms }, (context) => sql.readLookupDocumentTerms(context)),
    readTableFacts: (read) => executeRead(state, "readTableFacts", "table_facts", read,
      { query_text: read.query_text, match_count: read.match_count, document_filters: read.document_filters },
      (context) => sql.readTableFacts(context)),
    readEmbeddingFields: (read) => executeRead(state, "readEmbeddingFields", "embedding_fields", read,
      { query_embedding: read.query_embedding, query_text: read.query_text, match_count: read.match_count,
        min_similarity: read.min_similarity, document_filters: read.document_filters },
      (context) => sql.readEmbeddingFields(context)),
    readIndexUnits: (read) => executeRead(state, "readIndexUnits", "index_units", read,
      { query_embedding: read.query_embedding, query_text: read.query_text, match_count: read.match_count,
        min_similarity: read.min_similarity, document_filters: read.document_filters },
      (context) => sql.readIndexUnits(context)),
    readMemoryCardsHybrid: (read) => executeRead(state, "readMemoryCardsHybrid", "memory_cards_hybrid", read,
      { query_embedding: read.query_embedding, query_text: read.query_text, match_count: read.match_count,
        min_similarity: read.min_similarity, document_filters: read.document_filters },
      (context) => sql.readMemoryCardsHybrid(context)),
    readMemoryCardsLexical: (read) => executeRead(state, "readMemoryCardsLexical", "memory_cards_lexical", read,
      { query_text: read.query_text, document_filters: read.document_filters, match_count: read.match_count },
      (context) => sql.readMemoryCardsLexical(context)),
    readChunksByIds: (read) => executeRead(state, "readChunksByIds", "chunks_by_ids", read,
      { ids: read.ids }, (context) => sql.readChunksByIds(context)),
    readChunksByIndexes: (read) => executeRead(state, "readChunksByIndexes", "chunks_by_indexes", read,
      { document_ids: read.document_ids, indexes: read.indexes, match_count: read.match_count },
      (context) => sql.readChunksByIndexes(context)),
    readDocumentSnapshots: (read) => executeRead(state, "readDocumentSnapshots", "documents", read,
      { ids: read.ids }, (context) => sql.readDocumentSnapshots(context)),
    readRankingMetadata: (read) => executeRead(state, "readRankingMetadata", "ranking_metadata", read,
      { document_ids: read.document_ids }, (context) => sql.readRankingMetadata(context)),
    readRelatedDocuments: (read) => executeRead(state, "readRelatedDocuments", "related_documents", read,
      { document_ids: read.document_ids }, (context) => sql.readRelatedDocuments(context)),
    readQuality: (read) => executeRead(state, "readQuality", "quality", read,
      { document_ids: read.document_ids }, (context) => sql.readQuality(context)),
    readImagesByIds: (read) => executeRead(state, "readImagesByIds", "images_by_ids", read,
      { ids: read.ids }, (context) => sql.readImagesByIds(context)),
    readImagesByPages: (read) => executeRead(state, "readImagesByPages", "images_by_pages", read,
      { document_ids: read.document_ids, page_numbers: read.page_numbers },
      (context) => sql.readImagesByPages(context)),
    readVisualCounts: (read) => executeRead(state, "readVisualCounts", "visual_rows", read,
      { document_ids: read.document_ids }, (context) => sql.readVisualCounts(context)),
    readAdjacentChunks: (read) => executeRead(state, "readAdjacentChunks", "adjacent_chunks", read,
      { document_ids: read.document_ids, chunk_indexes: read.chunk_indexes },
      (context) => sql.readAdjacentChunks(context)),
  });

  const buildProviders = (state: CaseState): RagEvaluationProviderDependencies => Object.freeze({
    embedQuery: (requestValue) => {
      const retained = providerOptionsEvidence(requestValue);
      return wrapProvider(
        state,
        "embed_query",
        captureShadowProducerInputV1({ request: retained.options, signal: retained.signal }),
        () => providers.embedQuery(requestValue),
      );
    },
    generateClassifier: (providerInput, schema, options) => {
      const retained = providerOptionsEvidence(options);
      return wrapProvider(
        state,
        "classify_query",
        captureShadowProducerInputV1({
          input: providerInput,
          schema: zodSchemaEvidence(schema, options.schemaName),
          options: retained.options,
          signal: retained.signal,
        }),
        () => providers.generateClassifier(providerInput, schema, options),
      );
    },
    generateRerank: (providerInput, schema, options, policy) => {
      const retained = providerOptionsEvidence(options);
      return wrapProvider(
        state,
        "rerank",
        captureShadowProducerInputV1({
          input: providerInput,
          schema: zodSchemaEvidence(schema, options.schemaName),
          options: retained.options,
          policy,
          signal: retained.signal,
        }),
        () => providers.generateRerank(providerInput, schema, options, policy),
      );
    },
    generateAnswer: (providerInput, schema, options) => {
      const retained = providerOptionsEvidence(options);
      return wrapProvider(
        state,
        "generate_answer",
        captureShadowProducerInputV1({
          input: providerInput,
          schema,
          options: retained.options,
          signal: retained.signal,
        }),
        () => providers.generateAnswer(providerInput, schema, options),
      );
    },
  });


  for (const state of caseStates.values()) {
    state.evaluation = Object.freeze({
      kind: "u04-rag-evaluation-context-v1",
      sessionId: request.payload.sessionId,
      side: request.payload.phase.side,
      documentIds: state.documentIds,
      snapshotDigest: request.envelope.digest,
      ownerId,
      includePublic,
      sourceOnly: profile.payload.providerMode === "offline",
      providerAvailable: profile.payload.providerMode === "openai",
      configuration,
      providerPolicy,
      ragContextSnapshot,
      indexingVersionAtRequestStart,
      readers: buildReaders(state),
      providers: buildProviders(state),
      failures: failureCollector,
      now: () => clock.now(),
    });
  }

  const exactState = (address: EvalQualityCaseAddress) => {
    const state = requireCaseState(address);
    if (!state.evaluation) throw new Error("U04 evaluation case context was not initialized.");
    return state as CaseState & { evaluation: RagEvaluationContext };
  };

  const workload = await runBoundEvalQualityWorkload({
    retrievalCases: workloadCases.retrieval,
    qualityCases: workloadCases.quality,
    ownerId: ownerId ?? undefined,
    globalForceEmbedding: profile.cases.payload.globalForceEmbedding,
    evaluatorRetry: request.authority.payload.runnerPolicy.evaluatorRetry,
    costRates: request.authority.payload.runnerPolicy.costRates,
    providerMode: profile.payload.providerMode,
    runContext: request.authority.payload.runnerPolicy.runContext,
    crossRegionRunner: request.authority.payload.runnerPolicy.crossRegionRunner,
    generatedAt: admittedAt,
    search: async (searchInput, address) => {
      const state = exactState(address);
      const selected = restoredCases.retrieval[address.ordinal];
      const expectedForceEmbedding = selected?.forceEmbedding === true || profile.cases.payload.globalForceEmbedding;
      if (address.kind !== "retrieval" || !selected || selected.id !== address.id ||
        searchInput.query !== selected.query || searchInput.ownerId !== (ownerId ?? undefined) ||
        searchInput.topK !== Math.max(selected.topK, 10) || searchInput.minSimilarity !== 0.12 ||
        searchInput.skipCache !== true || searchInput.forceEmbedding !== expectedForceEmbedding) {
        failureCollector.record({ code: "context_mismatch", operation: "context" });
        throw new Error("U04 retrieval callback does not match its captured case.");
      }
      failureCollector.assertComplete();
      return searchChunksWithTelemetryForEvaluation({
        ...searchInput,
        ragContextSnapshot,
        cacheContext: state.cacheContext,
      }, state.evaluation);
    },
    answer: async (answerInput, address) => {
      const state = exactState(address);
      const selected = restoredCases.quality[address.ordinal];
      if (address.kind !== "quality" || !selected || selected.id !== address.id ||
        answerInput.query !== selected.question || answerInput.ownerId !== (ownerId ?? undefined) ||
        answerInput.logQuery !== false || answerInput.skipCache !== true) {
        failureCollector.record({ code: "context_mismatch", operation: "context" });
        throw new Error("U04 answer callback does not match its captured case.");
      }
      failureCollector.assertComplete();
      return answerQuestionWithScopeForEvaluation({
        ...answerInput,
        ragContextSnapshot,
        cacheContext: state.cacheContext,
      }, state.evaluation);
    },
  });

  try {
    prepareShadowEvaluationRuntimeAdmissionV1(
      requestEnvelope,
      authorityEnvelope,
      independentlyAdmitted,
      clock.trustedNow(),
      candidateEvidence,
    );
  } catch {
    failureCollector.record({ code: "context_mismatch", operation: "context" });
  }
  const retainedWorkload = immutableNativeSnapshot({
    ...workload,
    error: workload.error === null ? null : retainedError(workload.error),
  }) as BoundEvalQualityWorkloadResult;

  // A candidate can change during a provider call after its last retrieval read.
  // Reuse a fixed read to acquire a fresh whole-wave guard after all case work.
  let completionRead: ShadowEvaluationRuntimeReadOccurrenceV1 | null = null;
  if (request.payload.phase.side === "candidate" && workload.complete && !workload.failureLatched && !failureLatched) {
    const state = caseStates.values().next().value;
    if (!state) failureCollector.record({ code: "context_mismatch", operation: "context" });
    else try {
      await buildReaders(state).readAliases({
        sessionId: request.payload.sessionId, side: request.payload.phase.side,
        documentIds: state.documentIds, snapshotDigest: request.envelope.digest, ownerId, includePublic,
      });
      completionRead = readOccurrences.at(-1) ?? null;
    } catch {
      // executeRead retains the original failure and permanently latches NO_GO.
    }
  }

  return Object.freeze({
    kind: "u04-evaluation-runtime-result-v1" as const,
    complete: retainedWorkload.complete && !retainedWorkload.failureLatched && !failureLatched,
    failureLatched: failureLatched || retainedWorkload.failureLatched,
    requestEnvelope: immutableNativeSnapshot(request.envelope),
    authorityEnvelope: immutableNativeSnapshot(request.authority.envelope),
    executionProfileEnvelope: immutableNativeSnapshot(request.authority.executionProfileEnvelope),
    ragContextSnapshot: immutableNativeSnapshot(ragContextSnapshot),
    indexingVersionAtRequestStart: syntheticIndexIdentity,
    readOccurrences: Object.freeze(readOccurrences.slice()),
    completionRead,
    providerOccurrences: Object.freeze(providerOccurrences.slice()),
    failures: Object.freeze(failures.slice()),
    workload: retainedWorkload,
  });
}
