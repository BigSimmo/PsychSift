import type { ShadowWorkerContextV1, ShadowProducerBatchV1, ShadowRawEnvelope } from "../scripts/lib/reindex-eval-session";

export type ShadowWorkerReservation = ShadowWorkerContextV1;

export type ShadowProducerFailure = Readonly<{
  phase: "cache_lookup" | "image_bytes" | "image_classification" | "chunk_embeddings" |
    "section_context" | "table_facts" | "visual_index_units" |
    "supplemental_embedding_fields" | "enrichment_policy" | "summary_generation" |
    "document_embedding_fields" | "deep_sections" | "deep_model_profile" | "deep_cards" |
    "deep_card_embeddings" | "deep_index_units" | "deep_index_embeddings" | "deep_persistence";
  code: "producer_failed" | "producer_skipped";
  artifactGenerationId: string | null;
  input: unknown;
  partial: unknown;
}>;

/** Fixed producer declaration boundary; persistence remains in the owning producer. */
export type ShadowProducerPersistence = {
  binding: ShadowWorkerReservation["binding"];
  declareBatch: (batch: ShadowProducerBatchV1) => Promise<ShadowRawEnvelope>;
  recordFailure: (failure: ShadowProducerFailure) => Promise<never>;
};

/** Candidate-only pending native persistence inputs, before any family write. */
export type ShadowCoreProducerRows = {
  chunks: Record<string, unknown>[];
  table_facts: Record<string, unknown>[];
  embedding_fields: Record<string, unknown>[];
  index_units: Record<string, unknown>[];
};

export type JobDocument = {
  id: string;
  owner_id: string | null;
  title: string;
  file_name: string;
  file_type: string;
  storage_path: string;
  content_hash?: string | null;
  source_path?: string | null;
  import_batch_id?: string | null;
  status?: string | null;
  metadata: Record<string, unknown> | null;
};

export type JobRow = {
  // Optional until the U04 claim contract is introduced; legacy claims remain standard.
  operation?: "standard" | "shadow_reindex";
  requested_generation_id?: string | null;
  shadow_plan_digest?: string | null;
  locked_by: string;
  lease_token: string;
  lease_expected_generation_id: string | null;
  lease_write_generation_id: string;
  lease_authority_digest: string;
  lease_expires_at: string;
  lease_duration_seconds: number;
  id: string;
  document_id: string;
  batch_id: string | null;
  attempt_count: number;
  max_attempts: number;
  documents: JobDocument;
};

/** Persisted member and wave identity read for a shadow claim, never document metadata. */
export type ShadowGenerationMember = {
  document_id: string;
  index_generation_id: string;
  baseline_generation_id: string | null;
  job_id: string;
  first_lease_token: string;
  authority_digest: string;
  shadow_reindex_waves: {
    candidate_generation_id: string;
    plan_digest: string;
  };
};
