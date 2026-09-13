import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const schemaSource = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const schema = schemaSource.replace(/\s+/g, " ");
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

function trackedMigrationFileNames() {
  // Git failure is fatal. Never fall back to discovering unrelated untracked SQL.
  const tracked = execFileSync("git", ["ls-files", "-z", "--", "supabase/migrations/*.sql"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    encoding: "utf8",
    windowsHide: true,
  })
    .split("\0")
    .filter(Boolean);
  if (tracked.length === 0 || tracked.some((path) => !/^supabase\/migrations\/[^/]+\.sql$/.test(path))) {
    throw new Error("Expected a complete tracked SQL migration inventory.");
  }
  const names = new Set(tracked.map((path) => path.slice("supabase/migrations/".length)));
  for (const ownedMigration of [
    "20260831102000_stage_shadow_document_generations.sql",
    "20260831103000_activate_retained_document_generations.sql",
  ]) {
    if (existsSync(new URL(ownedMigration, migrationDirectoryUrl))) names.add(ownedMigration);
  }
  return [...names].sort();
}

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
const siteContentRuntimeAuthorityMigration = readFileSync(
  new URL("../supabase/migrations/20260827213539_add_site_content_runtime_authority.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");

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

describe("U04 shadow generation storage foundation (source contract only)", () => {
  // Remove only full-line SQL comments. Tokens in quoted glob/regexp literals
  // are data, so a generic block-comment or inline-comment regex is unsafe.
  const sql = schemaSource
    .replace(/^[ \t]*--[^\r\n]*/gm, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  const privateTables = [
    {
      name: "shadow_reindex_waves",
      columns: [
        "candidate_generation_id uuid",
        "plan_digest text",
        "plan_version integer not null",
        "project_ref text not null",
        "source_policy_version text not null",
        "audit_digest text not null",
        "population_fingerprint text not null",
        "recovery_evidence_digest text not null",
        "baseline_evaluation_digest text not null",
        "operation_manifest_digest text not null",
        "plan_payload jsonb not null",
        "created_at timestamptz not null",
        "prepared_origin_digest text not null",
        "execution_profile_digest text not null",
        "case_set_digest text not null",
        "baseline_report jsonb not null",
        "baseline_report_digest text not null",
      ],
      key: "candidate_generation_id",
      references: [],
    },
    {
      name: "document_index_generations",
      columns: [
        "document_id uuid not null",
        "index_generation_id uuid not null",
        "owner_id uuid",
        "baseline_generation_id uuid",
        "expected_state_digest text not null",
        "authority_digest text not null",
        "source_binding jsonb not null",
        "job_id uuid not null",
        "first_lease_token uuid",
        "claimed_at timestamptz",
        "state text not null",
        "expected_inventory_digest text",
        "inventory_digest text",
        "candidate_projection_digest text",
        "baseline_bundle_digest text not null",
        "stage_receipt jsonb",
        "stage_receipt_digest text",
        "staged_at timestamptz",
        "control_revision bigint not null default 0",
        "control_snapshot jsonb not null",
        "original_origin_envelope jsonb not null",
        "inventory_manifest jsonb not null",
      ],
      key: "document_id, index_generation_id",
      references: ["documents(id)", "shadow_reindex_waves(candidate_generation_id)", "ingestion_jobs(id)"],
    },
    {
      name: "document_generation_projections",
      columns: [
        "document_id uuid not null",
        "index_generation_id uuid not null",
        "lease_token uuid not null",
        "owner_id uuid",
        "summary jsonb",
        "generated_labels jsonb",
        "summary_projection_complete boolean",
        "enrichment_metadata jsonb",
        "quality jsonb",
        "worker_metadata jsonb",
        "document_counts jsonb",
        "deep_memory_artifact_generation_id uuid",
        "deep_memory_receipt jsonb",
        "deep_memory_metadata jsonb",
        "producer_aliases jsonb",
        "summary_digest text",
        "quality_digest text",
        "deep_memory_digest text",
        "worker_state_digest text",
        "sealed_at timestamptz",
      ],
      key: "document_id, index_generation_id",
      references: ["document_index_generations(document_id, index_generation_id)"],
    },
    {
      name: "document_generation_inventory",
      columns: [
        "document_id uuid not null",
        "index_generation_id uuid not null",
        "family text not null",
        "unit_key text not null",
        "lease_token uuid not null",
        "expected boolean not null",
        "required boolean not null",
        "disposition text not null",
        "reason_code text",
        "limitations jsonb not null",
        "producer text not null",
        "artifact_generation_id uuid",
        "artifact_ref jsonb",
        "content_digest text",
        "source_binding jsonb not null",
        "relationships jsonb not null",
        "retained_evidence_text text",
        "retained_native_payload text",
        "representation_version text",
        "transform_version text",
      ],
      key: "document_id, index_generation_id, family, unit_key",
      references: ["document_index_generations(document_id, index_generation_id)"],
    },
    {
      name: "document_generation_baselines",
      columns: [
        "document_id uuid not null",
        "candidate_generation_id uuid not null",
        "baseline_generation_id uuid",
        "expected_state_digest text not null",
        "bundle_version integer not null",
        "bundle_payload jsonb not null",
        "bundle_digest text not null",
        "captured_at timestamptz not null",
      ],
      key: "document_id, candidate_generation_id",
      references: ["document_index_generations(document_id, index_generation_id)"],
    },
  ];

  function tableDefinition(name: string) {
    const definition = sql.match(new RegExp(`create table (?:if not exists )?public\\.${name} \\([^;]+;`))?.[0];
    // Missing future storage is an assertion failure against today's snapshot,
    // not an import/ENOENT failure from reading an unauthored migration.
    expect(definition, `Missing U04 table public.${name}`).toBeDefined();
    return definition!;
  }

  function tableAlterations(name: string) {
    return (sql.match(new RegExp(`alter table public\\.${name}\\b[^;]+;`, "g")) ?? []).join(" ");
  }

  it("addresses page ordinals by generation while preserving one explicit legacy set", () => {
    const definition = tableDefinition("document_pages");
    const alterations = tableAlterations("document_pages");
    expect(`${definition} ${alterations}`).toMatch(/\bindex_generation_id uuid\b/);
    const indexes = (sql.match(/create unique index [^;]+ on public\.document_pages\b[^;]+;/g) ?? []).join(" ");
    expect(`${definition} ${alterations} ${indexes}`).toMatch(
      /(?:unique\s*\(document_id, index_generation_id, page_number\)|on public\.document_pages\s*\(document_id, index_generation_id, page_number\))/,
    );
    expect(sql).toMatch(
      /create unique index [^;]+ on public\.document_pages\s*\(document_id, page_number\) where \(?index_generation_id is null\)?;/,
    );
    if (definition.includes("unique (document_id, page_number)")) {
      expect(alterations).toMatch(/drop constraint (?:if exists )?document_pages_document_id_page_number_key/);
    }
  });

  it("persists a closed immutable standard/shadow job identity with no shadow batch", () => {
    const jobs = `${tableDefinition("ingestion_jobs")} ${tableAlterations("ingestion_jobs")}`;
    expect(jobs).toContain("operation text not null default 'standard'");
    expect(jobs).toContain("requested_generation_id uuid");
    expect(jobs).toContain("shadow_plan_digest text");
    expect(jobs).toMatch(/operation in \('standard', 'shadow_reindex'\)/);
    expect(jobs).toContain("operation = 'standard' and requested_generation_id is null and shadow_plan_digest is null");
    expect(jobs).toContain(
      "operation = 'shadow_reindex' and requested_generation_id is not null and shadow_plan_digest is not null and batch_id is null",
    );
    const guard = sqlFunctionBody(sql, "guard_shadow_generation_evidence_mutation");
    for (const field of ["operation", "requested_generation_id", "shadow_plan_digest"]) {
      expect(guard).toContain(`old.${field}`);
      expect(guard).toContain(`new.${field}`);
    }
    expect(guard).toContain("is distinct from");
    expect(guard).toContain("raise exception");
    expect(sql).toMatch(
      /create trigger [^;]+ before update\b[^;]* on public\.ingestion_jobs[^;]+ execute function public\.guard_shadow_generation_evidence_mutation\(\)/,
    );
  });

  it.each(privateTables)(
    "retains the complete private $name row and closes direct writes",
    ({ name, columns, key, references }) => {
      const table = tableDefinition(name);
      for (const column of columns) expect(table, `${name}.${column}`).toContain(column);
      if (key === "candidate_generation_id") {
        expect(table).toMatch(/candidate_generation_id uuid (?:not null )?primary key/);
      } else {
        expect(table).toContain(`primary key (${key})`);
      }
      for (const target of references) expect(table).toContain(`references public.${target}`);
      if (name.startsWith("document_generation_")) {
        const memberKey =
          name === "document_generation_baselines"
            ? "document_id, candidate_generation_id"
            : "document_id, index_generation_id";
        expect(table).toContain(`foreign key (${memberKey}) references public.document_index_generations`);
      }
      expect(table).not.toMatch(/on (?:delete|update) (?:cascade|set null|set default)/);
      expect(sql).toContain(`alter table public.${name} enable row level security`);
      const reset = `revoke all on table public.${name} from public, anon, authenticated, service_role`;
      const readGrant = `grant select on table public.${name} to service_role`;
      expect(sql).toContain(reset);
      expect(sql.indexOf(readGrant)).toBeGreaterThan(sql.lastIndexOf(reset));
      const grants = (sql.match(/grant [^;]+;/g) ?? []).filter((grant) =>
        new RegExp(`\\bpublic\\.${name}\\b`).test(grant),
      );
      expect(grants).toEqual([`${readGrant};`]);
      const policies = sql.match(new RegExp(`create policy [^;]+ on public\\.${name}\\b[^;]+;`, "g")) ?? [];
      for (const policy of policies) {
        expect(policy).toMatch(/for select to service_role using \(/);
      }
    },
  );

  it("constrains wave, member, inventory and baseline identities without an active or abandoned state", () => {
    const wave = tableDefinition("shadow_reindex_waves");
    expect(wave).toMatch(/(?:plan_digest text[^,]*unique|unique \(plan_digest\))/);
    expect(wave).toMatch(/plan_digest text[^,]*not null/);
    expect(wave).toContain("plan_version = 1");
    expect(wave).toContain("project_ref = 'sjrfecxgysukkwxsowpy'");
    const member = tableDefinition("document_index_generations");
    expect(member).toMatch(/(?:job_id uuid[^,]*unique|unique \(job_id\))/);
    expect(member).toMatch(/(?:stage_receipt_digest text[^,]*unique|unique \(stage_receipt_digest\))/);
    expect(member).toContain("state in ('reserved', 'building', 'staged')");
    expect(member).not.toMatch(/'(?:active|promoted|abandoned)'/);
    for (const field of ["first_lease_token", "claimed_at", "stage_receipt", "stage_receipt_digest", "staged_at"]) {
      expect(member).toContain(`${field} is null`);
      expect(member).toContain(`${field} is not null`);
    }
    const inventory = tableDefinition("document_generation_inventory");
    expect(inventory).toContain(
      "disposition in ('pending', 'retained', 'excluded', 'failed', 'skipped', 'not_required')",
    );
    expect(inventory).toContain("'retained'");
    expect(inventory).toContain("artifact_ref is not null");
    expect(inventory).toContain("content_digest is not null");
    expect(tableDefinition("document_generation_baselines")).toContain("bundle_version = 1");
  });

  it("retains raw origin and baseline envelopes plus full control and producer manifests without empty defaults", () => {
    const ledger = tableDefinition("document_index_generations");
    const baseline = tableDefinition("document_generation_baselines");
    for (const [table, column] of [
      [ledger, "original_origin_envelope"],
      [baseline, "bundle_payload"],
    ]) {
      expect(table).toContain(`${column} jsonb not null`);
      expect(table).not.toMatch(new RegExp(`${column} jsonb[^,]*default`));
      // The raw string is durable authority; parsed JSON alone loses precision.
      expect(table).toContain(`jsonb_typeof(${column} -> 'canonicalpayload') = 'string'`);
      for (const key of ["version", "domain", "encoding", "digest"]) {
        expect(table).toContain(`${column} ->> '${key}'`);
      }
    }
    for (const column of ["control_snapshot", "inventory_manifest"]) {
      expect(ledger).toContain(`${column} jsonb not null`);
      expect(ledger).not.toMatch(new RegExp(`${column} jsonb[^,]*default`));
    }
    expect(ledger).toContain("control_revision >= 0");
    expect(ledger).toContain("jsonb_array_length(inventory_manifest -> 'families') = 18");
    // Exact producer slots are durable, including both independent index-unit producers.
    const familySlots: Record<string, string[]> = {
      pages: ["worker_core"],
      native_structure: ["worker_native"],
      chunks: ["worker_core"],
      images: ["worker_core"],
      table_facts: ["worker_core"],
      embedding_fields: ["worker_core"],
      index_units: ["worker_core", "deep_memory"],
      sections: ["deep_memory"],
      memory_cards: ["deep_memory"],
      summary: ["enrichment"],
      generated_labels: ["enrichment"],
      quality: ["worker_core"],
      document_metadata: ["projection_aggregate"],
      producer_aliases: ["deep_memory"],
      private_objects: ["private_objects"],
      attempt_control: ["control"],
      cache_inputs: ["cache"],
      repair_audit_inputs: ["repair"],
    };
    for (const [family, slots] of Object.entries(familySlots)) {
      // CHECK containment binds family and slots in the same retained JSON entry;
      // global token presence would not catch a swapped or lost producer slot.
      const entry = JSON.stringify({ family, groups: slots.map((groupKey) => ({ groupKey })) }).toLowerCase();
      expect(ledger.replace(/\s/g, "")).toContain(entry);
    }
  });
});

describe("U04 failed producer D retention source contracts", () => {
  const failureRetentionMigration = readFileSync(
    new URL("../supabase/migrations/20260831102000_stage_shadow_document_generations.sql", import.meta.url),
    "utf8",
  );
  const failureRetentionSchema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  function effectiveFailureRetention(source: string, name: string) {
    const start = source.lastIndexOf("create or replace function public." + name + "(");
    expect(start, "Missing effective function " + name).toBeGreaterThanOrEqual(0);
    const plpgsqlEnd = source.indexOf("\nend $$;", start);
    const sqlEnd = source.indexOf("\n$$;", start);
    const end = [plpgsqlEnd, sqlEnd]
      .filter((candidate) => candidate > start)
      .sort((left, right) => left - right)[0];
    const effectiveEnd = end ?? -1;
    expect(effectiveEnd, "Missing end of " + name).toBeGreaterThan(start);
    const suffix = source.startsWith("\nend $$;", effectiveEnd) ? "\nend $$;" : "\n$$;";
    return source.slice(start, effectiveEnd + suffix.length);
  }

  it("keeps the strict failed-stage artifact extractor identical in migration and schema", () => {
    const name = "shadow_failed_artifact_generation_v1";
    const body = effectiveFailureRetention(failureRetentionMigration, name);
    expect(effectiveFailureRetention(failureRetentionSchema, name)).toBe(body);
    expect(body).toContain("not public.shadow_keys_v1(p_stage.metadata,array['u04_producer_failure_v1'])");
    expect(body).toContain(
      "v_payload->'binding' is distinct from pg_catalog.jsonb_build_object('tag','candidate','source',p_member.source_binding",
    );
    expect(body).toContain("p_stage.lease_token is distinct from p_member.first_lease_token");
    expect(body).toContain("p_revision_offset is null");
    expect(body).toContain("p_revision_offset=0 and p_member.state is distinct from 'building'");
    expect(body).toContain("p_revision_offset=0 and v_revision<>p_member.control_revision");
    expect(body).toContain("p_revision_offset=1 and v_revision+1>p_member.control_revision");
    expect(body).toContain(
      "public.shadow_node_payload_v1(v_payload->'inputEnvelope','u04-retained-evidence-v1')",
    );
    expect(body).toContain(
      "public.shadow_node_payload_v1(v_payload->'partialEnvelope','u04-retained-evidence-v1')",
    );
    expect(body).toContain("exception when others then return null");
    expect(failureRetentionMigration).toContain(
      "revoke all on function public.shadow_failed_artifact_generation_v1",
    );
    expect(failureRetentionMigration).not.toContain(
      "grant execute on function public.shadow_failed_artifact_generation_v1",
    );
  });

  it("protects failed D from cleanup, row mutation and every generation reservation path", () => {
    for (const name of [
      "shadow_generation_retained_v1",
      "shadow_artifact_retention_guard_v1",
      "shadow_parent_retention_guard_v1",
      "enqueue_shadow_reindex_generation",
      "write_shadow_generation_inventory",
      "shadow_reserve_producer_d_v1",
      "shadow_state_rows_v1",
    ]) {
      expect(effectiveFailureRetention(failureRetentionSchema, name)).toBe(
        effectiveFailureRetention(failureRetentionMigration, name),
      );
    }
    const retained = effectiveFailureRetention(failureRetentionMigration, "shadow_generation_retained_v1");
    const artifact = effectiveFailureRetention(failureRetentionMigration, "shadow_artifact_retention_guard_v1");
    const parent = effectiveFailureRetention(failureRetentionMigration, "shadow_parent_retention_guard_v1");
    const enqueue = effectiveFailureRetention(failureRetentionMigration, "enqueue_shadow_reindex_generation");
    const stateRows = effectiveFailureRetention(failureRetentionMigration, "shadow_state_rows_v1");
    const inventory = effectiveFailureRetention(failureRetentionMigration, "write_shadow_generation_inventory");
    const reserve = effectiveFailureRetention(failureRetentionMigration, "shadow_reserve_producer_d_v1");
    expect(retained).toContain("public.shadow_failed_artifact_generation_v1(s,g,1)=p_generation");
    expect(artifact).toContain("public.shadow_failed_artifact_generation_v1(st,g,1)=v_lock::uuid");
    expect(artifact).toContain("then raise exception 'shadow_retained_evidence'");
    expect(parent).toContain("v_failed_artifact:=public.shadow_failed_artifact_generation_v1(new,v_member,0)");
    expect(parent).toContain(
      "pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('u04-artifact-generation:'||v_failed_artifact::text,0))",
    );
    expect(parent).toContain("shadow_producer_generation_occupied");
    expect(parent).toContain(
      "v_row->'owner_id' is distinct from coalesce(pg_catalog.to_jsonb(v_member.owner_id),'null'::jsonb)",
    );
    expect(parent).toContain("v_row->>'index_generation_id' is distinct from v_failed_artifact::text");
    expect(parent).toContain("v_row->'metadata'->>'generated_by' is distinct from 'local-worker'");
    expect(parent).toContain("v_row->'metadata'->>'index_generation_id' is distinct from v_failed_artifact::text");
    expect(enqueue).toContain("public.shadow_failed_artifact_generation_v1(st,g,1)=v_c");
    expect(enqueue).toContain(
      "public.shadow_failed_artifact_generation_v1(st,g,1)=(v_source->>'baselineGenerationId')::uuid",
    );
    expect(inventory).toContain("public.shadow_failed_artifact_generation_v1(st,g,1)=v_d");
    expect(reserve).toContain("public.shadow_failed_artifact_generation_v1(st,g,1)=v_d");
    expect(stateRows).toContain("v_table in ('document_index_units','document_sections','document_memory_cards')");
    expect(stateRows).toContain("st.job_id=any(p_jobs)");
    expect(stateRows).toContain("public.shadow_failed_artifact_generation_v1(st,g,1)::text=v_row->>'index_generation_id'");
    expect(stateRows).toContain("v_row->>'producer'='local-worker'");
    expect(stateRows).toContain("v_row->'owner_id' is not distinct from coalesce(pg_catalog.to_jsonb(g.owner_id),'null'::jsonb)");
    expect(stateRows).toContain("v_row->'metadata'->>'generated_by'='local-worker'");
    expect(stateRows).toContain("v_row->'metadata'->>'index_generation_id'=public.shadow_failed_artifact_generation_v1(st,g,1)::text");
    expect(stateRows).toContain("v_row->'metadata'->>'ingestion_lease_token'=g.first_lease_token::text");
  });
});

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

    for (const fileName of trackedMigrationFileNames()) {
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

describe("site-content runtime authority schema parity", () => {
  it("keeps the forward migration and canonical schema aligned on the bounded authority", () => {
    for (const sql of [schema, siteContentRuntimeAuthorityMigration]) {
      expect(sql).toContain("deployment_sha text generated always as");
      expect(sql).toContain("create table public.site_content_synchronizer_state");
      expect(sql).toContain("function public.record_site_content_synchronizer_heartbeat");
      expect(sql).toContain("function public.read_site_content_runtime_authority()");
      expect(sql).toContain("limit 101");
      expect(sql).toContain("grant execute on function public.read_site_content_runtime_authority() to service_role");
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
      "tombstone_public_source_version_for_review",
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
    expect(stageBody).toContain("returns jsonb");
    expect(stageBody).toContain("p_version ? 'stagingdocumentid'");
    expect(stageBody).toContain("outcome', 'resumed'");
    expect(stageBody).toContain("outcome', 'missing'");
    expect(stageBody).toContain("public source resumable shadow identity mismatch");
    expect(stageBody).toContain("v_existing.lifecycle is distinct from 'shadow'");
    expect(stageBody).toContain("v_existing.staged_content_hash is distinct from p_version->>'stagedcontenthash'");
    expect(stageBody).toContain("v_existing.activation_event_id is distinct from v_activation_event_id");
    expect(stageBody).toContain("v_existing.staging_owner_id is distinct from v_owner_id");
    expect(stageBody).not.toContain("when unique_violation");
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
    const withdrawalBody = sqlFunctionBody(sql, "tombstone_public_source_version_for_review");
    expect(withdrawalBody).toContain("for update");
    expect(withdrawalBody).toContain("lifecycle = 'active'");
    expect(withdrawalBody).toContain("lifecycle = 'tombstoned'");
    expect(withdrawalBody).toContain("public source current active identity mismatch");
    expect(withdrawalBody).toContain("insert into public.audit_logs");
    expect(withdrawalBody).toContain("public_source_withdrawal_review_required");
    expect(withdrawalBody).toContain("where not exists");
    expect(sql).toContain("create unique index public_source_versions_one_active_per_source_idx");
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

    const migrationFiles = trackedMigrationFileNames()
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

  it("preserves the historical invoker migration while retiring its current schema surface", () => {
    expect(invokeIngestionWorkerGucMigration).toContain("alter database %I set app.ingestion_worker_base_url = %L");
    expect(invokeIngestionWorkerGucMigration).toContain("when insufficient_privilege then");
    expect(invokeIngestionWorkerGucMigration).toContain(
      "nullif(current_setting('app.ingestion_worker_base_url', true), '')",
    );
    expect(invokeIngestionWorkerGucMigration).toContain("v_base_url || '/functions/v1/ingestion-worker?limit='");
    expect(invokeIngestionWorkerGucMigration).toContain(
      "revoke execute on function public.invoke_ingestion_worker(integer) from public, anon, authenticated",
    );
    expect(invokeIngestionWorkerGucMigration).toContain(
      "grant execute on function public.invoke_ingestion_worker(integer) to service_role",
    );
    expect(schema).not.toContain("FUNCTION public.invoke_ingestion_worker");
  });

  it("reconciles strict-gate counts to the exact active generation or positive legacy rows", () => {
    const migration = readFileSync(
      new URL("../supabase/migrations/20260831100000_retire_ingestion_worker.sql", import.meta.url),
      "utf8",
    ).toLowerCase();
    for (const sql of [schema.toLowerCase(), migration]) {
      const viewStart = sql.lastIndexOf("create or replace view public.document_strict_gate_status");
      expect(viewStart).toBeGreaterThanOrEqual(0);
      const viewEnd = sql.indexOf("create or replace function public.repair_strict_enrichment_gate_batch", viewStart);
      const view = sql.slice(viewStart, viewEnd >= 0 ? viewEnd : undefined);
      expect(view).toContain("d.index_generation_id");
      expect(view).toContain("d.metadata->>'index_generation_id'");
      expect(view).toContain("s.index_generation_id = d.index_generation_id");
      expect(view).toContain("m.index_generation_id = d.index_generation_id");
      expect(view).toContain("l.metadata->>'index_generation_id' = d.index_generation_id::text");
      expect(view).toContain("u.index_generation_id = d.index_generation_id");
      expect(view).toContain("not (coalesce(d.metadata, '{}'::jsonb) ? 'index_generation_id')");
    }
  });
});

describe("U04 fixed origin capture and profile bindings (source only)",()=>{
  const migration=readFileSync(new URL("../supabase/migrations/20260831102000_stage_shadow_document_generations.sql",import.meta.url),"utf8");
  function routine(source:string,name:string){
    const start=source.indexOf(`create or replace function public.${name}(`);
    expect(start,`Missing fixed routine ${name}`).toBeGreaterThanOrEqual(0);
    const end=source.indexOf("$$;",start);expect(end).toBeGreaterThan(start);
    return source.slice(start,end+3);
  }
  const families=["documents","document_pages","document_chunks","document_images","document_table_facts","document_embedding_fields","document_index_units",
    "document_sections","document_memory_cards","document_summaries","document_labels","document_index_quality","ingestion_jobs","indexing_v3_agent_jobs",
    "ingestion_job_stages","import_batches","rag_aliases","document_title_words","public_source_versions","public_source_activation_events",
    "public_source_serving_authority","document_publication_approvals","shadow_reindex_waves","document_index_generations","document_generation_projections",
    "document_generation_inventory","document_generation_baselines"];
  it("exposes only the corrected full-profile fixed read signature",()=>{
    const capture=routine(migration,"capture_shadow_reindex_origin");
    expect(capture).toContain("p_execution_profile_envelope jsonb");
    expect(capture).not.toContain("p_execution_profile_digest text");
    expect(capture).toContain("language sql stable security definer set search_path = ''");
    expect(capture).toContain("select public.capture_shadow_reindex_origin_v1_impl(");
    const persistenceStart=migration.indexOf("-- U04 fixed retention-safe persistence.");
    expect(persistenceStart).toBeGreaterThanOrEqual(0);
    expect(migration.slice(0,persistenceStart).match(/grant execute on function public\.[^;]+ to service_role;/g)).toEqual([
      "grant execute on function public.capture_shadow_reindex_origin(uuid[],text,uuid[],jsonb) to service_role;",
    ]);
  });
  it.each(["shadow_capture_rows_v1","shadow_capture_count_v1","shadow_capture_bytes_v1","read_shadow_document_authority_v1","capture_shadow_reindex_origin_v1_impl"])("keeps %s private and STABLE",(name)=>{
    const body=routine(migration,name);
    expect(body).toMatch(/language (?:sql|plpgsql) stable/);
    expect(body).toContain("set search_path = ''");
    expect(body).not.toMatch(/\b(?:insert into|update public\.|delete from|for update|pg_advisory|execute format)\b/i);
    expect(migration).toMatch(new RegExp(`alter function public\\.${name}\\([^;]+\\) owner to postgres;`));
    expect(migration).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^;]+\\) from public, anon, authenticated, service_role;`));
    expect(migration).not.toMatch(new RegExp(`grant execute on function public\\.${name}\\(`));
  });
  it("mirrors every frozen capture helper into the schema snapshot",()=>{
    const marker="-- U04 read-only capture foundation. No mutation, claim or seal entrypoint is exposed.";
    const nextMarker = "-- U05 exact document-generation lifecycle. Source-only; no operation is performed here.";
    expect(schemaSource.slice(schemaSource.indexOf(marker), schemaSource.indexOf(nextMarker))).toBe(
      migration.slice(migration.indexOf(marker)),
    );
  });
  it("retains all 27 complete row populations in row/count/byte queries",()=>{
    for(const name of ["shadow_capture_rows_v1","shadow_capture_count_v1","shadow_capture_bytes_v1"]){
      const body=routine(migration,name);
      for(const family of families)expect(body).toContain(`from public.${family} r where `);
      expect(body).not.toMatch(/\blimit\b|\boffset\b|r\.status\s*=/i);
    }
    expect(routine(migration,"shadow_capture_rows_v1").match(/as row_payload/g)).toHaveLength(27);
  });
  it("counts membership and exact encoded bytes before constructing nonempty arrays",()=>{
    const body=routine(migration,"capture_shadow_reindex_origin_v1_impl");
    expect(body.indexOf("v_count := public.shadow_capture_count_v1")).toBeLessThan(body.indexOf("v_total_bytes := public.shadow_capture_bytes_v1"));
    expect(body.indexOf("v_total_bytes := public.shadow_capture_bytes_v1")).toBeLessThan(body.indexOf("for v_row in select * from public.shadow_capture_rows_v1"));
    expect(body).toContain("if v_count>v_max_rows then raise exception 'evidence_too_large'");
    expect(body).toContain("if v_base_bytes+v_total_bytes>v_max_bytes then raise exception 'evidence_too_large'");
    expect(body).toContain("if v_actual_count<>v_count then raise exception 'shadow_snapshot_incomplete'");
    expect(body).toContain("pg_catalog.octet_length(pg_catalog.convert_to(v_origin::text,'UTF8'))>v_max_bytes");
    expect(routine(migration,"shadow_capture_bytes_v1").match(/case when pg_catalog.count\(\*\)>0 then 2 else 0 end/g)).toHaveLength(27);
  });
  it("uses full original profile bytes and enforces hard and lowered ceilings",()=>{
    const profile=routine(migration,"shadow_profile_capture_v1"),capture=routine(migration,"capture_shadow_reindex_origin_v1_impl");
    expect(profile).toContain("public.shadow_node_json_text_v1(v_text::json) is distinct from v_text");
    expect(profile).toContain("pg_catalog.octet_length(pg_catalog.convert_to(v_text,'UTF8'))::text");
    expect(profile).toContain("(v_limits->>'maxMembers')::numeric<=8");
    expect(profile).toContain("(v_limits->>'maxCapturedRows')::numeric<=250000");
    expect(profile).toContain("(v_limits->>'maxOriginBundleBytes')::numeric<=268435456");
    expect(capture).toContain("v_max_rows := (v_profile->'limits'->>'maxCapturedRows')::integer");
    expect(capture).toContain("'executionProfileEnvelope',p_execution_profile_envelope");
    expect(capture).toContain("pg_catalog.to_jsonb(p_document_ids)=v_profile->'documentIds'");
    expect(capture).toContain("pg_catalog.to_jsonb(p_manual_alias_ids)=v_profile->'manualAliasIds'");
  });
  it("rejects ambiguous Node JSON before JSONB normalization",()=>{
    const node=routine(migration,"shadow_node_json_text_v1");
    expect(node).toContain("pg_catalog.json_each(p_value)");
    expect(node).toContain("v_order <= v_prior");
    expect(node).toContain("public.shadow_utf16_order_v1(v_item.key)");
    expect(node).toContain("if v_number = 0 then return '0'");
    expect(node).toContain("v_exponent >= -6 and v_exponent < 21");
  });
  it("retains native stored fields, arrays, search vectors and vector text",()=>{
    const rows=routine(migration,"shadow_capture_rows_v1");
    for(const field of ["description","file_size","metadata","created_at","updated_at","lease_expires_at","section_path","source_chunk_ids"])
      expect(rows).toContain(`'${field}', r.${field}`);
    expect(rows.match(/'embedding', r.embedding::text/g)).toHaveLength(4);
    expect(rows).toContain("'search_tsv', r.search_tsv::text");
    expect(rows).toContain("public.shadow_utf16_order_v1(r.word::text)");
    expect(rows).not.toMatch(/date_trunc|to_char|substring|left\(/);
  });
  it("captures batch siblings, contradictory stages, all events and disabled exact manual aliases",()=>{
    const rows=routine(migration,"shadow_capture_rows_v1");
    expect(rows).toContain("r.document_id=any(p_w) or r.batch_id in (select id from batches)");
    expect(rows).toContain("r.document_id=any(p_w) or r.job_id in (select id from jobs)");
    expect(rows).toContain("r.source_catalogue_key in (select key from catalogue)");
    expect(rows).toContain("r.metadata->>'document_id'=any(p_w::text[]) or r.id=any(p_m)");
    expect(rows).not.toMatch(/where[^\n]*r\.enabled/);
  });
  it("mirrors U03 authority without invoking its locking helper",()=>{
    const authority=routine(migration,"read_shadow_document_authority_v1");
    expect(authority).toContain("order by source_sequence desc limit 1");
    expect(authority).toContain("v_version.lifecycle not in ('shadow', 'approved')");
    expect(authority).toContain("public.public_source_acquisition_identity_digest(v_version.id)");
    expect(authority).toContain("Any public-source marker forbids");
    expect(authority).not.toContain("lock_ingestion_document_authority");
    expect(authority).not.toContain("for update");
  });
  it("requires full exact manual review membership and original row equality",()=>{
    const profile=routine(migration,"shadow_profile_capture_v1"),review=routine(migration,"shadow_manual_alias_review_v1"),capture=routine(migration,"capture_shadow_reindex_origin_v1_impl");
    expect(profile).toContain("pg_catalog.jsonb_array_length(v_profile->'manualAliasReviews')<>pg_catalog.jsonb_array_length(v_profile->'manualAliasIds')");
    expect(review).toContain("'kind','evidenceMode','target','aliasId','ownerId','rowDigest','rowEnvelope','producerIdentity','reviewer','basis','reviewText'");
    expect(review).toContain("pg_catalog.jsonb_array_length(v_review->'basis')>0");
    expect(review).toContain("v_review->'reviewer'->>'identity'<>v_review->>'producerIdentity'");
    expect(capture).toContain("v_document::text is distinct from v_policy->'rowEnvelope'->>'canonicalPayload'");
    expect(capture).not.toContain("shadow_manual_lineage_unavailable");
  });
  it("amends only consumed Node scheduling nullability while retaining its default",()=>{
    expect(migration).toContain("alter table public.ingestion_jobs alter column next_run_at drop not null;");
    const preconditionEnd=migration.indexOf("$u04_pages$;");
    const firstMutation=migration.search(/^(?:alter table|update public\.|create (?:table|unique index))/m);
    expect(preconditionEnd).toBeGreaterThan(migration.indexOf("raise exception 'shadow_page_generation_provenance_ambiguous'"));
    expect(firstMutation).toBeGreaterThan(preconditionEnd);
    expect(firstMutation).toBe(migration.indexOf("alter table public.ingestion_jobs alter column next_run_at drop not null;"));
    const start=schemaSource.indexOf("create table if not exists public.ingestion_jobs (");const end=schemaSource.indexOf(");",start);
    expect(schemaSource.slice(start,end)).toContain("next_run_at timestamptz default now()");
    expect(schemaSource.slice(start,end)).not.toContain("next_run_at timestamptz not null");
  });
  it("binds complete Node capture columns and controls to the actual stored plan digest",()=>{
    const source=readFileSync(new URL("../scripts/lib/reindex-eval-session.ts",import.meta.url),"utf8");
    const types=readFileSync(new URL("../src/lib/supabase/database.types.ts",import.meta.url),"utf8");
    const descriptor=source.match(/ingestion_jobs:\s*\{([^}]+)\}/)?.[1];
    const typedRow=types.match(/ingestion_jobs:\s*\{\s*Row:\s*\{([^}]+)\}/)?.[1];
    expect(descriptor).toBeDefined();expect(typedRow).toBeDefined();
    const descriptorColumns=Array.from((descriptor??"").matchAll(/"([a-z_]+)"\s*:/g),match=>match[1]).sort();
    const typedColumns=Array.from((typedRow??"").matchAll(/\b([a-z_]+):/g),match=>match[1]).sort();
    const rows=routine(migration,"shadow_capture_rows_v1");
    const nodeStart=rows.indexOf("select 'ingestion_jobs'::text as table_name");
    const nodeEnd=rows.indexOf("from public.ingestion_jobs r where",nodeStart);
    expect(nodeStart).toBeGreaterThanOrEqual(0);expect(nodeEnd).toBeGreaterThan(nodeStart);
    const sqlColumns=Array.from(rows.slice(nodeStart,nodeEnd).matchAll(/'([a-z_]+)', r\.([a-z_]+)/g),match=>{
      expect(match[1]).toBe(match[2]);return match[1];
    }).sort();
    expect(descriptorColumns).toEqual(typedColumns);expect(sqlColumns).toEqual(typedColumns);
    expect(typedRow).toContain("shadow_plan_digest: string | null");
    expect(migration).toContain("add column shadow_plan_digest text");
    expect(migration).toContain("shadow_plan_digest ~ '^sha256:[0-9a-f]{64}$'");
    for(const body of [source,rows,routine(migration,"shadow_capture_bytes_v1")])expect(body).not.toMatch(/shadow_plan_id|shadowPlanId/);
    expect(source).toMatch(/planDigest:\s*digestValue/);
  });
  it("does not return private JSON/numeric parser fragments through the capture entrypoint",()=>{
    const body=routine(migration,"capture_shadow_reindex_origin_v1_impl");
    expect(body).toContain("exception when others then");
    expect(body).toContain("raise exception 'invalid_shadow_capture' using errcode='22023'");
    expect(body).not.toMatch(/raise exception[^;]*%/);
  });
});

describe("U04 retention-safe persistence contracts (source only; no SQL execution)", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20260831102000_stage_shadow_document_generations.sql", import.meta.url), "utf8");
  const types = readFileSync(new URL("../src/lib/supabase/database.types.ts", import.meta.url), "utf8");
  const persistence = migration.slice(migration.indexOf("-- U04 fixed retention-safe persistence."));
  function effective(name: string) {
    const start = migration.lastIndexOf(`create or replace function public.${name}(`);
    expect(start, `Missing effective function ${name}`).toBeGreaterThanOrEqual(0);
    const end = migration.indexOf("$$;", start);
    expect(end).toBeGreaterThan(start);
    return migration.slice(start, end + 3);
  }
  const artifacts = ["document_pages", "document_chunks", "document_images", "document_table_facts", "document_embedding_fields", "document_index_units", "document_sections", "document_memory_cards"];
  const ledgers = ["shadow_reindex_waves", "document_index_generations", "document_generation_projections", "document_generation_inventory", "document_generation_baselines"];
  const tables = [...artifacts, ...ledgers, "documents", "document_index_quality", "document_labels", "document_summaries", "document_title_words", "ingestion_jobs", "indexing_v3_agent_jobs", "ingestion_job_stages", "import_batches", "rag_aliases", "public_source_versions", "public_source_activation_events", "public_source_serving_authority", "document_publication_approvals"].sort();

  it.each([
    ["enqueue_shadow_reindex_generation", ["p_plan", "p_baseline_evaluation", "p_recovery_evidence", "p_operation_manifest"]],
    ["write_shadow_generation_inventory", ["p_fence", "p_generation", "p_declarations", "p_dispositions"]],
    ["write_shadow_generation_pages", ["p_fence", "p_generation", "p_pages"]],
    ["persist_shadow_summary_projection", ["p_fence", "p_generation", "p_summary", "p_labels", "p_metadata", "p_output_manifest"]],
    ["persist_shadow_quality_projection", ["p_fence", "p_generation", "p_quality", "p_output_manifest"]],
    ["persist_shadow_deep_memory_projection", ["p_fence", "p_generation", "p_artifact_generation", "p_output_manifest", "p_request"]],
    ["persist_shadow_worker_projection", ["p_fence", "p_generation", "p_metadata", "p_counts", "p_output_manifest"]],
    ["validate_shadow_plan_v1", ["p_plan"]],
    ["validate_shadow_inventory_v1", ["p_declarations", "p_dispositions"]],
  ] as const)("binds %s to its actual fixed argument and generated type contract", (name, args) => {
    const sqlArgs = effective(name).split("\n")[0]!.match(/\b(p_[a-z_]+)\s+(?:jsonb|uuid)\b/g)?.map((item) => item.split(" ")[0]);
    expect(sqlArgs).toEqual([...args]);
    const start = types.indexOf(`      ${name}: {`);
    expect(start).toBeGreaterThanOrEqual(0);
    const typed = types.slice(start, types.indexOf("Returns:", start));
    expect(Array.from(typed.matchAll(/\b(p_[a-z_]+):/g), (match) => match[1])).toEqual([...args]);
  });

  it("keeps every new private helper ungranted and confined to fixed SQL", () => {
    const names = [...new Set(Array.from(persistence.matchAll(/create or replace function public\.((?:shadow_[a-z_0-9]+|validate_shadow_[a-z_0-9]+))\(/g), (match) => match[1]!))];
    expect(names.length).toBeGreaterThan(25);
    for (const name of names) {
      expect(effective(name)).toMatch(/set search_path\s*=\s*''/);
      expect(persistence).toMatch(new RegExp(`alter function public\\.${name}\\([^;]*\\) owner to postgres;`));
      expect(persistence).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^;]*\\) from public,\\s*anon,\\s*authenticated,\\s*service_role;`));
      expect(persistence).not.toMatch(new RegExp(`grant execute on function public\\.${name}\\(`));
    }
    expect(persistence).not.toMatch(/execute\s+format\s*\(|set_config\([^\n]*(?:role|shadow)/i);
  });

  it("grants only the seven completed shadow mutation entrypoints to service_role", () => {
    const entrypoints = [
      ["enqueue_shadow_reindex_generation", "jsonb,jsonb,jsonb,jsonb"],
      ["write_shadow_generation_inventory", "jsonb,uuid,jsonb,jsonb"],
      ["write_shadow_generation_pages", "jsonb,uuid,jsonb"],
      ["persist_shadow_summary_projection", "jsonb,uuid,jsonb,jsonb,jsonb,jsonb"],
      ["persist_shadow_quality_projection", "jsonb,uuid,jsonb,jsonb"],
      ["persist_shadow_deep_memory_projection", "jsonb,uuid,uuid,jsonb,jsonb"],
      ["persist_shadow_worker_projection", "jsonb,uuid,jsonb,jsonb,jsonb"],
    ] as const;
    expect(entrypoints).toHaveLength(7);
    for (const [name, signature] of entrypoints) {
      expect(effective(name)).toContain("security definer");
      expect(effective(name)).toContain("set search_path = ''");
      const revoke = `revoke all on function public.${name}(${signature}) from public,anon,authenticated,service_role;`;
      const grant = `grant execute on function public.${name}(${signature}) to service_role;`;
      expect(persistence.lastIndexOf(revoke)).toBeGreaterThanOrEqual(0);
      expect(persistence.lastIndexOf(grant)).toBeGreaterThan(persistence.lastIndexOf(revoke));
      const grants = (persistence.match(/grant execute on function public\.[^;]+;/g) ?? []).filter((item) =>
        item.includes(`public.${name}(`),
      );
      expect(grants).toEqual([grant]);
    }
  });

  it("keeps stamped C and D artifacts out of the effective legacy publication-state digest", () => {
    const predicates = [
      "from public.document_pages p where p.document_id = d.id and public.is_committed_document_generation(p.index_generation_id, d.index_generation_id)",
      "from public.document_images i where i.document_id = d.id and public.is_committed_artifact_generation(i.metadata, d.metadata)",
      "from public.document_memory_cards m where m.document_id = d.id and public.is_committed_artifact_generation(m.metadata, d.metadata)",
      "from public.document_chunks c where c.document_id = d.id and (public.is_committed_document_generation(c.index_generation_id, d.index_generation_id) or public.is_committed_artifact_generation(c.metadata, d.metadata))",
      "from public.document_table_facts f where f.document_id = d.id and public.is_committed_artifact_generation(f.metadata, d.metadata)",
    ];
    const bodies: string[] = [];
    for (const source of [migration, schemaSource]) {
      const start = source.lastIndexOf("create or replace function public.document_publication_state_digest(");
      expect(start).toBeGreaterThanOrEqual(0);
      const end = source.indexOf("$$;", start);
      expect(end).toBeGreaterThan(start);
      const body = source.slice(start, end + 3);
      for (const predicate of predicates) expect(body).toContain(predicate);
      expect(body).not.toContain(
        "nullif(coalesce(d.metadata, '{}'::jsonb)->>'index_generation_id', '') is null or",
      );
      bodies.push(body);
    }
    expect(bodies[1]).toBe(bodies[0]);

    const artifactHelperStart = schemaSource.lastIndexOf(
      "create or replace function public.is_committed_artifact_generation(\n  artifact_metadata jsonb",
    );
    const artifactHelper = schemaSource.slice(artifactHelperStart, schemaSource.indexOf("$$;", artifactHelperStart));
    expect(artifactHelper).toContain(
      "select nullif(coalesce(artifact_metadata, '{}'::jsonb)->>'index_generation_id', '') is null",
    );
    const documentHelperStart = schemaSource.lastIndexOf(
      "create or replace function public.is_committed_document_generation(\n  row_generation uuid,\n  document_generation uuid",
    );
    const documentHelper = schemaSource.slice(documentHelperStart, schemaSource.indexOf("$$;", documentHelperStart));
    expect(documentHelper).toContain("select row_generation is null");

    const baseWriter = effective("write_ingestion_base_artifacts");
    expect(
      baseWriter.match(
        /jsonb_build_object\('index_generation_id',p_generation,'ingestion_lease_token',p_fence->>'lease_token'/g,
      ),
    ).toHaveLength(5);
    const deepWriter = effective("persist_shadow_deep_memory_projection");
    expect(deepWriter).toContain(
      "update public.document_memory_cards set index_generation_id=p_generation,metadata=pg_catalog.jsonb_set(metadata,'{index_generation_id}',pg_catalog.to_jsonb(p_generation))",
    );
    expect(deepWriter).toContain("artifact_generation_id=p_artifact_generation");
  });

  it("keeps the producer-failure phase contract closed over every implemented failure point", () => {
    const expectedPhases = [
      "cache_lookup",
      "image_bytes",
      "image_classification",
      "section_context",
      "table_facts",
      "visual_index_units",
      "supplemental_embedding_fields",
      "enrichment_policy",
      "summary_generation",
      "document_embedding_fields",
      "chunk_embeddings",
      "deep_sections",
      "deep_model_profile",
      "deep_cards",
      "deep_card_embeddings",
      "deep_index_units",
      "deep_index_embeddings",
      "deep_persistence",
    ];
    const bodies: string[] = [];
    for (const source of [migration, schemaSource]) {
      const start = source.lastIndexOf("create or replace function public.record_shadow_producer_failure(");
      expect(start).toBeGreaterThanOrEqual(0);
      const end = source.indexOf("end $$;", start);
      expect(end).toBeGreaterThan(start);
      const body = source.slice(start, end + "end $$;".length);
      const phaseList = body.match(/v_payload->>'phase' in \(([^)]+)\)/);
      expect(phaseList).not.toBeNull();
      expect(Array.from(phaseList![1]!.matchAll(/'([^']+)'/g), (match) => match[1])).toEqual(expectedPhases);
      bodies.push(body);
    }
    expect(bodies[1]).toBe(bodies[0]);
  });

  it("takes all 27 literal relation barriers before reservation reads and effects", () => {
    const body = effective("enqueue_shadow_reindex_generation");
    const barrier = body.match(/lock table ([\s\S]+?) in share row exclusive mode nowait;/);
    expect(barrier).not.toBeNull();
    expect(Array.from(barrier![1]!.matchAll(/public\.([a-z_][a-z_0-9]*)/g), (match) => match[1])).toEqual(tables);
    const end = body.indexOf(" in share row exclusive mode nowait;");
    expect(end).toBeLessThan(body.indexOf("v_payload:=public.validate_shadow_plan_v1"));
    expect(end).toBeLessThan(body.indexOf("public.lock_ingestion_document_authority"));
    expect(body).toContain("current_setting('transaction_isolation')<>'read committed'");
    for (const name of ["write_shadow_generation_inventory", "write_shadow_generation_pages", "heartbeat_ingestion_job", "update_ingestion_job_progress"])
      expect(effective(name)).not.toMatch(/\block table\b/i);
  });

  it("checks the profile's lower lock limit before row locks without setting a late deadline", () => {
    const body = effective("enqueue_shadow_reindex_generation");
    expect(body).toContain("current_setting('statement_timeout')::interval)*1000 not between 1 and 15000");
    const limit = body.indexOf("(v_profile->'limits'->>'lockTimeoutMs')::numeric");
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThan(body.indexOf("public.lock_ingestion_document_authority"));
    expect(body).not.toMatch(/set_config|set local (?:lock|statement)_timeout/i);
  });

  it("requires original string timestamps and exact microseconds for audit observations", () => {
    const parser = effective("shadow_audit_micros_v1"), enqueue = effective("enqueue_shadow_reindex_generation");
    expect(parser).toContain("jsonb_typeof(p_value) is distinct from 'string'");
    expect(parser).toContain("[0-9]{1,6}");
    expect(parser).toContain("v_text ~ E'[\\n\\r]'");
    expect(parser).toContain("pg_catalog.substr(v_zone,2,2)");
    expect(parser).toContain("pg_catalog.substr(v_zone,4,2)");
    expect(parser).not.toContain("substring");
    for (const field of ["authorizedAt", "expiresAt"]) expect(enqueue).toContain(`shadow_audit_timestamp_v1(v_manifest->'${field}')`);
    for (const field of ["auditPreparedAt", "baselineCompletedAt", "recoveryCheckedAt"]) expect(enqueue).toContain(`shadow_audit_timestamp_v1(v_observations->'${field}')`);
    expect(effective("shadow_audit_timestamp_v1")).toContain("interval '1 microsecond'");
    expect(parser).not.toContain("shadow_recovery_timestamp_ms_v1");
  });

  it("keeps native recovery millisecond, elapsed-duration, UUID and trim semantics distinct", () => {
    const recovery = effective("shadow_validate_recovery_v1"), clock = effective("shadow_recovery_timestamp_ms_v1");
    expect(migration).not.toMatch(/(?:is distinct from|>)\s*case\b/i);
    expect(recovery).toContain("if p_project is null");
    expect(recovery).toContain("jsonb_typeof(v->'restoreDrill'->'targetProjectRef') is distinct from 'string'");
    expect(recovery).toContain("00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff");
    for (const duration of ["300000", "86400000", "604800000", "7776000000"]) expect(recovery).toContain(duration);
    expect(recovery).not.toMatch(/interval\s+'(?:7|90) days'/);
    expect(clock).toContain("pg_catalog.left(coalesce(v_match[9],''),3)");
    for (const code of [9, 13, 160, 5760, 8232, 8233, 12288, 65279]) expect(effective("shadow_ecmascript_trim_v1")).toContain(`pg_catalog.chr(${code})`);
  });

  it("retains full PostgreSQL bundle text and all four independent original parameter envelopes", () => {
    const body = effective("enqueue_shadow_reindex_generation"), bundle = effective("shadow_pg_bundle_v1");
    expect(bundle).toContain("p_domain is null");
    expect(bundle).toContain("p_payload::text");
    expect(bundle).toContain("pg-jsonb-text-v1");
    for (const parameter of ["p_plan", "p_baseline_evaluation", "p_recovery_evidence", "p_operation_manifest"]) expect(body).toContain(`'${parameter}',${parameter}`);
    expect(body).toContain("v_recovery->'rawDigest' is distinct from v_manifest->'recoveryEvidenceSha256'");
    expect(body).toContain("v_recovery->'evidence'->>'digest'");
    expect(body).toContain("v_payload->'audit'->'p04ReportEnvelope'->'digest'");
    expect(body).toContain("v_current-'capturedAt' is distinct from v_origin-'capturedAt'");
  });

  it("retains complete image bytes against captured worker hashes, not just self-consistent references", () => {
    const original = effective("shadow_validate_original_objects_v1"), final = effective("shadow_reconcile_final_disposition_v1");
    expect(original).toContain("image_hash");
    expect(original).toContain("jsonb_typeof(v_entry->'representation') is distinct from 'string'");
    expect(effective("shadow_candidate_image_attachment_v1")).toContain("v_row->'metadata'->'image_hash' is distinct from v_row->'image_hash'");
    expect(effective("shadow_candidate_image_attachment_v1")).toContain("row_payload->'storage_path'=p_ref->'objectPath'");
    expect(final).toContain("pg_catalog.octet_length(v_bytes)");
    expect(final).toContain("public.shadow_node_value_text_v1(v_ref)");
    expect(final).toContain("public.shadow_candidate_image_attachment_v1(p_member,v_ref)");
  });

  it("replays a complete reservation without resetting or recreating its member rows", () => {
    const body = effective("enqueue_shadow_reindex_generation");
    const replay = body.slice(body.indexOf("select * into v_existing"), body.indexOf("if exists(select 1 from public.shadow_reindex_waves where candidate_generation_id"));
    expect(replay).toContain("bundle_payload=v_bundle");
    expect(replay).toContain("v_existing.plan_payload is distinct from p_plan");
    expect(replay).toContain("'kind','existing_reservation'");
    expect(replay).not.toMatch(/\b(?:insert into|update public\.|delete from)\b/);
    expect(body).toContain("insert into public.document_generation_baselines");
    expect(body).toContain("public.shadow_pending_manifest_v1");
  });

  it("preserves standard claim randomness while permitting only the first reserved shadow claim", () => {
    const body = effective("claim_ingestion_jobs");
    expect(body).toContain("case when v_shadow then v_member.index_generation_id else gen_random_uuid() end");
    expect(body).toContain("v_job.lease_token is not null");
    expect(body).toContain("first_lease_token=v_job.lease_token");
    expect(body).toContain("control_snapshot=public.shadow_control_snapshot_v1(v_job.id,v_member.control_revision+1)");
    expect(body).toContain("state='reserved' and first_lease_token is null");
  });

  it("requires the caller revision and full checkpoint before any append effect", () => {
    const parser = effective("validate_shadow_inventory_v1"), writer = effective("write_shadow_generation_inventory");
    expect(parser).toContain("array['version','expectedControlRevision','groups','units']");
    expect(parser).toContain("not between 0 and 9007199254740991");
    expect(writer).toContain("shadow_assert_attempt_v1(p_fence,p_generation,(p_declarations->>'expectedControlRevision')::bigint)");
    expect(writer.indexOf("shadow_assert_attempt_v1")).toBeLessThan(writer.indexOf("insert into public.document_generation_inventory"));
    expect(effective("shadow_assert_attempt_v1")).toContain("p_revision is not null and v_member.control_revision<>p_revision");
    expect(effective("shadow_assert_attempt_v1")).toContain("control_snapshot is distinct from public.shadow_control_snapshot_v1");
  });

  it("retains a complete output envelope and basis even for a zero-unit slot", () => {
    const declaration = effective("shadow_validate_producer_declaration_v1"), batch = effective("shadow_validate_planned_batch_v1");
    expect(declaration).toContain("array['firstLeaseToken','producer','artifactGenerationId','population','outputManifestEnvelope']");
    expect(declaration).toContain("p_declaration->'producer'->>'outputManifestDigest' is distinct from p_declaration->'outputManifestEnvelope'->>'digest'");
    expect(batch).toContain("array['producer','producerVersion','binding','units']");
    expect(batch).toContain("v_payload->'binding' is distinct from p_source_binding");
    expect(batch).toContain("pg_catalog.jsonb_array_length(p_declaration->'population'->'basis')=0");
    expect(batch).toContain("shadow_partial_output_cannot_be_unavailable");
    expect(effective("shadow_generation_manifest_shape")).toContain("outputManifestEnvelope");
  });

  it("keeps all 18 families and 19 fixed slots in canonical order", () => {
    const shape = effective("shadow_generation_manifest_shape");
    const text = shape.match(/v_slots constant jsonb := '([^']+)'::jsonb/)?.[1];
    expect(text).toBeDefined();
    const slots: { family: string; groups: { groupKey: string }[] }[] = JSON.parse(text!);
    expect(slots).toHaveLength(18);
    expect(slots.flatMap((family) => family.groups)).toHaveLength(19);
    expect(slots.find((family) => family.family === "index_units")?.groups.map((group) => group.groupKey)).toEqual(["worker_core", "deep_memory"]);
    expect(shape).toContain("order by public.shadow_utf16_order_v1(value->>'family') offset v_i limit 1");
  });

  it("rejects missing, duplicate or same-count substituted planned unit identities", () => {
    const writer = effective("write_shadow_generation_inventory"), parser = effective("validate_shadow_inventory_v1");
    expect(writer).toContain("v_expected is distinct from v_supplied");
    expect(writer).toContain("shadow_ambiguous_unit_producer");
    expect(parser).toContain("v_identity<=v_prior");
    expect(writer).toContain("v_unit->'sourceBinding' is distinct from v_view");
    expect(writer).toContain("v_unit->'required' is distinct from pg_catalog.to_jsonb(v_required)");
  });

  it("preflights all outcomes and append ceilings before any inventory insert", () => {
    const body = effective("write_shadow_generation_inventory");
    for (const check of ["v_count>least(2000", "v_bytes>least(16777216", "perform public.shadow_validate_final_disposition_v1"])
      expect(body.indexOf(check)).toBeLessThan(body.indexOf("insert into public.document_generation_inventory"));
    expect(body).toContain("maxAppendRows");
    expect(body).toContain("maxAppendBytes");
    expect(effective("validate_shadow_inventory_v1")).toContain("('retained','failed','skipped','excluded','not_required')");
    expect(effective("validate_shadow_inventory_v1")).not.toContain("'pending'");
  });

  it("freezes the last-slot digest from persisted full declarations in the same manifest update", () => {
    const body = effective("write_shadow_generation_inventory");
    const insert = body.indexOf("insert into public.document_generation_inventory");
    const digest = body.indexOf("v_digest:=public.shadow_pg_bundle_v1");
    const update = body.indexOf("update public.document_index_generations set inventory_manifest");
    expect(insert).toBeLessThan(digest); expect(digest).toBeLessThan(update);
    expect(body.match(/update public\.document_index_generations set inventory_manifest/g)).toHaveLength(1);
    expect(body).toContain("'manifest',v_manifest,'declarations',v_frozen");
    expect(body).toContain("v_member.expected_inventory_digest is null");
    expect(body).toContain("if v_changed then perform public.shadow_checkpoint_advance_v1");
    expect(body).toContain("else 'unchanged' end");
  });

  it("finalizes only pending units and compares the complete finalized retransmission", () => {
    const finalizer = effective("shadow_finalize_inventory_unit_v1"), ledger = effective("shadow_ledger_guard_v1");
    expect(finalizer).toContain("public.shadow_inventory_outcome_v1(v_unit) is distinct from p_outcome");
    expect(finalizer).toContain("and disposition='pending'");
    expect(finalizer).toContain("return false");
    expect(ledger).toContain("old.disposition<>'pending' or new.disposition='pending'");
    expect(ledger).toContain("'reason_code','limitations','artifact_ref','content_digest','relationships'");
  });

  it("reconciles final candidate rows through fixed core and deep writer contracts", () => {
    const body = effective("shadow_reconcile_final_disposition_v1");
    const originalCheck = body.indexOf("v_native is distinct from v_planned");
    const deepMatch = body.indexOf("public.shadow_deep_row_matches_v1(p_member,v_family,p_outcome->>'unitKey',v_row) is not true");
    const coreMatch = body.indexOf("public.shadow_core_row_matches_v1(p_member,v_family,v_native,v_row) is not true");
    expect(originalCheck).toBeGreaterThan(0);
    expect(deepMatch).toBeGreaterThan(originalCheck); expect(coreMatch).toBeGreaterThan(originalCheck);
    expect(body).toContain("when v_d is not null then public.shadow_deep_row_key_v1(p_member,v_family,v_row)");
    expect(body).toContain("v_native is distinct from v_planned");
    expect(body).not.toContain("v_native:=pg_catalog.jsonb_set");
    expect(body).not.toContain("v_native is distinct from v_row");
    expect(body).toContain("v_row->>'producer' is distinct from 'local-worker'");
    expect(body).toContain("v_row->'metadata'->>'artifact_generation_id' is distinct from v_d::text");
    expect(body).toContain("shadow_capture_envelope_v1(v_row)->>'digest'");
    const deep = effective("shadow_deep_row_matches_v1"), native = effective("shadow_deep_native_v1");
    expect(deep.indexOf("public.shadow_deep_native_v1(p_member,v_d,p_family,v_output)")).toBeLessThan(deep.indexOf("v_native:=v_native||"));
    expect(native).toContain("v_native->>'index_generation_id' is distinct from p_artifact::text");
    expect(native).toContain("v_native->'metadata'->>'index_generation_id' is distinct from p_artifact::text");
    expect(deep).toContain("v_expected-'search_tsv'=p_row-'search_tsv'");
    const key = effective("shadow_deep_row_key_v1");
    expect(key).toContain("v_count<>1");
    expect(key).toContain("shadow_deep_row_original_ambiguous");
  });

  it("preserves complete core after-images while allowing only fixed generated columns and declared anchor repair", () => {
    const body = effective("shadow_core_row_matches_v1");
    expect(body).toContain("v_input:=public.shadow_native_rpc_input_v1(p_output)");
    expect(body).toContain("not public.shadow_keys_v1(p_row,v_all)");
    expect(body).toContain("v_expected=p_row-v_generated");
    expect(body).toContain("public.shadow_candidate_anchor_update_v1(p_member,v_expected,p_row)");
    expect(body).toContain("exception when others then return false");
    for (const family of ["chunks", "images", "table_facts", "embedding_fields", "index_units"])
      expect(body).toContain(`when '${family}' then`);
    expect(body).toContain("((v_value->>'embedding')::extensions.vector)::text");
  });

  it("resolves only exact producer-owned projection items against immutable component evidence", () => {
    const body = effective("shadow_projection_disposition_v1");
    expect(effective("shadow_reconcile_final_disposition_v1")).toContain("public.shadow_projection_disposition_v1(p_member,v_declaration,p_outcome)");
    expect(body).toContain("v_original is distinct from v_planned");
    expect(body).toContain("v_count<>1");
    expect(body).toContain("v_row.owner_id is distinct from p_member.owner_id");
    expect(body).toContain("v_row.lease_token is distinct from p_member.first_lease_token");
    expect(body).toContain("v_row.sealed_at is not null");
    expect(body).toContain("when 'document_metadata' then 'worker_metadata'");
    expect(body).toContain("'deep:'||(v_ordinal-1)::text");
    expect(body).toContain("pg_catalog.jsonb_build_object('label',v_payload->'label','label_type',v_payload->'label_type')");
    expect(body).toContain("public.shadow_pg_bundle_v1(v_component,'projection')->>'digest' is distinct from v_component_digest");
    expect(body).toContain("public.shadow_pg_bundle_v1(v_payload,'projection')->>'digest'");
    expect(body).toContain("v_ref->>'payloadDigest' is distinct from v_digest");
    expect(body).not.toMatch(/update public\.|insert into|delete from|stage_document_index_generation/);
  });

  it("retains exact relationship field positions and same-source declared targets without claiming seal", () => {
    const body = effective("shadow_inventory_relationships_v1");
    expect(body).toContain("pg_catalog.jsonb_build_array(v_index)");
    expect(effective("shadow_validate_inventory_relationships_v1")).toContain("v_expected is distinct from v_actual");
    expect(body).toContain("shadow_relationship_target_undeclared");
    expect(body).toContain("'source',p_member.source_binding");
    expect(body).toContain("'firstLeaseToken',p_member.first_lease_token");
    expect(body).toContain("shadow_payload_relationship_semantics_unavailable");
    expect(body).toContain("Seal must later resolve");
    expect(body).toContain("in ('candidate_row','candidate_projection')");
    expect(body).toContain('"path":["cover_image_id"],"tag":"source_image"');
    expect(body).toContain('"path":["metadata","pages"],"tag":"page"');
    expect(body).toContain(`v_spec->'path'='["metadata","pages"]'::jsonb and p_outcome->>'family'<>'generated_labels'`);
    expect(body).toContain(`v_spec->'path'='["cover_image_id"]'::jsonb and p_outcome->>'family'<>'document_metadata'`);
    expect(body).toContain("public.shadow_deep_row_key_v1(p_member,'sections',v_output)");
    expect(body).toContain("shadow_section_relationship_unavailable");
    expect(body).toContain("if p_outcome->>'family'='summary' then");
    expect(body).toContain(`v_prefix:='["metadata","source_anchored_summary_v1"]'::jsonb`);
    expect(body).toContain("pg_catalog.jsonb_build_array('clinical_specifics','profile',v_profile_key,v_claim_index)");
    expect(body).toContain("for v_spec in select value from pg_catalog.jsonb_array_elements(v_specs)");
    expect(body).toContain("'required_forms_documentation','not_covered','important_tables_images','best_questions','source_quality_notes'");
  });

  it("derives retained outcomes and forces complete fresh reconciliation before finalization", () => {
    const builder=effective("shadow_finalize_retained_inventory_v1");
    const reconcile=effective("shadow_reconcile_final_disposition_v1");
    const replay=effective("shadow_validate_final_disposition_v1");
    expect(builder).toContain("p_member.control_snapshot is distinct from public.shadow_control_snapshot_v1");
    expect(builder).toContain("public.shadow_validate_projection_components_v1(p_member,v_projection)");
    expect(builder).toContain("v_job.status<>'processing'");
    expect(builder).toContain("v_job.lease_expires_at<=pg_catalog.clock_timestamp()");
    expect(builder.indexOf("shadow_final_attempt_not_current")).toBeLessThan(builder.indexOf("if v_unit.disposition<>'pending' then"));
    expect(builder).toContain("'disposition','retained'");
    expect(builder).not.toContain("'disposition','skipped'");
    expect(builder).not.toContain("'disposition','failed'");
    expect(builder).toContain("shadow_final_candidate_population");
    expect(builder).toContain("shadow_final_projection_population");
    expect(builder).toContain("public.shadow_inventory_relationships_v1(p_member,p_member.inventory_manifest,v_outcome,v_payload)");
    expect(builder.match(/perform public\.shadow_reconcile_final_disposition_v1/g)).toHaveLength(2);
    expect(builder.lastIndexOf("perform public.shadow_reconcile_final_disposition_v1")).toBeLessThan(
      builder.indexOf("perform public.shadow_finalize_inventory_unit_v1"));
    expect(reconcile).not.toContain("v_unit.disposition<>'pending'");
    expect(replay).toContain("public.shadow_inventory_outcome_v1(v_unit) is distinct from p_outcome");
    expect(replay).toContain("perform public.shadow_reconcile_final_disposition_v1(p_member,p_manifest,p_outcome)");
    const relationships=effective("shadow_inventory_relationships_v1");
    expect(relationships).toContain("return v_sorted");
    expect(effective("shadow_validate_inventory_relationships_v1")).toContain(
      "v_expected:=public.shadow_inventory_relationships_v1(p_member,p_manifest,p_outcome,p_payload)");
    expect(effective("shadow_pg_bundle_v1")).toContain(
      "p_domain not in ('baseline','inventory','control','projection','member_receipt','wave_receipt','evaluation_report')",
    );
    for(const name of ["shadow_finalize_retained_inventory_v1","shadow_reconcile_final_disposition_v1","shadow_inventory_relationships_v1"]){
      expect(schemaSource).toContain(`create or replace function public.${name}`);
      expect(migration).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^;]+from public,anon,authenticated,service_role;`));
      expect(migration).not.toMatch(new RegExp(`grant execute on function public\\.${name}\\(`));
    }
  });

  it("admits native and cache retained payloads only through their full producer contracts", () => {
    const capture = effective("shadow_producer_capture_v1");
    const native = effective("shadow_native_structure_payload_v1");
    const cache = effective("shadow_cache_input_payload_v1");
    const classification = effective("shadow_image_classification_v1");
    const final = effective("shadow_reconcile_final_disposition_v1");
    const relationships = effective("shadow_inventory_relationships_v1");

    expect(capture).toContain("public.shadow_node_payload_v1(p_envelope,'u04-retained-evidence-v1')");
    expect(capture).toContain("array['input','ownUndefinedPaths']");
    expect(capture).toContain("v_current ? (v_component#>>'{}')");
    expect(capture).toContain("v_current->(v_index::integer) is distinct from 'null'::jsonb");
    expect(capture).toContain('(v_sort collate "C")<=(v_previous_sort collate "C")');

    expect(native).toContain("v_native_batch->'units'->0->>'key'<>'extracted-document'");
    expect(native).toContain("v_page_output->'extractedPage' is distinct from v_page");
    expect(native).toContain("pg_catalog.jsonb_array_length(v_input->'imageBytes')<>pg_catalog.jsonb_array_length(v_extracted->'images')");
    expect(native).toContain("v_bytes->'path' is distinct from v_image->'path'");
    expect(native).toContain("pg_catalog.decode(v_bytes->>'content','base64')");
    expect(native).toContain("not public.shadow_native_undefined_path_v1(a.value)");

    expect(cache).toContain("array['task','classification','classificationCacheHit','ownerId','model']");
    expect(cache).toContain("v_task->>'index' is distinct from p_unit_key");
    expect(cache).toContain("v_candidate->'originalIndex' is distinct from v_task->'index'");
    expect(cache).toContain("v_input->'ownerId' is distinct from coalesce(pg_catalog.to_jsonb(p_member.owner_id),'null'::jsonb)");
    expect(cache).toContain("public.shadow_image_classification_v1(v_input->'classification')");
    expect(cache).toContain("not public.shadow_cache_undefined_path_v1(a.value)");
    expect(cache).toContain("(v_candidate ? 'nearbyText')=(v_task ? 'nearbyText')");
    expect(cache).toContain("v_native_image:=v_native_capture->'input'->'extracted'->'images'->(v_index::integer)");
    expect(cache).toContain("extensions.digest(pg_catalog.decode(v_native_bytes->>'content','base64'),'sha256')");
    expect(cache).toContain("shadow_worker_metadata_string_v1(v_metadata,'table_text')");
    expect(classification).toContain("(p_value->>'clinical_signal_score')::numeric between 0 and 10");
    expect(classification).toContain("public.shadow_visual_profile_v1(p_value->'structured_visual_profile')");

    expect(final).toContain("v_group<>'worker_native'");
    expect(final).toContain("v_group<>'cache'");
    expect(final).toContain("v_unit.source_binding is distinct from public.shadow_projection_binding_v1(p_member,null)");
    expect(final).toContain("public.shadow_native_structure_payload_v1(p_member,p_manifest,v_declaration,v_planned)");
    expect(final).toContain("public.shadow_cache_input_payload_v1(p_member,p_manifest,v_declaration,p_outcome->>'unitKey',v_planned)");
    expect(final).toContain("shadow_required_cache_input_not_retained");

    expect(relationships).toContain("p_outcome->>'family'='native_structure'");
    expect(relationships).toContain("pg_catalog.jsonb_build_array('input','task','image','path')");
    expect(relationships).toContain("pg_catalog.jsonb_build_object('family','native_structure','key','extracted-document')");
    expect(relationships).toContain("v_target_group<>'worker_native'");
    expect(relationships).toContain("Complete bytes alone do not grant semantics to an unimplemented owner");
    for (const functionName of [
      "shadow_producer_capture_v1",
      "shadow_native_undefined_path_v1",
      "shadow_visual_undefined_field_v1",
      "shadow_cache_undefined_path_v1",
      "shadow_native_structure_payload_v1",
      "shadow_cache_input_payload_v1",
      "shadow_worker_metadata_string_v1",
      "shadow_worker_metadata_number_v1",
      "shadow_visual_profile_v1",
      "shadow_image_classification_v1",
    ]) {
      expect(schemaSource).toContain(`create or replace function public.${functionName}`);
      expect(schemaSource).toContain(`revoke all on function public.${functionName}`);
    }
  });

  it("binds control first-write and repair final semantics without enabling terminal acceptance", () => {
    const initial = effective("shadow_initial_control_capture_v1");
    const control = effective("shadow_attempt_control_payload_v1");
    const repair = effective("shadow_repair_audit_payload_v1");
    const writer = effective("write_shadow_generation_inventory");
    const final = effective("shadow_reconcile_final_disposition_v1");
    const relationships = effective("shadow_inventory_relationships_v1");

    expect(initial).toContain("v_capture->'input' is distinct from p_member.control_snapshot");
    expect(writer).toContain("if v_slot_changed then");
    expect(writer).toContain("public.shadow_initial_control_capture_v1(v_member,v_declaration)");
    expect(writer.indexOf("public.shadow_initial_control_capture_v1(v_member,v_declaration)")).toBeLessThan(
      writer.indexOf("v_manifest:=pg_catalog.jsonb_set"),
    );
    expect(control).toContain("(v_checkpoint->>'controlRevision')::numeric>p_member.control_revision");
    expect(control).toContain("v_initial_job-array['stage','progress','locked_at','lease_expires_at','updated_at']");
    expect(control).toContain("v_stage->>'job_kind'<>'node'");
    expect(control).toContain("v_stage->'index_generation_id' is distinct from coalesce(pg_catalog.to_jsonb(p_member.baseline_generation_id),'null'::jsonb)");

    expect(repair).toContain("array['input','optionalIndexWriteIssues','decision']");
    expect(repair).toContain("v_issue-array['stage','message','code']='{}'::jsonb");
    expect(repair).toContain("v_input->'optionalIssueCount' is distinct from pg_catalog.to_jsonb(pg_catalog.jsonb_array_length(v_issues))");
    expect(repair).toContain("v_decision is distinct from v_expected");
    expect(repair).toContain("public.shadow_validate_projection_components_v1(p_member,v_projection)");
    expect(repair).toContain("v_issues is distinct from v_quality->'metrics'->'optional_index_write_issues'");
    expect(repair).toContain("v_issues is distinct from v_metadata->'optional_index_write_issues'");
    expect(final).toContain("p_outcome->>'family' in ('attempt_control','repair_audit_inputs')");
    expect(final).toContain("shadow_required_retained_input_not_retained");
    expect(final).toContain("v_ref->>'representation'<>'control_checkpoint'");
    expect(final).toContain("v_ref->>'representation'<>'repair_audit_input'");
    expect(relationships).toContain("p_outcome->>'family' in ('attempt_control','repair_audit_inputs')");
    expect(migration).not.toContain("v_ref->>'tag'='origin_row' and p_outcome->>'family'='attempt_control'");
    for (const functionName of ["shadow_initial_control_capture_v1", "shadow_attempt_control_payload_v1", "shadow_repair_audit_payload_v1"]) {
      expect(schemaSource).toContain(`create or replace function public.${functionName}`);
      expect(schemaSource).toContain(`revoke all on function public.${functionName}`);
    }
    expect(migration).toContain("shadow_terminal_semantics_unavailable");
  });

  it("matches native page population and JavaScript cache normalization exactly", () => {
    const native = effective("shadow_native_structure_payload_v1");
    const cache = effective("shadow_cache_input_payload_v1");
    const metadataString = effective("shadow_worker_metadata_string_v1");
    const metadataNumber = effective("shadow_worker_metadata_number_v1");
    const collapse = effective("shadow_ecmascript_collapse_v1");
    const slice = effective("shadow_utf16_slice_v1");
    const compact = effective("shadow_worker_compact_text_v1");

    expect(native).toContain("count(distinct value->'pageNumber')");
    expect(cache).toContain("v_image->'pageNumber'='null'::jsonb");
    expect(cache).toContain("v_candidate->'nearbyText'='null'::jsonb and not(v_task?'nearbyText')");
    expect(cache).toContain(`v_capture->'ownUndefinedPaths' @> '[["task","nearbyText"]]'::jsonb`);
    expect(metadataString).toContain("public.shadow_ecmascript_trim_v1(p_metadata->>p_key)");
    expect(metadataNumber).toContain("public.shadow_ecmascript_trim_v1(v_value#>>'{}')");
    expect(collapse).toContain("pg_catalog.chr(65279)");
    expect(collapse).toContain("pg_catalog.regexp_replace(p_text,'['||v_space||']+',' ','g')");
    expect(slice).toContain("pg_catalog.octet_length(public.shadow_utf16_order_v1(v_character))/2");
    expect(compact).toContain("public.shadow_utf16_slice_v1(v_compact,p_limit-3)");
    expect(cache).toContain("public.shadow_worker_compact_text_v1(v_table_text,1200)");
    for (const functionName of ["shadow_ecmascript_collapse_v1", "shadow_utf16_slice_v1", "shadow_worker_compact_text_v1"]) {
      expect(schemaSource).toContain(`create or replace function public.${functionName}`);
      expect(schemaSource).toContain(`revoke all on function public.${functionName}`);
    }
  });

  it("preserves baseline-null page rows by captured identity and checks both candidate images", () => {
    const body = effective("shadow_artifact_retention_guard_v1");
    expect(body).toContain("(e->>'canonicalPayload')::jsonb->'id'=v_old->'id'");
    expect(body).toContain("(e->>'canonicalPayload')::jsonb->'id'=v_new->'id'");
    expect(body).toContain("(v_old->>'document_id')::uuid");
    expect(body).toContain("v_row_id:=case when tg_table_name='document_pages' then v_new->>'page_number'");
    expect(body).toContain(
      "when tg_table_name in ('document_sections','document_memory_cards','document_index_units') and v_new->'artifact_generation_id'<>'null'::jsonb",
    );
    expect(body).toContain("then public.shadow_deep_row_key_v1(v_member,v_family,v_new) else v_new->>'id' end;");
  });

  it("checks the effective invoker before locking private SELECT-only rows", () => {
    for (const name of ["shadow_artifact_retention_guard_v1", "shadow_parent_retention_guard_v1"]) {
      const body = effective(name);
      expect(body).not.toContain("security definer");
      expect(body.indexOf("if current_user<>'postgres'")).toBeLessThan(body.indexOf("for update nowait"));
    }
    const stages = effective("shadow_parent_retention_guard_v1");
    expect(stages).toContain("(v_old->>'job_kind'='node' and job_id=(v_old->>'job_id')::uuid) or (v_new->>'job_kind'='node' and job_id=(v_new->>'job_id')::uuid)");
    expect(stages).toContain("v_old->'job_id' is distinct from v_new->'job_id'");
  });

  it("guards all eight artifact and five private-ledger row and TRUNCATE paths", () => {
    for (const table of artifacts) {
      expect(migration).toContain(`before insert or update or delete on public.${table} for each row execute function public.shadow_artifact_retention_guard_v1()`);
      expect(migration).toContain(`before truncate on public.${table} for each statement execute function public.shadow_artifact_retention_guard_v1()`);
    }
    for (const table of ledgers) {
      expect(migration).toContain(`before insert or update or delete on public.${table} for each row execute function public.shadow_ledger_guard_v1()`);
      expect(migration).toContain(`before truncate on public.${table} for each statement execute function public.shadow_ledger_guard_v1()`);
    }
    const ledger = effective("shadow_ledger_guard_v1");
    expect(ledger).toContain("shadow_terminal_semantics_unavailable");
    expect(ledger).toContain("shadow_projection_attempt_invalid");
    expect(ledger).toContain("shadow_projection_identity_immutable");
    expect(ledger).toContain("shadow_projection_seal_invalid");
    expect(ledger).toContain("shadow_projection_single_component_required");
    expect(ledger).not.toContain("shadow_projection_semantics_unavailable");
  });

  it("excludes retained generations and exact original rows in every cleanup phase", () => {
    const body = effective("cleanup_abandoned_document_index_generations");
    expect(body.match(/not public\.shadow_generation_retained_v1\(/g)).toHaveLength(21);
    expect(body.match(/original_origin_envelope/g)).toHaveLength(21);
    expect(body).toMatch(/security\s+definer\s+set\s+search_path\s*=\s*''/);
    const synchronization = body.indexOf("public.lock_ingestion_document_authority");
    expect(synchronization).toBeGreaterThan(0);
    expect(synchronization).toBeLessThan(body.indexOf("delete from public.document_"));
    const deletion = effective("delete_document_if_idle");
    expect(deletion.indexOf("retained_shadow_generation")).toBeLessThan(deletion.indexOf("insert into public.storage_cleanup_jobs"));
  });

  it("refuses ordinary live mutation for a persisted shadow operation before effects", () => {
    for (const name of ["persist_ingestion_summary_projection", "patch_ingestion_document_state", "reset_ingestion_attempt_artifacts", "persist_ingestion_index_quality", "commit_document_index_generation", "persist_ingestion_image_caption_cache", "complete_ingestion_job", "complete_strict_enrichment_job", "cleanup_ingestion_deep_memory_staging", "commit_document_deep_memory_generation"]) {
      const body = effective(name);
      const guard = body.indexOf("perform public.shadow_assert_standard_job_v1(p_fence)");
      const effect = body.search(/\b(?:insert into|update public\.|delete from)\b/);
      expect(guard, name).toBeGreaterThanOrEqual(0); expect(guard, name).toBeLessThan(effect);
    }
    const pages = effective("commit_document_index_generation");
    expect(pages).toContain("delete from public.document_pages where document_id=v_document_id and index_generation_id=p_generation;");
    expect(pages).toContain("v_next := p_fence || jsonb_build_object('expected_generation_id',p_generation)");
  });

  it("fails shadow attempts without retry, clears locks, and preserves exact UTF-16 error bounds", () => {
    const body = effective("fail_or_retry_ingestion_job");
    const shadow = body.slice(body.indexOf("if public.shadow_control_before_v1"), body.indexOf("return jsonb_build_object('ok',true,'retry',false)") + 59);
    expect(shadow).toContain("p_error_message is null or pg_catalog.length(p_error_message)=0");
    expect(shadow).toContain("pg_catalog.octet_length(public.shadow_utf16_order_v1(p_error_message))/2>65536");
    expect(shadow).toContain("locked_by=null,locked_at=null");
    expect(shadow).toContain("next_run_at=null");
    expect(shadow).toContain("p_retry is distinct from false");
    const update = shadow.match(/update public\.ingestion_jobs\s+set\s+([\s\S]*?)\s+where\s+([^;]+);/);
    expect(update).not.toBeNull();
    expect(update![1]).not.toMatch(/\blease_token\s*=/);
    expect(update![2]).toContain("lease_token=(p_fence->>'lease_token')::uuid");
    expect(shadow.indexOf("invalid_shadow_error_message")).toBeLessThan(shadow.indexOf("update public.ingestion_jobs"));
  });

  it("writes only declared C page ordinals and cannot commit live or seal early", () => {
    const body = effective("write_shadow_generation_pages");
    expect(body).toContain("i.family='pages' and i.unit_key=v_page->>'page_number'");
    expect(body).toContain("i.disposition='pending'");
    expect(body).toContain("insert into public.document_pages(document_id,index_generation_id,page_number,text,ocr_used,metadata)");
    expect(body).toContain("old.index_generation_id=p_generation");
    expect(body).toContain("shadow_page_changed");
    expect(body).not.toMatch(/delete from|update public\.documents|stage_document_index_generation|expected_generation_id.*p_generation/);
  });

  it("reconciles original worker page input and full ExtractedPage separately from the server row", () => {
    const page = effective("shadow_page_producer_input_v1"), writer = effective("write_shadow_generation_pages"), final = effective("shadow_reconcile_final_disposition_v1");
    expect(page).toContain("array['input','extractedPage']");
    expect(page).toContain("array['document_id','page_number','text','ocr_used','metadata']");
    expect(page).toContain("v_native-array['pageNumber','text','ocrUsed','needsOcr']<>'{}'::jsonb");
    expect(page).toContain("v_native ? v_key and pg_catalog.jsonb_typeof(v_native->v_key) is distinct from 'boolean'");
    expect(page).toContain("v_input->'ocr_used' is distinct from coalesce(v_native->'ocrUsed','false'::jsonb)");
    expect(page).not.toMatch(/gen_random_uuid|clock_timestamp|jsonb_set\(v_native/);
    expect(writer).toContain("shadow_page_producer_input_v1(v_output,v_member.document_id) is distinct from v_page");
    expect(final).toContain("v_native is distinct from v_planned");
    expect(final).toContain("v_row->'metadata' is distinct from v_page_input->'metadata'||pg_catalog.jsonb_build_object");
    expect(final).toContain("shadow_capture_envelope_v1(v_row)->>'digest'");
    expect(final).toContain("shadow_audit_timestamp_v1(v_row->'created_at')");
  });

  it("serializes D declaration and all OLD/NEW artifact writers in the same fixed namespace", () => {
    const reserve = effective("shadow_reserve_producer_d_v1"), trigger = effective("shadow_artifact_retention_guard_v1");
    const namespace = "pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('u04-artifact-generation:'||";
    expect(reserve).toContain(namespace); expect(trigger).toContain(namespace);
    expect(trigger).toContain("v_old->'index_generation_id',v_old->'artifact_generation_id',v_new->'index_generation_id',v_new->'artifact_generation_id'");
    expect(trigger).toContain("where value is not null order by value");
    expect(trigger.indexOf(namespace)).toBeLessThan(trigger.indexOf("if not found then"));
    expect(trigger).not.toContain("public.shadow_reserve_producer_d_v1");
    expect(trigger).not.toContain("security definer");
    expect(trigger).toContain("v_new->>'document_id' is distinct from v_d_owner.document_id::text");
    expect(trigger).toContain("return new");
    expect(reserve).not.toContain("lock table");
  });

  it("rejects historical/global occupied D and binds same-member sharing to one complete producer batch", () => {
    const reserve = effective("shadow_reserve_producer_d_v1"), writer = effective("write_shadow_generation_inventory");
    for (const table of artifacts) expect(reserve).toContain(`from public.${table} r where r.index_generation_id=v_d`);
    expect(reserve).toContain("where index_generation_id=v_d or baseline_generation_id=v_d");
    expect(reserve).toContain("v_existing->>'candidateGenerationId' is distinct from p_member.index_generation_id::text");
    expect(reserve).toContain("v_existing->'declaration'->'outputManifestEnvelope' is distinct from p_declaration->'outputManifestEnvelope'");
    expect(reserve).toContain("if not v_reuse or");
    expect(writer).toContain("perform public.shadow_reserve_producer_d_v1(v_member,v_declaration)");
    expect(writer).toContain("shadow_shared_batch_changed");
    expect(writer).toContain("s->'declaration'->'outputManifestEnvelope' is distinct from v_declaration->'outputManifestEnvelope'");
  });

  it("resolves limitation bytes and paths plus non-retained relationships before either early return", () => {
    const batch = effective("shadow_validate_planned_batch_v1"), final = effective("shadow_reconcile_final_disposition_v1"), pointer = effective("shadow_resolve_batch_pointer_v1");
    const branch = batch.slice(batch.indexOf("if p_declaration->'population'->>'tag'<>'known'"), batch.indexOf("select coalesce(pg_catalog.jsonb_agg"));
    expect(branch.indexOf("shadow_resolve_batch_pointer_v1")).toBeGreaterThan(0);
    expect(branch.indexOf("shadow_resolve_batch_pointer_v1")).toBeLessThan(branch.indexOf("return;"));
    expect(final.indexOf("shadow_resolve_batch_pointer_v1")).toBeLessThan(final.indexOf("if p_outcome->>'disposition'<>'retained'"));
    const nonretained = final.slice(final.indexOf("if p_outcome->>'disposition'<>'retained'"), final.indexOf("if p_outcome->'reasonCode' is distinct"));
    expect(nonretained).toContain("shadow_partial_evidence_required");
    expect(nonretained).toContain("public.shadow_node_value_text_v1(v_planned) is distinct from p_outcome->>'retainedNativePayload'");
    expect(nonretained).toContain("v_declaration->'artifactGenerationId'='null'::jsonb");
    expect(nonretained).toContain("then public.shadow_native_rpc_input_v1(v_planned)");
    expect(nonretained.indexOf("shadow_partial_evidence_required")).toBeLessThan(nonretained.indexOf("then public.shadow_native_rpc_input_v1(v_planned)"));
    expect(nonretained.indexOf("shadow_validate_inventory_relationships_v1")).toBeLessThan(nonretained.indexOf("return;"));
    expect(pointer).toContain("v_ref->'envelopeDigest' is distinct from p_envelope->'digest'");
    expect(pointer).toContain("pg_catalog.octet_length(pg_catalog.convert_to(p_envelope->>'canonicalPayload','UTF8'))");
    expect(pointer).toContain("if v_value is null then raise exception 'shadow_limitation_path_unavailable'");
    expect(pointer).toContain("shadow_limitation_evidence_unavailable");
  });

  it("uses one exact C image attachment with typed and metadata provenance for both object directions", () => {
    const attachment = effective("shadow_candidate_image_attachment_v1");
    expect(attachment).toContain("v_count<>1");
    expect(attachment).toContain("v_row->>'index_generation_id' is distinct from p_member.index_generation_id::text");
    expect(attachment).toContain("v_row->'metadata'->>'ingestion_job_id' is distinct from p_member.job_id::text");
    expect(attachment).toContain("v_row->'metadata'->>'ingestion_lease_token' is distinct from p_member.first_lease_token::text");
    expect(attachment).toContain("v_row->'metadata'->>'extractor' is distinct from 'local-worker'");
    expect(attachment).toContain("v_row->'metadata'->'image_hash' is distinct from v_row->'image_hash'");
    expect(attachment).toContain("p_ref->'mediaType' is distinct from v_row->'mime_type'");
    expect(attachment).toContain("i.unit_key=v_row->>'id'");
    expect(effective("shadow_reconcile_final_disposition_v1")).toContain("public.shadow_candidate_image_attachment_v1(p_member,v_ref)");
    expect(effective("shadow_inventory_relationships_v1")).toContain("public.shadow_candidate_image_attachment_v1(p_member,p_payload->'ref')");
  });

  it("locks document INSERT/UPDATE generation assignment using the actual generated metadata expression", () => {
    const parent = effective("shadow_parent_retention_guard_v1");
    expect(migration).toContain("create trigger documents_shadow_retention before insert or update or delete on public.documents");
    expect(schemaSource).toContain("index_generation_id uuid generated always as (");
    expect(parent).toContain("v_new_generation:=case when v_new->'metadata'->>'index_generation_id'");
    expect(parent).toContain("then (v_new->'metadata'->>'index_generation_id')::uuid else null end");
    expect(parent).toContain("array[v_old_generation,v_new_generation]");
    expect(parent).toContain("tg_op='INSERT' or (tg_op='UPDATE' and v_old_generation is distinct from v_new_generation)");
    expect(parent).toContain("pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('u04-artifact-generation:'||v_lock,0))");
    expect(parent).toContain("s->'declaration'->>'artifactGenerationId'=v_new_generation::text");
    expect(parent).toContain("shadow_document_generation_reserved");
    expect(parent).not.toContain("public.shadow_reserve_producer_d_v1");
    expect(parent).not.toContain("security definer");
  });

  it("serializes C reservation and continuously owned G0 with the same D namespace", () => {
    const enqueue = effective("enqueue_shadow_reindex_generation");
    const cLock = enqueue.indexOf("'u04-artifact-generation:'||v_c::text");
    const sourceLock = enqueue.indexOf("public.lock_ingestion_document_authority");
    const g0Lock = enqueue.indexOf("'u04-artifact-generation:'||((v_source->>'baselineGenerationId')::uuid)::text");
    const reserve = enqueue.indexOf("insert into public.shadow_reindex_waves");
    expect(cLock).toBeGreaterThan(enqueue.indexOf("in share row exclusive mode nowait;"));
    expect(cLock).toBeLessThan(sourceLock); expect(sourceLock).toBeLessThan(g0Lock); expect(g0Lock).toBeLessThan(reserve);
    expect(enqueue).toContain("shadow_candidate_generation_reserved");
    expect(enqueue).toContain("shadow_baseline_generation_reserved");
    expect(enqueue).not.toContain("pg_advisory_unlock");
    expect(schemaSource).toContain("create unique index if not exists ingestion_jobs_one_open_per_document_uidx");
    const atomic = persistence.match(/do \$u04_restart_index\$([\s\S]+?)end \$u04_restart_index\$;/)?.[1];
    expect(atomic).toBeDefined();
    const guard = atomic!.indexOf("create trigger ingestion_jobs_shadow_scheduling");
    const checkpoint = atomic!.indexOf("create constraint trigger ingestion_jobs_shadow_checkpoint_complete");
    const replacement = atomic!.indexOf("drop index public.ingestion_jobs_one_open_per_document_uidx;");
    expect(guard).toBeGreaterThan(atomic!.indexOf("perform public.shadow_queue_complete_v1(j.id)"));
    expect(checkpoint).toBeGreaterThan(guard); expect(replacement).toBeGreaterThan(checkpoint);
    expect(atomic!.indexOf("create unique index ingestion_jobs_one_open_per_document_uidx")).toBeGreaterThan(replacement);
    expect(persistence.match(/drop index public\.ingestion_jobs_one_open_per_document_uidx;/g)).toHaveLength(1);
  });

  it("couples the exact NULL-safe structural index predicate to the atomic guard installation", () => {
    const predicate = `where (status in ('pending', 'processing')) is not false
      and not ((
        operation = 'shadow_reindex'
        and status = 'processing'
        and batch_id is null
        and requested_generation_id is not null
        and shadow_plan_digest is not null
        and shadow_plan_digest ~ '^sha256:[0-9a-f]{64}$'
        and attempt_count = 1 and max_attempts = 1
        and lease_token is not null
        and lease_write_generation_id = requested_generation_id
        and locked_by is not null and locked_by <> ''
        and locked_at is not null
        and lease_authority_digest is not null and lease_authority_digest <> ''
        and lease_expires_at is not null
        and lease_duration_seconds is not null and lease_duration_seconds > 0
      ) is true);`;
    const install = persistence.slice(persistence.indexOf("do $u04_restart_index$"));
    const indexStart = install.indexOf("create unique index ingestion_jobs_one_open_per_document_uidx");
    expect(indexStart).toBeGreaterThanOrEqual(0);
    const indexEnd = install.indexOf(";", indexStart);
    expect(indexEnd).toBeGreaterThan(indexStart);
    const indexDefinition = install.slice(indexStart, indexEnd + 1);
    expect(indexDefinition).toContain(predicate);
    expect(indexDefinition).not.toMatch(/clock_timestamp|current_timestamp|select .*document_index_generations/i);
    expect(install).toContain("in share row exclusive mode nowait;");
    expect(install.indexOf("shadow_queue_complete_v1(j.id)")).toBeLessThan(install.indexOf("drop index"));
  });

  it("requires READ COMMITTED for INSERT and every NULL-safe scheduling or identity UPDATE", () => {
    const guard = effective("shadow_queue_scheduling_guard_v1");
    expect(guard).toContain("language plpgsql volatile security invoker set search_path = ''");
    expect(guard).toContain("tg_op not in ('INSERT','UPDATE')");
    expect(guard).toContain("v_old->k is distinct from v_new->k");
    for (const field of ["id", "document_id", "batch_id", "operation", "requested_generation_id", "shadow_plan_digest", "status", "attempt_count", "max_attempts",
      "next_run_at", "locked_by", "locked_at", "lease_token", "lease_expected_generation_id", "lease_write_generation_id", "lease_authority_digest", "lease_expires_at", "lease_duration_seconds"])
      expect(guard.slice(guard.indexOf("v_columns text[]"), guard.indexOf("begin"))).toContain(`'${field}'`);
    const isolation = guard.indexOf("current_setting('transaction_isolation') is distinct from 'read committed'");
    expect(isolation).toBeGreaterThan(0); expect(isolation).toBeLessThan(guard.indexOf("from public.public_source_versions"));
    expect(guard).toContain("shadow_queue_read_committed_required");
  });

  it("preserves invoker permission boundaries and fresh post-lock competing-row reads", () => {
    const guard = effective("shadow_queue_scheduling_guard_v1");
    expect(guard).toContain("current_user not in ('postgres','service_role')");
    expect(guard).toContain("new.operation='shadow_reindex' and current_user<>'postgres'");
    expect(guard).toContain("'public_source:'||v_key");
    expect(guard).toContain("select * into strict v_document from public.documents where id=v_doc for update nowait;");
    expect(guard).toContain("v_after_key is distinct from v_key or v_after_version is distinct from v_version");
    expect(guard).not.toMatch(/from public\.public_source_(?:versions|activation_events)[^;]*for update/);
    const lock = guard.indexOf("from public.indexing_v3_agent_jobs where document_id=v_doc order by id for update nowait;");
    expect(lock).toBeGreaterThan(0); expect(guard.indexOf("if exists(select 1 from public.ingestion_jobs")).toBeGreaterThan(lock);
    expect(guard.indexOf("v_now:=pg_catalog.clock_timestamp()")).toBeGreaterThan(lock);
    expect(guard).toContain("id is distinct from new.id");
    expect(guard).toContain("array[(v_old->>'document_id')::uuid,new.document_id]");
    expect(guard).not.toContain("pg_advisory_unlock");
  });

  it("admits only complete finite expired predecessors already in the captured population", () => {
    const history = effective("shadow_queue_history_v1");
    expect(history).toContain("language plpgsql volatile");
    expect(history).toContain("id is distinct from p_job");
    expect(history).toContain("status in ('pending','processing') order by id for update nowait");
    expect(history).toContain("j.operation is distinct from 'shadow_reindex'");
    expect(history).toContain("j.lease_expires_at is null"); expect(history).toContain("not pg_catalog.isfinite(j.lease_expires_at)");
    expect(history).toContain("j.lease_expires_at>v_now"); expect(history).toContain("g:=public.shadow_queue_complete_v1(j.id)");
    expect(history).toContain("(x->>'canonicalPayload')::jsonb=pg_catalog.to_jsonb(j)");
    expect(history).toContain("(x->>'canonicalPayload')::jsonb=pg_catalog.to_jsonb(g)");
    expect(history).toContain("shadow_predecessor_not_admitted");
    expect(history).not.toMatch(/\b(update public\.|delete from|insert into)\b/);
  });

  it("binds fresh reservation and later owned continuation to the same complete predecessor origin", () => {
    const enqueue = effective("enqueue_shadow_reindex_generation");
    expect(enqueue).toContain("perform public.shadow_queue_history_v1(v_document,null,v_origin)");
    expect(enqueue.indexOf("shadow_queue_history_v1(v_document,null,v_origin)")).toBeLessThan(enqueue.indexOf("insert into public.shadow_reindex_waves"));
    const origin = effective("shadow_assert_origin_unchanged_v1");
    expect(origin).toContain("perform public.shadow_queue_history_v1(v_g.document_id,v_g.job_id,v_origin)");
    expect(origin).toContain("v_g.original_origin_envelope is distinct from p_member.original_origin_envelope");
    expect(origin).toContain("public.shadow_state_rows_v1(v_current->'rows'");
    const guard = effective("shadow_queue_scheduling_guard_v1");
    expect(guard).toContain("public.validate_shadow_plan_v1(w.plan_payload)");
    expect(guard).toContain("w.baseline_report is distinct from p->'audit'->'input'->'caseResultsEnvelope'");
    expect(guard).toContain("perform public.shadow_assert_origin_unchanged_v1(g)");
    expect(guard).toContain("if new.operation is distinct from 'shadow_reindex' then return new");
  });

  it("preserves provisional first-claim ordering but demands complete OLD and exact NEW identity", () => {
    const guard = effective("shadow_queue_scheduling_guard_v1");
    expect(guard).toContain("g:=public.shadow_queue_complete_v1(old.id)");
    expect(guard).toContain("g.first_lease_token is not null or g.claimed_at is not null or old.attempt_count is distinct from 0");
    expect(guard).toContain("new.status is distinct from 'processing' or new.attempt_count is distinct from 1");
    expect(guard).toContain("new.lease_expected_generation_id is distinct from g.baseline_generation_id");
    expect(guard).toContain("new.lease_write_generation_id is distinct from g.index_generation_id");
    expect(guard).toContain("new.lease_authority_digest is distinct from g.authority_digest");
    expect(guard).toContain("shadow_queue_first_claim_required");
    expect(guard).toContain("old.lease_expires_at<=v_now");
    const claim = effective("claim_ingestion_jobs");
    expect(claim.indexOf("update public.ingestion_jobs set status = 'processing'")).toBeLessThan(claim.indexOf("update public.document_index_generations set state='building'"));
    expect(claim).toContain("control_snapshot=public.shadow_control_snapshot_v1(v_job.id,v_member.control_revision+1)");
  });

  it("defers latest-state consistency without granting scheduling authority or imposing later liveness", () => {
    const checker = effective("shadow_queue_checkpoint_complete_v1");
    expect(checker).toContain("volatile security definer set search_path = ''");
    expect(checker).toContain("perform public.shadow_queue_complete_v1(new.id)");
    expect(checker).not.toMatch(/clock_timestamp|for update|update public\.|insert into|delete from/);
    expect(persistence).toContain("deferrable initially deferred for each row execute function public.shadow_queue_checkpoint_complete_v1()");
    const complete = effective("shadow_queue_complete_v1");
    expect(complete).toContain("select * into strict j from public.ingestion_jobs where id=p_job");
    expect(complete).toContain("g.control_snapshot is distinct from public.shadow_control_snapshot_v1(j.id,g.control_revision)");
    expect(complete).toContain("j.status='failed' and j.stage='shadow_failed'");
    expect(complete).toContain("j.locked_by is null and j.locked_at is null");
    expect(complete).not.toContain("clock_timestamp");
    expect(complete).toContain("g.original_origin_envelope is distinct from p->'audit'->'input'->'originEnvelope'");
    expect(complete).toContain("b.bundle_digest is distinct from g.baseline_bundle_digest");
  });

  it("retains the original expired-attempt refusal and all new restart helpers remain ungranted", () => {
    const parent = effective("shadow_parent_retention_guard_v1");
    expect(parent).toContain("then raise exception 'shadow_wave_restart_required'");
    expect(parent).toContain("tg_op='DELETE' then raise exception 'shadow_retained_job'");
    for (const name of ["shadow_queue_complete_v1", "shadow_queue_history_v1", "shadow_queue_scheduling_guard_v1", "shadow_queue_checkpoint_complete_v1"]) {
      expect(persistence).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^;]*\\) from public,anon,authenticated,service_role;`));
      expect(persistence).not.toMatch(new RegExp(`grant execute on function public\\.${name}\\(`));
    }
  });
});


describe("U04 atomic terminal SQL contracts (source only)", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20260831102000_stage_shadow_document_generations.sql", import.meta.url), "utf8");
  function effective(name: string) {
    const start = migration.lastIndexOf(`create or replace function public.${name}(`);
    expect(start, `Missing effective function ${name}`).toBeGreaterThanOrEqual(0);
    const end = migration.indexOf("$$;", start);
    expect(end).toBeGreaterThan(start);
    return migration.slice(start, end + 3);
  }

  it("keeps the final shadow seal on the live two-argument Fence interface", () => {
    const body = effective("stage_document_index_generation");
    expect(migration).toContain("stage_document_index_generation(p_fence jsonb,p_generation uuid)");
    expect(body).toContain("transaction_isolation");
    expect(body).toContain("shadow_deadline_not_effective");
    expect(body).toContain("in share row exclusive mode nowait");
    expect(body).toContain("public.shadow_assert_attempt_v1(p_fence,p_generation,null)");
    expect(body).toContain("public.shadow_finalize_retained_inventory_v1(v_member)");
    expect(body).toContain("perform public.shadow_checkpoint_advance_v1(v_member.job_id)");
    expect(body).toContain("public.shadow_assert_origin_unchanged_v1(v_member)");
    expect(body).toContain("state='staged'");
    expect(body).toContain("status='completed',stage='shadow_staged',progress=100");
    expect(body).toContain("locked_by=null,locked_at=null,completed_at=v_sealed");
    expect(body).toContain("public.shadow_queue_complete_v1(v_member.job_id)");
    expect(body).toContain("p_fence->>'job_kind' is distinct from 'node'");
    expect(body.indexOf("public.shadow_assert_origin_unchanged_v1(v_member)")).toBeLessThan(body.indexOf("public.shadow_queue_complete_v1(v_member.job_id)"));
    expect(body).toContain("public.shadow_member_stage_response_v1(v_member)");
    expect(body.indexOf("update public.ingestion_jobs set status='completed'")).toBeLessThan(
      body.indexOf("update public.document_generation_projections set sealed_at=v_sealed"),
    );
    expect(body.indexOf("update public.document_generation_projections set sealed_at=v_sealed")).toBeLessThan(
      body.indexOf("update public.document_index_generations set state='staged'"),
    );
    expect(body).not.toMatch(/update public\.documents|delete from|commit_document_index_generation|activate/);
  });

  it("returns the exact member receipt validation context on fresh seal and replay", () => {
    const response = effective("shadow_member_stage_response_v1");
    expect(response).toContain("'ok',true,'kind','shadow_staged'");
    expect(response).toContain("'memberReceiptEnvelope',p_member.stage_receipt");
    for (const key of ["memberRowEnvelope","profileEnvelope","inventoryRowEnvelopes","originalOriginEnvelope","planDigest"])
      expect(response).toContain(`'${key}'`);
    expect(response).toContain("public.shadow_capture_envelope_v1(pg_catalog.to_jsonb(p_member))");
    expect(response).toContain("public.shadow_capture_envelope_v1(pg_catalog.to_jsonb(i))");
    expect(response).toContain("shadow_member_response_too_large");
  });

  it("builds the acyclic final inventory before the member receipt", () => {
    const final = effective("shadow_final_inventory_v1");
    const stage = effective("stage_document_index_generation");
    expect(final).toContain("'kind','u04-final-inventory-v1','version',1");
    expect(final).toContain("'expectedInventoryEnvelope',v_expected");
    expect(final).toContain("'finalDispositions',v_dispositions");
    expect(final).toContain("'projectionEnvelope',v_projection_envelope");
    expect(final).toContain("'preSealControlEnvelope'");
    expect(final).toContain("public.shadow_final_candidate_rows_v1(p_member)");
    expect(final).toContain("public.shadow_final_retained_evidence_v1(p_member)");
    expect(final).toContain("disposition='pending' or required and disposition<>'retained'");
    expect(final).not.toContain("'kind','u04-member-seal-receipt-v1'");
    expect(final).not.toContain("'kind','u04-wave-seal-receipt-v1'");
    expect(stage.indexOf("v_final:=public.shadow_final_inventory_v1")).toBeLessThan(stage.indexOf("'u04-member-seal-receipt-v1'"));
    expect(stage).toContain("control_revision=control_revision+1");
  });

  it("captures only the eight closed candidate row owners and exact retained bytes", () => {
    const rows = effective("shadow_final_candidate_rows_v1");
    const retained = effective("shadow_final_retained_evidence_v1");
    for (const table of ["document_pages","document_chunks","document_images","document_table_facts",
      "document_embedding_fields","document_index_units","document_sections","document_memory_cards"]) {
      expect(rows).toContain(`'${table}'`);
    }
    expect(rows).toContain("public.shadow_capture_envelope_v1(row_payload)->'digest'=v_unit.artifact_ref->'rowDigest'");
    expect(rows).toContain("(value->'rowEnvelope'->>'canonicalPayload')::jsonb->>'id'");
    expect(rows).toContain("shadow_candidate_row_not_unique");
    expect(retained).toContain("'representation',v_representation");
    for (const family of ["native_structure","cache_inputs","attempt_control","repair_audit_inputs"])
      expect(retained).toContain(`'${family}'`);
    for (const representation of ["producer_json","cache_input","control_checkpoint","repair_audit_input"])
      expect(retained).toContain(`'${representation}'`);
    expect(retained).toContain("'mediaType','application/json'");
    expect(retained).toContain("pg_catalog.octet_length(pg_catalog.convert_to(v_envelope->>'canonicalPayload','UTF8'))");
    expect(retained).toContain("v_unit->'output'");
    expect(retained).not.toMatch(/fetch|storage\.objects|http|net\./);
  });

  it("returns a complete guarded wave readback from the accepted three-argument receipt RPC", () => {
    const body = effective("get_shadow_generation_receipt");
    expect(migration).toContain("get_shadow_generation_receipt(p_plan_digest text,p_generation uuid,p_document_id uuid)");
    expect(body).toContain("candidate_generation_id=p_generation and plan_digest=p_plan_digest");
    expect(body).toContain("document_id=p_document_id and index_generation_id=p_generation");
    expect(body).toContain("state<>'staged' or stage_receipt is null");
    expect(body).toContain("perform public.shadow_queue_complete_v1(v_job)");
    expect(body).toContain("v_b is distinct from v_w");
    expect(body).toContain("public.shadow_assert_origin_unchanged_v1(v_member)");
    expect(body).toContain("public.capture_shadow_reindex_origin(v_w");
    expect(body).toContain("'kind','u04-wave-seal-receipt-v1','version',1");
    expect(body).toContain("'members',v_members");
    expect(body).toContain("'baselineRows',v_baselines");
    expect(body).toContain("'observedOriginEnvelope',v_current");
    expect(body).toContain("max(staged_at)");
    expect(body).not.toMatch(/lease_expires_at\s*>|update public\.|insert into|delete from|typed_absent/);
  });

  it("keeps terminal RPC privilege and deferred consistency boundaries closed", () => {
    expect(migration).toContain("revoke all on function public.stage_document_index_generation(jsonb,uuid) from public,anon,authenticated,service_role");
    expect(migration).toContain("grant execute on function public.stage_document_index_generation(jsonb,uuid) to service_role");
    expect(migration).toContain("revoke all on function public.get_shadow_generation_receipt(text,uuid,uuid) from public,anon,authenticated,service_role");
    expect(migration).toContain("grant execute on function public.get_shadow_generation_receipt(text,uuid,uuid) to service_role");
    expect(migration).toContain("deferrable initially deferred for each row execute function public.shadow_terminal_consistency_v1()");
    const marker="-- U04 read-only capture foundation. No mutation, claim or seal entrypoint is exposed.";
    const nextMarker = "-- U05 exact document-generation lifecycle. Source-only; no operation is performed here.";
    expect(schemaSource.slice(schemaSource.indexOf(marker), schemaSource.indexOf(nextMarker))).toBe(
      migration.slice(migration.indexOf(marker)),
    );
  });

  it("admits only the exact atomic job, projection and member terminal deltas", () => {
    const parent = effective("shadow_parent_retention_guard_v1");
    const scheduling = effective("shadow_queue_scheduling_guard_v1");
    const ledger = effective("shadow_ledger_guard_v1");
    expect(parent).toContain("v_old-array['status','stage','progress','locked_at','locked_by','completed_at','updated_at']");
    expect(parent).toContain("v_member.state is distinct from 'building'");
    expect(scheduling).toContain("elsif new.status='completed'");
    expect(scheduling).toContain("shadow_queue_terminal_transition");
    expect(ledger).toContain("v_old-'sealed_at' is distinct from v_new-'sealed_at'");
    expect(ledger).toContain("v_job.completed_at is distinct from new.sealed_at");
    expect(ledger).toContain("old.state='building' and new.state='staged'");
    expect(ledger).toContain("v_receipt->'terminalControlEnvelope'");
  });

  it("revalidates the complete immutable staged receipt in every deferred proof", () => {
    const complete = effective("shadow_queue_complete_v1");
    expect(complete).toContain("elsif g.state='staged'");
    expect(complete).toContain("public.shadow_keys_v1(r,array['kind','version','binding','planDigest'");
    expect(complete).toContain("f->'finalDispositions'=v_dispositions");
    expect(complete).toContain("public.shadow_inventory_envelope_payload_v1(f->'projectionEnvelope')=pg_catalog.to_jsonb(pr)");
    expect(complete).toContain("v_preseal->'ownStages'=v_terminal->'ownStages'");
    expect(complete).toContain("disposition='pending' or required and disposition<>'retained'");
    expect(complete).toContain("st.stage_status<>'completed' or st.finished_at is null");
    expect(effective("shadow_validate_projection_components_v1")).not.toContain("shadow_terminal_semantics_unavailable");
  });
});

describe("U04 fixed evaluation SQL body source contracts", () => {
  it("keeps evaluator reconciliation read-only and terminal-phase-specific", () => {
    for (const name of ["shadow_eval_projection_disposition_v1", "shadow_eval_attempt_control_payload_v1",
      "shadow_eval_reconcile_final_disposition_v1", "shadow_eval_guard_v1"]) {
      const start = migration.lastIndexOf(`create or replace function public.${name}(`);
      expect(start).toBeGreaterThanOrEqual(0);
      const body = migration.slice(start, migration.indexOf("end $$;", start) + 7);
      expect(schemaSource).toContain(body);
      expect(body).toContain("stable security definer set search_path = ''");
      const executable = body.replace(/--[^\n]*/g, "");
      expect(executable).not.toMatch(/\bfor\s+(?:no\s+key\s+)?update\b|\b(?:insert\s+into|delete\s+from|update\s+public\.)|pg_advisory|shadow_assert_origin_unchanged_v1/i);
      expect(executable).not.toMatch(/pg_catalog\.(?:coalesce|greatest|least|nullif|trim)\s*\(/i);
    }
    const start = migration.lastIndexOf("create or replace function public.shadow_eval_reconcile_final_disposition_v1(");
    const reconcile = migration.slice(start, migration.indexOf("end $$;", start));
    expect(reconcile).toContain("v_row->>'index_generation_id' is distinct from p_member.index_generation_id::text");
    expect(reconcile).toContain("v_row->'metadata'->>'index_generation_id' is distinct from p_member.index_generation_id::text");
    expect(reconcile).not.toContain("in (v_d::text,p_member.index_generation_id::text)");
    expect(reconcile).toContain("public.shadow_eval_projection_disposition_v1(");
    expect(reconcile).toContain("public.shadow_eval_attempt_control_payload_v1(");
  });
  const migration = readFileSync(
    new URL("../supabase/migrations/20260831102000_stage_shadow_document_generations.sql", import.meta.url),
    "utf8",
  );
  const generatedTypes = readFileSync(new URL("../src/lib/supabase/database.types.ts", import.meta.url), "utf8");
  const operations = [
    "adjacent_chunks",
    "aliases",
    "chunks_by_ids",
    "chunks_by_indexes",
    "corpus_terms",
    "correct_terms",
    "documents",
    "embedding_fields",
    "hybrid_chunks",
    "images_by_ids",
    "images_by_pages",
    "index_units",
    "lookup_chunk_prefix",
    "lookup_chunk_terms",
    "lookup_chunks",
    "lookup_document_terms",
    "lookup_documents",
    "memory_cards_hybrid",
    "memory_cards_lexical",
    "quality",
    "ranking_metadata",
    "related_documents",
    "table_facts",
    "text_chunks",
    "vector_chunks",
    "visual_rows",
  ] as const;
  const sqlSignatures: Record<(typeof operations)[number], string> = {
    adjacent_chunks: "jsonb,uuid[],integer[]",
    aliases: "jsonb",
    chunks_by_ids: "jsonb,uuid[]",
    chunks_by_indexes: "jsonb,uuid[],integer[],integer",
    corpus_terms: "jsonb,text[]",
    correct_terms: "jsonb,text,real",
    documents: "jsonb,uuid[]",
    embedding_fields: "jsonb,extensions.vector,text,integer,double precision,uuid[]",
    hybrid_chunks: "jsonb,extensions.vector,text,integer,double precision,uuid[]",
    images_by_ids: "jsonb,uuid[]",
    images_by_pages: "jsonb,uuid[],integer[]",
    index_units: "jsonb,extensions.vector,text,integer,double precision,uuid[]",
    lookup_chunk_prefix: "jsonb,uuid[],integer",
    lookup_chunk_terms: "jsonb,uuid[],text[],integer",
    lookup_chunks: "jsonb,text,uuid[],integer",
    lookup_document_terms: "jsonb,text[]",
    lookup_documents: "jsonb,text,integer",
    memory_cards_hybrid: "jsonb,extensions.vector,text,integer,double precision,uuid[]",
    memory_cards_lexical: "jsonb,text,uuid[],integer",
    quality: "jsonb,uuid[]",
    ranking_metadata: "jsonb,uuid[]",
    related_documents: "jsonb,uuid[]",
    table_facts: "jsonb,text,integer,uuid[]",
    text_chunks: "jsonb,text,integer,uuid[]",
    vector_chunks: "jsonb,extensions.vector,integer,double precision,uuid",
    visual_rows: "jsonb,uuid[]",
  };

  function effectiveEvaluationBody(source: string, operation: (typeof operations)[number]) {
    const name = `u04_eval_${operation}_v1`;
    const start = source.lastIndexOf(`create or replace function public.${name}(`);
    expect(start, `missing ${name}`).toBeGreaterThanOrEqual(0);
    const end = source.indexOf("\nend $$;", start);
    expect(end, `missing end of ${name}`).toBeGreaterThan(start);
    return source.slice(start, end + "\nend $$;".length);
  }

  it("accepts the bound request domain and page-backed origin provenance", () => {
    for (const sql of [migration, schemaSource]) {
      const originStart = sql.lastIndexOf("create or replace function public.shadow_eval_result_origin_ref_v1(");
      const origin = sql.slice(originStart, sql.indexOf("end $$;", originStart));
      expect(origin).toContain("p_table not in ('documents','document_pages','document_chunks'");
      expect(origin).toContain("p_owner not in ('document','page','chunk'");
      const resultStart = sql.lastIndexOf("create or replace function public.shadow_eval_result_v1(");
      const result = sql.slice(resultStart, sql.indexOf("end $$;", resultStart));
      expect(result).toContain("p_guard->'requestEnvelope'->>'domain' is distinct from 'u04-evaluation-request-v1'");
      expect(result).not.toContain("p_guard->'requestEnvelope'->>'domain' is distinct from 'plan'");
    }
  });

  it("keeps exactly 26 literal service-only stable endpoints in migration, schema and generated RPC types", () => {
    expect(new Set(operations).size).toBe(26);
    for (const operation of operations) {
      const name = `u04_eval_${operation}_v1`;
      const body = effectiveEvaluationBody(migration, operation);
      expect(effectiveEvaluationBody(schemaSource, operation)).toBe(body);
      expect(body).toContain("returns jsonb language plpgsql stable security definer");
      expect(body).toContain("set search_path = ''");
      expect(body).toMatch(
        new RegExp(`begin\\s+v_guard:=public\\.shadow_eval_guard_v1\\(p_context,'${operation}',`),
      );
      expect(body).toContain(operation === "correct_terms"
        ? "return public.shadow_eval_result_v1(v_guard,pg_catalog.to_jsonb(v_result))"
        : "return public.shadow_eval_result_v1(v_guard,v_result)");
      expect(body).not.toMatch(/\bexecute\b/i);
      expect(body).not.toContain("shadow_assert_origin_unchanged_v1");
      expect(body).not.toContain("set_config(");
      const signature = sqlSignatures[operation];
      expect(migration).toContain(`alter function public.${name}(${signature}) owner to postgres;`);
      expect(migration).toContain(
        `revoke all on function public.${name}(${signature}) from public,anon,authenticated,service_role;`,
      );
      expect(migration).toContain(`grant execute on function public.${name}(${signature}) to service_role;`);
      const typeStart = generatedTypes.indexOf(`      ${name}:`);
      expect(typeStart, `missing generated type for ${name}`).toBeGreaterThanOrEqual(0);
      const typeEnd = generatedTypes.indexOf("\n      u04_eval_", typeStart + 1);
      const typeBlock = generatedTypes.slice(typeStart, typeEnd < 0 ? undefined : typeEnd);
      expect(typeBlock).toContain("p_context: Json");
      expect(typeBlock).toMatch(/Returns:\s*Json\s*[;}]/);
    }
    expect((migration.match(/^create or replace function public\.u04_eval_[a-z_]+_v1\(/gm) ?? []).length).toBe(26);
    expect(migration).not.toContain("set_config('hnsw.ef_search'");
  });

  it("applies selected side and generation predicates before the preserved branch limits", () => {
    const text = effectiveEvaluationBody(migration, "text_chunks");
    expect(text).toContain("chunk_hits as");
    expect(text).toContain("title_chunk_hits as");
    expect(text).toContain("shadow_eval_generation_matches_v1(v_guard,c.document_id,c.index_generation_id,'chunks')");
    expect(text).toContain("limit least(greatest(v_count*2,24),96)");
    expect(text).toContain("least(0.5,0.18+(least(ranked.text_rank,1)*0.3))");
    expect(text).toContain("least(0.99,0.4+(least(ranked.text_rank,1)*0.59))");
    expect(text).toContain("shadow_eval_related_metadata_v1(v_guard,");
    expect(text).toContain("'text_chunks'");
    expect(text).toContain("shadow_eval_image_metadata_v1(v_guard,ranked.image_ids)");

    const hybrid = effectiveEvaluationBody(migration, "hybrid_chunks");
    expect(hybrid).toContain("shadow_eval_quality_v1(v_guard,array(select id from docs))");
    expect(hybrid).toContain("limit greatest(match_count*6,48)");
    expect(hybrid).toContain("(similarity*0.62)+(least(text_rank,1)*0.22)+(quality_score*0.10)");
    expect(hybrid).toContain("doc_updated_at>v_clock-interval '90 days'");
    for (const branch of ["hybrid_candidates", "vector_candidates", "text_candidates", "rrf_candidates"]) {
      expect(hybrid).toContain(`${branch} as`);
    }

    const facts = effectiveEvaluationBody(migration, "table_facts");
    for (const branch of ["fts_matches", "term_matches", "trgm_matches"]) expect(facts).toContain(`${branch} as`);
    expect(facts).toContain("limit greatest(match_count*5,64)");
    expect(facts).toContain("limit greatest(match_count*4,48)");
    expect(facts).toContain("OPERATOR(extensions.%) q.normalized");
    expect(facts).toContain("'{}'::jsonb metadata");

    const fields = effectiveEvaluationBody(migration, "embedding_fields");
    expect(fields).toContain("limit greatest(match_count*3,32)");
    expect(fields).toContain("((similarity*0.7)+(least(text_rank,1)*0.3))");

    const units = effectiveEvaluationBody(migration, "index_units");
    expect(units).toContain("limit greatest(v_count*3,48)");
    expect(units).toContain("(similarity*0.52)+(least(text_rank,1)*0.28)+(quality_score*0.12)");
    expect(units).not.toContain("query_embedding)>=min_similarity");

    const cards = effectiveEvaluationBody(migration, "memory_cards_hybrid");
    expect(cards).toContain("limit greatest(match_count*6,96)");
    expect(cards).toContain("(similarity*0.62)+(least(text_rank,1)*0.24)+(confidence*0.10)");
  });

  it("preserves owner and public inner candidate caps for the seven split-scope production readers", () => {
    for (const operation of [
      "embedding_fields",
      "hybrid_chunks",
      "lookup_chunks",
      "lookup_documents",
      "memory_cards_hybrid",
      "table_facts",
      "vector_chunks",
    ] as const) {
      const body = effectiveEvaluationBody(migration, operation);
      expect(body).toContain("scopes(public_scope) as (values(false),(true))");
      expect(body).toContain("cross join lateral");
    }
    for (const operation of [
      "embedding_fields",
      "hybrid_chunks",
      "lookup_chunks",
      "memory_cards_hybrid",
      "vector_chunks",
    ] as const) {
      expect(effectiveEvaluationBody(migration, operation)).toContain(
        "(d.owner_id is null)=s.public_scope",
      );
    }
    expect(effectiveEvaluationBody(migration, "lookup_documents")).toContain(
      "(owner_id is null)=s.public_scope",
    );
    expect(effectiveEvaluationBody(migration, "table_facts")).toContain(
      "ds.public_scope=s.public_scope",
    );
  });

  it("pins direct-reader caps, placeholders, metadata modes, fixed clock and vector-only HNSW configuration", () => {
    expect(effectiveEvaluationBody(migration, "aliases")).toContain("order by a.weight desc limit 200");
    expect(effectiveEvaluationBody(migration, "corpus_terms")).toContain("t.ord<=8");
    expect(effectiveEvaluationBody(migration, "correct_terms")).toContain("limit 32");
    expect(effectiveEvaluationBody(migration, "correct_terms")).toContain(
      "select distinct d.id document_id,pg_catalog.lower(title_word) word",
    );
    expect(effectiveEvaluationBody(migration, "lookup_chunk_terms")).toContain("limit greatest(match_count*4,24)");
    expect(effectiveEvaluationBody(migration, "lookup_chunk_prefix")).toContain("order by c.chunk_index asc limit match_count");
    expect(effectiveEvaluationBody(migration, "lookup_document_terms")).toContain("limit 12");
    expect(effectiveEvaluationBody(migration, "chunks_by_ids")).toContain("limit pg_catalog.cardinality(ids)");
    expect(effectiveEvaluationBody(migration, "chunks_by_indexes")).toContain("order by c.chunk_index asc limit match_count");
    expect(effectiveEvaluationBody(migration, "images_by_pages")).toContain(
      "order by i.clinical_relevance_score desc limit 80",
    );
    expect(effectiveEvaluationBody(migration, "adjacent_chunks")).toContain("order by c.chunk_index asc limit 80");
    const vector = effectiveEvaluationBody(migration, "vector_chunks");
    expect(vector).toContain("set hnsw.ef_search = '100'");
    expect(vector).toContain("'[]'::jsonb document_labels");
    expect(vector).toContain("null::text document_summary");
    expect(vector).toContain("'[]'::jsonb images");
    for (const operation of operations.filter((value) => value !== "vector_chunks")) {
      expect(effectiveEvaluationBody(migration, operation)).not.toContain("hnsw.ef_search");
    }
    for (const operation of ["ranking_metadata", "related_documents"] as const) {
      expect(effectiveEvaluationBody(migration, operation)).toContain(
        "shadow_eval_related_metadata_v1(v_guard,document_ids,'related_documents')",
      );
    }
  });
});

describe("U05 exact generation lifecycle SQL source contracts", () => {
  const migrationUrl = new URL(
    "../supabase/migrations/20260831103000_activate_retained_document_generations.sql",
    import.meta.url,
  );
  const migration = existsSync(migrationUrl) ? readFileSync(migrationUrl, "utf8") : "";
  const generatedTypes = readFileSync(new URL("../src/lib/supabase/database.types.ts", import.meta.url), "utf8");
  const marker = "-- U05 exact document-generation lifecycle. Source-only; no operation is performed here.";

  function effective(name: string) {
    const start = migration.lastIndexOf(`create or replace function public.${name}(`);
    expect(start, `Missing effective U05 function ${name}`).toBeGreaterThanOrEqual(0);
    const end = migration.indexOf("$$;", start);
    expect(end).toBeGreaterThan(start);
    return migration.slice(start, end + 3);
  }

  it("keeps the migration and canonical schema byte-identical at the U05 boundary", () => {
    expect(migration.startsWith(marker)).toBe(true);
    const schemaStart = schemaSource.indexOf(marker);
    expect(schemaStart).toBeGreaterThanOrEqual(0);
    expect(schemaSource.slice(schemaStart)).toBe(migration);
  });

  it("adds an append-only receipt ledger without turning identity references into live artifact references", () => {
    expect(migration).toContain("create table public.document_index_generation_operations");
    expect(migration).toMatch(/operation_kind text not null[\s\S]*check \(operation_kind in \('promote','rollback','cleanup'\)\)/);
    expect(migration).toMatch(/manifest_digest text not null unique/);
    expect(migration).toMatch(/receipt_digest text not null unique/);
    expect(migration).toMatch(/receipt jsonb not null/);
    expect(migration).not.toMatch(
      /document_index_generation_operations[\s\S]{0,1800}references public\.document_index_generations/i,
    );
    const guard = effective("guard_document_index_generation_operations_append_only");
    expect(guard).toContain("tg_op not in ('INSERT')");
    expect(guard).toContain("document_generation_operation_append_only");
    expect(migration).toContain(
      "before update or delete or truncate on public.document_index_generation_operations",
    );
    expect(migration).toContain(
      "revoke all on table public.document_index_generation_operations from public,anon,authenticated,service_role",
    );
    expect(migration).toContain("grant select on table public.document_index_generation_operations to service_role");
  });

  it("extends the staged ledger with one active generation and explicit retention state", () => {
    expect(migration).toContain("drop constraint document_index_generations_state");
    expect(migration).toMatch(
      /add constraint document_index_generations_state check \(state in \('reserved','building','staged','active','retained','abandoned'\)\)/,
    );
    expect(migration).toContain("add column activated_at timestamptz");
    expect(migration).toContain("add column retained_until timestamptz");
    expect(migration).toContain("add column cleaned_at timestamptz");
    expect(migration).toContain("create unique index document_index_generations_one_active_per_document_uidx");
    expect(migration).toContain("on public.document_index_generations(document_id) where state='active'");
  });

  it("keeps the transition and deletion cores private and disjoint", () => {
    const transition = effective("transition_document_index_generation_core");
    expect(transition).toContain("security definer set search_path = ''");
    expect(transition).toContain("is distinct from p_expected_generation_id");
    expect(transition).toContain("update public.documents");
    expect(transition).toContain("update public.document_index_generations");
    expect(transition).not.toMatch(/delete from|document_generation_projections|document_summaries|document_labels|document_index_quality/i);
    expect(transition).toContain("document_generation_first_publication_forbidden");

    const deletion = effective("delete_document_index_generations_core");
    expect(deletion).toContain("security definer set search_path = ''");
    expect(deletion).toMatch(/delete from public\.document_(pages|chunks|images)/);
    expect(deletion).not.toMatch(/update public\.documents|update public\.document_index_generations|delete from public\.document_index_generations/i);
    expect(deletion).toContain("document_generation_cleanup_active_forbidden");

    for (const signature of [
      "transition_document_index_generation_core(uuid,uuid,uuid,uuid)",
      "delete_document_index_generations_core(jsonb,uuid)",
    ]) {
      expect(migration).toContain(
        `revoke all on function public.${signature} from public,anon,authenticated,service_role`,
      );
      expect(migration).not.toContain(`grant execute on function public.${signature}`);
    }
  });

  it("promotes only a complete staged wave through semantic, rights and future U10 gates", () => {
    const promote = effective("promote_shadow_document_generation");
    expect(migration).toMatch(
      /promote_shadow_document_generation\(\s*p_plan jsonb\s*,\s*p_stage_receipt jsonb\s*,\s*p_evaluation_report jsonb\s*,\s*p_authorization_manifest jsonb\s*\)/,
    );
    expect(promote).toContain("public.shadow_node_payload_v1(p_plan,'plan')");
    expect(promote).toContain("public.shadow_inventory_envelope_payload_v1(p_stage_receipt)");
    expect(promote).toContain("public.shadow_node_payload_v1(p_evaluation_report,'evaluation_report')");
    expect(promote).toContain("public.document_generation_local_digest_v1");
    expect(promote).toContain("public.shadow_assert_origin_unchanged_v1");
    expect(promote).toContain("public.lock_ingestion_document_authority");
    expect(promote).toContain("public.require_document_generation_technical_gate_v1");
    expect(promote).toContain("v_current->'document'->>'status' is distinct from 'indexed'");
    expect(effective("transition_document_index_generation_core")).toContain(
      "document_generation_first_publication_forbidden",
    );
    expect(promote).toContain("is distinct from 'GO'");
    const populationGuard = "v_evaluation->>'populationFingerprint' is distinct from v_plan->>'populationFingerprint'";
    expect(promote).toContain(populationGuard);
    expect(promote.indexOf(populationGuard)).toBeLessThan(
      promote.indexOf("public.require_document_generation_technical_gate_v1"),
    );
    expect(promote).not.toMatch(/p_go\b|p_eligible\b|coalesce\([^)]*decision/i);
    expect(promote.indexOf("public.apply_document_generation_projection_v1")).toBeLessThan(
      promote.indexOf("public.transition_document_index_generation_core"),
    );
    const projection = effective("apply_document_generation_projection_v1");
    expect(projection).toContain("delete from public.document_summaries");
    expect(projection).toContain("delete from public.document_labels");
    expect(projection).toContain("delete from public.document_index_quality");
    expect(promote).toContain("deep_memory_artifact_generation_id");
    expect(promote).toContain("stageAuthorizationDigest");
    expect(promote).toContain("expectedTechnicalEvidenceReceiptDigests");
    expect(promote).toContain("v_retained_until<=v_now");
    expect(promote.indexOf("document_generation_promotion_evidence_mismatch")).toBeLessThan(
      promote.indexOf("select * into v_existing"),
    );
    expect(promote.indexOf("public.require_document_generation_technical_gate_v1")).toBeLessThan(
      promote.indexOf("select * into v_existing"),
    );
  });

  it("leaves the U10 technical gate fail-closed until its receipt table replaces the seam", () => {
    const gate = effective("require_document_generation_technical_gate_v1");
    expect(gate).toContain("document_generation_technical_gate_unavailable");
    expect(gate).not.toMatch(/return\s+(true|p_)|verdict\s*=\s*'activate'/i);
    expect(migration).toContain(
      "revoke all on function public.require_document_generation_technical_gate_v1(jsonb,jsonb) from public,anon,authenticated,service_role",
    );
    expect(migration).not.toContain(
      "grant execute on function public.require_document_generation_technical_gate_v1(jsonb,jsonb)",
    );
  });

  it("makes rollback receipt-bound, legacy-null aware and independent of expired recovery freshness", () => {
    const rollback = effective("rollback_document_index_generation");
    expect(migration).toMatch(
      /rollback_document_index_generation\(\s*p_promotion_receipt jsonb\s*,\s*p_rollback_manifest jsonb\s*\)/,
    );
    expect(rollback).toContain("document-generation-promotion-v1");
    expect(rollback).toContain("promotionReceiptDigest");
    expect(rollback).toContain("is distinct from");
    expect(rollback).toContain("public.lock_ingestion_document_authority");
    expect(rollback).toContain("public.assert_document_generation_rights_current_v1");
    expect(effective("assert_document_generation_rights_current_v1")).toContain(
      "public_source_document_is_serving_eligible",
    );
    expect(rollback).toContain("public.transition_document_index_generation_core");
    expect(rollback).toContain("previousServingSnapshot");
    expect(rollback).toContain("v_retained_until<=v_now");
    expect(rollback).not.toContain("shadow_validate_recovery_v1");
    expect(rollback).not.toMatch(/recovery.*expires|expires.*recovery/i);
  });

  it("cleans only exact authorized pairs and preserves private evidence for later object disposal", () => {
    const cleanup = effective("cleanup_document_index_generations");
    expect(migration).toMatch(
      /cleanup_document_index_generations\(\s*p_manifest jsonb\s*,\s*p_apply boolean default false\s*\)/,
    );
    expect(cleanup).toContain("expectedCount");
    expect(cleanup).toContain("manifestDigest");
    expect(cleanup).toContain("p_apply is not true");
    expect(cleanup).toContain("retained_until");
    expect(cleanup).toContain("cleaned_at");
    expect(cleanup).toContain("public.delete_document_index_generations_core");
    expect(cleanup).toContain("privateObjectReferenceInventory");
    expect(cleanup).toContain("physicalDeletionAuthorized");
    expect(cleanup).toContain("'ok',true");
    expect(cleanup).toContain("'applied',false");
    expect(cleanup).toContain("'applied',true");
    expect(cleanup).toContain("document_generation_cleanup_manifest_mismatch");
    expect(cleanup).not.toMatch(/where\s+state\s+in\s*\([^)]*\)\s+limit|all[_ ]eligible/i);

    const deletion = effective("delete_document_index_generations_core");
    expect(deletion).not.toMatch(/delete from public\.document_generation_inventory/i);
    expect(deletion).not.toMatch(/delete from public\.document_index_generation_operations/i);
    expect(deletion).toContain("privateObjectReferenceInventory");
    expect(deletion).toContain("'physicalDeletionAuthorized' is distinct from 'false'::jsonb");
    expect(migration).not.toContain("privateObjectDeletionCandidates");
  });

  it("prevents legacy mutators from deleting or replacing U04/U05 governed evidence", () => {
    const commit = effective("commit_document_index_generation");
    const abandoned = effective("cleanup_abandoned_document_index_generations");
    expect(commit).toContain("document_index_generations");
    expect(commit).toContain("governed_document_generation_commit_forbidden");
    expect(abandoned).toContain("document_index_generations");
    expect(abandoned).toContain("governed_document_generation_cleanup_forbidden");
    expect(abandoned).not.toMatch(/state\s+in\s*\('retained'|'staged'/i);
    expect(migration).toMatch(
      /revoke all on function public\.cleanup_abandoned_document_index_generations_legacy_u05\(\s*uuid,integer,boolean\s*\) from public,anon,authenticated,service_role/,
    );
    expect(migration).toMatch(
      /revoke all on function public\.commit_document_index_generation\(\s*uuid,text,uuid,uuid,text,integer,integer,integer,jsonb,jsonb,jsonb\s*\) from public,anon,authenticated,service_role/,
    );
  });

  it("requires exact retained baseline proof while preserving evidence-backed legacy and null G0", () => {
    const transition = effective("transition_document_index_generation_core");
    const legacy = effective("document_generation_legacy_baseline_proven_v1");
    expect(transition).toContain("document_generation_baseline_proof_missing");
    expect(transition).toContain("document_generation_rollback_target_unavailable");
    expect(transition).toContain("p_expected_generation_id is not null");
    expect(transition).toContain("p_operation_id,p_document_id,null,p_next_generation_id");
    expect(legacy).toContain("public.document_generation_baselines");
    expect(legacy).toContain("b.bundle_digest=g.baseline_bundle_digest");
    expect(legacy).toContain("previousServingSnapshotDigest");
    expect(legacy).toContain("public.shadow_reindex_waves");
  });

  it("captures, applies and restores the exact local-worker producer alias projection", () => {
    const snapshot = effective("document_generation_serving_snapshot_v1");
    const applyProjection = effective("apply_document_generation_projection_v1");
    const applySnapshot = effective("apply_document_generation_snapshot_v1");
    expect(snapshot).toContain("'producerAliases',v_aliases");
    expect(snapshot).toContain("a.metadata->>'generated_by'='local-worker'");
    expect(applyProjection).toContain("p_projection.producer_aliases");
    expect(applyProjection).toContain("document_generation_alias_projection_mismatch");
    expect(applySnapshot).toContain("p_snapshot->'producerAliases'");
    for (const body of [applyProjection, applySnapshot]) {
      expect(body).toContain("delete from public.rag_aliases");
      expect(body).toContain("insert into public.rag_aliases");
    }
  });

  it("makes every effective serving-generation predicate exact and NULL-safe", () => {
    for (const signature of [
      "is_committed_document_generation(row_generation uuid,document_metadata jsonb)",
      "is_committed_document_generation(row_generation uuid,document_generation uuid)",
      "is_committed_artifact_generation(artifact_metadata jsonb,document_metadata jsonb)",
      "is_committed_artifact_generation(artifact_generation_id uuid,document_metadata jsonb)",
    ]) {
      const start = migration.lastIndexOf(`create or replace function public.${signature}`);
      expect(start, `Missing U05 exact predicate ${signature}`).toBeGreaterThanOrEqual(0);
      const body = migration.slice(start, migration.indexOf("$$;", start));
      expect(body).toContain("is not distinct from");
      expect(body).not.toMatch(/\bis null\s+or\b/i);
    }
  });

  it("grants only the three narrow wrappers and exposes their generated RPC types", () => {
    const rpcSignatures = {
      promote_shadow_document_generation: "jsonb,jsonb,jsonb,jsonb",
      rollback_document_index_generation: "jsonb,jsonb",
      cleanup_document_index_generations: "jsonb,boolean",
    } as const;
    for (const [name, signature] of Object.entries(rpcSignatures)) {
      expect(migration).toContain(
        `revoke all on function public.${name}(${signature}) from public,anon,authenticated,service_role`,
      );
      expect(migration).toContain(`grant execute on function public.${name}(${signature}) to service_role`);
      const start = generatedTypes.indexOf(`      ${name}:`);
      expect(start, `Missing generated RPC type for ${name}`).toBeGreaterThanOrEqual(0);
      const end = generatedTypes.indexOf("\n      };", start);
      expect(end, `Missing generated RPC type terminator for ${name}`).toBeGreaterThan(start);
      const block = generatedTypes.slice(start, end + "\n      };".length);
      expect(block).toMatch(/Returns:\s*Json/);
    }
  });
});
