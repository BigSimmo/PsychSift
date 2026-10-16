export type JobDocument = {
  id: string;
  owner_id: string | null;
  title: string;
  file_name: string;
  file_type: string;
  storage_path: string;
  content_hash?: string | null;
  file_size?: number | null;
  page_storage_mode?: "legacy_unqualified" | "typed_exact";
  source_path?: string | null;
  import_batch_id?: string | null;
  status?: string | null;
  metadata: Record<string, unknown> | null;
};

export type JobRow = {
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
