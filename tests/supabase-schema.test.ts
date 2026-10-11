import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { australianSourceCatalogue } from "@/lib/australian-source-catalogue";
import { formRecords } from "@/lib/forms";
import { serviceRecords } from "@/lib/services";

const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8").replace(/\s+/g, " ");
const governedRetrievalV3 = readFileSync(
  new URL("../supabase/migrations/20260830122000_add_corpus_scoped_retrieval_v3.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const correctedGovernedRetrievalV3 = readFileSync(
  new URL("../supabase/migrations/20260831120000_correct_governed_retrieval_v3.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const failClosedGovernedRetrievalV3 = readFileSync(
  new URL(
    "../supabase/migrations/20260901120100_fail_closed_unactivated_uploaded_local_retrieval.sql",
    import.meta.url,
  ),
  "utf8",
).replace(/\s+/g, " ");
const failClosedInternationalGovernedRetrievalV3 = readFileSync(
  new URL("../supabase/migrations/20260901130000_fail_closed_unactivated_international_retrieval.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const siteContentHealthMigration = readFileSync(
  new URL("../supabase/migrations/20260824123000_add_site_content_health_probe.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const evaluateSiteContentReleaseDigestMigration = readFileSync(
  new URL(
    "../supabase/migrations/20261010120000_evaluate_site_content_release_digest_once_per_health_read.sql",
    import.meta.url,
  ),
  "utf8",
).replace(/\s+/g, " ");
const siteContentHealthSqlFixture = readFileSync(
  new URL("./fixtures/site-content/site-content-health-state-machine.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const siteContentInvocationSqlFixture = readFileSync(
  new URL("./fixtures/site-content/site-content-invocation-state-machine.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");

describe("governed corpus retrieval v3 schema", () => {
  it("mirrors the candidate-only functions and filters before the ranked limit", () => {
    for (const sql of [schema, governedRetrievalV3]) {
      const candidateFunction = sql.slice(
        sql.indexOf("create function public.match_governed_candidate_chunks_v3("),
        sql.indexOf("create function public.match_document_chunks_text_v3("),
      );
      expect(sql).toContain("create function public.match_document_chunks_text_v3(");
      expect(sql).toContain("create function public.match_document_chunks_hybrid_v3(");
      expect(sql).toContain("create function public.match_document_chunks_v3(");
      expect(sql).toContain("from public.site_content_release_records record");
      expect(candidateFunction).toContain("release.target_change_epoch = state.served_change_epoch");
      expect(candidateFunction).toContain("state.active_release_digest = expected_site_release_digest");
      expect(candidateFunction).toContain("state.change_epoch = expected_site_change_epoch");
      expect(candidateFunction).toContain("pending_site_set as (");
      expect(candidateFunction).toContain("event.target_change_epoch is distinct from record.head_change_epoch");
      expect(candidateFunction).toContain("event.target_change_epoch > site_authority.change_epoch");
      expect(candidateFunction).toContain("record.head_change_epoch > site_authority.served_change_epoch");
      expect(candidateFunction).toContain("record.pending_event_sequence is null");
      expect(candidateFunction).not.toContain("event.state in (");
      expect(sql).toContain("pending_site_logical_ids as (");
      expect(sql).toContain("and not exists ( select 1 from pending_site_logical_ids pending");
      expect(candidateFunction).toContain(
        "document_filters is null or record.logical_document_id = any(document_filters)",
      );
      expect(sql).toContain("document.owner_id is null");
      const documentProjection = candidateFunction.slice(
        candidateFunction.indexOf("document_candidates as ("),
        candidateFunction.indexOf(") as source_metadata") + ") as source_metadata".length,
      );
      expect(documentProjection).toContain("pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(");
      expect(documentProjection).not.toContain("document.metadata as source_metadata");
      for (const privateKey of [
        "uploaded_by",
        "public_source_steward_id",
        "publication_approval_id",
        "administrator_id",
      ]) {
        expect(documentProjection).not.toContain(`'${privateKey}'`);
      }
      expect(sql).toContain("document.metadata->>'source_kind' = 'document'");
      expect(candidateFunction).toContain("vector_ranked as (");
      expect(candidateFunction).toContain("text_ranked as (");
      expect(candidateFunction).toContain("select * from vector_ranked union all select * from text_ranked");
      expect(candidateFunction).toContain("1.0 / (60 + rank_positions.vector_rank)");
      expect(candidateFunction).toContain("1.0 / (60 + rank_positions.text_match_rank)");
      expect(candidateFunction).not.toContain("pg_catalog.coalesce");
      expect(candidateFunction).toContain("coalesce(record.record->>'title', '')");
      expect(candidateFunction).toContain("coalesce(1.0 / (60 + rank_positions.vector_rank), 0)");
      expect(candidateFunction).toContain("coalesce(1.0 / (60 + rank_positions.text_match_rank), 0)");
      expect(candidateFunction.match(/OPERATOR\(extensions\.<=>\)/g)).toHaveLength(2);
      expect(candidateFunction.replaceAll("OPERATOR(extensions.<=>)", "")).not.toContain("<=>");
      const scoreProjection = candidateFunction.slice(candidateFunction.lastIndexOf("ranked as ("));
      expect(scoreProjection).not.toContain("row_number()");
      expect(candidateFunction).not.toContain("source_kind' = 'registry_record'");
    }
    expect(governedRetrievalV3).toContain(
      "document.metadata->>'corpus_scope' in ('australian_public', 'international_supplementary')",
    );
  });

  it("uses the current head only to exclude a pending logical ID above the served snapshot", () => {
    const scenario = { servedChangeEpoch: 5, currentChangeEpoch: 6, pendingEventEpoch: 6 };
    expect(scenario.pendingEventEpoch <= scenario.servedChangeEpoch).toBe(false);
    expect(scenario.pendingEventEpoch <= scenario.currentChangeEpoch).toBe(true);
    for (const sql of [schema, governedRetrievalV3]) {
      expect(sql).toContain("release.target_change_epoch = state.served_change_epoch");
      expect(sql).toContain("state.change_epoch = expected_site_change_epoch");
      expect(sql).toContain("event.target_change_epoch > site_authority.change_epoch");
      expect(sql).toContain("where record.pending_event_sequence is not null");
    }
  });

  it("preserves the superseded generic uploaded-local receipt in forward-only migration history", () => {
    const start = correctedGovernedRetrievalV3.indexOf(
      "create or replace function public.match_governed_candidate_chunks_v3(",
    );
    const end = correctedGovernedRetrievalV3.indexOf(
      "revoke all on function public.match_governed_candidate_chunks_v3(",
      start,
    );
    const candidateFunction = correctedGovernedRetrievalV3.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(candidateFunction).toContain("document.owner_id is null");
    expect(candidateFunction).toContain("document.status = 'indexed'");
    expect(candidateFunction).toContain(
      "public.is_committed_document_generation(chunk.index_generation_id, document.index_generation_id)",
    );
    expect(candidateFunction).toContain("'uploaded_local', 'australian_public', 'international_supplementary'");
    expect(candidateFunction).toContain("document.metadata->>'source_kind' = 'document'");
    expect(candidateFunction).toContain("document.metadata->'public_corpus' = 'true'::jsonb");
    expect(candidateFunction).toContain("document.metadata->>'content_mode' = 'indexed_content'");
    expect(candidateFunction).toContain("document.metadata->>'document_status' = 'current'");
    expect(candidateFunction).toContain("in ('changed', 'unchanged')");
    expect(candidateFunction).toContain("document.metadata->>'licence_policy' = 'public_index_permitted'");
    expect(candidateFunction).toContain("nullif(document.metadata->>'source_role', '') is not null");
    expect(candidateFunction).toContain("nullif(document.metadata->>'source_catalogue_key', '') is not null");
    expect(candidateFunction).toContain("nullif(document.metadata->>'source_policy_version', '') is not null");
    expect(candidateFunction).toContain("from public.document_publication_approvals approval");
    expect(candidateFunction).toContain("approval.id::text = document.metadata->>'publication_approval_id'");
    expect(candidateFunction).toContain("approval.document_id = document.id");
    expect(candidateFunction).toContain("approval.decision = 'approved'");
    expect(candidateFunction).toContain("approval.manifest_digest = document.metadata->>'publication_manifest_digest'");
    expect(candidateFunction).toContain(
      "approval.reviewed_state_digest = document.metadata->>'publication_reviewed_state_digest'",
    );
  });

  it("keeps uploaded-local request-compatible while failing effective retrieval closed until P16 activation", () => {
    const start = failClosedGovernedRetrievalV3.indexOf(
      "create or replace function public.match_governed_candidate_chunks_v3(",
    );
    const end = failClosedGovernedRetrievalV3.indexOf(
      "revoke all on function public.match_governed_candidate_chunks_v3(",
      start,
    );
    const candidateFunction = failClosedGovernedRetrievalV3.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(candidateFunction).toContain(
      "'uploaded_local', 'clinical_kb_site', 'australian_public', 'international_supplementary'",
    );
    expect(candidateFunction).toContain(
      "document.metadata->>'corpus_scope' in ('australian_public', 'international_supplementary')",
    );
    expect(candidateFunction).not.toContain("from public.document_publication_approvals approval");
    expect(candidateFunction).not.toContain("'uploaded_local', 'australian_public', 'international_supplementary'");
  });

  it("keeps international request-compatible while failing document retrieval closed until P16 activation", () => {
    const start = failClosedInternationalGovernedRetrievalV3.indexOf(
      "create or replace function public.match_governed_candidate_chunks_v3(",
    );
    const end = failClosedInternationalGovernedRetrievalV3.indexOf(
      "revoke all on function public.match_governed_candidate_chunks_v3(",
      start,
    );
    const candidateFunction = failClosedInternationalGovernedRetrievalV3.slice(start, end);
    const schemaStart = schema.lastIndexOf("create or replace function public.match_governed_candidate_chunks_v3(");
    const schemaEnd = schema.indexOf("revoke all on function public.match_governed_candidate_chunks_v3(", schemaStart);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(candidateFunction).toContain(
      "'uploaded_local', 'clinical_kb_site', 'australian_public', 'international_supplementary'",
    );
    expect(candidateFunction).toContain("document.metadata->>'corpus_scope' = 'australian_public'");
    expect(candidateFunction).not.toContain(
      "document.metadata->>'corpus_scope' in ('australian_public', 'international_supplementary')",
    );
    expect(candidateFunction).not.toContain("from public.document_publication_approvals approval");
    expect(schema.slice(schemaStart, schemaEnd)).toBe(candidateFunction);
  });

  it("emits canonical registry metadata and mirrors the effective function in the final schema", () => {
    const migrationStart = failClosedInternationalGovernedRetrievalV3.indexOf(
      "create or replace function public.match_governed_candidate_chunks_v3(",
    );
    const migrationEnd = failClosedInternationalGovernedRetrievalV3.indexOf(
      "revoke all on function public.match_governed_candidate_chunks_v3(",
      migrationStart,
    );
    const schemaStart = schema.lastIndexOf("create or replace function public.match_governed_candidate_chunks_v3(");
    const schemaEnd = schema.indexOf("revoke all on function public.match_governed_candidate_chunks_v3(", schemaStart);

    const migrationFunction = failClosedInternationalGovernedRetrievalV3.slice(migrationStart, migrationEnd);
    const schemaFunction = schema.slice(schemaStart, schemaEnd);
    expect(migrationFunction).toContain("'source_kind', 'registry_record'");
    expect(migrationFunction).not.toContain("'source_kind', 'site_content_release_record'");
    expect(schemaFunction).toBe(migrationFunction);
  });
});

describe("site-content Task 4 health schema", () => {
  it("adds immutable administrator attestation and private forced-RLS invocation evidence", () => {
    for (const sql of [schema, siteContentHealthMigration]) {
      expect(sql).toContain("administrator_authorized_at timestamptz not null");
      expect(sql).toContain("administrator_authorization_version text not null");
      expect(sql).toContain("create table public.site_content_sync_worker_invocations");
      expect(sql).toContain("alter table public.site_content_sync_worker_invocations force row level security");
      expect(sql).toContain("create or replace function public.record_site_content_sync_worker_invocation(");
      expect(sql).toContain("create or replace function public.read_site_content_health()");
    }
  });

  it("preserves Task 3 migration bytes and removes spoofable publication overloads only in Task 4", () => {
    expect(siteContentHealthMigration).toContain("site_content_task4_requires_empty_publications");
    expect(siteContentHealthMigration).toContain("auth.uid()");
    expect(siteContentHealthMigration).toContain("from auth.users");
    expect(siteContentHealthMigration).toContain("for share");
    expect(siteContentHealthMigration).toContain("pg_advisory_xact_lock");
    expect(siteContentHealthMigration).toContain("statement_timestamp()");
    expect(siteContentHealthMigration).not.toMatch(/delete from public\.site_content_sync_worker_invocations/i);
    expect(siteContentHealthMigration.indexOf("site_content_task4_requires_empty_publications")).toBeLessThan(
      siteContentHealthMigration.indexOf("add column administrator_authorized_at"),
    );
    for (const name of ["publish_site_content_record", "retire_site_content_record"]) {
      expect(siteContentHealthMigration).toContain(
        `drop function if exists public.${name}(text, uuid, text, bigint, text, text, text, uuid)`,
      );
      expect(siteContentHealthMigration).toContain("auth.jwt()->>'role' is distinct from 'authenticated'");
      expect(siteContentHealthMigration).toContain(
        "raw_app_meta_data->>'site_role' is not distinct from 'administrator'",
      );
    }
  });

  it("samples immutable administrator authorization only after the locked role validation", () => {
    for (const sql of [schema, siteContentHealthMigration]) {
      for (const name of ["publish_site_content_record", "retire_site_content_record"]) {
        const start = sql.lastIndexOf(`create or replace function public.${name}(`);
        const end = sql.indexOf(" $$;", start);
        const body = sql.slice(start, end);
        const failedAuthorization = body.indexOf("if not found then");
        const completedAuthorizationCheck = body.indexOf("end if;", failedAuthorization);
        const authorizationTime = body.indexOf("v_authorized_at := pg_catalog.clock_timestamp()");

        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        expect(body).toContain("v_authorized_at timestamptz;");
        expect(body).not.toContain("v_authorized_at timestamptz :=");
        expect(failedAuthorization).toBeGreaterThan(body.indexOf("for share"));
        expect(completedAuthorizationCheck).toBeGreaterThan(failedAuthorization);
        expect(authorizationTime).toBeGreaterThan(completedAuthorizationCheck);
      }
    }
  });

  it("derives de-duplicated queue counts from current chain terminals", () => {
    for (const sql of [schema, siteContentHealthMigration]) {
      expect(sql).toContain("terminal_current_events as (");
      const queueStart = sql.indexOf("queue as (");
      const queueEnd = sql.indexOf("invocation_latest as (", queueStart);
      const queue = sql.slice(queueStart, queueEnd);
      expect(queue).toContain("from terminal_current_events cross join db_clock");
      expect(queue).not.toContain("from public.site_content_sync_events where state = 'quarantined'");
    }
  });

  it("binds initialized release integrity to the exact served epoch and guard-valid receipt shape", () => {
    for (const sql of [schema, siteContentHealthMigration]) {
      const integrityStart = sql.indexOf("integrity as (");
      const releaseDigestStart = sql.indexOf("release_digest_valid", integrityStart);
      const populationIntegrity = sql.slice(integrityStart, releaseDigestStart);
      const rollbackStart = sql.indexOf("rollback as (");
      const rollbackEnd = sql.indexOf("activation_evidence as (", rollbackStart);
      const rollback = sql.slice(rollbackStart, rollbackEnd);

      expect(populationIntegrity).toContain("r.target_change_epoch = s.served_change_epoch");
      expect(rollback).toContain("receipt.receipt#>>'{resource,previousSiteReleaseId}' = p.id::text");
      expect(rollback).toContain("receipt.receipt#>>'{resource,previousSiteReleaseDigest}' = p.release_digest");
      expect(rollback).not.toContain("previousResource");
    }
  });

  it("indexes both append-only invocation health access paths", () => {
    for (const sql of [schema, siteContentHealthMigration]) {
      expect(sql).toContain(
        "create index site_content_sync_worker_invocations_started_at_idx on public.site_content_sync_worker_invocations (started_at desc, invocation_id desc)",
      );
      expect(sql).toContain(
        "create index site_content_sync_worker_invocations_successful_terminal_at_idx on public.site_content_sync_worker_invocations (terminal_at desc) where terminal_phase = 'succeeded' and outcome_code in ('idle', 'ready')",
      );
    }
  });

  it("fences invocation replay and derives one bounded, read-only health snapshot", () => {
    expect(siteContentHealthMigration).toContain("pg_catalog.pg_advisory_xact_lock(93206432)");
    expect(siteContentHealthMigration).toContain("admission_expires_at <= v_now");
    expect(siteContentHealthMigration).toContain("outcome_code = 'invocation_expired'");
    expect(siteContentHealthMigration).toContain("v_now timestamptz;");
    const invocationLock = siteContentHealthMigration.indexOf("pg_catalog.pg_advisory_xact_lock(93206432)");
    const serializedClock = siteContentHealthMigration.indexOf("v_now := pg_catalog.clock_timestamp()", invocationLock);
    const firstInvocationRead = siteContentHealthMigration.indexOf(
      "select * into v_row from public.site_content_sync_worker_invocations",
      invocationLock,
    );
    expect(serializedClock).toBeGreaterThan(invocationLock);
    expect(serializedClock).toBeLessThan(firstInvocationRead);
    expect(siteContentHealthMigration).toContain(
      "v_row.terminal_phase = p_phase and v_row.outcome_code = p_outcome_code",
    );
    expect(siteContentHealthMigration).toContain("language sql stable security definer set search_path = ''");
    expect(siteContentHealthMigration).toContain("db_clock as (select statement_timestamp() as now)");
    expect(siteContentHealthMigration).toContain("max(db_clock.now) - min(e.created_at)");
    expect(siteContentHealthMigration).toContain(
      "origin.target_publication_id is distinct from h.current_publication_id",
    );
    expect(siteContentHealthMigration).toContain("e.event_sequence > c.event_sequence");
    expect(siteContentHealthMigration).toContain("not exists (select 1 from live_events e where not exists");
    expect(siteContentHealthMigration).toContain("receipt.receipt#>>'{resource,kind}' = 'site_release'");
    expect(siteContentHealthMigration).toContain(
      "p.target_change_epoch = 0 and p.id = 'e4a1dd29-14f6-556c-8fb7-f4f947d8b846'::uuid",
    );
    expect(siteContentHealthMigration).toContain("p.expected_record_count = 843 and p.expected_tombstone_count = 0");
    expect(siteContentHealthMigration).not.toContain("(select state from bootstrap) = 'valid_retained'");
    const healthStart = siteContentHealthMigration.indexOf(
      "create or replace function public.read_site_content_health()",
    );
    const healthEnd = siteContentHealthMigration.indexOf(
      "alter table public.site_content_sync_worker_invocations enable",
      healthStart,
    );
    const health = siteContentHealthMigration.slice(healthStart, healthEnd);
    expect(health).not.toMatch(/for update|pg_advisory|delete from|insert into|update public/i);
    const publicObject = health.slice(health.lastIndexOf("select jsonb_build_object("));
    expect(publicObject).not.toMatch(/workerId|invocationId|publishedBy|logicalId|renderPayload|providerError/);
  });

  it("mirrors the health wrapper and evaluates its operational evidence once", () => {
    const healthFunction = /create (?:or replace )?function public\.read_site_content_health\(\).*? \$\$;/g;
    const schemaHealth = [...schema.matchAll(healthFunction)].at(-1)?.[0];
    const migrationHealth = evaluateSiteContentReleaseDigestMigration.match(healthFunction);

    expect(schemaHealth).toBeDefined();
    expect(migrationHealth).toHaveLength(1);
    expect(migrationHealth?.[0]).toBe(schemaHealth?.replace("create function", "create or replace function"));
    expect(migrationHealth?.[0]).toContain(
      "base as materialized ( select public.site_content_health_operational_base() payload )",
    );
    expect(migrationHealth?.[0]).toContain("language sql stable security definer set search_path = ''");
    expect(migrationHealth?.[0]).toContain(
      "s.valid and r.id is not null and coalesce((b.payload->>'releaseDigestValid')::boolean, false) release_digest_valid,",
    );
    expect(migrationHealth?.[0]).toContain(
      "s.valid and r.id is not null and coalesce((b.payload->>'dynamicDigestValid')::boolean, false) dynamic_digest_valid,",
    );
    expect(migrationHealth?.[0]).not.toContain("public.site_content_release_digest(r.id)");
    expect(migrationHealth?.[0]).not.toContain("public.site_content_dynamic_state_digest(r.id)");
    expect(evaluateSiteContentReleaseDigestMigration).toContain(
      "revoke all on function public.read_site_content_health() from public, anon, authenticated, service_role;",
    );
    expect(evaluateSiteContentReleaseDigestMigration).toContain(
      "grant execute on function public.read_site_content_health() to service_role;",
    );
    expect(evaluateSiteContentReleaseDigestMigration).toContain(
      "alter function public.read_site_content_health() owner to postgres;",
    );
  });

  it("ships executable health-integrity and serialized invocation state fixtures", () => {
    for (const state of ["candidate", "superseded", "abandoned", "rolled_back"]) {
      expect(siteContentHealthSqlFixture).toContain(`'${state}'`);
    }
    expect(siteContentHealthSqlFixture).toContain("activePublicSiteRelease");
    expect(siteContentHealthSqlFixture).toContain("rollbackAvailable");
    expect(siteContentHealthSqlFixture).toContain(
      "bootstrap retained integrity ignored an extra outstanding head/live event",
    );
    expect(siteContentHealthSqlFixture).toContain("missing public head did not make populationComplete false");
    expect(siteContentHealthSqlFixture).toContain("current quarantined terminal did not stop pending integrity");
    expect(siteContentHealthSqlFixture).toContain(
      "served corrected successor retained an orphaned historical quarantine failure",
    );
    expect(siteContentHealthSqlFixture).toContain(
      "served epoch advanced beyond the active release target without failing population integrity",
    );
    expect(siteContentHealthSqlFixture).toContain("guard_site_content_receipt_shape");
    expect(siteContentHealthSqlFixture).toContain("previousSiteReleaseId");
    expect(siteContentHealthSqlFixture).not.toContain("previousResource");
    expect(siteContentInvocationSqlFixture).toContain("set local role service_role");
    expect(siteContentInvocationSqlFixture).toContain("p_phase => null");
    expect(siteContentInvocationSqlFixture).toContain("p_phase => 'succeeded', p_outcome_code => null");
    expect(siteContentInvocationSqlFixture).toContain("p_phase => 'failed', p_outcome_code => null");
    expect(siteContentInvocationSqlFixture).toContain("retry-after-lock-expiry");
    expect(siteContentInvocationSqlFixture).toContain("terminal-after-lock-expiry");
    expect(siteContentInvocationSqlFixture).toContain("where locktype = 'advisory' and not granted");
    expect(siteContentInvocationSqlFixture).toContain("site_content_sync_worker_invocations_started_at_idx");
    expect(siteContentInvocationSqlFixture).toContain(
      "site_content_sync_worker_invocations_successful_terminal_at_idx",
    );
  });
});
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

  it("keeps the legacy generation quality upsert aligned with its migration", () => {
    for (const sql of [schema, preserveLegacyArtifactCommitMigration]) {
      const start = sql.indexOf("create or replace function public.commit_document_index_generation(");
      expect(start).toBeGreaterThan(-1);
      const end = sql.indexOf("end; $$;", start);
      expect(end).toBeGreaterThan(start);
      const body = sql.slice(start, end);
      expect(body).toContain("on conflict on constraint document_index_quality_pkey");
      expect(body).not.toContain("on conflict (document_id)");
    }
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
    // Historical policy migration: full CRUD + single FOR ALL policy (pre append-only).
    expect(auditLogsServiceRolePolicyMigration).toContain("alter table public.audit_logs enable row level security");
    expect(auditLogsServiceRolePolicyMigration).toContain("revoke all on public.audit_logs from anon, authenticated");
    expect(auditLogsServiceRolePolicyMigration).toContain(
      "grant select, insert, update, delete on table public.audit_logs to service_role",
    );
    expect(auditLogsServiceRolePolicyMigration).toContain(
      'create policy "audit logs service role all" on public.audit_logs',
    );
    expect(auditLogsServiceRolePolicyMigration).toContain("for all to service_role");

    // Current schema: append-only (select+insert, no update/delete, prevent_mutation trigger).
    expect(schema).toContain("alter table public.audit_logs enable row level security");
    expect(schema).toContain("revoke all on public.audit_logs from anon, authenticated");
    expect(schema).toContain("revoke update, delete on table public.audit_logs from service_role");
    expect(schema).toContain("grant select, insert on table public.audit_logs to service_role");
    expect(schema).toContain('create policy "audit logs service role select" on public.audit_logs');
    expect(schema).toContain('create policy "audit logs service role insert" on public.audit_logs');
    expect(schema).toContain("create or replace function public.audit_logs_prevent_mutation()");
    expect(schema).not.toContain('create policy "audit logs service role all" on public.audit_logs');
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
      ["historical_version_placeholder", 12],
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

describe("site-content publication and release control plane", () => {
  const migrationRaw = readFileSync(
    new URL("../supabase/migrations/20260824122000_add_site_content_release_and_outbox.sql", import.meta.url),
    "utf8",
  );
  const migration = migrationRaw.replace(/\s+/g, " ");

  it("keeps legacy owner rows as drafts and creates an ownerless public head", () => {
    expect(migration).toContain("create table public.site_content_publications");
    expect(migration).toContain("create table public.site_content_public_records");
    expect(migration).not.toContain("alter table public.clinical_registry_records alter column owner_id drop not null");
    expect(migration).not.toContain("alter table public.medication_records alter column owner_id drop not null");
    expect(migration).not.toContain("alter table public.differential_records alter column owner_id drop not null");
    expect(migration).not.toMatch(
      /create trigger .* on public\.(clinical_registry_records|medication_records|differential_records)/i,
    );
    expect(migration).toContain("unique (kind, slug)");
  });

  it("normalizes every legacy kind into the P03 canonical record shape without audit identifiers", () => {
    expect(migration).toContain("create or replace function public.site_content_canonical_text(p_value text)");
    expect(migration).toContain("create or replace function public.site_content_source_projection(");
    expect(migration).toContain("v_render := public.site_content_public_json_projection");
    expect(migration).toContain("'contentHash', public.site_content_json_sha256");
    expect(migration).toContain("'publicationVersion', public.site_content_json_sha256(v_record)");
    expect(migration).toContain("'sourceLineage', '[]'::jsonb");
    expect(migration).toContain(
      "revoke all on function public.site_content_canonical_text(text) from public, anon, authenticated, service_role",
    );
    expect(migration).toContain("pg_catalog.normalize(lower(coalesce(p_value, '')), 'NFKD')");
    expect(migration).toContain("U&'[\\0300-\\036F]'");
    expect(migration).toContain("return p_value #>> '{}'");
    expect(migration).toContain("site_content_utf16_cutoff_unrepresentable");
    expect(migration).toContain("v_render#>>'{catalogPayload,availability}'");
    expect(migration).toContain("create or replace function public.site_content_typed_json(p_value jsonb)");
    expect(migration).toContain(
      "create or replace function public.site_content_projection_digest(p_record jsonb, p_render_payload jsonb)",
    );
    expect(migration).toContain("p_expected_projection_digest text");
    expect(migration).toContain("projection_digest_mismatch");
    expect(migration).not.toContain("v_owner := jsonb_strip_nulls(jsonb_build_object(");
    expect(migration).toContain(
      "revoke all on function public.site_content_projection_digest(jsonb, jsonb) from public, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "grant execute on function public.publish_site_content_record(text, uuid, text, bigint, text, text, text, uuid) to service_role",
    );
    expect(migration).toContain(
      "grant execute on function public.retire_site_content_record(text, uuid, text, bigint, text, text, text, uuid) to service_role",
    );
  });

  /**
   * SHAPE, NOT CONTENT — and the difference is why 2026-09-16 happened.
   *
   * This baseline is frozen inside an APPLIED migration. Asserting it equalled the whole current
   * catalogue made every added or edited service record fail by construction, and the only way to
   * pass was to rewrite `20260824122000` — which changes a content-addressed release id the live
   * database can never pick up, because an applied migration is never re-run. PR #2814 did exactly
   * that: the repository went on to describe a bootstrap release (`91ceaa8d…`, 860 records) that no
   * database has ever held, while live kept `e4a1dd29…` and 843, and `check:drift` went red on two
   * constraints.
   *
   * Divergence from the catalogue is expected, not a defect. The baseline is a 2026-08-24 snapshot
   * used by SQL's null and forced-field merging for the records frozen at epoch zero; curated
   * content reaches live through the publication pipeline (`docs/site-content-sync-runbook.md`), and
   * the lookup that serves newer or revised records is refreshed by a NEW forward migration, never
   * by editing this one.
   *
   * What must not drift is the FIELD VOCABULARY the merge reads. Identity of the freeze itself is
   * pinned in `tests/site-content-epoch-zero-freeze.test.ts`.
   */
  it("keeps the frozen P03 registry baseline readable as the current catalogue record shape", () => {
    const match = migrationRaw.match(
      /\$site_content_registry_baselines\$([\s\S]*?)\$site_content_registry_baselines\$/,
    );
    expect(match).not.toBeNull();
    if (!match) return;
    const sqlBaselines = JSON.parse(match[1]!) as Record<string, unknown>;
    const catalogue = [
      ...serviceRecords.map((record) => record as unknown as Record<string, unknown>),
      ...formRecords.map((record) => record as unknown as Record<string, unknown>),
    ];
    // Non-vacuous: the freeze carries 281 entries, so an empty or truncated blob fails here
    // rather than passing as "every frozen entry had the right shape".
    expect(Object.keys(sqlBaselines).length).toBe(281);
    expect(catalogue.length).toBeGreaterThanOrEqual(281);

    // An optional field is absent from a record that has no value for it, so one record's key set
    // cannot be compared to another's. The VOCABULARY can: every field name the catalogue emits
    // today. A rename or a removal leaves the frozen baseline carrying a field SQL's merge can no
    // longer resolve, and that is what this catches.
    //
    // Only that direction is checked. A field added to the catalogue after 2026-08-24 is absent
    // from the freeze by definition, so requiring the freeze to carry today's mandatory fields
    // would re-create the failure-by-construction this test was rewritten to remove.
    const emitted = new Set(catalogue.flatMap((record) => Object.keys(record)));
    expect(emitted.size, "the catalogue must emit fields to pin").toBeGreaterThan(0);

    for (const [key, frozen] of Object.entries(sqlBaselines)) {
      expect(frozen && typeof frozen === "object" && !Array.isArray(frozen), `baseline ${key} is not an object`).toBe(
        true,
      );
      expect(
        Object.keys(frozen as Record<string, unknown>).filter((field) => !emitted.has(field)),
        `frozen baseline ${key} carries fields the catalogue no longer emits`,
      ).toEqual([]);
    }
    expect(migration).toContain("create or replace function public.site_content_registry_source_render(");
    expect(migration).toContain("p_kind <> 'form' and p_row->'summary_cards' is distinct from 'null'::jsonb");
    expect(migration).toContain("v_baseline#>'{catalogPayload,actSections}'");
    expect(migration).toContain("create or replace function public.site_content_compact_text(p_parts text[]");
  });

  it("atomically advances the epoch, pending head, and ordered outbox", () => {
    const start = migration.indexOf("create or replace function public.publish_site_content_record(");
    const body = migration.slice(start, migration.indexOf("$$;", start));
    expect(body).toContain("pg_catalog.pg_advisory_xact_lock(93206431)");
    expect(body).toContain("from public.site_content_sync_state where singleton for update");
    expect(body).toContain("insert into public.site_content_publications");
    expect(body).toContain("insert into public.site_content_public_records");
    expect(body).toContain("insert into public.site_content_sync_events");
    expect(body).toContain("set pending_event_sequence = v_event_sequence");
    expect(body).toContain("set change_epoch = v_state.change_epoch + 1");
  });

  it("fences every post-claim mutation and bounds retry quarantine", () => {
    expect(migration).toContain("lease_generation = e.lease_generation + 1");
    expect(migration).toContain("for update skip locked limit p_limit");
    for (const marker of [
      "heartbeat_site_content_sync_event",
      "stage_site_content_sync_event",
      "fail_site_content_sync_event",
    ]) {
      const start = migration.indexOf(`create or replace function public.${marker}(`);
      const body = migration.slice(start, migration.indexOf("$$;", start));
      expect(body).toMatch(/(?:e|v_event)\.worker_id/);
      expect(body).toMatch(/(?:e|v_event)\.lease_token/);
      expect(body).toMatch(/(?:e|v_event)\.lease_generation/);
      expect(body).toContain("pg_catalog.clock_timestamp()");
    }
    expect(migration).toContain("state = case when e.attempt_count >= 5 then 'quarantined' else 'retry_pending' end");
  });

  it("reclaims expired processing work with a fresh fence and supersedes obsolete epochs", () => {
    const claimStart = migration.indexOf("create or replace function public.claim_site_content_sync_events(");
    const claim = migration.slice(claimStart, migration.indexOf("$$;", claimStart));
    expect(claim).toContain("e.state = 'processing' and e.lease_expires_at <= pg_catalog.clock_timestamp()");
    expect(claim).toContain("lease_token = gen_random_uuid()");
    expect(claim).toContain("lease_generation = e.lease_generation + 1");
    expect(migration).toContain("'superseded'");
    expect(migration).toContain("state in ('pending', 'retry_pending', 'processing', 'ready')");
    expect(migration).toContain("e.event_sequence <> v_event_sequence and e.target_change_epoch < change_epoch");
  });

  it("keeps terminal current-head work fail-closed until a represented activation", () => {
    const readStart = migration.indexOf("create or replace function public.read_site_content_public_records(");
    const read = migration.slice(readStart, migration.indexOf("$$;", readStart));
    expect(read).toContain("h.pending_event_sequence is not null");
    expect(read).not.toContain("e.state in ('pending', 'retry_pending', 'processing', 'ready')");
    expect(read).toContain("h.head_change_epoch > s.served_change_epoch");
  });

  it("binds retirement events to tombstones through plan, stage, and activation", () => {
    const recordPlanStart = migration.indexOf("create or replace function public.record_site_content_sync_event_plan(");
    const recordPlan = migration.slice(recordPlanStart, migration.indexOf("$$;", recordPlanStart));
    expect(recordPlan).toContain("p_plan->'tombstones'");
    expect(recordPlan).toContain("item->>'targetPublicationId' = v_event.target_publication_id::text");
    const activateStart = migration.indexOf("create or replace function public.activate_site_content_release(");
    const activate = migration.slice(activateStart, migration.indexOf("$$;", activateStart));
    expect(activate).toContain("rr.tombstone is distinct from h.retired");
  });

  it("content-addresses exact reconciliation and binds first adoption through activation", () => {
    const recordStart = migration.indexOf("create or replace function public.record_site_content_reconciliation_plan(");
    const record = migration.slice(recordStart, migration.indexOf("$$;", recordStart));
    expect(record).toContain("site-content-reconciliation-plan-v1");
    expect(record).toContain("site_content_json_sha256");
    expect(record).toContain("trustedSnapshots");
    expect(record).toContain("expectedGroupCount");
    expect(record).toContain("site_content_source_projection");
    expect(record).toContain("identical_duplicate");
    expect(record).toContain("v_item->>'contentHash' is distinct from source.record->>'contentHash'");
    expect(record).toContain("sourceRowId");
    expect(record).toContain("sourceVersion");
    expect(record).toContain("contentHash");
    expect(record).toContain("publicationVersion");
    expect(record).toContain("trustedSnapshotDigest");
    expect(record).toContain("batchCount");
    expect(record).toContain("disposition");
    const publishStart = migration.indexOf("create or replace function public.publish_site_content_record(");
    const publish = migration.slice(publishStart, migration.indexOf("$$;", publishStart));
    expect(publish).toContain("item->>'sourceRowId' = p_source_row_id::text");
    expect(publish).toContain("item->>'sourceVersion' = v_source.source_version");
    expect(publish).toContain("item->>'contentHash' = v_source.record->>'contentHash'");
    const activateStart = migration.indexOf("create or replace function public.activate_site_content_release(");
    const activate = migration.slice(activateStart, migration.indexOf("$$;", activateStart));
    expect(activate).toContain("site_content_reconciliation_plans");
    expect(activate).toContain("reconciliation_plan_digest");
  });

  it("verifies immutable plan semantics, complete staging, vectors, digests, checks and receipt identities", () => {
    const recordPlanStart = migration.indexOf("create or replace function public.record_site_content_sync_event_plan(");
    const recordPlan = migration.slice(recordPlanStart, migration.indexOf("$$;", recordPlanStart));
    expect(recordPlan).toContain("site_content_json_sha256");
    expect(recordPlan).toContain("p_plan - 'planDigest'");
    const stageStart = migration.indexOf("create or replace function public.stage_site_content_sync_event(");
    const stage = migration.slice(stageStart, migration.indexOf("$$;", stageStart));
    for (const field of [
      "normalizedText",
      "targetPublicationId",
      "publicationFingerprint",
      "contentHash",
      "governanceFingerprint",
      "lineageFingerprint",
      "publicMetadataFingerprint",
      "embeddingModel",
      "embeddingDimensions",
      "embeddingFingerprint",
      "reuseEmbedding",
      "renderPayload",
    ]) {
      expect(stage, field).toContain(field);
    }
    expect(stage).toContain("count(distinct staged->>'logicalId')");
    expect(stage).toContain("extensions.vector_dims");
    expect(stage).toContain("site_content_stage_population_mismatch");
    expect(stage).toContain("site_content_stage_authoritative_check_failed");
    const activateStart = migration.indexOf("create or replace function public.activate_site_content_release(");
    const activate = migration.slice(activateStart, migration.indexOf("$$;", activateStart));
    expect(activate).toContain("site_content_release_digest");
    expect(activate).toContain("site_content_dynamic_state_digest");
    expect(activate).toContain("site_content_provider_free_checks_pass");
    expect(migration).toContain("activation-receipt-identity-v1");
    expect(migration).toContain("rollback-receipt-identity-v1");
  });

  it("reads retained public bytes from the active release and rollback only switches immutable pointers", () => {
    const readStart = migration.indexOf("create or replace function public.read_site_content_public_records(");
    const read = migration.slice(readStart, migration.indexOf("$$;", readStart));
    expect(read).toContain("rr.render_payload");
    expect(read).not.toContain("p.render_payload");
    expect(read).not.toContain("rr.target_publication_id = h.current_publication_id");
    const rollbackStart = migration.indexOf("create or replace function public.rollback_site_content_release(");
    const rollback = migration.slice(rollbackStart, migration.indexOf("$$;", rollbackStart));
    expect(rollback).toContain("active_release_id = p_target_release_id");
    expect(rollback).not.toContain("update public.site_content_public_records");
    expect(migration).toContain("site-content-bootstrap-public-release-v1");
    expect(migration).toContain("create or replace function public.site_content_bootstrap_digest(");
    expect(read).toContain("rr.target_publication_id is null");
    expect(read).not.toContain("case when s.initialized then r.record else null end");
    expect(rollback).toContain("site_content_bootstrap_digest(v_target.id)");
    expect(rollback).toContain("bootstrap-no-embedding-1536-v1");
  });

  it("uses a recursive public allowlist and P03-equivalent canonical projections", () => {
    expect(migration).toContain("create or replace function public.site_content_public_json_projection(");
    expect(migration).toContain("p_path || entry.key");
    expect(migration).toContain("when p_path = array['source'] then");
    expect(migration).toContain("clinicalRegistryRecordToCorpusEntry");
    expect(migration).toContain("medicationRecordToCorpusEntry");
    expect(migration).toContain("differentialRecordToCorpusEntry");
    expect(migration).not.toContain("render_payload := v_row - array[");
    const sourceProjectionStart = migration.indexOf(
      "create or replace function public.site_content_source_projection(",
    );
    const sourceProjection = migration.slice(sourceProjectionStart, migration.indexOf("$$;", sourceProjectionStart));
    expect(sourceProjection).not.toContain("p_record jsonb");
    expect(sourceProjection).not.toContain("p_render_payload jsonb");
    expect(sourceProjection).toContain("site_content_public_json_projection");
  });

  it("activates and rolls back retained immutable release records with exact receipts", () => {
    expect(migration).toContain("create table public.site_content_release_receipts");
    expect(migration).toContain("before update or delete on public.site_content_release_receipts");
    expect(migration).toContain("p_activation_receipt#>>'{resource,previousSiteReleaseId}'");
    expect(migration).toContain("p_rollback_receipt->>'activationReceiptId'");
    expect(migration).toContain("v_active.previous_release_id is distinct from p_target_release_id");
    const rollbackStart = migration.indexOf("create or replace function public.rollback_site_content_release(");
    const rollback = migration.slice(rollbackStart, migration.indexOf("$$;", rollbackStart));
    expect(rollback).not.toContain("v_activation.recovery_readiness_digest is distinct from p_recovery_digest");
    expect(migration).not.toMatch(/delete from public\.site_content_release/);
  });

  it("enforces the physical 1536-dimensional embedding contract at every SQL boundary", () => {
    expect(migration).toContain("embedding_dimensions integer not null check (embedding_dimensions = 1536)");
    const stageStart = migration.indexOf("create or replace function public.stage_site_content_sync_event(");
    const stage = migration.slice(stageStart, migration.indexOf("$$;", stageStart));
    expect(stage).toContain("(p_stage#>>'{embedding,dimensions}')::integer <> 1536");
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

  it("binds Australian public activation to v2 policy, committed generation, and reviewed state", () => {
    const sql = australianSourceActivationMigration;
    for (const column of [
      "source_catalogue_key text",
      "source_policy_version text",
      "reviewed_index_generation_id uuid",
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain("create or replace function public.activate_approved_public_documents(");
    expect(sql).toContain("p_manifest jsonb");
    expect(sql).toContain("p_expected_state_digest text");
    expect(sql).toContain("p_expected_generation_ids uuid[]");
    expect(sql).toContain("for update;");
    expect(sql).toContain("public.document_publication_state_digest(");
    expect(sql).toContain("v_document.index_generation_id is distinct from v_expected_index_generation_id");
    expect(sql).toContain("v_document.metadata->>'source_catalogue_key' is distinct from v_source_catalogue_key");
    expect(sql).toContain("v_document.metadata->>'source_policy_version' is distinct from v_source_policy_version");
    expect(sql).toContain("v_document.metadata->>'content_mode' is distinct from 'indexed_content'");
    expect(sql).toContain("v_document.metadata->>'licence_policy' is distinct from 'public_index_permitted'");
    expect(sql).toContain("v_document.metadata->>'document_status' is distinct from 'current'");
    expect(sql).toContain("v_document.metadata->>'change_state' in ('withdrawn', 'superseded')");
    expect(sql).toContain("approval.reviewed_index_generation_id = v_expected_index_generation_id");
    expect(sql).toContain("approval.source_catalogue_key = v_source_catalogue_key");
    expect(sql).toContain("approval.source_policy_version = v_source_policy_version");
    expect(sql).toContain("'source_policy_version', v_source_policy_version");
    expect(sql).toContain("'index_generation_id', v_expected_index_generation_id");

    const functionStart = sql.indexOf("create or replace function public.activate_approved_public_documents(");
    const functionBody = sql.slice(functionStart, sql.indexOf("$$;", functionStart));
    expect(functionBody).toContain("order by value->>'documentId'");
    expect(functionBody).toContain("array_agg(generation_id order by generation_id)");
    expect(functionBody).toContain("does not exactly match manifest");
    expect(functionBody).toContain("(document->>'expectedStateDigest') !~ '^[0-9a-f]{64}$'");
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
    expect(functionBody).toContain("coalesce(v_document.metadata->>'change_state', '') not in");
    expect(functionBody.indexOf("for update;")).toBeLessThan(
      functionBody.indexOf("v_current_document_state_digest := public.document_publication_state_digest("),
    );
    expect(functionBody.indexOf("v_current_document_state_digest :=")).toBeLessThan(
      functionBody.indexOf("v_publish_result := public.publish_approved_documents("),
    );
  });

  it.each([
    ["absent", {}],
    ["JSON null", { decision: null }],
    ["non-string", { decision: 42 }],
  ])("rejects a %s manifest decision before approval reuse", (_label, malformedEntry) => {
    const functionStart = australianSourceActivationMigration.indexOf(
      "create or replace function public.activate_approved_public_documents(",
    );
    const functionBody = australianSourceActivationMigration.slice(
      functionStart,
      australianSourceActivationMigration.indexOf("$$;", functionStart),
    );
    const decision = "decision" in malformedEntry ? malformedEntry.decision : undefined;
    expect(typeof decision).not.toBe("string");
    expect(functionBody).toContain("jsonb_typeof(document->'decision') is distinct from 'string'");
    expect(functionBody).toContain("document->>'decision' is null");
    expect(functionBody).toContain("jsonb_typeof(v_entry->'decision') is distinct from 'string'");
    expect(functionBody).toContain("v_decision is null");
    expect(functionBody.indexOf("jsonb_typeof(document->'decision')")).toBeLessThan(
      functionBody.indexOf("for v_entry in"),
    );
  });

  it("prevents one-statement publication from changing any reviewed document state", () => {
    const sql = australianSourceActivationMigration;
    const guardStart = sql.indexOf("create or replace function public.guard_australian_source_activation(");
    const guardBody = sql.slice(guardStart, sql.indexOf("$$;", guardStart));
    expect(guardBody).toContain(
      "to_jsonb(new) - array['owner_id', 'metadata', 'updated_at', 'search_tsv', 'title_search_tsv']",
    );
    expect(guardBody).toContain(
      "to_jsonb(old) - array['owner_id', 'metadata', 'updated_at', 'search_tsv', 'title_search_tsv']",
    );
    expect(guardBody).toContain("new.index_generation_id is distinct from old.index_generation_id");
    expect(guardBody).toContain("new.metadata - array[");
    for (const receiptKey of [
      "public_corpus",
      "publication_approval_id",
      "publication_manifest_digest",
      "publication_reviewed_state_digest",
      "published_at",
    ]) {
      expect(guardBody).toContain(`'${receiptKey}'`);
    }
    expect(guardBody).toContain("old.metadata - array[");
    expect(guardBody.indexOf("new.metadata - array[")).toBeLessThan(guardBody.indexOf("old.metadata - array["));
    expect(guardBody.indexOf("to_jsonb(new) - array[")).toBeLessThan(guardBody.indexOf("select * into v_approval"));
    expect(sql).toContain("after update on public.documents");
  });

  it("treats an already-public Australian relabel as activation but permits same-scope receipt updates", () => {
    const sql = australianSourceActivationMigration;
    const guardStart = sql.indexOf("create or replace function public.guard_australian_source_activation(");
    const guardBody = sql.slice(guardStart, sql.indexOf("$$;", guardStart));
    expect(guardBody).toContain("v_public_relabel_activation := old.owner_id is null");
    expect(guardBody).toContain("and new.owner_id is null");
    expect(guardBody).toContain("old.metadata->>'corpus_scope' is distinct from 'australian_public'");
    expect(guardBody).toContain("and new.metadata->>'corpus_scope' = 'australian_public'");
    expect(guardBody).toContain("if v_owned_public_activation or v_public_relabel_activation then");
    expect(guardBody).toContain("v_approval.expected_prior_owner_id is distinct from old.owner_id");
    expect(guardBody).not.toContain(
      "v_public_relabel_activation := old.owner_id is null and old.metadata->>'corpus_scope' = 'australian_public'",
    );
  });

  it("requires digest-bound Australian document identity metadata at approval and activation boundaries", () => {
    const sql = australianSourceActivationMigration;
    for (const exactGate of [
      "v_document.metadata->>'source_kind' is distinct from 'document'",
      "nullif(trim(v_document.metadata->>'publisher'), '') is null",
      "nullif(trim(v_document.metadata->>'publisher_code'), '') is null",
      "nullif(trim(v_document.metadata->>'jurisdiction'), '') is null",
      "nullif(trim(v_document.metadata->>'source_role'), '') is null",
    ]) {
      expect(sql).toContain(exactGate);
    }
    expect(sql).toContain("Australian public approval requires exact document identity metadata");
    expect(sql).toContain("Australian activation document % fails source identity, policy, or lifecycle gates");
  });

  it("uses only the canonical active change states for Australian activation", () => {
    const sql = australianSourceActivationMigration;
    expect(sql).toContain("not in ('changed', 'unchanged')");
    expect(sql).not.toContain("('new', 'changed', 'unchanged')");
  });

  it("allows only the exact bound v2 receipt enrichment on same-scope Australian public rows", () => {
    const sql = australianSourceActivationMigration;
    const guardStart = sql.indexOf("create or replace function public.guard_australian_source_activation(");
    const guardBody = sql.slice(guardStart, sql.indexOf("$$;", guardStart));
    expect(guardBody).toContain("v_same_scope_public_update := old.owner_id is null");
    expect(guardBody).toContain("old.metadata->>'corpus_scope' = 'australian_public'");
    expect(guardBody).toContain("and new.metadata->>'corpus_scope' = 'australian_public'");
    expect(guardBody).toContain(
      "v_v2_receipt_keys text[] := array['publication_manifest_version', 'publication_source_policy_version', 'publication_reviewed_index_generation_id']",
    );
    expect(guardBody).toContain("new.metadata - v_v2_receipt_keys");
    expect(guardBody).toContain("old.metadata - v_v2_receipt_keys");
    expect(guardBody).toContain("new.metadata->'publication_manifest_version' is distinct from '2'::jsonb");
    expect(guardBody).toContain(
      "new.metadata->>'publication_source_policy_version' is distinct from new.metadata->>'source_policy_version'",
    );
    expect(guardBody).toContain(
      "new.metadata->>'publication_reviewed_index_generation_id' is distinct from new.index_generation_id::text",
    );
    const v2KeysStart = guardBody.indexOf("v_v2_receipt_keys text[] := array[");
    const v2KeysEnd = guardBody.indexOf("];", v2KeysStart);
    const v2Keys = guardBody.slice(v2KeysStart, v2KeysEnd);
    for (const genericReceiptKey of [
      "public_corpus",
      "publication_approval_id",
      "publication_manifest_digest",
      "publication_reviewed_state_digest",
      "published_at",
    ]) {
      expect(v2Keys).not.toContain(`'${genericReceiptKey}'`);
    }
  });

  it("rejects same-scope Australian governed-state mutations without recursive writes", () => {
    const sql = australianSourceActivationMigration;
    const guardStart = sql.indexOf("create or replace function public.guard_australian_source_activation(");
    const guardBody = sql.slice(guardStart, sql.indexOf("$$;", guardStart));
    expect(guardBody).toContain("if v_same_scope_public_update then");
    expect(guardBody).toContain("Australian public governed state changed; unpublish and reapprove");
    expect(guardBody).not.toContain("update public.documents");
    expect(guardBody.indexOf("new.metadata - v_v2_receipt_keys")).toBeLessThan(
      guardBody.indexOf("Australian public governed state changed; unpublish and reapprove"),
    );
  });

  it("keeps Australian activation append-only and service-role-only while rejecting v1/link-only transitions", () => {
    const sql = australianSourceActivationMigration;
    expect(sql).toContain("old.metadata->>'corpus_scope' = 'australian_public'");
    expect(sql).toContain("or new.metadata->>'corpus_scope' = 'australian_public'");
    expect(sql).toContain("publication_manifest_version");
    expect(sql).toContain("Australian public transition requires manifest v2 evidence");
    expect(sql).toContain("Australian public transition rejects link-only content");
    expect(sql).toContain(
      "revoke all on function public.activate_approved_public_documents(jsonb, text, uuid[]) from public, anon, authenticated;",
    );
    expect(sql).toContain(
      "grant execute on function public.activate_approved_public_documents(jsonb, text, uuid[]) to service_role;",
    );
    expect(sql).toContain("before update or delete on public.document_publication_approvals");
    expect(sql).not.toContain("grant select on table public.document_publication_approvals to anon");
    expect(sql).not.toContain("grant select on table public.document_publication_approvals to authenticated");
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

  it("requires a login token on indexing-v3-agent and has the cron invoker send one beside the shared secret", () => {
    const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
    expect(config).toContain("[functions.indexing-v3-agent]\nverify_jwt = true");
    const migration = readFileSync(
      new URL("../supabase/migrations/20260926041100_indexing_v3_agent_cron_sends_jwt.sql", import.meta.url),
      "utf8",
    );
    for (const sql of [schema, migration]) {
      expect(sql).toContain("where name = 'cron_ingestion_jwt'");
      expect(sql).toContain("jsonb_build_object('Authorization', 'Bearer ' || trim(v_jwt))");
      expect(sql).toContain("'x-indexing-agent-secret', v_secret");
      expect(sql).toContain("headers := v_headers,");
    }
    expect(migration).toContain(
      "revoke execute on function public.invoke_indexing_v3_agent(integer) from public, anon, authenticated",
    );
    expect(migration).toContain("grant execute on function public.invoke_indexing_v3_agent(integer) to service_role");
  });

  it("retires invoke_ingestion_worker: unscheduled, dropped, and absent from the schema snapshot", () => {
    const retirement = readFileSync(
      new URL("../supabase/migrations/20260926041000_retire_invoke_ingestion_worker.sql", import.meta.url),
      "utf8",
    );
    expect(retirement).toContain("where command ilike '%invoke_ingestion_worker%'");
    expect(retirement).toContain("perform cron.unschedule(job.jobid);");
    expect(retirement).toContain("drop function if exists public.invoke_ingestion_worker(integer);");
    expect(schema).not.toContain("function public.invoke_ingestion_worker");
    expect(schema).not.toContain("/functions/v1/ingestion-worker");
  });

  it("moved invoke_ingestion_worker to the GUC base-URL pattern with service-role-only execute before retirement", () => {
    for (const sql of [invokeIngestionWorkerGucMigration]) {
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

  describe("public source control plane", () => {
    function controlPlaneSql() {
      return readFileSync(
        new URL("../supabase/migrations/20260824121000_create_public_source_control_plane.sql", import.meta.url),
        "utf8",
      ).replace(/\s+/g, " ");
    }

    it("creates append-only service-role-only activation and exact-version tables", () => {
      const sql = controlPlaneSql();
      for (const table of [
        "public_source_policy_entries",
        "public_source_activation_events",
        "public_source_versions",
      ]) {
        expect(sql).toContain(`create table public.${table}`);
        expect(sql).toContain(`alter table public.${table} enable row level security`);
        expect(sql).toContain(`revoke all on table public.${table} from public, anon, authenticated, service_role`);
        expect(sql).toContain(`grant select on table public.${table} to service_role`);
        expect(sql).not.toMatch(new RegExp(`grant (insert|update|delete|all).*public\\.${table}.*service_role`, "i"));
        expect(sql).not.toContain(`grant select on table public.${table} to anon`);
        expect(sql).not.toContain(`grant select on table public.${table} to authenticated`);
      }
      expect(sql).toContain("before update or delete on public.public_source_activation_events");
      expect(sql).toContain("public source activation events are append-only");
      expect(sql).toContain("public source version immutable fields changed");
    });

    it("separates streamed raw-response provenance from stored document integrity", () => {
      const sql = controlPlaneSql();
      const types = readFileSync("src/lib/supabase/database.types.ts", "utf8");
      expect(sql).toContain("raw_response_hash text not null check (raw_response_hash ~ '^[0-9a-f]{64}$')");
      expect(sql).toContain("raw_response_byte_count bigint not null check (raw_response_byte_count >= 0)");
      expect(sql).toContain("v_version.raw_response_hash is distinct from p_manifest->>'rawResponseHash'");
      expect(sql).toContain(
        "v_version.raw_response_byte_count is distinct from (p_manifest->>'rawResponseByteCount')::bigint",
      );
      expect(sql).toContain("metadata'->>'raw_response_hash' is distinct from v_version.raw_response_hash");
      expect(sql).toContain(
        "metadata'->>'raw_response_byte_count' is distinct from v_version.raw_response_byte_count::text",
      );
      expect(sql).toContain("'raw_response_hash', 'raw_response_byte_count'");
      expect(types).toContain("raw_response_hash: string;");
      expect(types).toContain("raw_response_byte_count: number;");
    });

    it("binds activation and reservation to the immutable exact eligible-source policy", () => {
      const sql = controlPlaneSql();
      expect(sql).toContain("create table public.public_source_policy_entries");
      expect(sql).toContain("public source policy entries are immutable");
      expect(sql).toContain("'wa-health', 'https://www.health.wa.gov.au/About-us/Policy-frameworks'");
      expect(sql).not.toContain("('etg-complete', 'https://www.tg.org.au/'");
      expect(sql).not.toContain("('nps-medicinewise', 'https://www.medicinewise.org.au/'");
      expect(sql).toContain("exact_document_licence = 'public_index_permitted'");
      for (const source of australianSourceCatalogue) {
        const eligible =
          source.lifecycle === "active" &&
          source.contentMode === "indexed_content" &&
          source.licencePolicy !== "index_forbidden";
        const rowPrefix = `('${source.key}', '${source.canonicalUrl}'`;
        if (eligible) expect(sql).toContain(rowPrefix);
        else expect(sql).not.toContain(rowPrefix);
      }
      const activation = sql.slice(
        sql.indexOf("create or replace function public.record_public_source_activation("),
        sql.indexOf("$$;", sql.indexOf("create or replace function public.record_public_source_activation(")),
      );
      expect(activation).toContain("from public.public_source_policy_entries");
      expect(activation).toContain("source is not eligible for activation");
    });

    it("serializes first activation and fetch-manifest races with fixed-path definers", () => {
      const sql = controlPlaneSql();
      expect(sql).toContain("pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_source_catalogue_key, 0))");
      expect(sql).toContain("93b99a99f19ac2ae7f316e4b7b4aba24bc756e62c9c9cd51f113df996d517a3f");
      expect(sql).toContain("activation_sequence bigint generated always as identity");
      expect(sql).toContain("order by activation_sequence desc");
      expect(sql).not.toContain("order by created_at desc, id desc");
      expect(sql).toContain("for update");
      expect(sql).toContain("security definer set search_path = ''");
      expect(sql).toContain("source definition is not active for controlled acquisition");
      expect(sql).toContain("source policy digest does not match the active definition");
      expect(sql).toContain("public source reservation manifest conflicts with existing identity");
    });

    it("uses a monotonic event sequence when activate and retire share one transaction timestamp", () => {
      const sql = controlPlaneSql();
      const sameTransactionEvents = [
        { activation_sequence: 41, decision: "activate", created_at: "2026-08-24T00:00:00.000Z" },
        { activation_sequence: 42, decision: "retire", created_at: "2026-08-24T00:00:00.000Z" },
      ];
      expect(
        [...sameTransactionEvents].sort((a, b) => b.activation_sequence - a.activation_sequence)[0]?.decision,
      ).toBe("retire");
      expect(sql.match(/order by activation_sequence desc/g)?.length).toBeGreaterThanOrEqual(7);
      expect(sql).not.toMatch(/order by created_at desc, id desc/i);
    });

    it("preflights exact current authority before provider access while reserve and finalize recheck it", () => {
      const sql = controlPlaneSql();
      const preflightStart = sql.indexOf("create or replace function public.preflight_public_source_acquisition(");
      const preflight = sql.slice(preflightStart, sql.indexOf("$$;", preflightStart));
      expect(preflightStart).toBeGreaterThan(-1);
      expect(preflight).toContain("activationSequence");
      expect(preflight).toContain("v_event.activation_sequence");
      expect(preflight).toContain("from public.public_source_policy_entries");
      expect(preflight).toContain("exact version URL is outside the eligible canonical host");
      expect(preflight).toContain("source definition is not active for controlled acquisition");
      expect(preflight).toContain("order by activation_sequence desc");
      expect(preflight).toContain("from auth.users");
      expect(preflight).toContain("stewardId");
      expect(preflight).toContain("storageBucket");
      for (const name of [
        "reserve_public_source_version",
        "authorize_public_source_upload",
        "finalize_public_source_version",
      ]) {
        const start = sql.indexOf(`create or replace function public.${name}(`);
        const body = sql.slice(start, sql.indexOf("$$;", start));
        expect(start, name).toBeGreaterThan(-1);
        expect(body).toContain("order by activation_sequence desc");
        expect(body).toContain("v_event.activation_sequence");
        expect(body).toContain("from auth.users");
        expect(body).toContain("stewardId");
        expect(body).toContain("storageBucket");
      }
    });

    it("retains steward authority and exact storage identity for every governed lifecycle", () => {
      const sql = controlPlaneSql();
      expect(sql).toContain("steward_id uuid not null references auth.users(id) on delete restrict");
      expect(sql).toContain("storage_bucket text not null");
      expect(sql).toContain("upload_lease_token uuid not null");
      expect(sql).toContain("upload_lease_expires_at timestamptz not null");
      expect(sql).toContain("upload_state text not null");
      expect(sql).toContain("storage_bucket ~ '^[a-z0-9][a-z0-9._-]{0,62}$'");
      for (const name of [
        "finalize_public_source_version",
        "abandon_public_source_reservation",
        "withdraw_public_source_version",
      ]) {
        const start = sql.indexOf(`create or replace function public.${name}(`);
        const body = sql.slice(start, sql.indexOf("$$;", start));
        expect(body, name).toContain("v_version.steward_id");
        expect(body, name).toContain("auth.users");
      }
    });

    it("reserves current authority before writes and finalizes document, optional job, and version atomically", () => {
      const sql = controlPlaneSql();
      const reserve = sql.slice(
        sql.indexOf("create or replace function public.reserve_public_source_version("),
        sql.indexOf("$$;", sql.indexOf("create or replace function public.reserve_public_source_version(")),
      );
      const finalize = sql.slice(
        sql.indexOf("create or replace function public.finalize_public_source_version("),
        sql.indexOf("$$;", sql.indexOf("create or replace function public.finalize_public_source_version(")),
      );
      for (const body of [reserve, finalize]) {
        expect(body).toContain("from public.public_source_policy_entries");
        expect(body).toContain("source policy digest does not match the active definition");
        expect(body).toContain("exact version URL is outside the eligible canonical host");
      }
      expect(reserve).toContain("reservation_key");
      expect(reserve).toContain("supersedes_version_id");
      expect(finalize).toContain("insert into public.documents");
      expect(finalize).toContain("insert into public.ingestion_jobs");
      expect(finalize).toContain("p_manifest->>'disposition' = 'shadow'");
      expect(finalize).toContain("p_manifest->>'disposition' = 'quarantined'");
      expect(finalize).toContain("review_queued_at = case when p_manifest->>'disposition' = 'quarantined'");
      expect(finalize).toContain("v_document.content_hash is distinct from v_version.content_hash");
      expect(finalize).toContain(
        "v_document.metadata->>'exact_version_url' is distinct from v_version.exact_version_url",
      );
      expect(finalize).not.toContain("create_uploaded_document_with_ingestion_job(");
      expect(finalize).not.toContain("publish_approved_documents(");
      expect(finalize).not.toContain("activate_approved_public_documents(");
    });

    it("permits only the legal lifecycle and never discovered or shadow directly to active", () => {
      const sql = controlPlaneSql();
      expect(sql).toContain("('discovered', 'shadow')");
      expect(sql).toContain("('discovered', 'quarantined')");
      expect(sql).toContain("('discovered', 'tombstoned')");
      expect(sql).toContain("('shadow', 'approved')");
      expect(sql).toContain("('approved', 'active')");
      expect(sql).toContain("old.lifecycle = 'tombstoned'");
      expect(sql).not.toContain("('discovered', 'active')");
      expect(sql).not.toContain("('shadow', 'active')");
      const start = sql.indexOf("create or replace function public.transition_public_source_version(");
      const body = sql.slice(start, sql.indexOf("$$;", start));
      expect(body).toContain("order by activation_sequence desc");
      expect(body).toContain("v_event.id is distinct from p_activation_event_id");
    });

    it("consumes matching P02 approval and public receipt facts without creating approvals", () => {
      const sql = controlPlaneSql();
      expect(sql).toContain("from public.document_publication_approvals approval");
      expect(sql).toContain("approval.source_catalogue_key = v_version.source_catalogue_key");
      expect(sql).toContain("approval.source_policy_version = v_version.source_policy_version");
      expect(sql).toContain("approval.reviewed_index_generation_id = v_document.index_generation_id");
      expect(sql).toContain("v_document.metadata->>'publication_approval_id'");
      expect(sql).toContain("v_document.owner_id is not null");
      expect(sql).not.toContain("insert into public.document_publication_approvals");
      expect(sql).not.toContain("publish_approved_documents(");
      const transitionStart = sql.indexOf("create or replace function public.transition_public_source_version(");
      const transition = sql.slice(transitionStart, sql.indexOf("$$;", transitionStart));
      expect(transition).not.toContain("activate_approved_public_documents(");
    });

    it("rechecks governance when workers claim and commit governed artifacts", () => {
      const sql = controlPlaneSql();
      expect(sql).toContain("create or replace function public.claim_ingestion_jobs(");
      expect(sql).toContain("create or replace function public.commit_document_index_generation(");
      for (const gate of [
        "source_catalogue_key",
        "source_policy_version",
        "source_policy_digest",
        "corpus_scope",
        "public_source_activation_event_id",
        "public_source_version_id",
        "public_source_steward_id",
        "content_mode",
        "licence_policy",
      ]) {
        expect(sql).toContain(gate);
      }
      expect(sql).toContain("governed public source is no longer active");
      expect(sql).toContain("governed public source document lost steward ownership");
      expect(sql).toContain("create trigger documents_guard_public_source_identity");
      expect(sql).toContain("new.content_hash is distinct from old.content_hash");
      expect(sql).toContain(
        "v_merged_metadata := coalesce(v_document.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb)",
      );
      expect(sql).toContain("governed public source artifact commit removed or changed policy identity");
      expect(sql).toContain("not (v_merged_metadata ? v_key)");
      expect(sql).toContain("jsonb_typeof(v_merged_metadata->v_key) = 'null'");
    });

    it("preserves generic P02 documents while old or new Task2 markers stay fail-closed", () => {
      const sql = controlPlaneSql();
      const triggerStart = sql.indexOf("create or replace function public.guard_public_source_document_identity(");
      const trigger = sql.slice(triggerStart, sql.indexOf("$$;", triggerStart));
      expect(trigger).toContain("new.metadata->>'public_source_version_id' is not null");
      expect(trigger).toContain("old.metadata->>'public_source_version_id' is not null");
      expect(trigger).not.toContain("new.metadata->>'corpus_scope' = 'australian_public' or");
      expect(trigger).toContain("not (new.metadata ? v_key)");
      expect(trigger).toContain("jsonb_typeof(new.metadata->v_key) = 'null'");
      const assertionStart = sql.indexOf("create or replace function public.assert_public_source_document_governance(");
      const assertion = sql.slice(assertionStart, sql.indexOf("$$;", assertionStart));
      expect(assertion).toContain("if v_version_id is null then return; end if");
      const claimStart = sql.indexOf("create or replace function public.claim_ingestion_jobs(");
      const claim = sql.slice(claimStart, sql.indexOf("$$;", claimStart));
      expect(claim).toContain("d.metadata->>'public_source_version_id' is null or (");
      expect(claim).not.toContain("d.metadata->>'corpus_scope' is distinct from 'australian_public'");
      const genericP02 = { corpus_scope: "australian_public", source_catalogue_key: "wa-health" };
      expect(genericP02).not.toHaveProperty("public_source_version_id");
    });

    it("uses one global advisory-event-document-version lock order with post-lock revalidation", () => {
      const sql = controlPlaneSql();
      for (const name of [
        "finalize_public_source_version",
        "assert_public_source_document_governance",
        "transition_public_source_version",
        "activate_public_source_version",
        "abandon_public_source_reservation",
        "withdraw_public_source_version",
      ]) {
        const start = sql.indexOf(`create or replace function public.${name}(`);
        const body = sql.slice(start, sql.indexOf("$$;", start));
        const advisory = body.indexOf("lock-order: advisory");
        const event = body.indexOf("lock-order: latest-event");
        const document = body.indexOf("lock-order: document");
        const version = body.indexOf("lock-order: version");
        expect(advisory, name).toBeGreaterThan(-1);
        expect(event, name).toBeGreaterThan(advisory);
        expect(document, name).toBeGreaterThan(event);
        expect(version, name).toBeGreaterThan(document);
        expect(body).toContain("governance changed while locks were acquired");
      }
    });

    it("performs controlled single-active replacement with linked immutable history", () => {
      const sql = controlPlaneSql();
      expect(sql).toContain("create unique index public_source_versions_one_active_per_catalogue_idx");
      expect(sql).toContain("where lifecycle = 'active'");
      expect(sql).toContain("supersedes_version_id");
      const transition = sql.slice(
        sql.indexOf("create or replace function public.transition_public_source_version("),
        sql.indexOf("$$;", sql.indexOf("create or replace function public.transition_public_source_version(")),
      );
      const activation = sql.slice(
        sql.indexOf("create or replace function public.activate_public_source_version("),
        sql.indexOf("$$;", sql.indexOf("create or replace function public.activate_public_source_version(")),
      );
      expect(transition).toContain("controlled public source activation RPC");
      expect(activation).toContain("activate_approved_public_documents(");
      expect(activation).toContain("app.public_source_controlled_activation");
      expect(activation).toContain("replacement requires the currently active predecessor");
      expect(activation).toContain("v_prior_approval");
      expect(activation).toContain("lifecycle = 'tombstoned'");
      expect(activation).toContain("v_prior_document.id, v_prior_version.steward_id, 'superseded'");
      expect(activation).toContain("public.restore_public_source_document_to_steward(");
      expect(activation.indexOf("set lifecycle = 'tombstoned'")).toBeLessThan(
        activation.indexOf("set lifecycle = 'active'"),
      );
      expect(sql).toContain("generic P02 publication is forbidden for governed public sources");
    });

    it("abandons only unfinalized unowned reservations and permits later authority to retry", () => {
      const sql = controlPlaneSql();
      expect(sql).toContain("'abandoned'");
      expect(sql).toContain("create unique index public_source_versions_reservation_key_live_idx");
      expect(sql).toContain("create unique index public_source_versions_catalogue_hash_live_idx");
      expect(sql).toContain("where lifecycle <> 'abandoned'");
      const start = sql.indexOf("create or replace function public.abandon_public_source_reservation(");
      const body = sql.slice(start, sql.indexOf("$$;", start));
      expect(start).toBeGreaterThan(-1);
      expect(body).toContain("v_version.staging_document_id is not null");
      expect(body).toContain("from public.documents where id = v_version.reserved_document_id");
      expect(body).toContain("from public.ingestion_jobs where document_id = v_version.reserved_document_id");
      expect(body).toContain("set lifecycle = 'abandoned'");
      expect(body).toContain("'storage_owned', false");
      expect(body).toContain("public_source_upload_attempts");
      expect(body).toContain("v_attempt.state in ('authorized', 'bound')");
      expect(body).toContain("perform public.schedule_public_source_upload_attempt_cleanup(v_attempt.id)");
      expect(body).not.toContain("delete from public.public_source_versions");
      expect(body).not.toContain("delete from public.documents");
    });

    it("uses immutable cleanup columns, uniqueness, and lease grace instead of mutable metadata identity", () => {
      const sql = controlPlaneSql();
      expect(sql).toContain("add column public_source_reservation_id uuid");
      expect(sql).toContain("add column public_source_upload_attempt_id uuid");
      expect(sql).toContain("add column public_source_storage_bucket text");
      expect(sql).toContain("add column public_source_storage_path text");
      expect(sql).toContain("add column public_source_cleanup_not_before timestamptz");
      expect(sql).toContain("unique (public_source_upload_attempt_id)");
      expect(sql).toContain("public_source_cleanup_bucket_path_idx");
      expect(sql).toContain("signed_authority_expires_at + interval '60 seconds' + interval '5 minutes'");
      expect(sql).toContain("create trigger storage_cleanup_jobs_guard_public_source_identity");
      expect(sql).toContain("public source cleanup identity is immutable");
      const types = readFileSync("src/lib/supabase/database.types.ts", "utf8");
      for (const field of [
        "public_source_reservation_id",
        "public_source_storage_bucket",
        "public_source_storage_path",
        "public_source_cleanup_not_before",
        "storage_bucket",
        "upload_lease_token",
        "upload_lease_expires_at",
        "upload_state",
      ]) {
        expect(types).toContain(`${field}:`);
      }
    });

    it("rejects forged cleanup authority unless the exact reservation is terminal and cleanup-pending", () => {
      const sql = controlPlaneSql();
      const triggerStart = sql.indexOf("create or replace function public.guard_public_source_cleanup_job_identity(");
      const trigger = sql.slice(triggerStart, sql.indexOf("$$;", triggerStart));
      for (const contract of [
        "v_attempt.state is distinct from 'cleanup_pending'",
        "v_attempt.version_id is distinct from v_version.id",
        "new.public_source_upload_attempt_id is distinct from v_attempt.id",
        "new.public_source_cleanup_not_before is distinct from v_attempt.cleanup_not_before",
        "new.image_paths is distinct from '{}'::text[]",
        "public source cleanup mutation guard is missing",
      ]) {
        expect(trigger).toContain(contract);
      }
      const eligible = (fixture: {
        attemptState: string;
        imagePaths: string[];
        deadline: number;
        expectedDeadline: number;
      }) =>
        fixture.attemptState === "cleanup_pending" &&
        fixture.imagePaths.length === 0 &&
        fixture.deadline === fixture.expectedDeadline;
      const valid = {
        attemptState: "cleanup_pending",
        imagePaths: [],
        deadline: 20,
        expectedDeadline: 20,
      };
      expect(eligible(valid)).toBe(true);
      for (const forged of [
        { ...valid, attemptState: "authorized" },
        { ...valid, attemptState: "bound" },
        { ...valid, attemptState: "finalized" },
        { ...valid, attemptState: "cleaned" },
        { ...valid, imagePaths: ["unrelated/image.png"] },
        { ...valid, deadline: 19 },
        { ...valid, deadline: 21 },
      ]) {
        expect(eligible(forged)).toBe(false);
      }
    });

    it("claims and completes Task2 cleanup only through DB-clock CAS RPCs", () => {
      const sql = controlPlaneSql();
      expect(sql).toContain("create table public.public_source_cleanup_mutation_guards");
      expect(sql).toContain("public_source_claim_token uuid");
      expect(sql).toContain("public_source_claim_expires_at timestamptz");
      expect(sql).toContain("status in ('pending', 'processing', 'completed', 'failed')");
      expect(sql).toContain(
        "revoke all on table public.public_source_cleanup_mutation_guards from public, anon, authenticated, service_role",
      );
      for (const name of [
        "claim_public_source_cleanup_job",
        "complete_public_source_cleanup_job",
        "release_public_source_cleanup_job",
      ]) {
        const start = sql.indexOf(`create or replace function public.${name}(`);
        const body = sql.slice(start, sql.indexOf("$$;", start));
        expect(start, name).toBeGreaterThan(-1);
        expect(body, name).toContain("pg_catalog.clock_timestamp()");
        expect(body, name).toContain("for update");
        expect(body, name).toContain("public_source_claim_token");
        expect(body, name).toContain("public_source_cleanup_mutation_guards");
        expect(body, name).toContain("public_source_upload_attempts");
        expect(body, name).toContain("v_attempt.state is distinct from 'cleanup_pending'");
      }
      const claimStart = sql.indexOf("create or replace function public.claim_public_source_cleanup_job(");
      const claim = sql.slice(claimStart, sql.indexOf("$$;", claimStart));
      expect(claim).toContain("public_source_cleanup_not_before <= pg_catalog.clock_timestamp()");
      expect(claim).toContain("gen_random_uuid()");
      expect(claim).toContain("'imagePaths', jsonb_build_array()");
      const completeStart = sql.indexOf("create or replace function public.complete_public_source_cleanup_job(");
      const complete = sql.slice(completeStart, sql.indexOf("$$;", completeStart));
      expect(complete).toContain("status is distinct from 'processing'");
      expect(complete).toContain("public_source_claim_token is distinct from p_claim_token");
      expect(complete).toContain("set status = 'completed'");
      const releaseStart = sql.indexOf("create or replace function public.release_public_source_cleanup_job(");
      const release = sql.slice(releaseStart, sql.indexOf("$$;", releaseStart));
      expect(release).toContain("set status = 'failed'");
    });

    it("makes upload authorization exclusive and rotates an unpredictable attempt token under locks", () => {
      const sql = controlPlaneSql();
      const start = sql.indexOf("create or replace function public.authorize_public_source_upload(");
      const body = sql.slice(start, sql.indexOf("$$;", start));
      expect(body).toContain("v_prior_attempt.claim_expires_at > pg_catalog.clock_timestamp()");
      expect(body).toContain("v_attempt_id uuid := gen_random_uuid()");
      expect(body).toContain("v_attempt_token uuid := gen_random_uuid()");
      expect(body).toContain("upload_lease_token = v_attempt_token");
      expect(body).toContain("v_attempt_expires_at timestamptz := pg_catalog.clock_timestamp() + interval '2 minutes'");
      expect(body).toContain("insert into public.public_source_upload_attempts");
      const finalizeStart = sql.indexOf("create or replace function public.finalize_public_source_version(");
      const finalize = sql.slice(finalizeStart, sql.indexOf("$$;", finalizeStart));
      expect(finalize).toContain("v_version.upload_lease_token is distinct from v_upload_lease_token");
      const abandonStart = sql.indexOf("create or replace function public.abandon_public_source_reservation(");
      const abandon = sql.slice(abandonStart, sql.indexOf("$$;", abandonStart));
      expect(abandon).toContain("v_version.upload_lease_token is distinct from v_upload_lease_token");
    });

    it("keeps immutable per-attempt history and binds provider-signed expiry before storage", () => {
      const sql = controlPlaneSql();
      expect(sql).toContain("create table public.public_source_upload_attempts");
      expect(sql).toContain("signed_authority_digest text");
      expect(sql).toContain("signed_authority_expires_at timestamptz");
      expect(sql).toContain("cleanup_not_before timestamptz not null");
      expect(sql).toContain("unique (storage_bucket, storage_path)");
      expect(sql).toContain("current_upload_attempt_id uuid");
      expect(sql).toContain("finalized_upload_attempt_id uuid");
      expect(sql).toContain("create or replace function public.bind_public_source_upload_authority(");
      const authorizeStart = sql.indexOf("create or replace function public.authorize_public_source_upload(");
      const authorize = sql.slice(authorizeStart, sql.indexOf("$$;", authorizeStart));
      expect(authorize).toContain("insert into public.public_source_upload_attempts");
      expect(authorize).toContain("gen_random_uuid()");
      expect(authorize).toContain("public-source-staging/");
      expect(authorize).toContain("state = 'cleanup_pending'");
      const bindStart = sql.indexOf("create or replace function public.bind_public_source_upload_authority(");
      const bind = sql.slice(bindStart, sql.indexOf("$$;", bindStart));
      expect(bind).toContain("signed_authority_digest");
      expect(bind).toContain("signed_authority_expires_at");
      expect(bind).toContain("interval '60 seconds'");
      expect(bind).toContain("interval '5 minutes'");
      expect(bind).toContain("for update");
      for (const name of ["finalize_public_source_version", "abandon_public_source_reservation"]) {
        const start = sql.indexOf(`create or replace function public.${name}(`);
        const body = sql.slice(start, sql.indexOf("$$;", start));
        expect(body, name).toContain("uploadAttemptId");
        expect(body, name).toContain("signedAuthorityDigest");
        expect(body, name).toContain("signedAuthorityExpiresAt");
        expect(body, name).toContain("public_source_upload_attempts");
      }
      for (const name of [
        "authorize_public_source_upload",
        "reap_expired_public_source_upload_attempts",
        "bind_public_source_upload_authority",
        "finalize_public_source_version",
        "abandon_public_source_reservation",
        "claim_public_source_cleanup_job",
        "complete_public_source_cleanup_job",
        "release_public_source_cleanup_job",
      ]) {
        const start = sql.indexOf(`create or replace function public.${name}(`);
        const body = sql.slice(start, sql.indexOf("$$;", start));
        expect(body.indexOf("lock-order: upload-attempt"), name).toBeGreaterThan(body.indexOf("lock-order: version"));
      }
    });

    it("binds cleanup authority to each retired upload attempt instead of the mutable version pointer", () => {
      const sql = controlPlaneSql();
      expect(sql).toContain("add column public_source_upload_attempt_id uuid");
      expect(sql).toContain("unique (public_source_upload_attempt_id)");
      expect(sql).not.toContain("unique (public_source_reservation_id)");
      const triggerStart = sql.indexOf("create or replace function public.guard_public_source_cleanup_job_identity(");
      const trigger = sql.slice(triggerStart, sql.indexOf("$$;", triggerStart));
      expect(trigger).toContain("public.public_source_upload_attempts");
      expect(trigger).toContain("v_attempt.state is distinct from 'cleanup_pending'");
      expect(trigger).toContain("new.public_source_upload_attempt_id is distinct from v_attempt.id");
      expect(trigger).toContain("new.public_source_cleanup_not_before is distinct from v_attempt.cleanup_not_before");
      for (const name of [
        "claim_public_source_cleanup_job",
        "complete_public_source_cleanup_job",
        "release_public_source_cleanup_job",
      ]) {
        const start = sql.indexOf(`create or replace function public.${name}(`);
        const body = sql.slice(start, sql.indexOf("$$;", start));
        expect(body, name).toContain("public_source_upload_attempts");
        expect(body, name).toContain("v_attempt.state is distinct from 'cleanup_pending'");
        expect(body, name).toContain("v_job.public_source_upload_attempt_id");
      }
      const types = readFileSync("src/lib/supabase/database.types.ts", "utf8");
      expect(types).toContain("public_source_upload_attempts:");
      expect(types).toContain("public_source_upload_attempt_id:");
      expect(types).toContain("bind_public_source_upload_authority:");
      expect(types).toContain("reap_expired_public_source_upload_attempts:");
      const reaperStart = sql.indexOf("create or replace function public.reap_expired_public_source_upload_attempts(");
      const reaper = sql.slice(reaperStart, sql.indexOf("$$;", reaperStart));
      expect(reaper).toContain("attempt.state in ('authorized', 'bound')");
      expect(reaper).toContain("attempt.claim_expires_at <= pg_catalog.clock_timestamp()");
      expect(reaper).toContain("set state = 'cleanup_pending'");
      expect(reaper).toContain("perform public.schedule_public_source_upload_attempt_cleanup(v_attempt.id)");
    });

    it("withdraws atomically from retrieval and anonymous cache while preserving history", () => {
      const sql = controlPlaneSql();
      const start = sql.indexOf("create or replace function public.withdraw_public_source_version(");
      const body = sql.slice(start, sql.indexOf("$$;", start));
      expect(body).toContain("for update");
      expect(body).toContain("lifecycle = 'tombstoned'");
      expect(body).toContain("public.restore_public_source_document_to_steward(");
      expect(body).not.toContain("delete from public.document_publication_approvals");
      const helperStart = sql.indexOf("create or replace function public.restore_public_source_document_to_steward(");
      const helper = sql.slice(helperStart, sql.indexOf("$$;", helperStart));
      expect(helper).toContain("owner_id = p_steward_id");
      expect(helper).toContain("'public_corpus', false");
      expect(helper).toContain("delete from public.rag_response_cache");
      expect(helper).toContain("cache_kind in ('search', 'answer')");
    });

    it("keeps public-source functions off public, anon, and authenticated roles", () => {
      const sql = controlPlaneSql();
      for (const signature of [
        "record_public_source_activation(jsonb)",
        "preflight_public_source_acquisition(jsonb)",
        "reserve_public_source_version(jsonb)",
        "authorize_public_source_upload(jsonb)",
        "bind_public_source_upload_authority(jsonb)",
        "reap_expired_public_source_upload_attempts(integer)",
        "claim_public_source_cleanup_job(integer)",
        "complete_public_source_cleanup_job(uuid, uuid, integer)",
        "release_public_source_cleanup_job(uuid, uuid, text)",
        "finalize_public_source_version(jsonb, integer)",
        "abandon_public_source_reservation(jsonb)",
        "activate_public_source_version(uuid, uuid, jsonb, text, uuid[])",
        "transition_public_source_version(uuid, text, uuid)",
        "withdraw_public_source_version(uuid, uuid, text)",
      ]) {
        expect(sql).toContain(`revoke all on function public.${signature} from public, anon, authenticated`);
        expect(sql).toContain(`grant execute on function public.${signature} to service_role`);
      }
      expect(sql).toContain(
        "revoke all on function public.restore_public_source_document_to_steward(uuid, uuid, text) from public, anon, authenticated, service_role",
      );
      expect(sql).not.toContain(
        "grant execute on function public.restore_public_source_document_to_steward(uuid, uuid, text) to service_role",
      );
    });
  });
});

describe("Owner deletion must not republish private rows (#ZBAC9D)", () => {
  // A null `owner_id` independently means "public corpus" to retrieval:
  // `retrieval_owner_matches` and `retrieval_owner_matches_v2` both resolve the
  // public sentinel to `row_owner_id is null` and check no published marker. So
  // for any table whose OWN owner_id reaches one of those predicates, an
  // `on delete set null` foreign key lets deleting an auth user silently turn
  // that user's private rows public. Those four tables must be `on delete
  // restrict`, which makes the deletion fail instead.
  const VISIBILITY_TABLES = ["documents", "document_labels", "document_summaries", "document_table_facts"] as const;

  // Nulling the owner here is deliberate retention behaviour, NOT a visibility
  // signal: these rows are either filtered through their parent document's owner
  // or are audit/telemetry that must survive the account being removed. Widening
  // the restrict set to them is a different, unreviewed decision.
  const RETENTION_TABLES = [
    "document_sections",
    "document_embedding_fields",
    "document_memory_cards",
    "document_index_units",
    "document_index_quality",
    "import_batches",
    "audit_logs",
    "rag_queries",
    "rag_query_misses",
    "rag_retrieval_logs",
    "rag_answer_feedback",
    "rag_visual_eval_cases",
    "storage_cleanup_jobs",
  ] as const;

  const rawSchema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");

  function ownerDeleteAction(table: string): string | null {
    const start = rawSchema.search(new RegExp(String.raw`create table if not exists public\.${table}\s*\(`));
    if (start < 0) return null;
    const end = rawSchema.indexOf("\n);", start);
    const block = rawSchema.slice(start, end);
    const match = /owner_id uuid[^\n]*references auth\.users\(id\) on delete (set null|restrict|cascade)/.exec(block);
    return match ? match[1] : null;
  }

  it.each(VISIBILITY_TABLES)(
    "public.%s restricts owner deletion, so a deleted account cannot orphan rows into the public corpus",
    (table) => {
      expect(ownerDeleteAction(table)).toBe("restrict");
    },
  );

  it.each(RETENTION_TABLES)(
    "public.%s keeps its retention behaviour and is not swept into the restrict set",
    (table) => {
      expect(ownerDeleteAction(table)).not.toBe("restrict");
    },
  );

  it("no other table has quietly joined the restrict set", () => {
    const restricted = [...rawSchema.matchAll(/create table if not exists public\.([a-z0-9_]+)\s*\(/g)]
      .map((match) => match[1])
      .filter((table) => ownerDeleteAction(table) === "restrict");
    expect(restricted.sort()).toEqual([...VISIBILITY_TABLES].sort());
  });

  it("ships the migration that applies the restrict action to live", () => {
    const migration = readFileSync(
      new URL(
        "../supabase/migrations/20260901120000_restrict_owner_delete_on_public_visibility_tables.sql",
        import.meta.url,
      ),
      "utf8",
    );
    for (const table of VISIBILITY_TABLES) {
      expect(migration).toContain(
        `add constraint ${table}_owner_id_fkey\n  foreign key (owner_id) references auth.users(id) on delete restrict;`,
      );
    }
    // The migration must prove its own effect rather than trusting the recorded
    // history — the #Q5JHBJ "statements never executed" shape.
    expect(migration).toContain("c.confdeltype <> 'r'");
    expect(migration).toContain("raise exception");
  });
});

// #ZBAC9D, second half. The restrict set above closes the path that CREATES an ownerless
// row by deleting its owner. It does not make "ownerless" mean "published".
//
// retrieval_owner_matches resolves the public sentinel to `row_owner_id is null` and
// checks no publication marker, while the application requires two signals —
// src/lib/documents/is-public-document.ts returns
// `recordedOwnerId(...) === null && metadata.public_corpus === true`. The ledger proposed
// closing that by adding the marker check inside retrieval_owner_matches; the function
// receives two uuids and never sees metadata, so it cannot be written there. These
// assertions pin the route actually taken: constrain the WRITE side so the property
// retrieval already assumes is guaranteed, and leave every retrieval predicate alone.
describe("Ownerless documents must carry the publication marker (#ZBAC9D)", () => {
  const rawSchema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  const collapse = (value: string) => value.replace(/\s+/g, " ").trim();

  it("public.documents constrains an ownerless row to published or quarantined", () => {
    const start = rawSchema.search(/create table if not exists public\.documents\s*\(/);
    expect(start).toBeGreaterThanOrEqual(0);
    const block = rawSchema.slice(start, rawSchema.indexOf("\n);", start));
    expect(collapse(block)).toContain(
      collapse(`constraint documents_ownerless_requires_publication_marker check (
        owner_id is not null
        or metadata->'public_corpus' is not distinct from 'true'::jsonb
        or status = 'failed'
      )`),
    );
  });

  // `->` and `::jsonb`, never `->>` and a text literal. `metadata->>'public_corpus' = 'true'`
  // would also accept the JSON STRING "true", which retrieval's public branch would serve
  // while src/lib/documents/is-public-document.ts (`metadata.public_corpus === true`) refused
  // it — the same asymmetry as #ZBAC9D, one level down.
  it("tests the JSON boolean rather than its text rendering", () => {
    const start = rawSchema.indexOf("constraint documents_ownerless_requires_publication_marker");
    const definition = rawSchema.slice(start, rawSchema.indexOf("),", start));
    expect(definition).toContain("metadata->'public_corpus' is not distinct from 'true'::jsonb");
    expect(definition).not.toContain("->>");
  });

  // The defect this constraint shipped with, and the reason it is pinned in both directions.
  // A CHECK is satisfied when its expression is true OR NULL (PostgreSQL accepts an unknown
  // result), and `metadata->'public_corpus'` is NULL whenever the key is absent. With `=`,
  // an ownerless + unmarked + indexed row evaluated to false OR NULL OR false = NULL and was
  // ACCEPTED — the constraint was a no-op against the single shape it exists to reject, and
  // no preview database would show it, because none of them hold that shape. Found in review
  // on PR #2547.
  it("rejects an absent marker instead of letting NULL satisfy the check", () => {
    const start = rawSchema.indexOf("constraint documents_ownerless_requires_publication_marker");
    const definition = rawSchema.slice(start, rawSchema.indexOf("),", start));
    expect(definition).toMatch(/metadata->'public_corpus'\s+is not distinct from\s+'true'::jsonb/);
    expect(definition).not.toMatch(/metadata->'public_corpus'\s*=\s*'true'::jsonb/);
  });

  // The preflight scan and the constraint must express the SAME predicate. They disagreed
  // before this fix — the scan was null-safe, the constraint was not — which is exactly how a
  // migration passes its own preflight and then fails to constrain anything.
  it("scans for violations with the same null-safe predicate it constrains with", () => {
    const preflight = readFileSync(
      new URL(
        "../supabase/migrations/20260902110500_ownerless_documents_require_publication_marker.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(preflight).toContain("(metadata->'public_corpus') is distinct from 'true'::jsonb");
    expect(preflight).toContain("or metadata->'public_corpus' is not distinct from 'true'::jsonb");
  });

  // The third arm is load-bearing, not a loophole: the rollback strips the publication marker
  // from a row that lands ownerless, exactly so an owner-scoped row cannot become a public
  // one, and quarantines it in the same statement. Drop the arm and the constraint breaks the
  // rollback it exists to complement.
  //
  // Asserted against the effective definition rather than as a file-wide substring probe: the
  // original of that shape would have survived an inverted rollback, since both literals
  // appear elsewhere in the same file.
  it("keeps the quarantine arm aligned with the private-mode rollback", () => {
    const start = rawSchema.indexOf("create or replace function public.set_document_corpus_access_mode");
    expect(start).toBeGreaterThanOrEqual(0);
    const body = rawSchema.slice(start, rawSchema.indexOf("\n$$;", start));
    // Quarantine keys off where the row LANDS, not where it came from. The original
    // `snapshot.owner_id is not null` qualifier missed the row that was already ownerless and
    // unmarked at activation — the population 20260825025032's own header describes — and
    // restoring it as ownerless-unmarked-indexed would abort the whole call against the
    // constraint above.
    expect(collapse(body)).toContain(
      collapse(`status = case
        when existing_owner.id is null
          and not (
            snapshot.owner_id is null
            and snapshot.public_corpus_present
            and snapshot.public_corpus_value = 'true'::jsonb
          )
        then 'failed'
        else d.status
      end`),
    );
    expect(collapse(body)).not.toContain(
      collapse("when snapshot.owner_id is not null and existing_owner.id is null then 'failed'"),
    );
  });

  // The one retrieval RPC with no status filter, which is what made the gap reachable at
  // all: every other one already requires d.status = 'indexed', and the sole writer of an
  // ownerless unmarked row sets status = 'failed'. get_related_document_metadata_v2
  // delegates straight to this, so fixing v1 fixes both.
  it("get_related_document_metadata hydrates only indexed documents", () => {
    const marker = "CREATE OR REPLACE FUNCTION public.get_related_document_metadata(document_ids uuid[]";
    const start = rawSchema.indexOf(marker);
    expect(start, "effective get_related_document_metadata definition not found").toBeGreaterThanOrEqual(0);
    const body = rawSchema.slice(start, rawSchema.indexOf("$function$;", start));
    expect(collapse(body)).toContain(
      collapse(`where d.id = any(document_ids)
        and d.status = 'indexed'
        and public.retrieval_owner_matches(owner_filter, d.owner_id)`),
    );
  });

  it("ships the migrations that apply the invariant to live, and a guard that proves they ran", () => {
    const read = (file: string) => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");

    // The status filter.
    expect(read("20260902110000_related_document_metadata_status_filter.sql")).toContain("and d.status = 'indexed'");

    // Preflight scan, then ADD CONSTRAINT ... NOT VALID only — the 20260827100000 shape, so
    // ACCESS EXCLUSIVE is not held across a full-table scan in the same transaction.
    const constraintMigration = read("20260902110500_ownerless_documents_require_publication_marker.sql");
    expect(constraintMigration).toContain("raise exception");
    expect(constraintMigration).toContain("add constraint documents_ownerless_requires_publication_marker");
    expect(constraintMigration).toContain("not valid");

    // VALIDATE in its own migration/transaction — SHARE UPDATE EXCLUSIVE, reads and writes
    // continue. Mirrors 20260827100500.
    expect(read("20260902111000_validate_ownerless_publication_marker_constraint.sql")).toContain(
      "validate constraint documents_ownerless_requires_publication_marker",
    );

    // The guard validates and never builds (the 20260804110240 pattern): no CREATE/ALTER of
    // the objects it checks, timeouts scoped with SET LOCAL, exactly one raise.
    const guard = read("20260902111500_validate_ownerless_publication_invariant.sql");
    expect(guard).toMatch(/set\s+local\s+lock_timeout/i);
    expect(guard).toMatch(/set\s+local\s+statement_timeout/i);
    expect(guard.match(/raise\s+exception/gi) ?? []).toHaveLength(1);
    // No trailing space in the pattern: `alter table\n  documents` must not slip past.
    expect(guard).not.toMatch(/^\s*(?:alter\s+table|create\s+or\s+replace\s+function)\b/im);
    // Presence, enforcement, definition, and behaviour — the four things a function or
    // constraint can independently fail at.
    expect(guard).toContain("documents_ownerless_requires_publication_marker");
    expect(guard).toContain("convalidated");
    expect(guard).toContain("pg_get_constraintdef");
    expect(guard).toContain("to_regprocedure('public.get_related_document_metadata(uuid[],uuid)')");
    expect(guard).toContain("public.retrieval_owner_matches(sentinel, null::uuid)");

    // The rollback widening must be ordered BEFORE the constraint, so the return-to-private
    // control is safe before the CHECK that would otherwise abort it exists.
    const rollbackFix = read("20260902110200_quarantine_ownerless_unpublished_on_private_rollback.sql");
    expect(rollbackFix).toContain("create or replace function public.set_document_corpus_access_mode");
    expect("20260902110200" < "20260902110500").toBe(true);

    // The constraint migration must verify the widened rollback is INSTALLED, not count
    // snapshot rows. An earlier draft did the latter and was wrong in the way that matters:
    // while the corpus is in public mode the legacy ownerless-unmarked population — the very
    // rows this change exists for, 2851 in production — is exactly the shape that scan
    // counted, so it would have aborted the migration on real data while a preview database
    // with no such rows passed cleanly. 20260902110200 does not rewrite those snapshot rows
    // and never claimed to; it changes what the rollback DOES with them. Found in review on
    // PR #2547.
    expect(constraintMigration).toContain("pg_catalog.to_regprocedure('public.set_document_corpus_access_mode(text)')");
    expect(constraintMigration).toContain("pg_catalog.pg_get_functiondef");
    expect(constraintMigration).not.toContain("from public.document_corpus_access_snapshots");
  });

  // The guard's definition comparison is the highest-risk logic in the change and cannot be
  // executed anywhere offline — there is no Postgres in this environment. So the normalizer is
  // reimplemented here and asserted against hard-coded pg_get_constraintdef renders, including
  // the extra parens and casts Postgres adds that the source text does not have. If this and
  // the SQL ever disagree, the guard raises on a correct database and aborts a live migration.
  it("the guard's definition normalizer matches what Postgres actually renders", () => {
    const normalize = (value: string) =>
      value
        .toLowerCase()
        .replaceAll("::text", "")
        .replaceAll("(", "")
        .replaceAll(")", "")
        .replaceAll(" ", "")
        .replace(/\s+/g, "")
        .trim();

    // NOT (x IS DISTINCT FROM y), not x IS NOT DISTINCT FROM y — even though the migration
    // source writes the latter. Postgres does not store that spelling; the parser rewrites it.
    // The first version of this guard expected the source spelling, and this test PASSED
    // anyway, because it compared the normalizer against the same wrong render the guard
    // used. Migration replay caught it on a real database. An offline reimplementation can
    // only ever check the render you assumed, so the render below is the one CI actually
    // observed from pg_get_constraintdef, quoted verbatim, not a hand-written guess.
    const expected = normalize(
      "CHECK (owner_id IS NOT NULL OR NOT (metadata->'public_corpus' IS DISTINCT FROM 'true'::jsonb) OR status = 'failed')",
    );

    for (const render of [
      // Observed on 2026-09-02, run 33604053672, head 4862888a.
      "CHECK (((owner_id IS NOT NULL) OR (NOT ((metadata -> 'public_corpus'::text) IS DISTINCT FROM 'true'::jsonb)) OR (status = 'failed'::text)))",
      "CHECK ((owner_id IS NOT NULL) OR (NOT ((metadata -> 'public_corpus'::text) IS DISTINCT FROM 'true'::jsonb)) OR ((status)::text = 'failed'::text))",
    ]) {
      expect(normalize(render), render).toBe(expected);
    }

    // The spelling the source uses must NOT normalize to the same string. If it did, this
    // test would go on passing through exactly the mistake that broke Migration replay.
    expect(
      normalize(
        "CHECK (((owner_id IS NOT NULL) OR ((metadata -> 'public_corpus'::text) IS NOT DISTINCT FROM 'true'::jsonb) OR (status = 'failed'::text)))",
      ),
    ).not.toBe(expected);

    // The ::jsonb cast is deliberately NOT stripped — it is what makes the predicate test the
    // JSON boolean rather than its text rendering, so a `->>`/text variant must NOT normalize
    // to the same string.
    expect(
      normalize(
        "CHECK (((owner_id IS NOT NULL) OR ((metadata ->> 'public_corpus'::text) = 'true'::text) OR (status = 'failed'::text)))",
      ),
    ).not.toBe(expected);

    // And the guard ships that exact expected literal.
    const guard = readFileSync(
      new URL("../supabase/migrations/20260902111500_validate_ownerless_publication_invariant.sql", import.meta.url),
      "utf8",
    );
    expect(guard).toContain(
      "'CHECK (owner_id IS NOT NULL OR NOT (metadata->''public_corpus'' IS DISTINCT FROM ''true''::jsonb) OR status = ''failed'')'",
    );
  });
});
