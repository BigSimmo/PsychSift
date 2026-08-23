import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8").replace(/\s+/g, " ");
const documentIndexUnitsMigration = readFileSync(
  new URL("../supabase/migrations/20260612006000_document_index_units.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const bulkIngestionMigration = readFileSync(
  new URL("../supabase/migrations/20260527000000_bulk_ingestion.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const lexicalScoreMigration = readFileSync(
  new URL("../supabase/migrations/20260617000000_text_search_lexical_score.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const perDocTokenSearchMigration = readFileSync(
  new URL("../supabase/migrations/20260617001000_per_document_token_search.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const strictGateRepairMigration = readFileSync(
  new URL("../supabase/migrations/20260625033425_strict_enrichment_gate_repair.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const indexingV3AgentWorkerHardeningMigration = readFileSync(
  new URL("../supabase/migrations/20260625000000_indexing_v3_agent_worker_hardening.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const documentChangeWebhookMigration = readFileSync(
  new URL("../supabase/migrations/20260723150000_document_change_ingestion_webhook.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const atomicReindexAgentGuardMigration = readFileSync(
  new URL("../supabase/migrations/20260724060000_atomic_reindex_agent_guard.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const dropStageJobIdFkMigration = readFileSync(
  new URL("../supabase/migrations/20260708140000_drop_ingestion_job_stages_job_id_fk.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const atomicStrictCompletionMigration = readFileSync(
  new URL("../supabase/migrations/20260625033944_atomic_strict_enrichment_completion.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const dropDuplicateStageIndexMigration = readFileSync(
  new URL("../supabase/migrations/20260626000000_drop_duplicate_ingestion_job_stage_index.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const phase7RetrievalPerformanceMigration = readFileSync(
  new URL("../supabase/migrations/20260626020000_phase7_retrieval_rpc_performance.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const retrievalOwnerFilterSentinelMigration = readFileSync(
  new URL("../supabase/migrations/20260705210000_retrieval_owner_filter_sentinel.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const ingestionJobsOneOpenNeutralizedMigration = readFileSync(
  new URL("../supabase/migrations/20260708160000_ingestion_jobs_one_open_per_document.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const ingestionJobsOneOpenMigration = readFileSync(
  new URL("../supabase/migrations/20260708170000_ingestion_jobs_one_open_per_document.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const retrievalPublicExecuteMigration = readFileSync(
  new URL("../supabase/migrations/20260708150150_harden_retrieval_public_execute.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const ingestionRpcPrivilegesMigration = readFileSync(
  new URL("../supabase/migrations/20260709062443_reconcile_ingestion_rpc_privileges_production.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const ingestionRpcPrivilegesDuplicateMigration = readFileSync(
  new URL("../supabase/migrations/20260709150000_reconcile_ingestion_rpc_privileges.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const atomicReindexMigration = readFileSync(
  new URL("../supabase/migrations/20260628000000_atomic_reindex_generation_commit.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const abandonedReindexRecoveryMigration = readFileSync(
  new URL("../supabase/migrations/20260629000000_abandoned_reindex_generation_recovery.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const auditLogsServiceRolePolicyMigration = readFileSync(
  new URL("../supabase/migrations/20260630090000_audit_logs_service_role_policy.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const migrationDirectoryUrl = new URL("../supabase/migrations/", import.meta.url);

function parseMigrationStem(fileName: string) {
  const stem = fileName.match(/^\d+_(.+)\.sql$/)?.[1];
  return stem ?? null;
}

function sqlFunctionBody(sql: string, functionName: string) {
  const start = sql.indexOf(`create or replace function public.${functionName}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$$;", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}
const preserveLegacyArtifactCommitMigration = readFileSync(
  new URL("../supabase/migrations/20260702000000_commit_generation_preserve_legacy_artifacts.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const promoteIndexGenerationIdMigration = readFileSync(
  new URL("../supabase/migrations/20260702180000_promote_index_generation_id_columns.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const indexingV3AgentJobsMigration = readFileSync(
  new URL("../supabase/migrations/20260702190000_indexing_v3_agent_jobs_table.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const routeEnrichmentThroughAgentMigration = readFileSync(
  new URL("../supabase/migrations/20260713062139_route_enrichment_through_agent.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const ragRemediationFunctionReconciliationMigration = readFileSync(
  new URL("../supabase/migrations/20260713083000_reconcile_rag_remediation_functions.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const deepMemoryCommitReconciliationMigration = readFileSync(
  new URL("../supabase/migrations/20260713090500_reconcile_deep_memory_commit.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const indexFriendlyLexicalRetrievalMigration = readFileSync(
  new URL("../supabase/migrations/20260713100000_index_friendly_lexical_retrieval.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const pinOwnerMatchesV2SearchPathMigration = readFileSync(
  new URL("../supabase/migrations/20260713101000_pin_retrieval_owner_matches_v2_search_path.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const publicationApprovalMigration = readFileSync(
  new URL("../supabase/migrations/20260717131000_guard_document_publication_approval.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const publicationReviewedStateMigration = readFileSync(
  new URL("../supabase/migrations/20260722190000_bind_publication_approval_to_reviewed_state.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const australianSourceActivationMigration = readFileSync(
  new URL("../supabase/migrations/20260822123000_govern_australian_source_activation.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const publicSourceControlPlaneMigration = readFileSync(
  new URL("../supabase/migrations/20260820121000_create_public_source_control_plane.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const deleteDocumentIfIdleMigration = readFileSync(
  new URL("../supabase/migrations/20260717132000_delete_document_if_idle.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const defaultAclAssertionMigration = readFileSync(
  new URL("../supabase/migrations/20260717161000_assert_postgres_default_privileges.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const defaultAclRepairMigration = readFileSync(
  new URL("../supabase/migrations/20260719053532_repair_postgres_default_privileges.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const defaultAclRoleBootstrap = readFileSync(new URL("../supabase/roles.sql", import.meta.url), "utf8").replace(
  /\s+/g,
  " ",
);
const scrubLegacyQueryTextMigration = readFileSync(
  new URL("../supabase/migrations/20260713103000_scrub_legacy_rag_query_text.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const validateContentNotBlankMigration = readFileSync(
  new URL("../supabase/migrations/20260713104000_validate_content_not_blank_constraints.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const clinicalRegistryRecordsMigration = readFileSync(
  new URL("../supabase/migrations/20260703020000_clinical_registry_records.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const medicationRecordsMigration = readFileSync(
  new URL("../supabase/migrations/20260705010000_medication_records.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const registryCatalogPayloadMigration = readFileSync(
  new URL("../supabase/migrations/20260705030000_registry_catalog_payload.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const searchHealthIndexesMigration = readFileSync(
  new URL("../supabase/migrations/20260705180000_reconcile_search_health_indexes.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const restoreRagSearchHealthIndexesMigration = readFileSync(
  new URL("../supabase/migrations/20260804110240_restore_rag_search_health_indexes.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const driftManifest = JSON.parse(readFileSync(new URL("../supabase/drift-manifest.json", import.meta.url), "utf8")) as {
  snapshot: {
    indexes: Array<{ name: string; def: string }>;
  };
};
const driftIndexDefinitions = new Map(driftManifest.snapshot.indexes.map((index) => [index.name, index.def] as const));

// Keep in lockstep with the PL/pgSQL chain in
// supabase/migrations/20260804110240_restore_rag_search_health_indexes.sql.
// The restore-migration contract below also pins each SQL transform literal.
const INDEX_DEFINITION_NORMALIZER_SQL_STEPS = [
  "replace(actual_normalized, 'create index if not exists', 'create index')",
  "regexp_replace(actual_normalized, ' extensions\\.', ' ', 'g')",
  "regexp_replace(actual_normalized, ' using btree', '', 'g')",
  "regexp_replace(actual_normalized, 'where \\(([^()]*)\\)$', 'where \\1')",
  "replace(actual_normalized, ';', '')",
  "regexp_replace(actual_normalized, '[[:space:]]+', ' ', 'g')",
  "regexp_replace(actual_normalized, ' on ([^ ()]+) \\(', ' on \\1(', 'g')",
] as const;

function normalizeIndexDefinition(definition: string) {
  return (
    definition
      .toLowerCase()
      .replace("create index if not exists", "create index")
      .replace(/ extensions\./g, " ")
      .replace(/ using btree/g, "")
      .replace(/where \(([^()]*)\)$/g, "where $1")
      .replace(/;/g, "")
      .replace(/\s+/g, " ")
      // pg_get_indexdef emits "table (cols)" after USING btree is stripped; schema SQL uses "table(cols)".
      .replace(/ on ([^ ()]+) \(/g, " on $1(")
      .trim()
  );
}
const searchSchemaHealthM13GuardMigration = readFileSync(
  new URL("../supabase/migrations/20260706010000_search_schema_health_m13_guard.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const ragQueriesRetentionMigration = readFileSync(
  new URL("../supabase/migrations/20260629060603_rag_queries_retention.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const ragQueriesRetentionDuplicateMigration = readFileSync(
  new URL("../supabase/migrations/20260629100000_rag_queries_retention.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const ragRetrievalLogsRetentionMigration = readFileSync(
  new URL("../supabase/migrations/20260702120000_rag_retrieval_logs_retention.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const ragQueryMissesRetentionMigration = readFileSync(
  new URL("../supabase/migrations/20260708120000_rag_query_misses_retention.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const responseCacheRetentionReconciliationMigration = readFileSync(
  new URL("../supabase/migrations/20260713201542_consolidate_rag_response_cache_retention.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const liveDatabaseDriftMigration = readFileSync(
  new URL("../supabase/migrations/20260705230000_reconcile_live_database_drift.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const searchDocumentChunksOwnerScopeMigration = readFileSync(
  new URL("../supabase/migrations/20260705133000_tighten_search_document_chunks_owner_scope.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const searchDocumentChunksCommittedGenerationMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260717130000_filter_search_document_chunks_committed_generation.sql",
    import.meta.url,
  ),
  "utf8",
).replace(/\s+/g, " ");
const retrievalPlanCacheMigration = readFileSync(
  new URL("../supabase/migrations/20260711120000_retrieval_fn_plan_cache_mode.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const patchRagAndCorrectorScalabilityMigration = readFileSync(
  new URL("../supabase/migrations/20260714180000_patch_rag_and_corrector_scalability.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const documentTableFactsTrgmMigration = readFileSync(
  new URL("../supabase/migrations/20260714190000_document_table_facts_trgm_idx.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const hardenRagScalabilityPatchMigration = readFileSync(
  new URL("../supabase/migrations/20260717010000_harden_rag_scalability_patch.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const documentTitleWordScopeMigration = readFileSync(
  new URL("../supabase/migrations/20260719053533_enforce_public_title_word_scope.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const documentTitleWordsBackendPolicyMigration = readFileSync(
  new URL("../supabase/migrations/20260722110000_explicit_document_title_words_backend_policy.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const publicTitleCorrectorMigration = readFileSync(
  new URL("../supabase/migrations/20260717171000_public_title_corrector.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const baseMatchRpcExecuteGrantsMigration = readFileSync(
  new URL("../supabase/migrations/20260724130000_explicit_base_match_rpc_execute_grants.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const invokeIngestionWorkerGucMigration = readFileSync(
  new URL("../supabase/migrations/20260724130100_fix_invoke_ingestion_worker_url_to_guc.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");

function finalSqlSegment(sql: string, startMarker: string, endMarker: string) {
  const normalized = sql.toLowerCase();
  const start = normalized.lastIndexOf(startMarker.toLowerCase());
  if (start < 0) throw new Error(`Missing SQL marker: ${startMarker}`);
  const end = normalized.indexOf(endMarker.toLowerCase(), start);
  if (end < 0) throw new Error(`Missing SQL marker after ${startMarker}: ${endMarker}`);
  return normalized.slice(start, end);
}

function extractTextChunkFunction(sql: string) {
  const start = sql.indexOf("function public.match_document_chunks_text");
  const end = sql.indexOf("$$;", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

function extractIndexUnitHybridFunction(sql: string) {
  const start = sql.indexOf("create or replace function public.match_document_index_units_hybrid");
  const end = sql.indexOf("$$;", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("Supabase schema Data API grants", () => {
  it("codifies custom plans for non-inlined retrieval functions", () => {
    for (const functionName of [
      "match_document_table_facts_text",
      "match_document_memory_cards_hybrid",
      "match_document_index_units_hybrid",
      "match_document_embedding_fields_hybrid",
    ]) {
      const start = schema.indexOf(`create or replace function public.${functionName}(`);
      const end = schema.indexOf("as $$", start);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(schema.slice(start, end)).toContain("set plan_cache_mode = 'force_custom_plan'");
      expect(retrievalPlanCacheMigration).toContain(`alter function public.${functionName}`);
    }
  });

  it("explicitly grants service-role access for upload and ingestion tables", () => {
    expect(schema).toContain("public.import_batches,");
    expect(schema).toContain("public.document_labels,");
    expect(schema).toContain("public.document_summaries,");
    expect(schema).toContain("public.storage_cleanup_jobs");
    expect(schema).toMatch(
      /grant select, insert, update, delete on table .*public\.documents, .*public\.document_pages, .*public\.document_images, .*public\.image_caption_cache, .*public\.document_labels, .*public\.document_summaries, .*public\.document_sections, .*public\.document_memory_cards, .*public\.document_chunks, .*public\.ingestion_jobs, .*public\.rag_queries, .*public\.storage_cleanup_jobs.* to service_role;/,
    );
    expect(schema).toContain("grant execute on all functions in schema public to service_role;");
  });

  it("keeps browser Data API table privileges disabled", () => {
    expect(schema).toContain("revoke all privileges on all tables in schema public from anon, authenticated;");
    expect(schema).toContain("revoke execute on all functions in schema public from public, anon, authenticated;");
    expect(schema).not.toMatch(/grant [^;]* on table [^;]* to authenticated;/);
    expect(schema).not.toContain("grant select, insert, update, delete on table public.documents to authenticated;");
    expect(schema).not.toContain("grant select, insert on table public.rag_queries to authenticated;");
    expect(schema).not.toMatch(/grant [^;]* on table [^;]*public\.document_sections[^;]* to authenticated;/);
    expect(schema).not.toMatch(/grant [^;]* on table [^;]*public\.document_memory_cards[^;]* to authenticated;/);
    expect(schema).not.toMatch(/grant [^;]* on table [^;]* to anon;/);
  });

  it("enables RLS where baseline owner policies are created", () => {
    for (const tableName of [
      "import_batches",
      "documents",
      "document_pages",
      "document_images",
      "document_chunks",
      "ingestion_jobs",
      "rag_queries",
    ]) {
      expect(bulkIngestionMigration).toContain(`alter table public.${tableName} enable row level security`);
      expect(schema).toContain(`alter table public.${tableName} enable row level security`);
    }
  });

  it("supports bulk import queue claiming and reindex resets", () => {
    expect(schema).toContain("create table if not exists public.import_batches");
    expect(schema).toContain("content_hash text");
    expect(schema).toContain(
      "create unique index if not exists documents_owner_content_hash_unique_idx on public.documents(owner_id, content_hash) where content_hash is not null;",
    );
    expect(schema).toContain("create or replace function public.claim_ingestion_jobs");
    expect(schema).toContain("row_number() over (partition by j.document_id order by j.created_at asc, j.id asc)");
    expect(schema).toContain("where active.document_id = j.document_id");
    expect(schema).toContain("and active.status = 'processing'");
    expect(schema).toContain("for update of j, d skip locked");
    expect(schema).toContain("when j.status = 'processing' then 'reclaimed stale job'");
    expect(schema).toContain("create or replace function public.reset_document_index");
    expect(schema).toContain("create or replace function public.refresh_import_batch_status");
    expect(schema).toContain("create or replace function public.complete_ingestion_job");
    expect(schema).toContain("create or replace function public.fail_or_retry_ingestion_job");
    expect(schema).toContain("count(*) filter (where status = 'pending')");
    expect(schema).toContain("failed_files = failed_count");
    expect(schema).toContain("perform public.refresh_import_batch_status(p_batch_id);");
    expect(schema).toContain("delete from public.document_memory_cards where document_id = p_document_id;");
    expect(schema).toContain("delete from public.document_sections where document_id = p_document_id;");
  });

  it("keeps replacement reindex generations invisible until commit", () => {
    for (const sql of [schema, atomicReindexMigration]) {
      expect(sql).toContain("create or replace function public.commit_document_index_generation");
      expect(sql).toContain("document_chunks_document_generation_chunk_idx");
      expect(sql).toContain("create or replace function public.is_committed_document_generation");
      expect(sql).toContain("create or replace function public.is_committed_artifact_generation");
      expect(sql).toContain("p_pages jsonb default null");
      expect(sql).toContain("p_quality jsonb default null");
      expect(sql).toContain("insert into public.document_pages");
      expect(sql).toContain("insert into public.document_index_quality");
    }
    // R5 helpers live only in schema.sql (+ the dedicated migration), not in the
    // original atomic-reindex migration snapshot.
    expect(schema).toContain("create or replace function public.jsonb_merge_deep");
    expect(schema).toContain("create or replace function public.apply_document_metadata_patch");
    expect(schema).toContain("perform public.apply_document_metadata_patch");
    // D2 (2026-07-14): retrieval readers compare the typed generated column on
    // documents, not the JSONB metadata pointer.
    expect(schema).toContain("public.is_committed_document_generation(c.index_generation_id, d.index_generation_id)");
    expect(schema).not.toContain("public.is_committed_document_generation(c.index_generation_id, d.metadata)");
    expect(schema).toContain("public.is_committed_artifact_generation(m.metadata, d.metadata)");
    expect(schema).toContain("public.is_committed_artifact_generation(f.metadata, d.metadata)");
    expect(schema).toContain("public.is_committed_artifact_generation(u.metadata, d.metadata)");
    for (const sql of [schema, atomicReindexMigration]) {
      expect(sql).toContain(
        "revoke execute on function public.commit_document_index_generation(uuid, uuid, text, integer, integer, integer, jsonb, jsonb, jsonb) from public, anon, authenticated",
      );
      expect(sql).toContain(
        "revoke execute on function public.is_committed_document_generation(uuid, jsonb) from public, anon, authenticated",
      );
      expect(sql).toContain(
        "revoke execute on function public.is_committed_artifact_generation(jsonb, jsonb) from public, anon, authenticated",
      );
    }
    expect(schema).toContain(
      "revoke execute on function public.commit_document_index_generation(uuid, uuid, text, integer, integer, integer, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role",
    );
    expect(schema).not.toContain(
      "grant execute on function public.commit_document_index_generation(uuid, uuid, text, integer, integer, integer, jsonb, jsonb, jsonb) to service_role",
    );
    expect(atomicReindexMigration).toContain("atomic reindex patch did not match match_document_chunks_hybrid");
    expect(atomicReindexMigration).toContain("atomic reindex patch did not match match_document_index_units_hybrid");
  });

  it("preserves NULL-generation artifacts until replacements exist", () => {
    for (const sql of [preserveLegacyArtifactCommitMigration]) {
      expect(sql).toContain(
        "index_generation_id is null and exists ( select 1 from public.document_chunks replacement",
      );
      expect(sql).toContain(
        "nullif(metadata->>'index_generation_id', '') is null and exists ( select 1 from public.document_images replacement",
      );
      expect(sql).toContain("from public.document_chunks replacement");
      expect(sql).toContain("from public.document_images replacement");
      expect(sql).toContain("from public.document_table_facts replacement");
      expect(sql).toContain("from public.document_embedding_fields replacement");
      expect(sql).toContain("from public.document_index_units replacement");
      expect(sql).toContain("from public.document_memory_cards replacement");
      expect(sql).toContain("from public.document_sections replacement");
    }

    for (const sql of [schema, promoteIndexGenerationIdMigration]) {
      expect(sql).toContain(
        "index_generation_id is null and exists ( select 1 from public.document_chunks replacement",
      );
      expect(sql).toContain("(metadata->>'index_generation_id')::uuid is distinct from p_index_generation_id");
      expect(sql).toContain("replacement.index_generation_id = p_index_generation_id");
      expect(sql).toContain(
        "replacement.index_generation_id is null and (replacement.metadata->>'index_generation_id')::uuid = p_index_generation_id",
      );
      expect(sql).toContain("from public.document_chunks replacement");
      expect(sql).toContain("from public.document_images replacement");
      expect(sql).toContain("from public.document_table_facts replacement");
      expect(sql).toContain("from public.document_embedding_fields replacement");
      expect(sql).toContain("from public.document_index_units replacement");
      expect(sql).toContain("from public.document_memory_cards replacement");
      expect(sql).toContain("from public.document_sections replacement");
    }
  });

  it("can identify and clean abandoned staged reindex generations", () => {
    for (const sql of [schema, abandonedReindexRecoveryMigration]) {
      expect(sql).toContain("create or replace function public.cleanup_abandoned_document_index_generations");
      expect(sql).toContain("p_dry_run boolean default true");
      expect(sql).toContain("j.status in ('pending', 'processing')");
      expect(sql).toContain("c.index_generation_id is not null");
      expect(sql).toContain("metadata, '{}'::jsonb)->>'index_generation_id'");
      expect(sql).toContain("if not coalesce(p_dry_run, true) then");
      expect(sql).toContain("'document_chunks', chunk_count");
      expect(sql).toContain("'document_index_units', index_unit_count");
      expect(sql).toContain(
        "revoke execute on function public.cleanup_abandoned_document_index_generations(uuid, integer, boolean) from public, anon, authenticated",
      );
      expect(sql).toContain(
        "grant execute on function public.cleanup_abandoned_document_index_generations(uuid, integer, boolean) to service_role",
      );
    }
  });

  it("keeps indexing-v3 enrichment claiming separate from raw ingestion jobs", () => {
    expect(schema).toContain("create table if not exists public.ingestion_job_stages");
    // R24e: schema.sql no longer declares a job_id -> ingestion_jobs FK. Live has
    // none, and job_id holds indexing_v3_agent_jobs ids, not ingestion_jobs ids,
    // so the FK would break the edge agent. The historical migration
    // 20260625000000 added it; 20260708140000 drops it so fresh/preview
    // environments match live.
    expect(schema).toContain("job_id uuid not null,");
    expect(schema).not.toContain("job_id uuid not null references public.ingestion_jobs(id) on delete cascade");
    expect(indexingV3AgentWorkerHardeningMigration).toContain(
      "add constraint ingestion_job_stages_job_id_fkey foreign key (job_id) references public.ingestion_jobs(id) on delete cascade",
    );
    expect(dropStageJobIdFkMigration).toContain("drop constraint if exists ingestion_job_stages_job_id_fkey");
    expect(schema).toContain("drop index if exists public.ingestion_job_stages_doc_idx");
    expect(schema).toContain("create index if not exists ingestion_job_stages_document_started_idx");
    for (const sql of [schema, indexingV3AgentJobsMigration]) {
      expect(sql).toContain("create table if not exists public.indexing_v3_agent_jobs");
      expect(sql).toContain("document_id uuid not null references public.documents(id) on delete cascade");
      expect(sql).toContain("create index if not exists indexing_v3_agent_jobs_claim_idx");
      expect(sql).toContain("create or replace function public.claim_indexing_v3_agent_jobs");
      expect(sql).toContain("from public.indexing_v3_agent_jobs j");
      expect(sql).toContain("j.enrichment_status in ('pending', 'failed', 'processing')");
      expect(sql).toContain("update public.indexing_v3_agent_jobs j");
      expect(sql).toContain("'indexing_v3_agent_locked_by', p_worker_id");
      expect(sql).toContain("'indexing_v3_agent_attempt_count', cj.attempt_count");
      expect(sql).toContain("create or replace function public.update_indexing_v3_agent_job_status");
      expect(sql).toContain(
        "grant execute on function public.update_indexing_v3_agent_job_status(uuid, text, text, timestamptz) to service_role",
      );
    }
    expect(schema).toContain(
      "grant execute on function public.claim_indexing_v3_agent_jobs(text, integer, integer) to service_role",
    );
    expect(schema).toContain("alter table public.ingestion_job_stages enable row level security");
    expect(schema).toContain('create policy "ingestion job stages service role all" on public.ingestion_job_stages');
    expect(schema).toContain("alter table public.indexing_v3_agent_jobs enable row level security");
    expect(schema).toContain(
      'create policy "indexing v3 agent jobs service role all" on public.indexing_v3_agent_jobs',
    );
    const authenticatedSelectGrant = schema.match(/grant select on table ([^;]+) to authenticated;/)?.[1] ?? "";
    expect(authenticatedSelectGrant).not.toContain("public.ingestion_job_stages");
    expect(authenticatedSelectGrant).not.toContain("public.indexing_v3_agent_jobs");
  });

  it("keeps the cron indexing-v3 invoker in the schema snapshot with service-role-only execute grants", () => {
    expect(schema).toContain("create or replace function public.invoke_indexing_v3_agent");
    expect(schema).toContain("returns bigint");
    expect(schema).toContain("security definer");
    expect(schema).toContain("set search_path = public, extensions, vault, pg_temp");
    expect(schema).toContain("from vault.decrypted_secrets");
    expect(schema).toContain("where name = 'indexing_v3_agent_secret'");
    // The GUC default is set through a privilege-guarded DO block so schema
    // replay succeeds on hosted Supabase (ALTER DATABASE SET is denied there).
    expect(schema).toContain("alter database %I set app.indexing_v3_agent_base_url = %L");
    expect(schema).toContain("when insufficient_privilege then");
    expect(schema).toContain("nullif(current_setting('app.indexing_v3_agent_base_url', true), '')");
    expect(schema).toContain("select net.http_post(");
    expect(schema).toContain("v_base_url || '/functions/v1/indexing-v3-agent?limit='");
    expect(schema).toContain("'https://sjrfecxgysukkwxsowpy.supabase.co'");
    expect(schema).toContain("/functions/v1/indexing-v3-agent?limit=");
    expect(schema).toContain(
      "revoke execute on function public.invoke_indexing_v3_agent(integer) from public, anon, authenticated",
    );
    expect(schema).toContain("grant execute on function public.invoke_indexing_v3_agent(integer) to service_role");
  });

  it("keeps the document-change ingestion webhook update-only, minimal, and fail-safe", () => {
    for (const sql of [schema, documentChangeWebhookMigration]) {
      const start = sql.indexOf("create or replace function public.notify_document_change_ingestion_webhook");
      const end = sql.indexOf("$$;", start);
      const body = sql.slice(start, end);

      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      expect(body).toContain("returns trigger");
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = public, extensions, vault, pg_temp");
      expect(body).toContain("new.metadata->'reindex_requested' = 'true'::jsonb");
      expect(body).toContain("new.metadata->'reindex_requested' is distinct from old.metadata->'reindex_requested'");
      expect(body).toContain("where name = 'ingestion_webhook_secret'");
      expect(body).toContain("current_setting('app.ingestion_webhook_base_url', true)");
      expect(body).toContain("rtrim(v_base_url, '/') || '/api/webhooks/supabase/document-change'");
      expect(body).toContain("'id', new.id");
      expect(body).toContain("'owner_id', new.owner_id");
      expect(body).toContain("'status', new.status");
      expect(body).toContain("timeout_milliseconds := 5000");
      expect(body).toContain("when others then");
      expect(body).not.toContain("to_jsonb(new)");
      expect(body).not.toContain("old_record");
      expect(body).not.toContain("psychiatry.tools");

      expect(sql).toContain(
        "revoke execute on function public.notify_document_change_ingestion_webhook() from public, anon, authenticated",
      );
      expect(sql).toContain("create trigger documents_ingestion_webhook after update of metadata on public.documents");
      expect(sql).not.toContain("create trigger documents_ingestion_webhook after insert");
    }
  });

  it("keeps enrichment requests conflict-safe with job-first locking and complete reset metadata", () => {
    for (const sql of [schema, routeEnrichmentThroughAgentMigration]) {
      const start = sql.indexOf("create or replace function public.request_indexing_v3_enrichment");
      const end = sql.indexOf("$$;", start);
      const body = sql.slice(start, end);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      expect(body).toContain("on conflict (document_id) do nothing");
      expect(body).toContain("select id, status into v_job_id, v_job_status");
      expect(body).toContain("from public.indexing_v3_agent_jobs");
      expect(body).toContain("for update");
      expect(body).toContain("v_job_status = 'processing'");
      expect(body.indexOf("from public.indexing_v3_agent_jobs")).toBeLessThan(
        body.lastIndexOf("from public.documents"),
      );
      expect(body).toContain("'indexing_v3_agent_attempt_count' - 'indexing_v3_agent_max_attempts'");
    }
  });

  it("serializes agent claims with transactional reindex enqueue", () => {
    for (const sql of [schema, atomicReindexAgentGuardMigration]) {
      const claimStart = sql.indexOf("create or replace function public.claim_indexing_v3_agent_jobs(");
      const claimBody = sql.slice(claimStart, sql.indexOf("$$;", claimStart));
      const reindexStart = sql.indexOf("create or replace function public.request_ingestion_reindex_if_agent_idle(");
      const reindexBody = sql.slice(reindexStart, sql.indexOf("$$;", reindexStart));

      expect(claimStart).toBeGreaterThanOrEqual(0);
      expect(claimBody).toContain("on conflict do nothing");
      expect(claimBody).toContain("for update of j, d skip locked");
      expect(reindexStart).toBeGreaterThanOrEqual(0);
      expect(reindexBody).toContain("and d.owner_id = p_owner_id for update;");
      expect(reindexBody.indexOf("for update;")).toBeLessThan(
        reindexBody.indexOf("from public.indexing_v3_agent_jobs a"),
      );
      expect(reindexBody.indexOf("from public.indexing_v3_agent_jobs a")).toBeLessThan(
        reindexBody.indexOf("update public.documents"),
      );
      expect(reindexBody.indexOf("update public.documents")).toBeLessThan(
        reindexBody.indexOf("insert into public.ingestion_jobs"),
      );
      expect(reindexBody).toContain("exception when unique_violation then");
      expect(sql).toContain(
        "revoke all on function public.request_ingestion_reindex_if_agent_idle(uuid, uuid, timestamptz, integer) from public, anon, authenticated;",
      );
      expect(sql).toContain(
        "grant execute on function public.request_ingestion_reindex_if_agent_idle(uuid, uuid, timestamptz, integer) to service_role;",
      );
    }
  });

  it("drops the stale duplicate ingestion_job_stages document index", () => {
    for (const sql of [schema, dropDuplicateStageIndexMigration]) {
      expect(sql).toContain("drop index if exists public.ingestion_job_stages_doc_idx");
    }
    expect(schema).toContain("create index if not exists ingestion_job_stages_document_started_idx");
    expect(schema).not.toContain("create index if not exists ingestion_job_stages_doc_idx");
  });

  it("centralizes the indexing-v3 strict completion gate and repair RPC", () => {
    for (const sql of [schema, strictGateRepairMigration]) {
      expect(sql).toContain("create or replace view public.document_strict_gate_status");
      expect(sql).toContain("with (security_invoker = true)");
      expect(sql).toContain("create or replace function public.repair_strict_enrichment_gate_batch");
      expect(sql).toContain("security invoker");
      expect(sql).toContain("case when sections > 0 then null else 'sections' end");
      expect(sql).toContain("case when memory_cards > 0 then null else 'memory_cards' end");
      expect(sql).toContain("case when generated_labels > 0 then null else 'generated_labels' end");
      expect(sql).toContain("case when index_units > 0 then null else 'index_units' end");
      expect(sql).toContain("case when title_embedding then null else 'title_embedding' end");
      expect(sql).toContain("case when summary_embedding then null else 'summary_embedding' end");
      expect(sql).toContain("or l.metadata->>'generated_by' = 'indexing-v3-agent'");
      expect(sql).toContain(
        "lower(coalesce(l.metadata->>'generation_source', '')) = 'indexing_v3_agent_parsed_artifacts'",
      );
      expect(sql).toContain("'indexing_v3_agent_status', 'completed'");
      expect(sql).toContain("'indexing_v3_agent_status', 'deferred'");
      expect(sql).toContain("coalesce(d.metadata->>'indexing_v3_agent_status', '') = 'processing'");
      expect(sql).toContain("then (d.metadata->>'indexing_v3_agent_locked_at')::timestamptz");
      expect(sql).toContain("'enrichment_status', 'processing'");
      expect(sql).toContain("stage = 'strict_gate_deferred'");
      expect(sql).toContain("'strict_gate_repair'");
      expect(sql).toContain("extraction_quality = 'good'");
      expect(sql).toContain("revoke all on table public.document_strict_gate_status from public, anon, authenticated");
      expect(sql).toContain("grant select on table public.document_strict_gate_status to service_role");
      expect(sql).toContain(
        "revoke execute on function public.repair_strict_enrichment_gate_batch(integer) from public, anon, authenticated",
      );
      expect(sql).toContain(
        "grant execute on function public.repair_strict_enrichment_gate_batch(integer) to service_role",
      );
    }
  });

  it("atomically completes strict enrichment only after the canonical gate passes", () => {
    for (const sql of [schema, atomicStrictCompletionMigration]) {
      expect(sql).toContain("create or replace function public.complete_strict_enrichment_job");
      expect(sql).toContain("security invoker");
      expect(sql).toContain("from public.document_strict_gate_status g");
      expect(sql).toContain("if not found then");
      expect(sql).toContain("if not gate_row.gate_passed then");
      expect(sql).toContain("'blocked_missing_artifacts'");
      expect(sql).toContain("'indexing_v3_agent_status', 'completed'");
      expect(sql).toContain("'enrichment_status', 'completed'");
      expect(sql).toContain("'source', 'complete_strict_enrichment_job'");
      expect(sql).toContain("extraction_quality = 'good'");
      expect(sql).toContain("on conflict on constraint document_index_quality_pkey");
      expect(sql).toContain("'{}'::uuid[]");
      expect(sql).not.toContain("perform public.refresh_import_batch_status(batch_ref)");
      expect(sql).toContain(
        "revoke execute on function public.complete_strict_enrichment_job(uuid, uuid, text, text, text) from public, anon, authenticated",
      );
      expect(sql).toContain(
        "grant execute on function public.complete_strict_enrichment_job(uuid, uuid, text, text, text) to service_role",
      );
    }
  });

  it("supports service-role-only durable API rate limiting", () => {
    expect(schema).toContain("create table if not exists public.api_rate_limits");
    expect(schema).toContain("create table if not exists public.api_rate_limit_subjects");
    expect(schema).toContain("primary key (owner_id, bucket)");
    expect(schema).toContain("primary key (subject_key, bucket)");
    expect(schema).toContain("create or replace function public.consume_api_rate_limit");
    expect(schema).toContain("create or replace function public.consume_api_subject_rate_limit");
    expect(schema).toContain("on conflict (owner_id, bucket) do update");
    expect(schema).toContain("on conflict (subject_key, bucket) do update");
    expect(schema).toContain("document_images_searchable_doc_page_relevance_idx");
    expect(schema).toContain("returns table ( limited boolean, limit_value integer, remaining integer");
    expect(schema).toContain("grant select, insert, update, delete on table");
    expect(schema).toContain("public.api_rate_limits,");
    expect(schema).toContain("public.api_rate_limit_subjects,");
    expect(schema).toContain("alter table public.api_rate_limits enable row level security");
    expect(schema).toContain("alter table public.api_rate_limit_subjects enable row level security");
    expect(schema).toContain('create policy "api rate limits service role all"');
    expect(schema).toContain('create policy "api rate limit subjects service role all"');
    expect(schema).not.toMatch(/grant [^;]*public\.api_rate_limits[^;]* to authenticated;/);
  });

  it("keeps audit logs service-role-only with an explicit RLS policy", () => {
    for (const sql of [schema, auditLogsServiceRolePolicyMigration]) {
      expect(sql).toContain("alter table public.audit_logs enable row level security");
      expect(sql).toContain("revoke all on public.audit_logs from anon, authenticated");
      expect(sql).toContain("grant select, insert, update, delete on table public.audit_logs to service_role");
      expect(sql).toContain('create policy "audit logs service role all" on public.audit_logs');
      expect(sql).toContain("for all to service_role");
    }
    expect(schema).not.toMatch(/grant [^;]*public\.audit_logs[^;]* to authenticated;/);
    expect(schema).not.toMatch(/grant [^;]*public\.audit_logs[^;]* to anon;/);
  });

  it("does not introduce new duplicate migration stems", () => {
    const duplicateStemAllowlist = new Map<string, number>([
      ["api_rate_limits", 2],
      ["assert_postgres_default_privileges", 2],
      ["audit_logs", 2],
      ["audit_logs_service_role_policy", 2],
      ["enforce_public_title_word_scope", 2],
      ["historical_version_placeholder", 6],
      ["indexing_reliability_recovery", 2],
      ["ingestion_jobs_one_open_per_document", 2],
      ["rag_queries_retention", 2],
      ["reassert_postgres_default_privileges", 2],
      ["repair_postgres_default_privileges", 2],
    ]);
    const stemCounts = new Map<string, number>();

    for (const fileName of readdirSync(migrationDirectoryUrl)) {
      const stem = parseMigrationStem(fileName);
      if (!stem) continue;
      stemCounts.set(stem, (stemCounts.get(stem) ?? 0) + 1);
    }

    const duplicateStems = new Map([...stemCounts.entries()].filter(([, count]) => count > 1));
    expect(duplicateStems).toEqual(duplicateStemAllowlist);
  });

  it("stores deep structured memory privately for source-backed answers", () => {
    expect(schema).toContain("create table if not exists public.document_sections");
    expect(schema).toContain("create table if not exists public.document_memory_cards");
    expect(schema).toContain("card_type text not null");
    expect(schema).toContain("source_chunk_ids uuid[] not null default '{}'");
    expect(schema).toContain("create index if not exists document_memory_cards_search_idx");
    expect(schema).toContain("create index if not exists document_memory_cards_embedding_hnsw_idx");
    expect(schema).toContain("create or replace function public.stamp_document_deep_memory_version");
    expect(schema).toContain("alter table public.document_sections enable row level security");
    expect(schema).toContain("alter table public.document_memory_cards enable row level security");
    expect(schema).toContain(
      "create index if not exists document_sections_owner_idx on public.document_sections(owner_id)",
    );
    expect(schema).toContain(
      "create index if not exists document_memory_cards_owner_idx on public.document_memory_cards(owner_id)",
    );
    expect(schema).toContain(
      "create index if not exists document_memory_cards_section_idx on public.document_memory_cards(section_id)",
    );
    expect(schema).toContain('create policy "document sections owner all" on public.document_sections');
    expect(schema).toContain('create policy "document memory cards owner all" on public.document_memory_cards');
    expect(schema).toContain('create policy "image caption cache owner all" on public.image_caption_cache');
  });

  it("tracks retryable storage cleanup and query-log purge performance", () => {
    expect(schema).toContain("create table if not exists public.storage_cleanup_jobs");
    expect(schema).toContain("create index if not exists storage_cleanup_jobs_owner_status_idx");
    expect(schema).toContain("create index if not exists rag_queries_source_chunk_ids_gin_idx");
    expect(schema).toContain('create policy "storage cleanup owner read"');
  });

  it("supports reviewing and promoting weak search misses", () => {
    expect(schema).toContain("review_status text not null default 'new'");
    expect(schema).toContain("check (review_status in ('new', 'fixed', 'not_in_corpus', 'ambiguous', 'ignored'))");
    expect(schema).toContain("expected_document_id uuid references public.documents(id) on delete set null");
    expect(schema).toContain("expected_chunk_id uuid references public.document_chunks(id) on delete set null");
    expect(schema).toContain("review_notes text");
    expect(schema).toContain("reviewed_at timestamptz");
    expect(schema).toContain("promoted_eval_case boolean not null default false");
    expect(schema).toContain("create index if not exists rag_query_misses_owner_review_status_created_idx");
  });

  it("supports owner-scoped table-backed RAG aliases", () => {
    expect(schema).toContain("create table if not exists public.rag_aliases");
    expect(schema).toContain("alias text not null");
    expect(schema).toContain("canonical text not null");
    expect(schema).toContain(
      "check (alias_type in ('medication', 'document_title', 'acronym', 'service', 'workflow', 'typo', 'clinical_term', 'custom'))",
    );
    expect(schema).toContain("weight real not null default 1.0");
    expect(schema).toContain("enabled boolean not null default true");
    expect(schema).toContain("create index if not exists rag_aliases_owner_enabled_idx");
    expect(schema).toContain("create index if not exists rag_aliases_type_enabled_idx");
    expect(schema).toContain("create index if not exists rag_aliases_alias_trgm_idx");
    expect(schema).toContain("grant select, insert, update, delete on table");
    expect(schema).toContain("public.rag_aliases,");
    expect(schema).toContain("alter table public.rag_aliases enable row level security");
    expect(schema).toContain('create policy "rag aliases owner read" on public.rag_aliases');
    expect(schema).toContain("owner_id is null or owner_id = (select auth.uid())");
    expect(schema).toContain("create trigger rag_aliases_updated_at");
  });

  it("returns table fact metadata for rich table source packing", () => {
    const functionBody = schema.slice(
      schema.indexOf("create or replace function public.match_document_table_facts_text"),
      schema.indexOf("create or replace function public.match_document_embedding_fields_hybrid"),
    );

    expect(functionBody).toContain("metadata jsonb");
    expect(functionBody).toContain("f.metadata");
  });

  it("declares the corpus topic term stats function with retrieval-equivalent scoping", () => {
    // Finding #11 corpus grounding (migration 20260707100000): the stats the unsupported
    // soft tail grounds on must be scoped exactly like retrieval — owner filter, indexed
    // status, and committed generation — and stay service_role-only.
    expect(schema).toContain("create or replace function public.corpus_topic_term_stats(");
    const corpusStatsBody = schema.slice(
      schema.indexOf("create or replace function public.corpus_topic_term_stats("),
      schema.indexOf("create or replace function public.match_document_chunks("),
    );
    expect(corpusStatsBody).toContain("public.retrieval_owner_matches(owner_filter, d.owner_id)");
    expect(corpusStatsBody).toContain("d.status = 'indexed'");
    expect(corpusStatsBody).toContain(
      "public.is_committed_document_generation(c.index_generation_id, d.index_generation_id)",
    );
    expect(corpusStatsBody).toContain(
      "grant execute on function public.corpus_topic_term_stats(text[], uuid) to service_role;",
    );
  });

  it("filters hybrid retrieval by owner inside Postgres", () => {
    expect(schema).toContain("owner_filter uuid default null");
    expect(schema).toContain(
      "create or replace function public.retrieval_owner_matches(owner_filter uuid, row_owner_id uuid)",
    );
    expect(schema).toContain("when owner_filter is null then false");
    expect(schema).not.toContain("when owner_filter is null then true");
    expect(schema).toContain(
      "when owner_filter = '00000000-0000-0000-0000-000000000000'::uuid then row_owner_id is null",
    );
    expect(schema).toContain("and public.retrieval_owner_matches(owner_filter, d.owner_id)");
    expect(schema).toContain("create or replace function public.match_document_chunks_text");
    expect(schema).toContain("create or replace function public.match_document_chunks_hybrid");
    expect(schema).toContain("rrf_score double precision");
    expect(schema).toContain("create or replace function public.match_document_memory_cards_hybrid");
    expect(schema).toContain("create or replace function public.match_documents_for_query");
    expect(schema).toContain("c.search_tsv @@ query.tsq");
    expect(schema).toContain(
      "create index if not exists documents_search_idx on public.documents using gin(search_tsv)",
    );
    expect(schema).toContain("ts_rank_cd(d.title_search_tsv, query.tsq) * 3.0");
    expect(schema).toContain("hybrid_candidates as");
    expect(schema).toContain("vector_candidates as");
    expect(schema).toContain("text_candidates as");
    expect(schema).toContain("rrf_candidates as");
    expect(schema).toContain("candidate_ids as");
    const hybridFunction = schema.slice(
      schema.indexOf("create or replace function public.match_document_chunks_hybrid"),
      schema.indexOf("create or replace function public.match_document_memory_cards_hybrid"),
    );
    expect(hybridFunction).not.toContain("document_label_metadata");
    expect(hybridFunction).not.toContain("document_summary_text");
  });

  it("covers advisor-reported foreign key indexes for search support tables", () => {
    expect(schema).not.toContain("create index if not exists document_chunks_section_path_gin_idx");
    expect(schema).toContain(
      "create index if not exists document_embedding_fields_owner_id_idx on public.document_embedding_fields(owner_id)",
    );
    expect(schema).not.toContain("create index if not exists document_table_facts_owner_idx");
    expect(schema).toContain(
      "create index if not exists document_table_facts_source_image_idx on public.document_table_facts(source_image_id) where source_image_id is not null",
    );
    expect(schema).toContain("autovacuum_vacuum_scale_factor = 0.05");
    expect(schema).toContain("autovacuum_analyze_scale_factor = 0.02");
    expect(schema).toContain("create index if not exists documents_indexed_owner_title_idx");
    expect(schema).toContain("create index if not exists document_table_facts_owner_document_page_idx");
    expect(schema).toContain("create index if not exists document_embedding_fields_owner_chunk_idx");
    expect(schema).toContain("create index if not exists document_index_units_owner_chunk_type_idx");
    expect(schema).toContain("autovacuum_vacuum_scale_factor = 0.05");
    expect(schema).toContain("autovacuum_analyze_scale_factor = 0.02");
  });

  it("keeps phase 7 retrieval RPCs bounded, profileable, and service-role scoped", () => {
    for (const sql of [schema, phase7RetrievalPerformanceMigration]) {
      expect(sql).toContain("create or replace function public.match_document_lookup_chunks_text");
      expect(sql).toContain("c.document_id = any(document_filters)");
      expect(sql).toContain("c.search_tsv @@ query.tsq or d.title_search_tsv @@ query.tsq");
      expect(sql).toContain("limit least(greatest(match_count, 1), 80)");
      expect(sql).toContain("limit least(greatest(match_count * 2, 24), 96)");
      expect(sql).toContain("create or replace function public.explain_retrieval_rpc");
      expect(sql).toContain("explain (%s) select * from public.match_document_chunks_text($1, $2, $3, $4)");
      expect(sql).toContain("revoke execute on function public.explain_retrieval_rpc");
      expect(sql).toContain("grant execute on function public.explain_retrieval_rpc");
    }
    // The phase-7 migration captured the original hybrid candidate bounds and unit/field-level
    // owner filters. The live perf fixes (codified in 20260701140631_codify_live_retrieval_rpcs)
    // widened the candidate limits and moved the owner filter to document level; schema.sql now
    // mirrors that live shape, so these old forms live only in the historical migration.
    expect(phase7RetrievalPerformanceMigration).toContain("limit least(greatest(match_count * 2, 48), 128)");
    expect(phase7RetrievalPerformanceMigration).toContain("limit least(greatest(match_count * 2, 32), 96)");
    expect(phase7RetrievalPerformanceMigration).toContain("and (owner_filter is null or f.owner_id = owner_filter)");
    expect(phase7RetrievalPerformanceMigration).toContain("and (owner_filter is null or u.owner_id = owner_filter)");
    expect(phase7RetrievalPerformanceMigration).toContain(
      "drop function if exists public.match_document_chunks_text(text, integer, uuid[], uuid)",
    );
    expect(schema).toContain("limit greatest(match_count * 6, 48)"); // chunks hybrid
    expect(schema).toContain("limit greatest(match_count * 3, 48)"); // index units hybrid
    expect(schema).toContain("limit greatest(match_count * 3, 32)"); // embedding fields hybrid
    expect(schema).toContain("limit greatest(match_count * 6, 96)"); // memory cards hybrid v2
    expect(schema).toContain("match_document_lookup_chunks_text.signature");
    expect(schema).toContain("explain_retrieval_rpc.signature");
  });

  it("allows richer clinical embedding field types", () => {
    expect(schema).toContain("'chunk_high_yield'");
    expect(schema).toContain("'table_row'");
    expect(schema).toContain("'image_caption'");
    expect(schema).toContain("'clinical_action'");
    expect(schema).toContain("'threshold_fact'");
  });

  it("supports unified multi-level document index units", () => {
    expect(schema).toContain("create table if not exists public.document_index_units");
    expect(schema).toContain("'document_profile'");
    expect(schema).toContain("'askable_question'");
    expect(schema).toContain("'threshold'");
    expect(schema).toContain("'workflow_step'");
    expect(schema).toContain("'medication_monitoring'");
    expect(schema).toContain("'alias'");
    expect(schema).toContain("'vocabulary_term'");
    expect(schema).toContain("source_span jsonb");
    // The index_units HNSW index was dropped live (0 lifetime scans; the hybrid RPC is
    // text-candidate-gated) via the drop_legacy_vector_indexes migration; schema.sql
    // intentionally no longer creates it.
    expect(schema).not.toContain("create index if not exists document_index_units_embedding_hnsw_idx");
    expect(schema).toContain("create or replace function public.match_document_index_units_hybrid");
    expect(schema).toContain("delete from public.document_index_units where document_id = p_document_id;");
    expect(schema).toContain('create policy "document index units owner read"');
  });

  it("keeps index-unit hybrid retrieval on the live timeout-safe SQL shape", () => {
    for (const sql of [schema, documentIndexUnitsMigration]) {
      const functionBody = extractIndexUnitHybridFunction(sql);

      expect(functionBody).toContain("and (u.search_tsv @@ query.tsq or u.normalized_terms && query.terms)");
      expect(functionBody).toContain("order by hybrid_score desc, similarity desc, text_rank desc");
      expect(functionBody).not.toContain("1 - (u.embedding <=> query_embedding) >= min_similarity or");
      expect(functionBody).not.toContain("vector_ranked as");

      const rankedCte = functionBody.slice(0, functionBody.indexOf("from ranked"));
      expect(rankedCte).not.toContain("order by hybrid_score");
    }
    // schema.sql mirrors the live-codified ranked ordering (single sort key, wider candidate
    // bound); the original migration kept the similarity tie-breaker and tighter bound.
    expect(extractIndexUnitHybridFunction(schema)).toContain(
      "order by text_rank desc limit greatest(match_count * 3, 48)",
    );
    expect(extractIndexUnitHybridFunction(documentIndexUnitsMigration)).toContain(
      "order by text_rank desc, similarity desc",
    );
  });

  it("stores smart image metadata, document labels, and high-yield summaries", () => {
    expect(schema).toContain("image_type text not null default 'unclear'");
    expect(schema).toContain("searchable boolean not null default true");
    expect(schema).toContain("clinical_relevance_score real not null default 0");
    expect(schema).toContain("create table if not exists public.document_labels");
    expect(schema).toContain("create table if not exists public.document_summaries");
    expect(schema).toContain('create policy "labels owner manual insert"');
    expect(schema).toContain('create policy "summaries owner read"');
    expect(schema).toContain("create or replace function public.chunk_image_metadata");
    expect(schema).toContain("and i.searchable = true");
    expect(schema).toContain("and i.image_type <> 'logo_decorative'");
    expect(schema).toContain("'clinical_relevance_score', i.clinical_relevance_score");
    expect(schema).toContain("'sourceKind', i.source_kind");
    expect(schema).toContain("'tableLabel', nullif(i.metadata->>'table_label', '')");
    expect(schema).toContain("'tableTitle', nullif(i.metadata->>'table_title', '')");
    expect(schema).toContain("'tableRole', nullif(i.metadata->>'table_role', '')");
    expect(schema).toContain(
      "'tableTextSnippet', nullif(left(coalesce(i.metadata->>'table_text_snippet', i.metadata->>'table_text', ''), 500), '')",
    );
    expect(schema).toContain("create or replace function public.get_related_document_metadata");
  });

  it("does not fabricate a cosine similarity for text-only retrieval (RET-C2)", () => {
    for (const sql of [schema, lexicalScoreMigration]) {
      const body = extractTextChunkFunction(sql);
      // Old fabricated ceilings must be gone.
      expect(body).not.toContain("0.56 + (least(ranked.text_rank, 1) * 0.39)");
      expect(body).not.toContain("0.58 + (least(ranked.text_rank, 1) * 0.39)");
      // similarity is reserved for real cosine; text-only rows leave it at 0.
      expect(body).toContain("0::double precision as similarity");
      // lexical signal lives in its own column.
      expect(body).toContain("as lexical_score");
      // hybrid_score capped below the 0.64 moderate threshold.
      expect(body).toContain("least(0.5,");
    }
  });

  it("tokenizes per-document viewer search instead of matching the whole query (RET-H5)", () => {
    expect(perDocTokenSearchMigration).toContain("regexp_split_to_table");
    expect(perDocTokenSearchMigration).toContain("length(token) >= 3");
    expect(perDocTokenSearchMigration).toContain("exists (");
    expect(perDocTokenSearchMigration).toContain("like '%' || t.token || '%'");
    expect(perDocTokenSearchMigration).toContain(
      "grant execute on function public.search_document_chunks(uuid, text, integer, uuid) to service_role;",
    );
  });

  it("defines the clinical registry tables identically in migration and schema", () => {
    for (const sql of [schema, clinicalRegistryRecordsMigration]) {
      expect(sql).toContain("create table if not exists public.clinical_registry_records");
      expect(sql).toContain("kind text not null check (kind in ('service', 'form'))");
      expect(sql).toContain("owner_id uuid not null references auth.users(id) on delete cascade");
      expect(sql).toContain(
        "source_status text not null default 'unknown' check (source_status in ('current', 'review_due', 'outdated', 'unknown'))",
      );
      expect(sql).toContain(
        "validation_status text not null default 'unverified' check (validation_status in ('unverified', 'locally_reviewed', 'approved'))",
      );
      expect(sql).toContain("unique (owner_id, kind, slug)");
      expect(sql).toContain("create table if not exists public.clinical_registry_record_sources");
      expect(sql).toContain(
        "record_id uuid not null references public.clinical_registry_records(id) on delete cascade",
      );
      expect(sql).toContain("document_id uuid not null references public.documents(id) on delete cascade");
      expect(sql).toContain("unique (record_id, document_id)");
      expect(sql).toContain("create index if not exists clinical_registry_records_owner_kind_idx");
      expect(sql).toContain("create trigger clinical_registry_records_updated_at");
      expect(sql).toContain("alter table public.clinical_registry_records enable row level security");
      expect(sql).toContain("revoke all on public.clinical_registry_records from anon, authenticated");
      expect(sql).toContain(
        "grant select, insert, update, delete on table public.clinical_registry_records to service_role",
      );
      expect(sql).toContain('create policy "registry records service role all"');
      expect(sql).toContain('create policy "registry record sources service role all"');
    }
  });

  it("defines the medication records table identically in migration and schema", () => {
    for (const sql of [schema, medicationRecordsMigration]) {
      expect(sql).toContain("create table if not exists public.medication_records");
      expect(sql).toContain("owner_id uuid not null references auth.users(id) on delete cascade");
      expect(sql).toContain("stats jsonb not null default '[]'::jsonb");
      expect(sql).toContain("sections jsonb not null default '[]'::jsonb");
      expect(sql).toContain("quick jsonb not null default '[]'::jsonb");
      expect(sql).toContain("unique (owner_id, slug)");
      expect(sql).toContain("create index if not exists medication_records_owner_name_idx");
      expect(sql).toContain("create trigger medication_records_updated_at");
      expect(sql).toContain("alter table public.medication_records enable row level security");
      expect(sql).toContain("revoke all on public.medication_records from anon, authenticated");
      expect(sql).toContain("grant select, insert, update, delete on table public.medication_records to service_role");
      expect(sql).toContain('create policy "medication records service role all"');
    }
  });

  it("adds catalog_payload to clinical registry records", () => {
    expect(schema).toContain("catalog_payload jsonb not null default '{}'::jsonb");
    expect(registryCatalogPayloadMigration).toContain(
      "add column if not exists catalog_payload jsonb not null default '{}'::jsonb",
    );
  });

  it("reconciles live database drift for embedding-field text RPC and rag visual eval tables", () => {
    for (const sql of [schema, liveDatabaseDriftMigration]) {
      expect(sql).toContain("create or replace function public.match_document_embedding_fields_text");
      expect(sql).toContain("create table if not exists public.rag_visual_eval_cases");
      expect(sql).toContain("create table if not exists public.rag_visual_eval_runs");
      expect(sql).toContain('create policy "rag visual eval cases service role all"');
      expect(sql).toContain('create policy "rag visual eval runs service role all"');
      expect(sql).toContain(
        "revoke execute on function public.match_document_embedding_fields_text(text, integer, double precision, uuid[], uuid) from public, anon, authenticated",
      );
      expect(sql).toContain(
        "grant execute on function public.match_document_embedding_fields_text(text, integer, double precision, uuid[], uuid) to service_role",
      );
    }
  });

  it("reconciles search_schema_health index drift with canonical creates and live aliases", () => {
    expect(searchHealthIndexesMigration).toContain("create index if not exists documents_title_trgm_idx");
    expect(searchHealthIndexesMigration).toContain("create index if not exists document_labels_label_trgm_idx");
    expect(searchHealthIndexesMigration).toContain("create index if not exists rag_retrieval_logs_miss_idx");
    expect(searchHealthIndexesMigration).toContain("index_aliases constant jsonb := jsonb_build_object(");
    expect(searchHealthIndexesMigration).toContain("'documents_title_search_tsv_idx'");
    expect(searchHealthIndexesMigration).toContain("'document_pages_document_id_page_number_key'");
    expect(schema).toContain("index_aliases constant jsonb := jsonb_build_object(");
    expect(schema).toContain("jsonb_array_elements_text(index_aliases -> index_name)");

    const restoredIndexNames = [
      "document_labels_label_trgm_idx",
      "document_summaries_summary_trgm_idx",
      "document_index_units_owner_chunk_type_idx",
      "rag_retrieval_logs_miss_idx",
    ] as const;
    const indexAliasKeys = [...searchHealthIndexesMigration.matchAll(/'([a-z0-9_]+)',\s*jsonb_build_array\(/g)].map(
      (match) => match[1],
    );

    for (const indexName of restoredIndexNames) {
      const definitionPattern = new RegExp(`create index if not exists ${indexName} .*?;`);
      const schemaDefinition = schema.match(definitionPattern)?.[0];
      const canonicalMigrationDefinition = searchHealthIndexesMigration.match(definitionPattern)?.[0];
      const driftDefinition = driftIndexDefinitions.get(indexName);

      expect(schemaDefinition, `schema definition for ${indexName}`).toBeDefined();
      expect(canonicalMigrationDefinition, `canonical migration definition for ${indexName}`).toBeDefined();
      expect(driftDefinition, `drift-manifest definition for ${indexName}`).toBeDefined();
      expect(normalizeIndexDefinition(canonicalMigrationDefinition ?? "")).toBe(
        normalizeIndexDefinition(schemaDefinition ?? ""),
      );
      expect(normalizeIndexDefinition(driftDefinition ?? "")).toBe(normalizeIndexDefinition(schemaDefinition ?? ""));
      expect(restoreRagSearchHealthIndexesMigration).toContain(`'${indexName}'`);
      expect(restoreRagSearchHealthIndexesMigration).toContain(normalizeIndexDefinition(schemaDefinition ?? ""));
      // Restore guard resolves canonical names only; keep these four out of health aliases.
      expect(indexAliasKeys, `alias key for restored index ${indexName}`).not.toContain(indexName);
    }

    // This version records an already-completed, validated repair. It must
    // fail fast on drift rather than starting a write-blocking transactional
    // rebuild on ingestion and telemetry tables. Presence alone is insufficient:
    // invalid CONCURRENTLY leftovers and non-canonical definitions must also fail.
    expect(restoreRagSearchHealthIndexesMigration).toContain("set local lock_timeout = '5s'");
    expect(restoreRagSearchHealthIndexesMigration).toContain("set local statement_timeout = '30s'");
    expect(restoreRagSearchHealthIndexesMigration).not.toMatch(/\bset (?!local )lock_timeout\b/);
    expect(restoreRagSearchHealthIndexesMigration).not.toMatch(/\bset (?!local )statement_timeout\b/);
    expect(restoreRagSearchHealthIndexesMigration).toContain("to_regclass(format('public.%I', required.index_name))");
    expect(restoreRagSearchHealthIndexesMigration).toContain("i.indisvalid");
    expect(restoreRagSearchHealthIndexesMigration).toContain("i.indisready");
    expect(restoreRagSearchHealthIndexesMigration).toContain("pg_get_indexdef(i.indexrelid)");
    expect(restoreRagSearchHealthIndexesMigration).toContain("Missing: %; Invalid: %; Mismatched: %");
    expect(restoreRagSearchHealthIndexesMigration).toContain(
      "create missing indexes concurrently outside the migration transaction",
    );
    let previousStepOffset = -1;
    for (const sqlStep of INDEX_DEFINITION_NORMALIZER_SQL_STEPS) {
      const stepOffset = restoreRagSearchHealthIndexesMigration.indexOf(sqlStep);
      expect(stepOffset, `SQL normalizer step: ${sqlStep}`).toBeGreaterThan(previousStepOffset);
      previousStepOffset = stepOffset;
    }
    // Allow the normalizer's replace() literal, but forbid actual IF NOT EXISTS DDL.
    expect(restoreRagSearchHealthIndexesMigration).not.toMatch(/create\s+index\s+if\s+not\s+exists\s+[a-z_]/i);
  });
  it("mirrors tightened search_document_chunks owner scope in schema and migration", () => {
    expect(searchDocumentChunksOwnerScopeMigration).toContain("(p_owner_id is null and d.owner_id is null)");
    expect(schema).toContain("create or replace function public.search_document_chunks(");
    expect(schema).toContain(
      "revoke execute on function public.search_document_chunks(uuid, text, integer, uuid) from public, anon, authenticated",
    );
  });

  it("filters per-document search to the committed generation before matching and limiting", () => {
    for (const sql of [schema, searchDocumentChunksCommittedGenerationMigration]) {
      const functionStart = sql.indexOf("create or replace function public.search_document_chunks(");
      const functionEnd = sql.indexOf("$$;", functionStart);
      const definition = sql.slice(functionStart, functionEnd);
      const generationFilter = definition.indexOf(
        "public.is_committed_document_generation(c.index_generation_id, d.index_generation_id)",
      );

      expect(generationFilter).toBeGreaterThanOrEqual(0);
      expect(generationFilter).toBeLessThan(definition.indexOf("c.search_tsv @@ normalized.query_tsv"));
      expect(generationFilter).toBeLessThan(definition.indexOf("limit least(greatest(match_count, 1), 80)"));
    }

    const g0 = "00000000-0000-0000-0000-000000000001";
    const g1 = "00000000-0000-0000-0000-000000000002";
    const candidates = [
      { id: "committed", chunkGeneration: g0, documentGeneration: g0, rank: 0.5 },
      { id: "staged-higher-rank", chunkGeneration: g1, documentGeneration: g0, rank: 0.99 },
      { id: "legacy-null", chunkGeneration: null, documentGeneration: null, rank: 0.4 },
    ];
    const visible = candidates
      .filter(
        (row) =>
          row.chunkGeneration === row.documentGeneration &&
          (row.chunkGeneration !== null || row.documentGeneration === null),
      )
      .sort((left, right) => right.rank - left.rank)
      .map((row) => row.id);

    expect(visible).toEqual(["committed", "legacy-null"]);
  });

  it("surfaces stale commit generation RPCs through search_schema_health", () => {
    for (const sql of [schema, searchSchemaHealthM13GuardMigration]) {
      expect(sql).toContain("commit_fn_def := pg_get_functiondef(");
      expect(sql).toContain("commit_document_index_generation.preserve_legacy_artifacts_migration");
      expect(sql).toContain("from public.document_chunks replacement");
    }
  });
});

describe("RC9 — lexical text path must not fabricate a cosine similarity", () => {
  // Regression guard for RC9. The text-only fallback (match_document_chunks_text) has no vector
  // cosine; an earlier version fabricated a synthetic `similarity` (0.56 + text_rank*0.39) that was
  // read downstream as a real semantic score, letting a pure keyword hit masquerade as moderate/strong
  // (>=0.64) evidence. The canonical definition in schema.sql now leaves similarity at 0 and carries
  // the lexical signal in a hybrid_score capped below the 0.64 moderate gate (plus lexical_score).
  // The two other lexical text RPCs (match_document_lookup_chunks_text / _table_facts_text) return only
  // text_rank — no similarity/hybrid_score column to fabricate.
  it("match_document_chunks_text returns similarity 0, not a synthetic score", () => {
    expect(schema).toContain("0::double precision as similarity");
    // The text path's hybrid_score is capped by least(0.5, ...) — strictly below the 0.64 moderate
    // threshold — so a lexical-only row can order among its peers but never clears the moderate/strong
    // evidence gate when merged with vector results. (Coefficients may be tuned; the 0.5 ceiling and
    // text_rank basis are the invariant.)
    expect(schema).toMatch(
      /least\(0\.5, [0-9.]+ \+ \(least\(ranked\.text_rank, 1\) \* [0-9.]+\)\)::double precision as hybrid_score/,
    );
  });
});

describe("Supabase Preview replay guards", () => {
  it("codifies owner-plus-public RPCs and forwards the canonical remediation functions", () => {
    for (const functionName of [
      "retrieval_owner_matches_v2",
      "corpus_topic_term_stats_v2",
      "match_document_chunks_text_v2",
      "match_document_chunks_hybrid_v2",
      "match_document_chunks_v2",
      "get_related_document_metadata_v2",
      "match_document_lookup_chunks_text_v2",
      "match_documents_for_query_v2",
      "match_document_table_facts_text_v2",
      "match_document_embedding_fields_hybrid_v2",
      "match_document_index_units_hybrid_v2",
      "match_document_memory_cards_hybrid_v3",
    ]) {
      expect(schema).toContain(`create or replace function public.${functionName}(`);
    }
    expect(ragRemediationFunctionReconciliationMigration).toContain(
      "create or replace function public.commit_document_deep_memory_generation(",
    );
    expect(ragRemediationFunctionReconciliationMigration).toContain(
      "create or replace function public.request_indexing_v3_enrichment(",
    );
    expect(ragRemediationFunctionReconciliationMigration).toContain("on conflict (document_id) do nothing");
    expect(ragRemediationFunctionReconciliationMigration).toContain("for update");
    expect(deepMemoryCommitReconciliationMigration).toContain(
      "create or replace function public.commit_document_deep_memory_generation(",
    );
    expect(deepMemoryCommitReconciliationMigration).toContain(
      "Re-check producer evidence inside the transaction. Legacy NULL-generation",
    );
    expect(deepMemoryCommitReconciliationMigration).toContain("local-worker rows predate explicit producer metadata");
    expect(deepMemoryCommitReconciliationMigration).toContain(
      "and metadata->>'artifact_generation_id' = p_artifact_generation_id::text",
    );
  });

  it("keeps the lexical text path index-friendly (no OR across chunk and title relations)", () => {
    // 2026-07-13 audit finding 1: OR-ing chunk and title tsquery predicates across
    // two relations defeated both GIN indexes and sequential-scanned every chunk.
    // The candidate search must stay split into separately indexable probes.
    for (const body of [
      extractTextChunkFunction(schema),
      extractTextChunkFunction(indexFriendlyLexicalRetrievalMigration),
    ]) {
      expect(body).toContain("chunk_hits as (");
      expect(body).toContain("title_chunk_hits as (");
      expect(body).toContain("union");
      expect(body).not.toContain("c.search_tsv @@ query.tsq or d.title_search_tsv @@ query.tsq");
      expect(body).toContain("where public.retrieval_owner_matches(owner_filter, d.owner_id)");
      expect(body).toContain("limit least(greatest(match_count * 2, 24), 96)");
      expect(body).toContain("0::double precision as similarity");
      expect(body).toContain("least(0.5,");
    }
    // D2 (2026-07-14): the effective schema body compares the typed documents
    // column; the historical A1 migration snapshot keeps the JSONB comparison.
    expect(extractTextChunkFunction(schema)).toContain(
      "public.is_committed_document_generation(c.index_generation_id, d.index_generation_id)",
    );
    expect(extractTextChunkFunction(indexFriendlyLexicalRetrievalMigration)).toContain(
      "public.is_committed_document_generation(c.index_generation_id, d.metadata)",
    );
    expect(indexFriendlyLexicalRetrievalMigration).toContain(
      "revoke execute on function public.match_document_chunks_text(text, integer, uuid[], uuid) from public, anon, authenticated;",
    );
    expect(indexFriendlyLexicalRetrievalMigration).toContain(
      "grant execute on function public.match_document_chunks_text(text, integer, uuid[], uuid) to service_role;",
    );
  });

  it("pins search_path on retrieval_owner_matches_v2", () => {
    // 2026-07-13 audit finding 6 / Supabase advisor function_search_path_mutable:
    // this helper was the only owner-plus-public wrapper without a pinned path.
    const start = schema.indexOf("create or replace function public.retrieval_owner_matches_v2(");
    expect(start).toBeGreaterThanOrEqual(0);
    const header = schema.slice(start, schema.indexOf("$$", start));
    expect(header).toContain("set search_path = public, extensions, pg_temp");
    expect(pinOwnerMatchesV2SearchPathMigration).toContain(
      "alter function public.retrieval_owner_matches_v2(uuid, uuid, boolean) set search_path = public, extensions, pg_temp;",
    );
  });

  it("locks down postgres future-object default privileges", () => {
    for (const sql of [schema, defaultAclRepairMigration]) {
      expect(sql).toContain(
        "alter default privileges for role postgres in schema public revoke all privileges on tables from public, anon, authenticated, service_role;",
      );
      expect(sql).toContain(
        "alter default privileges for role postgres in schema public revoke all privileges on sequences from public, anon, authenticated, service_role;",
      );
      expect(sql).toContain(
        "alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated, service_role;",
      );
      expect(sql).toContain(
        "alter default privileges for role postgres in schema public grant execute on functions to service_role;",
      );
      expect(sql).not.toContain("set local role");
      expect(sql).toContain("public.default_privileges_status('postgres', 'public')");
    }
  });

  it("requires append-only operator evidence for owned-to-public transitions", () => {
    for (const sql of [schema, publicationApprovalMigration]) {
      expect(sql).toContain("create table if not exists public.document_publication_approvals");
      expect(sql).toContain("check (cardinality(evidence_references) > 0)");
      expect(sql).toContain("unique (document_id, expected_prior_owner_id, manifest_digest)");
      expect(sql).toContain("before update or delete on public.document_publication_approvals");
      expect(sql).toContain("before insert or update on public.documents");
      expect(sql).toContain("if tg_op = 'INSERT' then");
      expect(sql).toContain("public documents must be created as owned rows before approved publication");
      expect(sql).toContain("old.owner_id is not null and new.owner_id is null");
      expect(sql).toContain("approval.expected_prior_owner_id = old.owner_id");
      expect(sql).toContain("create or replace function public.publish_approved_documents(");
      expect(sql).toContain("for update;");
      expect(sql).toContain(
        "grant execute on function public.publish_approved_documents(jsonb, text, integer) to service_role;",
      );
    }
  });

  it("binds publication approval to canonical reviewed content under the document lock", () => {
    for (const sql of [schema, publicationReviewedStateMigration]) {
      expect(sql).toContain("reviewed_state_digest");
      expect(sql).toContain("create or replace function public.document_publication_state_digest(");
      expect(sql).toContain("publication approval requires a reviewed content/state digest");
      expect(sql).toContain("v_current_state_digest := public.document_publication_state_digest(");
      expect(sql).toContain("publication document % changed after review");
      expect(sql).toContain("'publication_reviewed_state_digest', v_expected_state_digest");

      const digestStart = sql.indexOf("create or replace function public.document_publication_state_digest(");
      const digestBody = sql.slice(digestStart, sql.indexOf("$$;", digestStart));
      for (const tableAlias of ["i", "s", "m", "f", "u"]) {
        expect(digestBody).toContain(`public.is_committed_artifact_generation(${tableAlias}.metadata, d.metadata)`);
      }
      expect(digestBody).toContain(
        "public.is_committed_document_generation(c.index_generation_id, d.index_generation_id)",
      );
      expect(digestBody).toContain("public.is_committed_artifact_generation(c.metadata, d.metadata)");
      expect(digestBody).not.toContain(
        "public.is_committed_document_generation(f.index_generation_id, d.index_generation_id)",
      );

      const functionStart = sql.indexOf("create or replace function public.publish_approved_documents(");
      const functionBody = sql.slice(functionStart, sql.indexOf("$$;", functionStart));
      for (const table of [
        "document_pages",
        "document_images",
        "document_labels",
        "document_summaries",
        "document_sections",
        "document_memory_cards",
        "document_chunks",
        "document_table_facts",
        "document_embedding_fields",
        "document_index_quality",
        "document_index_units",
      ]) {
        expect(functionBody).toContain(`perform 1 from public.${table} where document_id = v_document_id for update;`);
      }
      for (const table of ["ingestion_jobs", "indexing_v3_agent_jobs"]) {
        expect(functionBody).toContain(
          `perform 1 from public.${table} where document_id = v_document_id for update nowait;`,
        );
      }
      expect(functionBody).toContain("publication document % has active ingestion work");
      expect(functionBody.indexOf("for update;")).toBeLessThan(
        functionBody.indexOf("v_current_state_digest := public.document_publication_state_digest("),
      );

      const guardStart = sql.indexOf("create or replace function public.guard_document_publication_transition(");
      const guardBody = sql.slice(guardStart, sql.indexOf("$$;", guardStart));
      expect(guardBody).toContain("perform 1 from public.document_chunks where document_id = old.id for update;");
      expect(guardBody).toContain("perform 1 from public.ingestion_jobs where document_id = old.id for update nowait;");
      expect(guardBody).toContain("public document transition has active ingestion work");
      expect(guardBody.indexOf("for update;")).toBeLessThan(
        guardBody.indexOf("v_current_state_digest := public.document_publication_state_digest("),
      );
    }
  });

  it("binds Australian activation to versioned source policy and committed generation", () => {
    const sql = australianSourceActivationMigration;
    for (const column of [
      "source_catalogue_key text",
      "source_policy_version text",
      "reviewed_index_generation_id uuid",
    ]) {
      expect(sql).toContain(`add column if not exists ${column}`);
    }
    expect(sql).toContain("create or replace function public.activate_approved_public_documents(");
    expect(sql).toContain("p_manifest jsonb");
    expect(sql).toContain("p_expected_state_digest text");
    expect(sql).toContain("p_expected_generation_ids uuid[]");
    expect(sql).toContain("coalesce(p_manifest->>'version', '') <> '2'");
    expect(sql).toContain("coalesce(p_manifest->>'sourcePolicyVersion', '') <> 'australian-source-policy-v1'");
    expect(sql).toContain("metadata->>'corpus_scope' = 'australian_public'");
    expect(sql).toContain("v_document.metadata->>'content_mode' is distinct from 'indexed_content'");
    expect(sql).toContain("v_document.metadata->>'licence_policy' is distinct from 'public_index_permitted'");
    expect(sql).toContain("v_document.metadata->>'document_status' is distinct from 'current'");
    const approvalGuard = sqlFunctionBody(sql, "require_document_publication_approval_state_digest");
    const transitionGuard = sqlFunctionBody(sql, "guard_document_publication_transition");
    const activationBody = sqlFunctionBody(sql, "activate_approved_public_documents");
    const activeStateConditions = [
      [approvalGuard, "v_metadata"],
      [transitionGuard, "new.metadata"],
      [activationBody, "v_document.metadata"],
    ] as const;
    for (const [boundary, metadata] of activeStateConditions) {
      expect(boundary).toContain(`coalesce(${metadata}->>'change_state', '') not in ('unchanged', 'changed')`);
      expect(boundary).toContain(
        `nullif(btrim(coalesce(${metadata}->>'superseded_by_document_id', '')), '') is not null`,
      );
    }
    expect(sql).toContain("v_document.index_generation_id is distinct from v_expected_index_generation_id");
    expect(sql).toContain("approval.reviewed_index_generation_id = v_expected_index_generation_id");
    expect(sql).toContain("approval.source_catalogue_key = v_source_catalogue_key");
    expect(sql).toContain("approval.source_policy_version = v_source_policy_version");
    expect(sql).toContain("v_current_state_digest := public.document_publication_state_digest(");

    expect(activationBody).toContain("Australian activation manifest contains duplicate generation ids");
    expect(activationBody).toContain(
      "array_agg((entry->>'expectedIndexGenerationId')::uuid order by (entry->>'documentId')::uuid)",
    );
    expect(activationBody).toContain("((entry->>'documentId')::uuid)::text || ':' || (entry->>'expectedStateDigest')");
    expect(activationBody).toContain("E'\\n' order by (entry->>'documentId')::uuid");
    expect(activationBody).toContain("'publication_manifest_digest', v_manifest_digest");
    const uuidValidation = activationBody.indexOf(
      "Australian activation manifest contains invalid approved document evidence",
    );
    const duplicateDocuments = activationBody.indexOf("group by (entry->>'documentId')::uuid");
    const duplicateGenerations = activationBody.indexOf("group by (entry->>'expectedIndexGenerationId')::uuid");
    const activationLoop = activationBody.indexOf("for v_entry in");
    expect(uuidValidation).toBeGreaterThanOrEqual(0);
    expect(uuidValidation).toBeLessThan(duplicateDocuments);
    expect(duplicateDocuments).toBeLessThan(duplicateGenerations);
    expect(duplicateGenerations).toBeLessThan(activationLoop);
    const rowLock = activationBody.indexOf("where id = v_document_id for update;");
    const generationCheck = activationBody.indexOf(
      "v_document.index_generation_id is distinct from v_expected_index_generation_id",
    );
    const digestCheck = activationBody.indexOf("v_current_state_digest := public.document_publication_state_digest(");
    const ownerRelease = activationBody.indexOf("update public.documents set owner_id = null");
    expect(rowLock).toBeGreaterThanOrEqual(0);
    expect(rowLock).toBeLessThan(generationCheck);
    expect(generationCheck).toBeLessThan(digestCheck);
    expect(digestCheck).toBeLessThan(ownerRelease);
  });

  it("validates the target state and keeps governed Australian public state immutable", () => {
    const guardBody = sqlFunctionBody(australianSourceActivationMigration, "guard_document_publication_transition");
    const ownerRelease = guardBody.indexOf("if old.owner_id is not null and new.owner_id is null then");
    const targetScopeGuard = guardBody.indexOf("if v_new_australian_public and not v_old_australian_public then");
    const targetStateGuard = guardBody.indexOf("v_new_reviewed_document is distinct from v_old_reviewed_document");
    const approvalLookup = guardBody.indexOf("from public.document_publication_approvals approval");
    expect(ownerRelease).toBeGreaterThanOrEqual(0);
    expect(targetScopeGuard).toBeGreaterThan(ownerRelease);
    expect(targetStateGuard).toBeGreaterThan(targetScopeGuard);
    expect(targetStateGuard).toBeLessThan(approvalLookup);

    for (const targetCheck of [
      "v_target_index_generation_id is distinct from v_approval.reviewed_index_generation_id",
      "new.metadata->>'source_catalogue_key' is distinct from v_approval.source_catalogue_key",
      "new.metadata->>'source_policy_version' is distinct from v_approval.source_policy_version",
      "new.metadata->>'content_mode' is distinct from 'indexed_content'",
      "new.metadata->>'licence_policy' is distinct from 'public_index_permitted'",
      "new.metadata->>'document_status' is distinct from 'current'",
      "coalesce(new.metadata->>'change_state', '') not in ('unchanged', 'changed')",
      "nullif(btrim(coalesce(new.metadata->>'superseded_by_document_id', '')), '') is not null",
    ]) {
      expect(guardBody).toContain(targetCheck);
    }
    expect(guardBody).toContain(
      "v_target_index_generation_id := nullif(new.metadata->>'index_generation_id', '')::uuid",
    );
    expect(guardBody).not.toContain("new.index_generation_id");
    expect(guardBody).toContain(
      "elsif old.owner_id is null and new.owner_id is null and (v_old_australian_public or v_new_australian_public) then",
    );
    expect(guardBody).toContain(
      "elsif old.owner_id is null and new.owner_id is not null and v_old_australian_public then",
    );
    expect(guardBody).toContain("Australian public reviewed state is immutable after activation");
    const generatedColumns = ["search_tsv", "title_search_tsv", "index_generation_id"];
    const documentsTable = schema.slice(
      schema.indexOf("create table if not exists public.documents ("),
      schema.indexOf("create table if not exists public.document_pages ("),
    );
    for (const generatedColumn of generatedColumns) {
      expect(documentsTable).toMatch(new RegExp(`${generatedColumn}\\s+(?:tsvector|uuid)\\s+generated always as \\(`));
    }
    const documentProjectionPattern = /v_(?:old|new)_reviewed_document := to_jsonb\((?:old|new)\) - array\[(.*?)\];/gs;
    const documentProjections = [...guardBody.matchAll(documentProjectionPattern)];
    expect(documentProjections).toHaveLength(2);
    const excludedDocumentFields = [
      "owner_id",
      "updated_at",
      "metadata",
      "search_tsv",
      "title_search_tsv",
      "index_generation_id",
    ];
    for (const projection of documentProjections) {
      expect([...projection[1].matchAll(/'([^']+)'/g)].map((match) => match[1])).toEqual(excludedDocumentFields);
    }
    const allowedAuditFields = [
      "public_corpus",
      "publication_approval_id",
      "publication_manifest_digest",
      "publication_reviewed_state_digest",
      "publication_source_catalogue_key",
      "publication_source_policy_version",
      "publication_reviewed_index_generation_id",
      "published_at",
    ];
    for (const allowedAuditField of allowedAuditFields) {
      expect(guardBody).toContain(`'${allowedAuditField}'`);
    }
    const metadataProjectionPattern =
      /v_(?:old|new)_reviewed_metadata := coalesce\((?:old|new)\.metadata, '\{\}'::jsonb\) - array\[(.*?)\];/gs;
    const metadataProjections = [...guardBody.matchAll(metadataProjectionPattern)];
    expect(metadataProjections).toHaveLength(2);
    expect(guardBody.indexOf(metadataProjections[0][0])).toBeGreaterThan(ownerRelease);
    expect(guardBody.indexOf(metadataProjections[1][0])).toBeGreaterThan(ownerRelease);
    for (const projection of metadataProjections) {
      expect([...projection[1].matchAll(/'([^']+)'/g)].map((match) => match[1])).toEqual(allowedAuditFields);
    }
    const alreadyPublicBranch = guardBody.slice(
      guardBody.indexOf(
        "elsif old.owner_id is null and new.owner_id is null and (v_old_australian_public or v_new_australian_public) then",
      ),
    );
    expect(alreadyPublicBranch).toContain("new.metadata is distinct from old.metadata");
    expect(alreadyPublicBranch).not.toContain("v_new_reviewed_metadata is distinct from v_old_reviewed_metadata");
  });

  it("keeps Australian approval history append-only and activation service-role-only", () => {
    const sql = australianSourceActivationMigration;
    expect(sql).toContain("alter table public.document_publication_approvals enable row level security;");
    expect(sql).toContain(
      "revoke all on table public.document_publication_approvals from public, anon, authenticated;",
    );
    expect(sql).toContain("grant select, insert on table public.document_publication_approvals to service_role;");
    expect(sql).toContain("document_publication_approvals_immutable");
    expect(sql).toContain("before update or delete on public.document_publication_approvals");
    expect(sql).toContain(
      "revoke all on function public.activate_approved_public_documents(jsonb, text, uuid[]) from public, anon, authenticated;",
    );
    expect(sql).toContain(
      "grant execute on function public.activate_approved_public_documents(jsonb, text, uuid[]) to service_role;",
    );
    expect(sql).toContain("historical version-1 approval cannot activate an Australian public document");
    expect(sql).toContain("source_catalogue_key is null");
    expect(sql).toContain("source_policy_version is null");
    expect(sql).toContain("reviewed_index_generation_id is null");
  });

  it("creates an append-only service-role public-source control plane", () => {
    const sql = publicSourceControlPlaneMigration.toLowerCase();
    expect(sql).toContain("create table public.public_source_activation_events");
    expect(sql).toContain("create table public.public_source_versions");
    expect(sql).toContain("check (decision in ('activate', 'quarantine', 'retire'))");
    expect(sql).toContain(
      "check (lifecycle in ('discovered', 'shadow', 'approved', 'active', 'quarantined', 'tombstoned'))",
    );
    expect(sql).toContain("before update or delete on public.public_source_activation_events");
    expect(sql).toContain("public_source_activation_events are append-only");
    expect(sql).toContain("unique (staging_document_id)");
    expect(sql).toContain("publication_approval_id uuid");
    expect(sql).toContain("publication_manifest_digest text");
    expect(sql).toContain("publication_reviewed_state_digest text");
    expect(sql).toContain("publication_reviewed_index_generation_id uuid");
    expect(sql).toContain("before update on public.public_source_versions");
    expect(sql).toContain("public source version identity is immutable");
    expect(sql).toContain("alter table public.public_source_activation_events enable row level security");
    expect(sql).toContain("alter table public.public_source_versions enable row level security");
    for (const table of ["public_source_activation_events", "public_source_versions"]) {
      expect(sql).toContain(`revoke all on table public.${table} from public, anon, authenticated`);
    }
  });

  it("locks source rows and permits only explicit version lifecycle transitions", () => {
    const sql = publicSourceControlPlaneMigration.toLowerCase();
    for (const functionName of [
      "record_public_source_activation_event",
      "create_public_source_fetch_manifest",
      "stage_public_source_version",
      "transition_public_source_version",
    ]) {
      const body = sqlFunctionBody(sql, functionName);
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = ''");
      expect(sql).toContain(`revoke all on function public.${functionName}`);
      expect(sql).toContain(`grant execute on function public.${functionName}`);
    }
    expect(sqlFunctionBody(sql, "create_public_source_fetch_manifest")).toContain("for update");
    expect(sqlFunctionBody(sql, "create_public_source_fetch_manifest")).toContain("decision <> 'activate'");
    expect(sqlFunctionBody(sql, "create_public_source_fetch_manifest")).toContain(
      "order by created_at desc, id desc limit 1 for update",
    );
    expect(sqlFunctionBody(sql, "create_public_source_fetch_manifest")).toContain(
      "v_event.id is distinct from p_activation_event_id",
    );
    const activationBody = sqlFunctionBody(sql, "record_public_source_activation_event");
    expect(activationBody).toContain("v_catalogue_key not in ( 'wa-health'");
    expect(activationBody).toContain("v_policy_version <> 'australian-source-policy-v1'");
    expect(activationBody).toContain(
      "v_policy_digest <> 'sha256:02dcc095258338d0c355af79dfa1889c024f25f385b553e5b6c802207546855d'",
    );
    for (const excluded of ["healthdirect", "etg-complete", "australian-medicines-handbook", "nps-medicinewise"]) {
      expect(activationBody).not.toContain(`'${excluded}'`);
    }
    const stageBody = sqlFunctionBody(sql, "stage_public_source_version");
    expect(stageBody).toContain("v_document.owner_id is null");
    expect(stageBody).toContain("order by created_at desc, id desc limit 1 for update");
    expect(stageBody).toContain("v_event.id is distinct from v_activation_event_id");
    expect(stageBody).toContain("v_document.content_hash is distinct from p_version->>'stagedcontenthash'");
    expect(stageBody).toContain("v_document.source_path is distinct from p_version->>'exacturl'");
    expect(stageBody).toContain(
      "v_document.metadata->>'source_content_hash' is distinct from p_version->>'contenthash'",
    );
    expect(stageBody).toContain(
      "v_document.metadata->>'licence_evidence_digest' is distinct from p_version->>'licenceevidencedigest'",
    );
    const transitionBody = sqlFunctionBody(sql, "transition_public_source_version");
    expect(transitionBody).toContain("for update");
    expect(transitionBody).toContain("p_expected_catalogue_key");
    expect(transitionBody).toContain("p_expected_exact_version_url");
    expect(transitionBody).toContain("p_expected_content_hash");
    expect(transitionBody).toContain("public source version identity changed after review");
    expect(transitionBody).toContain("invalid public source lifecycle transition");
    expect(transitionBody).toContain("publication_approval_id");
    expect(transitionBody).toContain("publication_manifest_digest");
    expect(transitionBody).toContain("publication_reviewed_state_digest");
    expect(transitionBody).toContain("publication_reviewed_index_generation_id");
    expect(transitionBody).toContain("approval.id = v_publication_approval_id");
    expect(transitionBody).toContain("exact document publication approval is distinct from source activation");
  });

  it("serializes permanent deletion against ingestion job creation", () => {
    for (const sql of [schema, deleteDocumentIfIdleMigration]) {
      const functionStart = sql.indexOf("create or replace function public.delete_document_if_idle(");
      const functionBody = sql.slice(functionStart, sql.indexOf("$$;", functionStart));
      const rowLock = functionBody.indexOf("for update;");
      const activeJobCheck = functionBody.indexOf("from public.ingestion_jobs j");
      const ledgerInsert = functionBody.indexOf("insert into public.storage_cleanup_jobs");
      const parentDelete = functionBody.indexOf("delete from public.documents");
      expect(rowLock).toBeGreaterThanOrEqual(0);
      expect(rowLock).toBeLessThan(activeJobCheck);
      expect(activeJobCheck).toBeLessThan(ledgerInsert);
      expect(ledgerInsert).toBeLessThan(parentDelete);
      expect(sql).toContain(
        "grant execute on function public.delete_document_if_idle(uuid, uuid, text, text) to service_role;",
      );
      const retryStart = sql.indexOf("create or replace function public.retry_ingestion_job_if_idle(");
      const retryBody = sql.slice(retryStart, sql.indexOf("$$;", retryStart));
      expect(retryBody).toContain("for update of d, j;");
      expect(retryBody.indexOf("for update of d, j;")).toBeLessThan(retryBody.indexOf("update public.ingestion_jobs"));
      expect(retryBody).toContain("update public.documents");
      expect(sql).toContain(
        "grant execute on function public.retry_ingestion_job_if_idle(uuid, uuid, timestamptz, integer, timestamptz, timestamptz) to service_role;",
      );
    }
  });

  it("fails closed on effective postgres default ACLs", () => {
    for (const sql of [schema, defaultAclAssertionMigration, defaultAclRepairMigration]) {
      expect(sql).toContain("create or replace function public.default_privileges_status(");
      expect(sql).toContain("pg_catalog.acldefault(ot.object_code, v_role_oid)");
      expect(sql).toContain("pg_catalog.aclexplode(ea.acl)");
      expect(sql).toContain("bool_or(grantee not in (p_role_name, 'service_role'))");
      expect(sql).toContain("bool_or(is_grantable)");
      expect(sql).toContain("entry like 'table:PUBLIC:%'");
      expect(sql).toContain("entry like 'sequence:PUBLIC:%'");
      expect(sql).toContain("entry = 'function:PUBLIC:execute'");
      expect(sql).toContain("public.default_privileges_status('postgres', 'public')");
      expect(sql).toContain("Unsafe postgres default privileges in schema public");
    }

    const migrationFiles = readdirSync(migrationDirectoryUrl)
      .filter((fileName) => /^\d+_.+\.sql$/.test(fileName))
      .sort();
    expect(migrationFiles).toContain("20260720170000_add_documents_owner_updated_at_indexed_idx.sql");
    expect(documentTitleWordScopeMigration).toContain(
      "v_status := public.default_privileges_status('postgres', 'public')",
    );
    expect(documentTitleWordScopeMigration).toContain(
      "message = 'Unsafe postgres default privileges in schema public; title-word privacy migration blocked.'",
    );
  });

  it("bootstraps safe default ACLs before fresh local and preview migration replay", () => {
    expect(defaultAclRoleBootstrap).toContain(
      "alter default privileges for role postgres revoke all privileges on tables from public, anon, authenticated, service_role;",
    );
    expect(defaultAclRoleBootstrap).toContain(
      "alter default privileges for role postgres revoke all privileges on sequences from public, anon, authenticated, service_role;",
    );
    expect(defaultAclRoleBootstrap).toContain(
      "alter default privileges for role postgres revoke execute on functions from public, anon, authenticated, service_role;",
    );
    expect(defaultAclRoleBootstrap).toContain(
      "alter default privileges for role postgres in schema public grant select, insert, update, delete on tables to service_role;",
    );
    expect(defaultAclRoleBootstrap).toContain(
      "alter default privileges for role postgres in schema public grant usage, select on sequences to service_role;",
    );
    expect(defaultAclRoleBootstrap).toContain(
      "alter default privileges for role postgres in schema public grant execute on functions to service_role;",
    );
    expect(defaultAclRoleBootstrap).toContain("bool_or(grantee not in ('postgres', 'service_role'))");
  });

  it("scrubs legacy plaintext query text with salted irreversible placeholders", () => {
    // 2026-07-13 audit finding 5: rows written before the HMAC rollout still
    // held raw clinical query text. Placeholders must be salted (not bare
    // md5(query), which is dictionary-attackable) and the migration must
    // assert completion for every query-bearing table.
    expect(scrubLegacyQueryTextMigration).toContain(
      "'redacted-query:legacy:' || md5(gen_random_uuid()::text || query)",
    );
    expect(scrubLegacyQueryTextMigration).not.toMatch(/md5\(query\)/);
    for (const table of ["rag_queries", "rag_query_misses", "rag_retrieval_logs"]) {
      expect(scrubLegacyQueryTextMigration).toContain(`update public.${table}`);
    }
    // Cache rows are deleted, not re-keyed: a scrubbed key would never be hit again.
    expect(scrubLegacyQueryTextMigration).toContain("delete from public.rag_response_cache");
    expect(scrubLegacyQueryTextMigration).toContain("where normalized_query !~ '^redacted-cache:[0-9a-f]{64}$'");
    expect(scrubLegacyQueryTextMigration).toContain("raise exception");
    // The strict format check must accept this migration's own salted legacy
    // placeholders, or the completion assertion aborts on the rows it just wrote.
    expect(scrubLegacyQueryTextMigration).toContain("'^redacted-query:([0-9a-f]{64}|legacy:[0-9a-f]{32})$'");
    expect(scrubLegacyQueryTextMigration).not.toContain("'^redacted-query:[0-9a-f]{64}$'");
  });

  it("validates the content_not_blank guards so they are no longer NOT VALID", () => {
    // 2026-07-13 audit finding 12: the three content-quality checks were codified
    // NOT VALID from live; zero violating rows existed, so they are now validated
    // and the canonical replay creates them enforced from the start.
    for (const constraint of [
      "document_chunks_content_not_blank",
      "document_embedding_fields_content_not_blank",
      "document_index_units_content_not_blank",
    ]) {
      expect(validateContentNotBlankMigration).toContain(`validate constraint ${constraint}`);
      expect(schema).toContain(`add constraint ${constraint} check (length(btrim(content)) > 0);`);
    }
    expect(schema).not.toContain("check (length(btrim(content)) > 0) not valid");
  });

  it("keeps retrieval_synopsis when adding lexical_score to match_document_chunks_text", () => {
    expect(lexicalScoreMigration).toContain("retrieval_synopsis text");
    expect(lexicalScoreMigration).toContain("c.retrieval_synopsis");
    expect(lexicalScoreMigration).toContain(
      "drop function if exists public.match_document_chunks_text(text, integer, uuid[], uuid)",
    );
  });

  it("drops match_document_chunks_text before phase 7 changes its OUT signature", () => {
    expect(phase7RetrievalPerformanceMigration).toContain(
      "drop function if exists public.match_document_chunks_text(text, integer, uuid[], uuid)",
    );
  });

  it("keeps retrieval owner sentinel migration neutralized to avoid replay regressions", () => {
    expect(retrievalOwnerFilterSentinelMigration).toContain("NEUTRALIZED 2026-07-08");
    expect(retrievalOwnerFilterSentinelMigration).toContain("select 1 where false;");
  });

  it("guards pg_cron retention schedules for preview branches without cron.job", () => {
    for (const sql of [
      ragQueriesRetentionMigration,
      ragRetrievalLogsRetentionMigration,
      ragQueryMissesRetentionMigration,
    ]) {
      expect(sql).toContain("to_regnamespace('cron')");
      expect(sql).not.toMatch(/select cron\.unschedule\(jobid\) from cron\.job/);
      expect(sql).not.toMatch(/select cron\.schedule\(/);
    }
    expect(ragQueriesRetentionDuplicateMigration).toMatch(/select 1;/);
  });

  it("keeps response-cache cleanup bounded and consolidates its cron jobs", () => {
    expect(responseCacheRetentionReconciliationMigration).toContain(
      "where j.jobname in ('purge-rag-response-cache', 'purge-expired-rag-response-cache')",
    );
    expect(responseCacheRetentionReconciliationMigration).toContain(
      "$job$select public.purge_expired_rag_response_cache(1000);$job$",
    );
    expect(responseCacheRetentionReconciliationMigration).not.toContain("delete from public.rag_response_cache");
    expect(schema).toContain("purge_expired_rag_response_cache(p_limit integer default 1000)");
    expect(schema).toContain("limit p_limit");
  });

  it("keeps ingestion_jobs_one_open stem neutralized for preview history parity", () => {
    expect(ingestionJobsOneOpenNeutralizedMigration).toContain("NEUTRALIZED 2026-07-09");
    expect(ingestionJobsOneOpenNeutralizedMigration).toContain("select 1 where false;");
    expect(ingestionJobsOneOpenNeutralizedMigration).not.toContain("concurrently");
    expect(ingestionJobsOneOpenMigration).toContain("ingestion_jobs_one_open_per_document_uidx");
    expect(ingestionJobsOneOpenMigration).not.toContain("concurrently");
  });

  it("codifies production ACL migration versions and neutralizes the later duplicate", () => {
    expect(retrievalPublicExecuteMigration).toContain(
      "revoke execute on function public.retrieval_owner_matches(uuid, uuid)",
    );
    expect(retrievalPublicExecuteMigration).toContain(
      "revoke execute on function public.search_document_chunks(uuid, text, integer, uuid)",
    );
    expect(ingestionRpcPrivilegesMigration).toContain(
      "revoke execute on function public.complete_ingestion_job(uuid, uuid, uuid, text, text)",
    );
    expect(ingestionRpcPrivilegesMigration).toContain(
      "revoke execute on function public.fail_or_retry_ingestion_job(uuid, uuid, uuid, boolean, text, text, text, timestamp with time zone, text)",
    );
    expect(ingestionRpcPrivilegesDuplicateMigration).toContain("NEUTRALIZED 2026-07-13");
    expect(ingestionRpcPrivilegesDuplicateMigration).toContain("select 1 where false;");
  });

  it("keeps the document-title vocabulary lifecycle aligned in migration and schema", () => {
    for (const sql of [schema, patchRagAndCorrectorScalabilityMigration]) {
      expect(sql).toContain("create table if not exists public.document_title_words");
      expect(sql).toContain("word text not null");
      expect(sql).toContain("document_id uuid not null references public.documents(id) on delete cascade");
      expect(sql).toContain("primary key (word, document_id)");
      expect(sql).toContain("insert into public.document_title_words (word, document_id)");
      expect(sql).toContain("drop trigger if exists documents_sync_title_words on public.documents");
      expect(sql).toContain("create trigger documents_sync_title_words");
    }
  });

  it("purges legacy private title words and enforces an indexed-public source invariant", () => {
    for (const sql of [schema, documentTitleWordScopeMigration]) {
      const normalized = sql.toLowerCase();
      const guardFunction = finalSqlSegment(
        sql,
        "create or replace function public.enforce_document_title_word_scope()",
        "revoke execute on function public.enforce_document_title_word_scope()",
      );

      expect(guardFunction).toContain("security definer set search_path = ''");
      expect(guardFunction).toContain("d.id = new.document_id");
      expect(guardFunction).toContain("d.owner_id is null");
      expect(guardFunction).toContain("d.status = 'indexed'");
      expect(guardFunction).toContain("pg_catalog.length(new.word) between 4 and 40");
      expect(guardFunction).toContain(
        "new.word = any ( pg_catalog.regexp_split_to_array(pg_catalog.lower(d.title), '[^a-z]+') )",
      );
      expect(guardFunction).toContain("for share");
      expect(guardFunction).toContain("if not found then");
      expect(guardFunction).toContain("using errcode = '23514'");
      expect(normalized).toContain(
        "revoke execute on function public.enforce_document_title_word_scope() from public, anon, authenticated, service_role",
      );
      expect(normalized).toContain(
        "create trigger document_title_words_enforce_public_scope before insert or update on public.document_title_words",
      );

      const guardIndex = normalized.indexOf("create trigger document_title_words_enforce_public_scope");
      const purgeIndex = normalized.indexOf("delete from public.document_title_words dtw", guardIndex);
      const repairIndex = normalized.indexOf("insert into public.document_title_words (word, document_id)", purgeIndex);
      expect(guardIndex).toBeGreaterThanOrEqual(0);
      expect(purgeIndex).toBeGreaterThan(guardIndex);
      expect(repairIndex).toBeGreaterThan(purgeIndex);

      const purge = normalized.slice(purgeIndex, repairIndex);
      expect(purge).toContain("where not exists");
      expect(purge).toContain("d.id = dtw.document_id");
      expect(purge).toContain("d.owner_id is null");
      expect(purge).toContain("d.status = 'indexed'");
      expect(purge).toContain("pg_catalog.length(dtw.word) between 4 and 40");
      expect(purge).toContain(
        "dtw.word = any ( pg_catalog.regexp_split_to_array(pg_catalog.lower(d.title), '[^a-z]+') )",
      );
    }

    expect(documentTitleWordScopeMigration).toContain(
      "revoke execute on function public.sync_document_title_words() from public, anon, authenticated, service_role",
    );
    expect(documentTitleWordScopeMigration).toContain(
      "revoke all on table public.document_title_words from public, anon, authenticated",
    );
    expect(documentTitleWordScopeMigration).toContain(
      "grant select, insert, update, delete on table public.document_title_words to service_role",
    );
    expect(documentTitleWordScopeMigration).toContain(
      "add constraint document_title_words_word_length check (pg_catalog.length(word) between 4 and 40) not valid",
    );
    expect(documentTitleWordScopeMigration).toContain(
      "add constraint document_title_words_lowercase check (word = pg_catalog.lower(word)) not valid",
    );
    expect(documentTitleWordScopeMigration).toContain("validate constraint document_title_words_word_length");
    expect(documentTitleWordScopeMigration).toContain("validate constraint document_title_words_lowercase");
    expect(documentTitleWordScopeMigration).toContain(
      "raise exception 'document_title_words contains rows outside the indexed public title corpus' using errcode = '23514'",
    );

    const initialCorrectorMigration = publicTitleCorrectorMigration.toLowerCase();
    const initialPurgeIndex = initialCorrectorMigration.indexOf("delete from public.document_title_words dtw");
    const tableBackedCorrectorIndex = initialCorrectorMigration.indexOf(
      "create or replace function public.correct_clinical_query_terms(",
    );
    expect(initialPurgeIndex).toBeGreaterThanOrEqual(0);
    expect(tableBackedCorrectorIndex).toBeGreaterThan(initialPurgeIndex);
    expect(initialCorrectorMigration.slice(initialPurgeIndex, tableBackedCorrectorIndex)).toContain(
      "d.owner_id is null",
    );
  });

  it("keeps document title words backend-only with an explicit service-role policy", () => {
    for (const sql of [schema, documentTitleWordsBackendPolicyMigration]) {
      expect(sql).toContain("alter table public.document_title_words enable row level security");
      expect(sql).toContain("revoke all on table public.document_title_words from public, anon, authenticated");
      expect(sql).toContain(
        "grant select, insert, update, delete on table public.document_title_words to service_role",
      );
      expect(sql).toContain(
        'drop policy if exists "document title words service role all" on public.document_title_words',
      );
      expect(sql).toContain(
        'create policy "document title words service role all" on public.document_title_words for all to service_role using (true) with check (true)',
      );
    }

    // For schema, extract just the document_title_words ACL/policy block.
    // For the migration, the whole file is already scoped to this table.
    const schemaSegment = finalSqlSegment(
      schema,
      "alter table public.document_title_words enable row level security",
      "create or replace function public.sync_document_title_words()",
    );
    const migrationSegment = documentTitleWordsBackendPolicyMigration.toLowerCase();

    for (const scopedSql of [schemaSegment, migrationSegment]) {
      const policies = scopedSql.match(/create policy [^;]+ on public\.document_title_words[^;]*;/g);
      expect(policies).toHaveLength(1);
      expect(policies![0]).toContain(" to service_role ");
      expect(scopedSql).not.toMatch(/create policy [^;]+ to (?:public|anon|authenticated)\b/i);
      expect(scopedSql).not.toMatch(
        /grant [^;]+ on table public\.document_title_words[^;]+ to (?:public|anon|authenticated)\b/i,
      );
    }
  });

  it("hardens registry cleanup without UUID casts or cross-registry collisions", () => {
    for (const sql of [schema, hardenRagScalabilityPatchMigration]) {
      const cleanup = finalSqlSegment(
        sql,
        "create or replace function public.cleanup_registry_corpus_document()",
        "revoke execute on function public.cleanup_registry_corpus_document()",
      );
      const cleanupLower = cleanup.toLowerCase();
      expect(cleanupLower).toContain("metadata->>'registry_record_id' = old.id::text");
      expect(cleanupLower).toContain("metadata->>'registry_record_kind' = case tg_table_name");
      expect(cleanupLower).toMatch(/when 'clinical_registry_records' then (pg_catalog\.)?to_jsonb\(old\)->>'kind'/);
      expect(cleanup).toContain("when 'medication_records' then 'medication'");
      expect(cleanup).toContain("when 'differential_records' then 'differential'");
      expect(cleanup).not.toContain("registry_record_id')::uuid");
      expect(sql).toContain(
        "revoke execute on function public.cleanup_registry_corpus_document() from public, anon, authenticated",
      );
      expect(sql).toContain(
        "revoke execute on function public.sync_document_title_words() from public, anon, authenticated",
      );
    }
  });

  it("uses bounded indexed probes for clinical query correction", () => {
    for (const sql of [schema, hardenRagScalabilityPatchMigration]) {
      const corrector = finalSqlSegment(
        sql,
        "create or replace function public.correct_clinical_query_terms",
        "revoke execute on function public.correct_clinical_query_terms",
      );
      expect(corrector).toContain("lower(alias) % tok");
      expect(corrector).toContain("lower(canonical) % tok");
      expect(corrector).toContain("word % tok");
      expect(corrector).toContain("limit 32");
      expect(corrector).toContain("best is not null and best_sim >= min_sim");
      if (corrector.includes("min_sim is null")) {
        expect(corrector).toContain("min_sim is null or min_sim < 0.3 or min_sim > 1");
      }
      expect(corrector).not.toContain("array_agg(distinct term)");
      expect(corrector).not.toContain("unnest(vocab)");
      expect(sql).toContain("rag_aliases_canonical_trgm_idx");
    }
  });

  it("drops the mismatched wide table-facts trigram index and preserves RPC parity", () => {
    const indexExpression =
      "lower(coalesce(table_title, '') || ' ' || coalesce(row_label, '') || ' ' || coalesce(clinical_parameter, ''))";
    const rpcExpression =
      "lower(coalesce(f.table_title, '') || ' ' || coalesce(f.row_label, '') || ' ' || coalesce(f.clinical_parameter, ''))";
    const tableFactsRpc = finalSqlSegment(
      schema,
      "create or replace function public.match_document_table_facts_text(",
      "$function$;",
    );

    expect(documentTableFactsTrgmMigration).toContain("create index if not exists document_table_facts_text_trgm_idx");
    expect(hardenRagScalabilityPatchMigration).toContain(
      "drop index if exists public.document_table_facts_text_trgm_idx",
    );
    expect(schema).not.toContain("create index if not exists document_table_facts_text_trgm_idx");
    expect(schema).toContain(
      `create index if not exists document_table_facts_title_row_param_trgm_idx on public.document_table_facts using gin (${indexExpression} extensions.gin_trgm_ops)`,
    );
    expect(tableFactsRpc).toContain(`${rpcExpression} % q.normalized`);
  });

  it("plans table-facts text matching via plpgsql EXECUTE for per-call custom plans", () => {
    const tableFactsMigration = readFileSync(
      new URL("../supabase/migrations/20260724120000_table_facts_plpgsql_execute.sql", import.meta.url),
      "utf8",
    );
    const tableFactsRpc = finalSqlSegment(
      schema,
      "create or replace function public.match_document_table_facts_text(",
      "$function$;",
    );
    expect(tableFactsRpc).toContain("language plpgsql");
    expect(tableFactsRpc).toContain("return query execute");
    expect(tableFactsRpc).toContain("using query_text, match_count, document_filters, owner_filter");
    expect(tableFactsMigration).toContain("language plpgsql");
    expect(tableFactsMigration).toContain("return query execute");
    expect(tableFactsMigration).toContain(
      "revoke execute on function public.match_document_table_facts_text(text, integer, uuid[], uuid)",
    );
  });
});

describe("Clinical query-term corrector — tenant-safe vocabulary (F10)", () => {
  // The fix ships as a forward migration; schema.sql + drift-manifest are synced at
  // the Docker-gated apply step, so this asserts the migration rather than schema.sql.
  const correctorPublicTitlesMigration = readFileSync(
    new URL("../supabase/migrations/20260717120000_corrector_public_titles_only.sql", import.meta.url),
    "utf8",
  )
    .replace(/\s+/g, " ")
    .toLowerCase();

  it("recreates the corrector scoped to the public (null-owner) title corpus", () => {
    expect(correctorPublicTitlesMigration).toContain(
      "create or replace function public.correct_clinical_query_terms(input_query text, min_sim real default 0.45)",
    );
    // SECURITY DEFINER bypasses RLS, so the title scan must be owner-scoped to keep a
    // private tenant's title tokens out of every caller's correction vocabulary.
    expect(correctorPublicTitlesMigration).toContain(
      "where d.status = 'indexed' and d.owner_id is null and length(w) between 4 and 40",
    );
    // Regression guard: the old unscoped predicate must not survive in the migration.
    expect(correctorPublicTitlesMigration).not.toContain("where d.status = 'indexed' and length(w) between 4 and 40");
  });

  it("scopes the rag_aliases vocabulary sources to public (null-owner) rows", () => {
    // rag_aliases carries an owner_id (deep-memory persists owner-scoped aliases for
    // private documents), so both alias reads must be owner-scoped too — otherwise the
    // title fix alone still leaks private-document-derived terms across tenants.
    expect(correctorPublicTitlesMigration).toContain(
      "select lower(alias) as term from public.rag_aliases where enabled and owner_id is null and length(alias) between 4 and 40",
    );
    expect(correctorPublicTitlesMigration).toContain(
      "select lower(canonical) from public.rag_aliases where enabled and owner_id is null and length(canonical) between 4 and 40",
    );
    // Regression guard: the old unscoped alias reads must not survive.
    expect(correctorPublicTitlesMigration).not.toContain(
      "from public.rag_aliases where enabled and length(alias) between 4 and 40",
    );
    expect(correctorPublicTitlesMigration).not.toContain(
      "from public.rag_aliases where enabled and length(canonical) between 4 and 40",
    );
  });

  it("keeps the corrector execute privilege confined to service_role", () => {
    expect(correctorPublicTitlesMigration).toContain(
      "revoke execute on function public.correct_clinical_query_terms(text, real) from public, anon, authenticated;",
    );
    expect(correctorPublicTitlesMigration).toContain(
      "grant execute on function public.correct_clinical_query_terms(text, real) to service_role;",
    );
  });

  it("defines correct_clinical_query_terms exactly once with owner-scoped rag_aliases probes", () => {
    // Schema hygiene: a superseded unscoped duplicate previously lived earlier in
    // schema.sql and only lost because CREATE OR REPLACE order favored the later
    // definition. Pin a single authoritative body so reorder/extract cannot revive
    // the cross-tenant alias side-channel.
    const definitionMatches = schema.match(/create or replace function public\.correct_clinical_query_terms/gi);
    expect(definitionMatches).toHaveLength(1);

    const corrector = finalSqlSegment(
      schema,
      "create or replace function public.correct_clinical_query_terms",
      "revoke execute on function public.correct_clinical_query_terms",
    );
    const aliasProbeBlocks = corrector.match(/from public\.rag_aliases[\s\S]*?limit 32/gi) ?? [];
    expect(aliasProbeBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of aliasProbeBlocks) {
      expect(block).toMatch(/owner_id\s+is\s+null/i);
    }
    expect(corrector).not.toContain("array_agg(distinct term)");
    expect(corrector).not.toContain("unnest(vocab)");
  });

  it("keeps base match RPC execute grants explicit in schema and the forward migration", () => {
    // 2026-07-24 interface audit P3: do not rely solely on roles.sql / default
    // privilege churn for the live match_* signatures.
    for (const sql of [schema, baseMatchRpcExecuteGrantsMigration]) {
      expect(sql).toContain(
        "revoke execute on function public.match_document_chunks(extensions.vector, integer, double precision, uuid, uuid)",
      );
      expect(sql).toContain(
        "grant execute on function public.match_document_chunks(extensions.vector, integer, double precision, uuid, uuid)",
      );
      expect(sql).toContain(
        "revoke execute on function public.match_document_chunks_hybrid(extensions.vector, text, integer, double precision, uuid[], uuid)",
      );
      expect(sql).toContain(
        "revoke execute on function public.match_document_chunks_text(text, integer, uuid[], uuid)",
      );
      expect(sql).toContain(
        "revoke execute on function public.match_document_memory_cards_hybrid(extensions.vector, text, integer, double precision, uuid[], uuid)",
      );
      expect(sql).toContain("revoke execute on function public.match_documents_for_query(text, integer, uuid)");
      expect(sql).toContain("grant execute on function public.match_documents_for_query(text, integer, uuid)");
    }
  });

  it("moves invoke_ingestion_worker to the GUC base-URL pattern with service-role-only execute", () => {
    for (const sql of [schema, invokeIngestionWorkerGucMigration]) {
      expect(sql).toContain("alter database %I set app.ingestion_worker_base_url = %L");
      expect(sql).toContain("when insufficient_privilege then");
      expect(sql).toContain("nullif(current_setting('app.ingestion_worker_base_url', true), '')");
      expect(sql).toContain("v_base_url || '/functions/v1/ingestion-worker?limit='");
      expect(sql).not.toContain("[REDACTED]/functions/v1/ingestion-worker");
      expect(sql).toContain(
        "revoke execute on function public.invoke_ingestion_worker(integer) from public, anon, authenticated",
      );
      expect(sql).toContain("grant execute on function public.invoke_ingestion_worker(integer) to service_role");
    }
  });
});
