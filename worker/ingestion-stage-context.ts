import type { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import type { IngestionProviderEgressContext } from "../src/lib/ingestion-provider-egress";
import type { embedTexts } from "../src/lib/openai";
import type { runIngestionMutation } from "./behavior";
import type { ManagedProviderEmbeddingBatchContext } from "./managed-provider-vectors";
import type { JobRow } from "./types";

/** The fenced, serialized mutation adapter that createWorkerRuntime builds once per runtime. */
export type IngestionMutation = (
  attempt: IngestionAttempt,
  name: string,
  args?: Record<string, unknown>,
) => ReturnType<typeof runIngestionMutation>;

/** Binds a managed embedding batch to the job and attempt that dispatched it. */
export type ManagedEmbeddingScope = AsyncLocalStorage<
  Readonly<{
    job: JobRow;
    attempt: IngestionAttempt;
    producer: ManagedProviderEmbeddingBatchContext;
    expectedPlanDigest: string;
  }>
>;

export type BaseArtifactRows = {
  chunks?: unknown[];
  images?: unknown[];
  tableFacts?: unknown[];
  embeddingFields?: unknown[];
  indexUnits?: unknown[];
};

/**
 * The runtime services an ingestion stage may use. createWorkerRuntime owns every one of
 * these (attempt maps, provider contexts, the mutation serializer, progress throttling);
 * the stage modules receive them here instead of closing over the runtime, so each stage
 * can be exercised alone with a fake context.
 */
export type IngestionStageContext = Readonly<{
  supabase: SupabaseClient;
  ingestionRpcClient: SupabaseClient;
  attemptForJob: (jobId: string) => IngestionAttempt;
  attemptForDocument: (documentId: string) => IngestionAttempt;
  mutation: IngestionMutation;
  providerContextForJob: (job: JobRow) => IngestionProviderEgressContext;
  updateJob: (jobId: string, patch: { stage?: string; progress?: number }) => Promise<void>;
  updateJobProgress: (jobId: string, patch: { stage: string; progress: number }) => Promise<void>;
  workerEmbedTexts: (
    job: JobRow,
    texts: string[],
    batchContext?: ManagedProviderEmbeddingBatchContext,
    expectedPlanDigest?: string,
  ) => Promise<Awaited<ReturnType<typeof embedTexts>>>;
  writeBaseArtifacts: (job: JobRow, generation: string, rows: BaseArtifactRows) => Promise<void>;
}>;
